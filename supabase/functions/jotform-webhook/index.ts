// jotform-webhook: receives a POST from JotForm when a client agreement form
// is submitted and creates a new row in public.clients.
//
// Auth: X-Jotform-Secret header must match JOTFORM_WEBHOOK_SECRET from Vault.
// Missing or wrong secret → 401.
//
// Body: application/x-www-form-urlencoded (JotForm default webhook format).
// Field mapping:
//   q6_businessName   / q6  → business_name (required)
//   q7_clientName     / q7  → owner_name
//   q8_abn            / q8  → abn
//   q9_businessNumber / q9  → owner_phone
//   q10_bookingUrl    / q10 → booking_url
//   q11_emailAddress  / q11 → email (required)
//
// After a successful insert, fires a Pushover alert (fire-and-forget).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JOTFORM_WEBHOOK_SECRET    = Deno.env.get('JOTFORM_WEBHOOK_SECRET');
const INTERNAL_SECRET           = Deno.env.get('INTERNAL_SECRET');

Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get('warmup') === '1') {
    return new Response(JSON.stringify({ warmup: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // ── Secret verification ────────────────────────────────────────────────────
  const providedSecret = req.headers.get('X-Jotform-Secret') || new URL(req.url).searchParams.get('secret');
  if (!JOTFORM_WEBHOOK_SECRET || providedSecret !== JOTFORM_WEBHOOK_SECRET) {
    return json(401, { error: 'unauthorized' });
  }

  // ── Parse form body ────────────────────────────────────────────────────────
  let params: URLSearchParams;
  try {
    const text = await req.text();
    params = new URLSearchParams(text);
  } catch {
    return json(400, { error: 'invalid_body', detail: 'Could not parse form body' });
  }

  function field(...names: string[]): string {
    for (const name of names) {
      const v = params.get(name)?.trim() ?? '';
      if (v) return v;
    }
    return '';
  }

  const businessName = field('q6_businessName',  'q6');
  const ownerName    = field('q7_clientName',     'q7');
  const abn          = field('q8_abn',            'q8');
  const ownerPhone   = field('q9_businessNumber', 'q9');
  const bookingUrl   = field('q10_bookingUrl',    'q10');
  const email        = field('q11_emailAddress',  'q11');

  // ── Required field validation ──────────────────────────────────────────────
  if (!businessName) return json(400, { error: 'missing_required_field', detail: 'business_name (q6) is required' });
  if (!email)        return json(400, { error: 'missing_required_field', detail: 'email (q11) is required' });

  // ── Build row ──────────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    business_name:            businessName,
    email,
    plan_type:                'bronze',
    sms_included:             50,
    account_status:           'active',
    is_test_account:          false,
    must_change_password:     true,
    middle_man_enabled:       false,
    middle_man_buttons:       [],
    middle_man_show_whats_on: false,
    palette_v2_reset:         false,
    theme_preference:         'emerald',
    vertical:                 'restaurant',
    terms_accepted:           true,
    terms_accepted_at:        now,
    customer_sms_template:    'Hi — we missed your call. Book online: {booking_url} Reply STOP to opt out',
  };
  if (ownerName)  row.owner_name  = ownerName;
  if (abn)        row.abn         = abn;
  if (ownerPhone) row.owner_phone = ownerPhone;
  if (bookingUrl) row.booking_url = bookingUrl;

  // ── Insert into public.clients ─────────────────────────────────────────────
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/clients`, {
    method:  'POST',
    headers: {
      apikey:         SUPABASE_SERVICE_ROLE_KEY,
      Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'return=minimal',
    },
    body: JSON.stringify(row),
  });

  if (!insertRes.ok) {
    const detail = await insertRes.text();
    console.error(`jotform-webhook: insert failed ${insertRes.status}: ${detail}`);
    return json(500, { error: 'insert_failed', detail: detail.slice(0, 500) });
  }

  console.log(`jotform-webhook: client created business_name="${businessName}" email="${email}"`);

  // ── Pushover alert (fire-and-forget) ──────────────────────────────────────
  if (INTERNAL_SECRET) {
    try {
      fetch(`${SUPABASE_URL}/functions/v1/send-pushover-alert`, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'X-Internal-Secret': INTERNAL_SECRET,
        },
        body: JSON.stringify({
          title:   '★ New Client Signed',
          message: `${businessName} — ${email}`,
        }),
      }).catch(() => {});
    } catch {
      // silent
    }
  }

  return json(200, { ok: true });
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
