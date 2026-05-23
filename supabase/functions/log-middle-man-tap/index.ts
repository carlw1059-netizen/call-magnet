// log-middle-man-tap: records a Middle Man landing page button tap.
//
// Auth: verify_jwt = false — called directly from the customer's browser on /b/<slug>.
//
// Always returns 200 OK. If the slug doesn't resolve to an active client, or if
// any DB write fails, the error is logged server-side but the caller gets 200 so
// the customer's redirect is never blocked by a logging failure.
//
// Request: POST application/json
//   slug            string  — middle_man_slug value (required)
//   intent          string  — button label tapped, max 60 chars (required)
//   customer_number string  — E.164 phone number, optional (sourced from SMS link context)
//
// Warmup: GET ?warmup=1 → 200 { warmup: 'ok' }
//
// Side-effects on success:
//   1. INSERT into link_clicks: client_id, clicked_at, intent, customer_number
//   2. POST to send-client-notification (event: 'link_tapped') — fire-and-forget

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET           = Deno.env.get('INTERNAL_SECRET');

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const OK = new Response(JSON.stringify({ ok: true }), {
  status:  200,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

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
    // Malformed JSON — log and return 200 (don't interrupt the customer's tap flow)
    console.warn('log-middle-man-tap: malformed JSON body');
    return OK;
  }

  const slug           = typeof body.slug   === 'string' ? body.slug.trim()   : '';
  const intent         = typeof body.intent === 'string' ? body.intent.trim() : '';
  const customerNumber = typeof body.customer_number === 'string' ? body.customer_number.trim() : null;

  if (!slug || !intent) {
    console.warn('log-middle-man-tap: missing slug or intent — tap not logged');
    return OK;
  }
  if (intent.length > 60) {
    console.warn(`log-middle-man-tap: intent too long (${intent.length} chars) — truncating`);
  }
  const intentSafe = intent.slice(0, 60);

  // ── Resolve client from slug ────────────────────────────────────────────────
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: clientRow, error: clientErr } = await supa
    .from('clients')
    .select('id')
    .eq('middle_man_slug', slug)
    .eq('account_status', 'active')
    .maybeSingle();

  if (clientErr) {
    console.error(`log-middle-man-tap: client lookup error for slug "${slug}":`, clientErr.message);
    return OK; // log failure — never block the customer
  }
  if (!clientRow) {
    // Slug not found or client inactive — return 200 silently (don't expose client existence)
    return OK;
  }

  const clientId = clientRow.id as string;
  const now      = new Date().toISOString();

  // ── Insert into link_clicks ─────────────────────────────────────────────────
  const insertPayload: Record<string, unknown> = {
    client_id:  clientId,
    clicked_at: now,
    intent:     intentSafe,
  };
  if (customerNumber) {
    insertPayload.customer_number = customerNumber;
  }

  const { error: insertErr } = await supa
    .from('link_clicks')
    .insert(insertPayload);

  if (insertErr) {
    console.error(`log-middle-man-tap: link_clicks insert failed for client ${clientId}:`, insertErr.message);
    // Continue to notification even if insert fails
  }

  // ── Fire-and-forget: send-client-notification (event: link_tapped) ──────────
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
        context:   { intent: intentSafe, customer_number: customerNumber ?? 'unknown' },
      }),
    }).catch((err) => {
      console.warn(`log-middle-man-tap: send-client-notification fire-and-forget failed: ${err?.message ?? err}`);
    });
  } else {
    console.warn('log-middle-man-tap: INTERNAL_SECRET not configured — skipping send-client-notification');
  }

  return OK;
});
