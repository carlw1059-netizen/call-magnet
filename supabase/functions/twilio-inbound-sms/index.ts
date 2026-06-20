// twilio-inbound-sms: receives inbound SMS webhooks from Twilio.
//
// Twilio sends ALL inbound messages here (not just STOPs), so the function
// checks the Body and ignores anything that doesn't start with STOP.
//
// When a STOP is received:
//   1. Look up the client by twilio_number = To
//   2. Upsert into opt_outs (client_id, phone_number = From, permanence = 'forever')
//
// Auth: verify_jwt = false — Twilio carries no Bearer token. The function
// URL itself is the secret (same posture as twilio-missed-call).
//
// Always returns 200 — Twilio retries on any non-2xx response.
//
// Twilio POST body (application/x-www-form-urlencoded):
//   From        — sender's E.164 number (the customer)
//   To          — the Twilio number that received the message (the client's number)
//   Body        — SMS text content
//   MessageSid  — Twilio's unique message ID

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return ok();
  }

  try {
    const form = await req.formData();
    const from = (form.get('From') ?? '').toString().trim();
    const to   = (form.get('To')   ?? '').toString().trim();
    const body = (form.get('Body') ?? '').toString().trim().toUpperCase();

    // Ignore everything except STOP and START replies
    if (!body.startsWith('STOP') && !body.startsWith('START')) {
      console.log(`twilio-inbound-sms: ignoring non-STOP/START message from=${from} to=${to}`);
      return ok();
    }

    if (!from || !to) {
      console.warn('twilio-inbound-sms: missing From or To — ignoring');
      return ok();
    }

    // Look up client by their Twilio number (shared by STOP and START handlers)
    const clientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients` +
      `?twilio_number=eq.${encodeURIComponent(to)}` +
      `&is_test_account=eq.false&account_status=eq.active` +
      `&select=id&limit=1`,
      {
        headers: {
          apikey:        SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );

    if (!clientRes.ok) {
      console.warn(`twilio-inbound-sms: client lookup failed ${clientRes.status} — ignoring`);
      return ok();
    }

    const clients = await clientRes.json() as { id: string }[];

    if (clients.length === 0) {
      console.warn(`twilio-inbound-sms: no active client found for To=${to} — ignoring`);
      return ok();
    }

    const clientId = clients[0].id;

    // ── STOP — upsert into opt_outs ──────────────────────────────────────────
    if (body.startsWith('STOP')) {
      console.log(`twilio-inbound-sms: STOP received from=${from} to=${to}`);

      const upsertRes = await fetch(
        `${SUPABASE_URL}/rest/v1/opt_outs`,
        {
          method: 'POST',
          headers: {
            apikey:         SUPABASE_SERVICE_ROLE_KEY,
            Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            Prefer:         'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify({
            client_id:    clientId,
            phone_number: from,
            permanence:   'forever',
            opted_out_at: new Date().toISOString(),
          }),
        },
      );

      if (!upsertRes.ok) {
        const detail = await upsertRes.text();
        console.error(`twilio-inbound-sms: opt_outs upsert failed ${upsertRes.status}: ${detail}`);
      } else {
        console.log(`twilio-inbound-sms: opt_out written client_id=${clientId} phone=${from} permanence=forever`);
      }
    }

    // ── START — delete from opt_outs (re-subscribe) ──────────────────────────
    if (body.startsWith('START')) {
      console.log(`twilio-inbound-sms: START received from=${from} to=${to}`);

      const deleteRes = await fetch(
        `${SUPABASE_URL}/rest/v1/opt_outs` +
        `?client_id=eq.${encodeURIComponent(clientId)}` +
        `&phone_number=eq.${encodeURIComponent(from)}`,
        {
          method: 'DELETE',
          headers: {
            apikey:        SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      );

      if (!deleteRes.ok) {
        const detail = await deleteRes.text();
        console.error(`twilio-inbound-sms: opt_outs delete failed ${deleteRes.status}: ${detail}`);
      } else {
        console.log(`twilio-inbound-sms: opt_out cleared client_id=${clientId} phone=${from}`);
      }
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`twilio-inbound-sms fatal: ${errMsg}`);
  }

  // Always return 200 — Twilio must never see a non-2xx
  return ok();
});

function ok(): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status:  200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
