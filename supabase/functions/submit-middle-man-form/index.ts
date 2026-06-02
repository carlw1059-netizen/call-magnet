// submit-middle-man-form: handles all form submissions from the Middle Man
// customer-facing landing page (/b/<slug>).
//
// Auth: verify_jwt = false — public endpoint, called directly from the browser.
//
// Always returns 200 { ok: true }. Server-side errors are logged but never
// surfaced to the caller so the customer-facing screen never shows an error.
//
// Warmup: GET ?warmup=1 → 200 { warmup: 'ok' }
//
// Request: POST application/json
//   slug                 string  — middle_man_slug (required)
//   form_type            string  — 'change_cancel'|'function'|'late_arrival'|'lost_found'|'something_else'
//   caller_name          string  — required
//   caller_phone         string  — required, AU phone format
//   original_booking_time string — optional
//   requested_change     string  — optional
//   note                 string  — optional, max 200 chars
//
// Side-effects on success:
//   1. INSERT into middle_man_form_submissions
//   2. POST to send-client-notification (event: 'link_tapped') — fire-and-forget

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET           = Deno.env.get('INTERNAL_SECRET');

const VALID_FORM_TYPES = new Set([
  'change_cancel', 'function', 'late_arrival', 'lost_found', 'something_else',
]);

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const OK = new Response(JSON.stringify({ ok: true }), {
  status:  200,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

function err400(message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status:  400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── AU phone validation ────────────────────────────────────────────────────────
// Accepts: 04XXXXXXXX, 4XXXXXXXX, +614XXXXXXXX, 614XXXXXXXX, 0[2-9]XXXXXXXX
function isValidAuPhone(raw: string): boolean {
  const stripped = raw.replace(/\s+/g, '');
  return /^(\+614\d{8}|04\d{8}|4\d{8}|614\d{8}|0[2-9]\d{8})$/.test(stripped);
}

// ── Normalise phone to E.164 ───────────────────────────────────────────────────
function toE164(raw: string): string {
  const s = raw.replace(/\s+/g, '');
  if (s.startsWith('+61'))  return s;
  if (s.startsWith('614'))  return '+' + s;
  if (s.startsWith('04'))   return '+61' + s.slice(1);
  if (s.startsWith('0'))    return '+61' + s.slice(1);
  return '+61' + s;
}

// ── SHA-256 hex of a string ────────────────────────────────────────────────────
async function sha256hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Build the push notification message for the business owner ─────────────────
function buildPushMessage(
  businessName: string,
  formType: string,
  callerName: string,
  callerPhone: string,
  originalBookingTime: string,
  requestedChange: string,
  note: string,
  companyName: string,
): string {
  const bn = businessName;
  const cn = callerName;
  const ph = callerPhone;
  switch (formType) {
    case 'change_cancel':
      return `★ ${bn} — CHANGE/CANCEL REQUEST — ${cn} — ${ph} — ${originalBookingTime} — ${requestedChange}`;
    case 'function': {
      const co = companyName ? ` (${companyName})` : '';
      return `★ ${bn} — FUNCTION ENQUIRY — ${cn}${co} — ${ph} — ${note}`;
    }
    case 'late_arrival':
      return `★ ${bn} — LATE ARRIVAL — ${cn} — ${ph} — booked ${originalBookingTime} — running ${note}`;
    case 'lost_found':
      return `★ ${bn} — LOST & FOUND — ${cn} — ${ph} — ${note}`;
    case 'something_else':
    default:
      return `★ ${bn} — ENQUIRY — ${cn} — ${ph} — ${note}`;
  }
}


Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── Warmup ─────────────────────────────────────────────────────────────────
  if (new URL(req.url).searchParams.get('warmup') === '1') {
    return new Response(JSON.stringify({ warmup: 'ok' }), {
      status:  200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err400('Invalid JSON body');
  }

  const slug                = typeof body.slug                 === 'string' ? body.slug.trim()                : '';
  const formType            = typeof body.form_type            === 'string' ? body.form_type.trim()           : '';
  const callerName          = typeof body.caller_name          === 'string' ? body.caller_name.trim()         : '';
  const callerPhone         = typeof body.caller_phone         === 'string' ? body.caller_phone.trim()        : '';
  const originalBookingTime = typeof body.original_booking_time === 'string' ? body.original_booking_time.trim() : '';
  const requestedChange     = typeof body.requested_change     === 'string' ? body.requested_change.trim()    : '';
  const rawNote             = typeof body.note                 === 'string' ? body.note.trim()                : '';
  const note                = rawNote.slice(0, 200);
  const companyName         = typeof body.company_name         === 'string' ? body.company_name.trim().slice(0, 100) : '';

  // ── Validate required fields ────────────────────────────────────────────────
  if (!slug)       return err400('Missing slug');
  if (!formType)   return err400('Missing form_type');
  if (!callerName) return err400('Missing caller_name');
  if (!callerPhone) return err400('Missing caller_phone');

  if (!VALID_FORM_TYPES.has(formType)) {
    return err400(`Invalid form_type: ${formType}`);
  }

  if (!isValidAuPhone(callerPhone)) {
    return err400('caller_phone must be a valid Australian phone number (e.g. 04XX XXX XXX)');
  }

  // ── Look up client ──────────────────────────────────────────────────────────
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: clientRow, error: clientErr } = await supa
    .from('clients')
    .select('id, business_name')
    .eq('middle_man_slug', slug)
    .eq('account_status', 'active')
    .maybeSingle();

  if (clientErr) {
    console.error(`submit-middle-man-form: client lookup error for slug "${slug}":`, clientErr.message);
    return err400('Client not found');
  }
  if (!clientRow) {
    return err400('Client not found or inactive');
  }

  const clientId    = clientRow.id as string;
  const businessName = (clientRow.business_name as string) || 'The business';

  // ── Hash caller IP ──────────────────────────────────────────────────────────
  const ipRaw  = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const ipFirst = ipRaw.split(',')[0].trim();
  let ipHash: string | null = null;
  try {
    ipHash = await sha256hex(ipFirst);
  } catch {
    // Non-critical — proceed without hash
  }

  const userAgent = req.headers.get('user-agent') ?? null;

  // ── INSERT form submission ──────────────────────────────────────────────────
  const insertPayload: Record<string, unknown> = {
    client_id:  clientId,
    form_type:  formType,
    caller_name:  callerName,
    caller_phone: callerPhone,
    submitted_at: new Date().toISOString(),
  };
  if (originalBookingTime) insertPayload.original_booking_time = originalBookingTime;
  if (requestedChange)     insertPayload.requested_change      = requestedChange;
  if (note)                insertPayload.note                  = note;
  if (ipHash)              insertPayload.ip_hash               = ipHash;
  if (userAgent)           insertPayload.user_agent            = userAgent;

  const { error: insertErr } = await supa
    .from('middle_man_form_submissions')
    .insert(insertPayload);

  if (insertErr) {
    console.error(`submit-middle-man-form: insert failed for client ${clientId}:`, insertErr.message);
    // Non-fatal — still fire notifications and return 200
  }

  // ── Fire-and-forget: send-client-notification ───────────────────────────────
  const pushMessage = buildPushMessage(
    businessName, formType, callerName, callerPhone,
    originalBookingTime, requestedChange, note, companyName,
  );

  if (INTERNAL_SECRET) {
    fetch(`${SUPABASE_URL}/functions/v1/send-client-notification`, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'X-Internal-Secret': INTERNAL_SECRET,
        Authorization:       `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        client_id: clientId,
        event:     'link_tapped',
        context:   {
          intent:          pushMessage.slice(0, 250),
          customer_number: toE164(callerPhone),
        },
      }),
    }).catch((e) => {
      console.warn(`submit-middle-man-form: send-client-notification failed: ${e?.message ?? e}`);
    });

  } else {
    console.warn('submit-middle-man-form: INTERNAL_SECRET not configured — skipping notifications');
  }

  return OK;
});
