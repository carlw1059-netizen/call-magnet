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
  const url = new URL(req.url);
  if (url.searchParams.get('warmup') === '1') {
    return new Response(JSON.stringify({ warmup: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const mode = url.searchParams.get('mode');
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

    // ── Diagnostic mode ─────────────────────────────────────────────────────
    // Probes the Twilio account state for debugging "SMS not arriving" issues.
    // Returns: account type (Trial vs Full), TWILIO_FROM_NUMBER value, list of
    // verified caller IDs, recent messages to optional `?to=+61...` target.
    // No SMS is sent. Caller still needs valid X-Internal-Secret (above).
    if (mode === 'diag') {
      const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
      const headers = { Authorization: `Basic ${credentials}` };

      const accountPromise = fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}.json`, { headers })
        .then((r) => r.json()).catch((e) => ({ error: String(e?.message ?? e) }));
      const callerIdsPromise = fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/OutgoingCallerIds.json?PageSize=50`, { headers })
        .then((r) => r.json()).catch((e) => ({ error: String(e?.message ?? e) }));
      const probeTo = url.searchParams.get('to') ?? '';
      const messagesPromise = probeTo
        ? fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json?To=${encodeURIComponent(probeTo)}&PageSize=10`, { headers })
            .then((r) => r.json()).catch((e) => ({ error: String(e?.message ?? e) }))
        : Promise.resolve({ note: 'pass ?to=+61XXXXXXXXX to query recent messages for that number' });

      const [account, callerIds, messages] = await Promise.all([accountPromise, callerIdsPromise, messagesPromise]);

      return json(200, {
        diag: true,
        account: {
          friendly_name: account?.friendly_name,
          type:          account?.type,            // "Trial" or "Full"
          status:        account?.status,
          sid:           account?.sid,
        },
        from_number: TWILIO_FROM_NUMBER,
        verified_caller_ids: (callerIds?.outgoing_caller_ids ?? []).map((c: { phone_number?: string; friendly_name?: string }) => ({
          phone: c.phone_number, name: c.friendly_name,
        })),
        recent_messages_to_probe_target: messages,
      });
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
      To:             to,
      From:           TWILIO_FROM_NUMBER,
      Body:           message,
      StatusCallback: 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/twilio-sms-status',
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
      console.error(`twilio_api_failed: to=${to} from=${TWILIO_FROM_NUMBER} status=${twilioRes.status} body=${errBody}`);
      return json(500, { error: 'twilio_api_failed', status: twilioRes.status, detail: errBody });
    }

    const data = await twilioRes.json();
    console.log(`send-twilio-sms: ok to=${to} sid=${data?.sid ?? '(none)'} status=${data?.status ?? '(none)'}`);
    return json(200, { ok: true, sid: data?.sid ?? null, status: data?.status ?? null });

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
