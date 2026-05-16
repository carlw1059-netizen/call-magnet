// twilio-sms-status: receives Twilio StatusCallback webhooks when an SMS
// delivery status changes. Twilio calls this directly — verify_jwt = false,
// no INTERNAL_SECRET guard (Twilio doesn't send one).
//
// Twilio POST body (application/x-www-form-urlencoded):
//   MessageSid     — Twilio's message ID (matches twilio_message_sid in sms_events)
//   MessageStatus  — queued | sent | delivered | undelivered | failed
//   To             — destination E.164 phone number
//   ErrorCode      — Twilio error code, only present on failure
//
// If an sms_events row has twilio_message_sid = MessageSid, delivery_status
// is updated on that row. If no row matches (Studio-sent missed-call SMS before
// manual StatusCallback is configured in Twilio Console, or a login-link SMS
// that has no sms_events row), the status is logged only — not an error.
//
// On 'failed' or 'undelivered': fires a Pushover alert so Carl can follow up.
//
// Always returns 200 — Twilio retries on any non-2xx response.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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

  try {
    const form          = await req.formData();
    const messageSid    = (form.get('MessageSid')    ?? '').toString().trim();
    const messageStatus = (form.get('MessageStatus') ?? '').toString().trim();
    const to            = (form.get('To')            ?? '').toString().trim();
    const errorCode     = (form.get('ErrorCode')     ?? '').toString().trim();

    console.log(`twilio-sms-status: sid=${messageSid} status=${messageStatus} to=${to} errorCode=${errorCode || 'none'}`);

    if (!messageSid || !messageStatus) {
      console.warn('twilio-sms-status: missing MessageSid or MessageStatus — ignoring');
      return ok();
    }

    // ── Update matching sms_events row ────────────────────────────────────────
    // twilio_message_sid is populated when send-twilio-sms sends a programmatic
    // SMS (login-link, onboarding). Studio-sent missed-call SMS rows won't match
    // until the Studio flow's StatusCallback is configured in Twilio Console.
    const updateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/sms_events?twilio_message_sid=eq.${encodeURIComponent(messageSid)}`,
      {
        method: 'PATCH',
        headers: {
          apikey:         SUPABASE_SERVICE_ROLE_KEY,
          Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer:         'return=representation',
        },
        body: JSON.stringify({ delivery_status: messageStatus }),
      },
    );

    if (updateRes.ok) {
      const updated = await updateRes.json() as unknown[];
      if (updated.length > 0) {
        console.log(`twilio-sms-status: updated ${updated.length} sms_events row(s) for sid=${messageSid} → ${messageStatus}`);
      } else {
        console.log(`twilio-sms-status: no sms_events row for sid=${messageSid} — status logged only`);
      }
    } else {
      console.error(`twilio-sms-status: DB update failed ${updateRes.status}: ${await updateRes.text()}`);
    }

    // ── Pushover alert on delivery failure ────────────────────────────────────
    if ((messageStatus === 'failed' || messageStatus === 'undelivered') && INTERNAL_SECRET) {
      const alertMsg = [
        `SMS delivery ${messageStatus}.`,
        `To: ${to}`,
        `SID: ${messageSid}`,
        errorCode ? `ErrorCode: ${errorCode}` : null,
      ].filter(Boolean).join(' | ');

      console.warn(`twilio-sms-status: ${alertMsg}`);

      fetch(`${SUPABASE_URL}/functions/v1/send-pushover-alert`, {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'X-Internal-Secret': INTERNAL_SECRET,
          Authorization:       `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          title:    `⚠️ SMS ${messageStatus}`,
          message:  alertMsg,
          priority: 1,
        }),
      }).catch((e) => console.warn(`twilio-sms-status: pushover alert failed: ${e}`));
    }

    return ok();

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`twilio-sms-status fatal: ${errMsg}`);
    // Return 200 — a 500 would cause Twilio to retry indefinitely
    return ok();
  }
});

function ok(): Response {
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
