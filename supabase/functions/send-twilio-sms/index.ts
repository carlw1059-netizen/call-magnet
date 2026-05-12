// send-twilio-sms: helper edge function. POSTs an outbound SMS via the
// Twilio Messages API on behalf of internal callers (create-client,
// request-login-link, future automations).
//
// Auth: shared-secret via X-Internal-Secret header. Same pattern as
// send-pushover-alert. No public anon access.
//
// Body (application/json):
//   to       string  required  E.164 phone, must start with '+'
//   message  string  required  SMS body, max ~1600 chars (Twilio limit)
//
// Vault prereqs:
//   TWILIO_ACCOUNT_SID    Twilio Account SID ('AC...')
//   TWILIO_AUTH_TOKEN     Twilio Auth Token (32 hex chars)
//   TWILIO_FROM_NUMBER    Twilio-owned sender number (E.164)
//   INTERNAL_SECRET       shared secret for caller auth

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_FROM_NUMBER = Deno.env.get('TWILIO_FROM_NUMBER');
const INTERNAL_SECRET    = Deno.env.get('INTERNAL_SECRET');

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

  try {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !INTERNAL_SECRET) {
      console.error('send-twilio-sms: missing required Vault secrets (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, or INTERNAL_SECRET)');
      return json(500, { error: 'config_error', detail: 'required Vault secrets not configured' });
    }

    if (req.headers.get('X-Internal-Secret') !== INTERNAL_SECRET) {
      return json(401, { error: 'unauthorized' });
    }

    const body = await req.json().catch(() => null) as { to?: unknown; message?: unknown } | null;
    if (!body || typeof body !== 'object') {
      return json(400, { error: 'invalid_body', detail: 'JSON body with to and message required' });
    }
    const to      = typeof body.to === 'string' ? body.to.trim() : '';
    const message = typeof body.message === 'string' ? body.message : '';
    if (!to || !message) {
      return json(400, { error: 'missing_required_field', detail: 'to and message are both required' });
    }
    if (!/^\+\d{8,15}$/.test(to)) {
      return json(400, { error: 'invalid_phone', detail: 'to must be E.164 (e.g. +614XXXXXXXX)' });
    }
    if (message.length > 1600) {
      return json(400, { error: 'message_too_long', detail: 'message body must be <= 1600 chars' });
    }

    const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const params = new URLSearchParams({
      To:   to,
      From: TWILIO_FROM_NUMBER,
      Body: message,
    });

    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method:  'POST',
        headers: {
          Authorization:  `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      },
    );

    if (!twilioRes.ok) {
      const errBody = await twilioRes.text();
      console.error(`twilio_api_failed: status=${twilioRes.status} body=${errBody}`);
      return json(500, { error: 'twilio_api_failed', status: twilioRes.status, detail: errBody });
    }

    const data = await twilioRes.json();
    return json(200, { ok: true, sid: data?.sid ?? null });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`send-twilio-sms fatal: ${errMsg}`);
    return json(500, { error: 'internal_error', detail: errMsg });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
