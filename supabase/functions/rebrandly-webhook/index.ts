// rebrandly-webhook: receives rebrand.ly webhook POSTs whenever a tracked
// short-link is clicked. Looks up which client owns the rebrand.ly link ID
// and inserts a row in link_clicks for analytics.
//
// Dormant until rebrand.ly Pro is configured: free tier doesn't fire
// webhooks, and the seeded REBRANDLY_WEBHOOK_SECRET is the literal string
// 'PENDING_UPGRADE' so any incoming traffic naturally fails the auth check
// (real rebrand.ly won't ever send 'PENDING_UPGRADE' as its signature).
// On Pro upgrade, rotate the secret to the real value via
// `supabase secrets set REBRANDLY_WEBHOOK_SECRET=<value>` — zero code change.
//
// Auth: shared-secret on the Authorization header. The exact rebrand.ly
// signature scheme will be confirmed at upgrade time; if Pro turns out to
// use HMAC body signing instead, this validation becomes a constant-time
// hex compare against an HMAC-SHA256 digest. Until then, simple string
// match keeps the dormant function fail-closed.
//
// Auth posture: deployed with --no-verify-jwt (rebrand.ly doesn't send
// Bearer tokens). The function URL plus the shared secret form the auth
// layer. Same posture as twilio-missed-call / stripe-* webhook receivers.
//
// Payload (rebrand.ly standard, application/json — defensive parsing):
//   id          rebrand.ly's link ID                    → link_clicks.rebrand_id
//   clickedAt   ISO timestamp                           → link_clicks.clicked_at
//   device      'mobile' | 'desktop' | 'tablet' | …    → link_clicks.device_type
//   country     country name or ISO code                → link_clicks.country
//   city        city name                               → link_clicks.city
//   referrer    URL string                              → link_clicks.referrer
//   userAgent   UA string                               → link_clicks.user_agent
//
// Orphaned webhooks (rebrand_id doesn't match any clients.rebrandly_link_id)
// are skipped with a warning log + 200 OK — same posture as
// twilio-missed-call's orphan handling. Returning 200 stops rebrand.ly's
// retry loop on irrecoverably mis-mapped events.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { BRAND, escapeHtml, renderEmailShell } from "../_shared/emailStyles.ts";

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const REBRANDLY_WEBHOOK_SECRET  = Deno.env.get('REBRANDLY_WEBHOOK_SECRET');
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY');
const ALERT_TO                  = 'car312@hotmail.com';

interface RebrandlyPayload {
  id?:        string;
  clickedAt?: string;
  device?:    string;
  country?:   string;
  city?:      string;
  referrer?:  string;
  userAgent?: string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    if (!REBRANDLY_WEBHOOK_SECRET) {
      console.error('rebrandly-webhook: REBRANDLY_WEBHOOK_SECRET missing from env');
      return json(500, { error: 'config_error', detail: 'webhook secret not configured' });
    }

    if (REBRANDLY_WEBHOOK_SECRET === 'PENDING_UPGRADE') {
      // Dormant phase — log so the path through is debuggable, then continue
      // into normal validation (which will reject because no real signature
      // equals 'PENDING_UPGRADE').
      console.warn('rebrandly-webhook: secret still set to PENDING_UPGRADE placeholder — function is in dormant mode');
    }

    // ── auth: Authorization header must equal the shared secret ──────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    if (authHeader !== REBRANDLY_WEBHOOK_SECRET) {
      return json(401, { error: 'unauthorized' });
    }

    // ── parse JSON body ──────────────────────────────────────────────────────
    let payload: RebrandlyPayload;
    let rawText: string;
    try {
      rawText = await req.text();
      payload = rawText.length > 0 ? JSON.parse(rawText) : {};
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      return json(400, { error: 'bad_json', detail: msg });
    }

    const rebrandId = (payload.id ?? '').toString().trim();
    if (!rebrandId) {
      return json(400, { error: 'missing_required_field', detail: 'payload.id is required' });
    }

    // ── look up client by rebrandly_link_id ──────────────────────────────────
    const lookupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?rebrandly_link_id=eq.${encodeURIComponent(rebrandId)}&select=id,business_name`,
      {
        headers: {
          apikey:        SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!lookupRes.ok) {
      throw new Error(`client_lookup_failed: ${lookupRes.status} ${await lookupRes.text()}`);
    }
    const matched = await lookupRes.json() as { id: string; business_name: string }[];

    // ── orphaned: no client owns this rebrand.ly link ID ─────────────────────
    if (matched.length === 0) {
      console.warn(`orphaned_rebrandly_click: no client found for rebrand_id=${rebrandId}`);
      return json(200, { ok: true, skipped: 'no_client_for_rebrand_id' });
    }
    const clientId = matched[0].id;

    // ── insert link_clicks row ───────────────────────────────────────────────
    // clicked_at falls back to now() if rebrand.ly didn't send one. raw_payload
    // captures the full body for debugging, especially during initial Pro
    // setup when field shapes may surprise us.
    const clickedAtIso = (payload.clickedAt ?? '').toString().trim() || new Date().toISOString();

    const insertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/link_clicks`,
      {
        method: 'POST',
        headers: {
          apikey:        SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer:        'return=representation',
        },
        body: JSON.stringify({
          client_id:   clientId,
          rebrand_id:  rebrandId,
          clicked_at:  clickedAtIso,
          device_type: payload.device   ?? null,
          country:     payload.country  ?? null,
          city:        payload.city     ?? null,
          referrer:    payload.referrer ?? null,
          user_agent:  payload.userAgent ?? null,
          raw_payload: payload,
        }),
      },
    );

    if (!insertRes.ok) {
      throw new Error(`insert_failed: ${insertRes.status} ${await insertRes.text()}`);
    }

    const inserted = await insertRes.json() as { id: number }[];
    return json(200, { ok: true, id: inserted[0]?.id, client_id: clientId });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`rebrandly-webhook fatal: ${errMsg}`);

    // Fire-and-forget alert email; suppressing alerting failure so a Resend
    // outage can't cascade into the webhook itself failing.
    if (RESEND_API_KEY) {
      const alertContent = `
        <h1 style="font-size:22px;font-weight:700;color:${BRAND.primaryText};margin:0 0 4px;letter-spacing:-0.01em;">⚠️ rebrandly-webhook failed</h1>
        <p style="font-size:14px;color:${BRAND.secondaryText};margin:0 0 16px;">A link-tap webhook errored — rebrand.ly may retry, but investigate.</p>
        <p style="font-size:13px;color:${BRAND.primaryText};margin:0 0 8px;"><strong>Function:</strong> rebrandly-webhook</p>
        <p style="font-size:13px;color:${BRAND.primaryText};margin:0 0 8px;"><strong>Error:</strong> ${escapeHtml(errMsg)}</p>
        <p style="font-size:13px;color:${BRAND.primaryText};margin:0 0 16px;"><strong>Time:</strong> ${new Date().toISOString()}</p>
        <p style="font-size:13px;color:${BRAND.secondaryText};margin:0;">Investigate in Supabase logs.</p>
      `;
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'CallMagnet Alerts <hello@callmagnet.com.au>',
          to: ALERT_TO,
          subject: '⚠️ CallMagnet — rebrandly-webhook failed',
          html: renderEmailShell(alertContent, 'rebrandly-webhook failed — investigate in Supabase logs'),
        }),
      }).catch(() => {});
    }

    return json(500, { error: 'internal_error', detail: errMsg });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
