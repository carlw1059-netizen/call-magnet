// log-click: records a Middle Man page visit (page load) for click analytics.
// Also records individual social icon taps when an intent is supplied.
//
// Auth: verify_jwt = false — called directly from the customer's browser on /b/<slug>.
//
// Always returns 200 OK. If the slug doesn't resolve to an active client, or if
// any DB write fails, the error is logged server-side but the caller gets 200 so
// the customer's page load is never blocked by a logging failure.
//
// Request: POST application/json OR text/plain (for sendBeacon compatibility)
//   slug       string — middle_man_slug value (required)
//   user_agent string — navigator.userAgent (required)
//   referrer   string — document.referrer (optional, may be empty)
//   intent     string — social icon tap intent (optional); must be one of the
//                       SOCIAL_INTENTS allowlist; ignored if not recognised

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SOCIAL_INTENTS = new Set([
  'social_instagram', 'social_facebook', 'social_tiktok',
  'social_youtube',   'social_whatsapp', 'social_spotify', 'social_soundcloud',
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

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── Non-POST methods ────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return OK;
  }

  // ── Parse body (application/json or text/plain for sendBeacon) ─────────────
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    body = JSON.parse(raw);
  } catch {
    console.warn('log-click: malformed JSON body');
    return OK;
  }

  const slug      = typeof body.slug       === 'string' ? body.slug.trim()       : '';
  const userAgent = typeof body.user_agent === 'string' ? body.user_agent.trim() : '';
  const referrer  = typeof body.referrer   === 'string' ? body.referrer.trim()   : '';
  const rawIntent = typeof body.intent     === 'string' ? body.intent.trim()     : '';
  const intent    = SOCIAL_INTENTS.has(rawIntent) ? rawIntent : null;

  if (!slug) {
    console.warn('log-click: missing slug — click not logged');
    return OK;
  }

  // ── Resolve client from slug ────────────────────────────────────────────────
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: clientRow, error: clientErr } = await supa
    .from('clients')
    .select('id')
    .eq('middle_man_slug', slug)
    .eq('account_status', 'active')
    .eq('is_test_account', false)
    .limit(1)
    .maybeSingle();

  if (clientErr) {
    console.error(`log-click: client lookup error for slug "${slug}":`, clientErr.message);
    return OK;
  }
  if (!clientRow) {
    console.warn(`log-click: no active client found for slug "${slug}"`);
    return OK;
  }

  // ── Detect device type ──────────────────────────────────────────────────────
  const device_type = /Mobile|Android/i.test(userAgent) ? 'mobile' : 'desktop';

  // ── Insert into link_clicks ─────────────────────────────────────────────────
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/link_clicks`, {
    method:  'POST',
    headers: {
      apikey:         SUPABASE_SERVICE_ROLE_KEY,
      Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'return=minimal',
    },
    body: JSON.stringify({
      client_id:   clientRow.id,
      clicked_at:  new Date().toISOString(),
      rebrand_id:  'cm1.au/' + slug,
      user_agent:  userAgent,
      device_type: device_type,
      referrer:    referrer,
      country:     null,
      city:        null,
      intent:      intent,
      raw_payload: body,
    }),
  });

  if (!insertRes.ok) {
    const detail = await insertRes.text();
    console.error('log-click: insert failed ' + insertRes.status + ': ' + detail);
  } else {
    console.log('log-click: click recorded slug=' + slug);
  }

  return OK;
});
