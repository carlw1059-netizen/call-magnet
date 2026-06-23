// log-click: records a Middle Man page visit (page load) for click analytics.
//
// Auth: verify_jwt = false — called directly from the customer's browser on /b/<slug>.
//
// Always returns 200 OK. If the slug doesn't resolve to an active client, or if
// any DB write fails, the error is logged server-side but the caller gets 200 so
// the customer's page load is never blocked by a logging failure.
//
// Request: POST application/json
//   slug       string — middle_man_slug value (required)
//   user_agent string — navigator.userAgent (required)
//   referrer   string — document.referrer (optional, may be empty)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    console.warn('log-click: malformed JSON body');
    return OK;
  }

  const slug      = typeof body.slug       === 'string' ? body.slug.trim()       : '';
  const userAgent = typeof body.user_agent === 'string' ? body.user_agent.trim() : '';
  const referrer  = typeof body.referrer   === 'string' ? body.referrer.trim()   : '';

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
  const { error: insertErr } = await supa
    .from('link_clicks')
    .insert({
      client_id:   clientRow.id,
      clicked_at:  new Date().toISOString(),
      rebrand_id:  'cm1.au/' + slug,
      user_agent:  userAgent,
      device_type: device_type,
      referrer:    referrer,
      country:     null,
      city:        null,
      raw_payload: body,
    });

  if (insertErr) {
    console.error(`log-click: link_clicks insert failed for client ${clientRow.id}:`, insertErr.message);
  }

  return OK;
});
