// send-missed-call-sms: called by Twilio Studio's HTTP widget (send_sms)
// after twilio-missed-call (http_1) records the sms_events row and returns
// the sms_event_id. Sends the missed-call SMS reply from the client's own
// Twilio number with StatusCallback wired to twilio-sms-status for full
// delivery tracking.
//
// Why not reuse send-twilio-sms:
//   - send-twilio-sms sends FROM a fixed TWILIO_FROM_NUMBER (used for login
//     links and onboarding SMS). Missed-call replies must come FROM the
//     client's own Twilio number — the one the customer actually called.
//   - send-twilio-sms is guarded by INTERNAL_SECRET; this function is called
//     directly by Twilio Studio which carries no shared secret.
//
// Auth: no verify_jwt (Twilio Studio calls this directly — URL is the secret).
// verify_jwt = false is set in config.toml. A future hardening pass can add
// Twilio request-signature verification.
//
// Studio widget order (IMPORTANT):
//   fetch_client → http_1 (twilio-missed-call) → send_sms (this function)
//   http_1 must run first so sms_event_id is available for send_sms.
//
// Body (application/json — sent by Studio HTTP widget):
//   customer_number        string   E.164 caller's number            → SMS To
//   client_twilio_number   string   E.164 client's Twilio number     → SMS From
//   customer_sms_template  string   Pre-built message from Studio    → SMS Body
//   sms_event_id           string?  sms_events PK from http_1        → links MessageSid back
//
// Fallback: if this function fails, the sms_events row already exists (http_1
// ran first). The row just won't have a twilio_message_sid or delivery status.
// Studio's failure branch should terminate gracefully — not retry the SMS.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TWILIO_ACCOUNT_SID        = Deno.env.get('TWILIO_ACCOUNT_SID')!;
const TWILIO_AUTH_TOKEN         = Deno.env.get('TWILIO_AUTH_TOKEN')!;
const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const STATUS_CALLBACK_URL =
  'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/twilio-sms-status';

