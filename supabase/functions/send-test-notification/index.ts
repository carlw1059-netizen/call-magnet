// send-test-notification: sends a fake missed-call push notification to the
// authenticated admin's registered device(s) via Progressier. Used for demo
// screenshots and testing the notification pipeline without a real missed call.
//
// Auth: verify_jwt = true (Supabase gateway validates the JWT before this
// function runs). We additionally enforce app_metadata.is_admin === true by
// decoding the JWT payload — no extra network hop required.
//
// Request body (application/json):
//   client_id  string  optional — Progressier subscriber ID to notify.
//                      Falls back to looking up the admin's own client row
//                      by email if omitted or null.
//
// Progressier push:
//   title:  'CallMagnet — Test Alert'
//   body:   '📱 Test — missed call from 0412 000 000. SMS sent to caller.'
//   url:    'https://callmagnet.com.au'

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PROGRESSIER_API_KEY       = Deno.env.get('PROGRESSIER_API_KEY');

const PUSH_TITLE = 'CallMagnet — Test Alert';
const PUSH_BODY  = '📱 Test — missed call from 0412 000 000. SMS sent to caller.';
const PUSH_URL   = 'https://callmagnet.com.au';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  }

  if (new URL(req.url).searchParams.get('warmup') === '1') {
    return new Response(JSON.stringify({ warmup: 'ok' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  try {
    // ── Decode JWT payload (gateway already verified the signature) ──────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const parts = token.split('.');
    if (parts.length !== 3) {
      return json(401, { error: 'unauthorized', detail: 'invalid token format' });
    }

    let claims: Record<string, unknown>;
    try {
      const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const jsonStr = atob(padded.padEnd(padded.length + (4 - (padded.length % 4)) % 4, '='));
      claims = JSON.parse(jsonStr);
    } catch {
      return json(401, { error: 'unauthorized', detail: 'could not decode token' });
    }

    // ── Require is_admin === true ─────────────────────────────────────────────
    const appMeta = claims.app_metadata as Record<string, unknown> | undefined;
    if (appMeta?.is_admin !== true) {
      return json(403, { error: 'forbidden', detail: 'admin access required' });
    }
    const adminEmail = typeof claims.email === 'string' ? claims.email.trim() : '';
    if (adminEmail.toLowerCase() !== 'car312@hotmail.com') {
      return json(403, { error: 'forbidden', detail: 'admin email mismatch' });
    }

    // ── Resolve Progressier subscriber ID ────────────────────────────────────
    // Prefer client_id from the request body; fall back to admin's own client row.
    let recipientId: string | null = null;

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.client_id === 'string' && body.client_id.trim()) {
      recipientId = body.client_id.trim();
    }

    if (!recipientId && adminEmail) {
      // Look up client row by admin email (works if admin also has a client account)
      const lookupRes = await fetch(
        `${SUPABASE_URL}/rest/v1/clients?email=eq.${encodeURIComponent(adminEmail)}&select=id&limit=1`,
        {
          headers: {
            apikey:        SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      );
      if (lookupRes.ok) {
        const rows = await lookupRes.json() as { id: string }[];
        if (rows.length > 0) recipientId = rows[0].id;
      }
    }

    if (!recipientId) {
      // Final fallback: the test account is Carl's demo account — his device is
      // registered in Progressier under that client's id. Use it as the push target.
      console.log('send-test-notification: no client row for admin email, falling back to test account');
      const testRes = await fetch(
        `${SUPABASE_URL}/rest/v1/clients?is_test_account=eq.true&select=id&limit=1`,
        {
          headers: {
            apikey:        SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      );
      if (testRes.ok) {
        const testRows = await testRes.json() as { id: string }[];
        if (testRows.length > 0) recipientId = testRows[0].id;
      }
    }

    if (!recipientId) {
      return json(422, {
        error: 'no_recipient',
        detail: 'Could not find a Progressier recipient. Pass client_id in the request body, or ensure a test account exists.',
      });
    }

    // ── Send Progressier push ─────────────────────────────────────────────────
    if (!PROGRESSIER_API_KEY) {
      console.error('send-test-notification: PROGRESSIER_API_KEY not configured in Vault');
      return json(500, { error: 'config_error', detail: 'PROGRESSIER_API_KEY not set' });
    }

    const progRes = await fetch('https://progressier.app/9kXZoGF2Dlfeqec880My/send', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${PROGRESSIER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipients: { id: recipientId },
        title:      PUSH_TITLE,
        body:       PUSH_BODY,
        url:        PUSH_URL,
      }),
    });

    if (!progRes.ok) {
      const errText = await progRes.text();
      console.error(`send-test-notification: progressier error ${progRes.status}: ${errText}`);
      return json(502, { error: 'progressier_error', detail: errText, status: progRes.status });
    }

    console.log(`send-test-notification: test push sent to recipient=${recipientId} by admin=${adminEmail}`);
    return json(200, { ok: true, recipient_id: recipientId });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`send-test-notification fatal: ${errMsg}`);
    return json(500, { error: 'internal_error', detail: errMsg });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
