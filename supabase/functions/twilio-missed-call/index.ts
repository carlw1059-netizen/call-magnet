// twilio-missed-call: receives Twilio Studio's http_1 widget POST when a call
// to a client's Twilio number goes unanswered, looks up which client owns the
// To number, and records a row in sms_events.
//
// Idempotency: twilio_call_sid has a partial UNIQUE index (added by migration
// 20260503120000). On Twilio retries the second insert raises a 23505 unique
// violation (PostgREST 409), which we catch and return 200 OK so Twilio stops.
//
// Auth: deployed with --no-verify-jwt (Twilio doesn't send Bearer tokens).
// The function URL itself is the secret — same posture as the prior Make.com
// webhook. A future hardening pass could add Twilio signature verification.
//
// Payload (Twilio standard, application/x-www-form-urlencoded):
//   From      caller's E.164 number          → sms_events.customer_number
//   To        the Twilio number called       → sms_events.client_number  (= clients.twilio_number)
//   CallSid   Twilio's 34-char unique ID     → sms_events.twilio_call_sid
//   Body      optional SMS body              → sms_events.message_body (NULL on missed-call branches)
//
// Orphaned calls (To number doesn't match any clients.twilio_number) are
// skipped with a warning log + 200 OK — analytics views filter on client_id
// anyway, so unattributable rows would be invisible junk.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY');
const ALERT_TO                  = 'car312@hotmail.com';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    // ── parse Twilio's form-encoded body ─────────────────────────────────
    const form = await req.formData();
    const callSid = (form.get('CallSid') ?? '').toString().trim();
    const from    = (form.get('From')    ?? '').toString().trim();
    const to      = (form.get('To')      ?? '').toString().trim();
    const bodyRaw = (form.get('Body')    ?? '').toString().trim();
    const body    = bodyRaw.length > 0 ? bodyRaw : null;

    if (!callSid || !from || !to) {
      // 400 stops Twilio retrying — bad payloads stay broken regardless of retry count
      return json(400, { error: 'missing_required_field', detail: 'CallSid, From, and To are all required' });
    }

    // ── look up client by their Twilio number ─────────────────────────────
    const lookupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?twilio_number=eq.${encodeURIComponent(to)}&select=id,business_name`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!lookupRes.ok) {
      throw new Error(`client_lookup_failed: ${lookupRes.status} ${await lookupRes.text()}`);
    }
    const clients = await lookupRes.json() as { id: string; business_name: string }[];

    // ── orphaned call: no client owns this Twilio number ──────────────────
    if (clients.length === 0) {
      console.warn(`orphaned_call: no client found for To=${to}, CallSid=${callSid}`);
      return json(200, { ok: true, skipped: 'no_client_for_to_number' });
    }
    const clientId      = clients[0].id;
    const businessName  = clients[0].business_name;

    // ── insert sms_events row ─────────────────────────────────────────────
    const insertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/sms_events`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          client_id:        clientId,
          customer_number:  from,
          client_number:    to,
          twilio_call_sid:  callSid,
          message_body:     body,
        }),
      },
    );

    // ── duplicate-retry path: unique violation on twilio_call_sid ─────────
    // sms_events has only one unique constraint (the new partial index on
    // twilio_call_sid) plus the PK on id (auto-generated, can't collide), so
    // any 409 here is unambiguously a CallSid retry.
    if (insertRes.status === 409) {
      console.log(`duplicate_call_sid: ${callSid} already logged for ${businessName}, returning 200`);
      return json(200, { ok: true, duplicate: true });
    }

    if (!insertRes.ok) {
      throw new Error(`insert_failed: ${insertRes.status} ${await insertRes.text()}`);
    }

    const inserted = await insertRes.json() as { id: string }[];
    return json(200, { ok: true, id: inserted[0]?.id, client_id: clientId });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`twilio-missed-call fatal: ${errMsg}`);

    // fire-and-forget alert email; suppressing alerting failure so a Resend
    // outage can't cascade into the webhook itself failing
    if (RESEND_API_KEY) {
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'CallMagnet Alerts <hello@callmagnet.com.au>',
          to: ALERT_TO,
          subject: '⚠️ CallMagnet — twilio-missed-call failed',
          html: `<p><strong>Function:</strong> twilio-missed-call</p>
                 <p><strong>Error:</strong> ${escapeHtml(errMsg)}</p>
                 <p><strong>Time:</strong> ${new Date().toISOString()}</p>
                 <p>Twilio will retry — investigate in Supabase logs.</p>`,
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