Deno.serve(async (req) => {
  // ── Warmup — return before any work ──────────────────────────────────────
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
    // ── Config check ─────────────────────────────────────────────────────────
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      console.error('send-missed-call-sms: TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN missing from Vault');
      return json(500, { error: 'config_error', detail: 'Twilio credentials not configured' });
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => null) as {
      customer_number?:       unknown;
      client_twilio_number?:  unknown;
      customer_sms_template?: unknown;
      sms_event_id?:          unknown;
    } | null;

    if (!body) {
      return json(400, { error: 'invalid_body', detail: 'JSON body required' });
    }

    const to         = typeof body.customer_number       === 'string' ? body.customer_number.trim()       : '';
    const from       = typeof body.client_twilio_number  === 'string' ? body.client_twilio_number.trim()  : '';
    const message    = typeof body.customer_sms_template === 'string' ? body.customer_sms_template.trim() : '';
    const smsEventId = typeof body.sms_event_id          === 'string' ? body.sms_event_id.trim()          : null;

    if (!to || !from || !message) {
      return json(400, {
        error:  'missing_required_field',
        detail: 'customer_number, client_twilio_number, and customer_sms_template are all required',
        received: { to: !!to, from: !!from, message: !!message },
      });
    }

    console.log(`send-missed-call-sms: to=${to} from=${from} sms_event_id=${smsEventId ?? '(none)'} msg_len=${message.length}`);

    // finalMessage starts as message; updated with ?u=<token> if token is generated.
    let finalMessage = message;

    // ── Opt-out check + unsubscribe token generation ──────────────────────────
    // 1. Look up client by twilio_number (= from).
    // 2. If the caller's phone is in opt_outs for this client → suppress SMS.
    // 3. Otherwise, if Middle Man is enabled: generate a UUID unsubscribe token,
    //    insert into unsubscribe_tokens, and PATCH the client's Rebrandly link
    //    destination to callmagnet.com.au/b/<slug>?u=<token> so the caller lands
    //    on the Middle Man page with their opt-out token embedded in the URL.
    //
    // TODO: per-caller Rebrandly link strategy needed before client #5 to prevent
    //   token cross-wiring on concurrent calls. (Two simultaneous missed calls to
    //   the same client update the same Rebrandly destination — last write wins.
    //   Negligible risk at current scale of ≤4 clients.)
    //
    // All wrapped in try/catch — any failure here falls through and the SMS sends.
    try {
      // 1. Find client row by twilio_number
      const clientRes = await fetch(
        `${SUPABASE_URL}/rest/v1/clients` +
        `?twilio_number=eq.${encodeURIComponent(from)}` +
        `&is_test_account=eq.false&account_status=eq.active` +
        `&select=id,middle_man_enabled,middle_man_slug,rebrandly_link_id,sms_included&limit=1`,
        {
          headers: {
            apikey:        SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );

      if (clientRes.ok) {
        const clients = await clientRes.json() as {
          id: string;
          middle_man_enabled: boolean;
          middle_man_slug: string | null;
          rebrandly_link_id: string | null;
          sms_included: number;
        }[];

        if (clients.length > 0) {
          const client   = clients[0];
          const clientId = client.id;

          // 2. Check opt_outs — suppress SMS if caller has opted out
          const optRes = await fetch(
            `${SUPABASE_URL}/rest/v1/opt_outs` +
            `?client_id=eq.${encodeURIComponent(clientId)}` +
            `&phone_number=eq.${encodeURIComponent(to)}` +
            `&select=id&limit=1`,
            {
              headers: {
                apikey:        SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              },
            }
          );

          if (optRes.ok) {
            const optOuts = await optRes.json() as { id: string }[];
            if (optOuts.length > 0) {
              console.log(`send-missed-call-sms: SMS suppressed — to=${to} is opted out for client=${clientId}`);
              return json(200, { ok: true, suppressed: true, reason: 'opted_out' });
            }
          }

          // ── SMS monthly cap check ────────────────────────────────────────────
          const smsIncluded = typeof client.sms_included === 'number' ? client.sms_included : 50;
          const monthStart  = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
          const capRes = await fetch(
            `${SUPABASE_URL}/rest/v1/sms_events` +
            `?client_id=eq.${encodeURIComponent(clientId)}` +
            `&received_at=gte.${encodeURIComponent(monthStart)}` +
            `&select=id`,
            {
              method: 'HEAD',
              headers: {
                apikey:        SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                Prefer:        'count=exact',
              },
            }
          );
          if (capRes.ok) {
            const contentRange = capRes.headers.get('content-range') || '*/0';
            const slash        = contentRange.lastIndexOf('/');
            const smsCount     = parseInt(slash >= 0 ? contentRange.slice(slash + 1) : '0', 10);
            if (Number.isFinite(smsCount) && smsCount >= smsIncluded) {
              console.log(`send-missed-call-sms: SMS cap reached for client_id=${clientId} (${smsCount}/${smsIncluded} this month)`);
              return json(200, { ok: true, suppressed: true, reason: 'sms_cap_reached' });
            }
          }

          // ── 3. Generate unsubscribe token (Middle Man clients only) ──────────
          // Only when Middle Man is enabled — those callers land on /b/<slug>
          // which has the "Stop these texts" link wired to /u/<token>.
          if (client.middle_man_enabled && client.middle_man_slug) {
            try {
              const unsubToken = crypto.randomUUID();
              const expiresAt  = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(); // 72 h

              // Insert into unsubscribe_tokens (best-effort — non-fatal)
              await fetch(`${SUPABASE_URL}/rest/v1/unsubscribe_tokens?on_conflict=client_id,phone_number`, {
                method:  'POST',
                headers: {
                  apikey:         SUPABASE_SERVICE_ROLE_KEY,
                  Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                  'Content-Type': 'application/json',
                  Prefer:         'resolution=merge-duplicates,return=minimal',
                },
                body: JSON.stringify({
                  token:        unsubToken,
                  client_id:    clientId,
                  phone_number: to,
                  expires_at:   expiresAt,
                }),
              });

              // Append ?u=<token> to the callmagnet.com.au/b/ or callmagnet.s.gy/ link in the message
              finalMessage = message.replace(
                /(https?:\/\/(?:callmagnet\.com\.au\/b\/|callmagnet\.s\.gy\/)[^\s?]*)/,
                (match: string) => match + '?u=' + unsubToken
              );
              console.log(`send-missed-call-sms: unsubscribe token generated for to=${to} token=${unsubToken.slice(0, 8)}…`);
            } catch (tokenErr) {
              console.warn(`send-missed-call-sms: token generation failed (non-fatal): ${tokenErr instanceof Error ? tokenErr.message : String(tokenErr)}`);
              // finalMessage stays as message — SMS sends without token
            }
          } else if (!client.middle_man_enabled) {
            // MM OFF: no opt-out link in the message — append the tail directly.
            const STOP_TAIL = ' Reply STOP to opt out';
            if (!finalMessage.endsWith(STOP_TAIL)) {
              finalMessage = finalMessage + STOP_TAIL;
            }
          }

        }
      } else {
        console.warn(`send-missed-call-sms: client lookup failed: ${clientRes.status}`);
      }
    } catch (preErr) {
      // Non-fatal — SMS still sends even if opt-out / token logic errors
      console.warn(`send-missed-call-sms: pre-send processing error (non-fatal): ${preErr instanceof Error ? preErr.message : String(preErr)}`);
    }

    // ── Twilio Lookup: skip landlines ────────────────────────────────────────
    // Fail open: if lookup errors for any reason, SMS sends anyway.
    const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    try {
      const lookupRes = await fetch(
        `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(to)}?Fields=line_type_intelligence`,
        { headers: { Authorization: `Basic ${credentials}` } },
      );
      if (lookupRes.ok) {
        const lookupData = await lookupRes.json() as { line_type_intelligence?: { type?: string } };
        const lineType = lookupData?.line_type_intelligence?.type;
        if (lineType === 'landline' || lineType === 'voip' || lineType === 'non-fixed-voip') {
          console.log(`send-missed-call-sms: SMS suppressed — to=${to} is ${lineType}`);
          return json(200, { ok: true, suppressed: true, reason: 'landline' });
        }
      } else {
        console.warn(`send-missed-call-sms: Lookup failed (non-fatal): ${lookupRes.status}`);
      }
    } catch (lookupErr) {
      console.warn(`send-missed-call-sms: Lookup error (non-fatal): ${lookupErr instanceof Error ? lookupErr.message : String(lookupErr)}`);
    }

    // ── Send SMS via Twilio Messages API ─────────────────────────────────────
    // From = the client's own Twilio number (not a fixed TWILIO_FROM_NUMBER)
    // so the customer sees the same number they called.
    const params = new URLSearchParams({
      To:             to,
      From:           from,
      Body:           finalMessage,
      StatusCallback: STATUS_CALLBACK_URL,
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

    const data       = await twilioRes.json();
    const messageSid = typeof data?.sid === 'string' ? data.sid : null;

    if (!twilioRes.ok) {
      console.error(
        `send-missed-call-sms: twilio_api_failed ` +
        `to=${to} from=${from} status=${twilioRes.status} body=${JSON.stringify(data).slice(0, 400)}`
      );
      return json(500, { error: 'twilio_api_failed', status: twilioRes.status, detail: data });
    }

    console.log(`send-missed-call-sms: ok to=${to} from=${from} sid=${messageSid ?? '(none)'} status=${data?.status ?? '(none)'}`);

    // ── Back-fill sms_events row with MessageSid + message_body ──────────────
    // The row was inserted by twilio-missed-call (http_1) with message_body=NULL
    // because Studio didn't know the body yet. Now we have both — patch it.
    // Best-effort: SMS is already sent; delivery tracking degrades gracefully
    // if this patch fails.
    if (smsEventId && messageSid) {
      fetch(
        `${SUPABASE_URL}/rest/v1/sms_events?id=eq.${encodeURIComponent(smsEventId)}`,
        {
          method:  'PATCH',
          headers: {
            apikey:         SUPABASE_SERVICE_ROLE_KEY,
            Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            Prefer:         'return=minimal',
          },
          body: JSON.stringify({
            twilio_message_sid: messageSid,
            message_body:       message,
          }),
        },
      ).catch((e) =>
        console.warn(`send-missed-call-sms: sms_events patch failed (non-fatal): ${e}`)
      );
    } else {
      console.warn(
        `send-missed-call-sms: skipping sms_events patch — ` +
        `sms_event_id=${smsEventId ?? 'null'} messageSid=${messageSid ?? 'null'}`
      );
    }

    return json(200, { ok: true, sid: messageSid, status: data?.status ?? null });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`send-missed-call-sms fatal: ${errMsg}`);
    return json(500, { error: 'internal_error', detail: errMsg });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
