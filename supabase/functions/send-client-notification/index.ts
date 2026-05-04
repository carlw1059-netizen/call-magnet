// send-client-notification: dual-channel notification dispatcher. Fans out
// a notification event over Web Push (every device the client has subscribed)
// AND Resend email (always, regardless of push outcome). Vertical-aware:
// title/body templates differ per (event, vertical), pulled from the
// clients.vertical column.
//
// Auth: shared-secret via X-Internal-Secret header. Same pattern as
// save-push-subscription. Called by:
//   - twilio-missed-call edge function (after sms_events insert)
//   - index.html dashboard JS (after a successful bookings insert)
//
// Body (application/json):
//   client_id  uuid    required
//   event      string  required, one of: 'missed_call' | 'booking_logged'
//   context    object  optional, event-specific data:
//                        booking_logged: { customer_name?: string }
//                        missed_call:    {} (caller phone is sourced upstream)
//
// Web Push uses npm:web-push@3.6.7 with VAPID keys from Vault. Subscriptions
// that return 404/410 (Gone) are deleted from push_subscriptions; successful
// pushes refresh last_used_at. Both cleanup paths are fire-and-forget so a
// misbehaving DB write can't tank the response.
//
// SECRET ROTATION: INTERNAL_SECRET lives in TWO places (Edge Functions Vault
// + Postgres Vault). VAPID keys live only in Edge Functions Vault and are
// not used by any cron, so they rotate in one place.
//
// Email rebrand (Session 4 D2): brand colours pulled from _shared/emailStyles.ts
// and the email body wrapped with renderEmailShell so it matches the login
// palette. Single source of truth for future palette changes.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webPush from 'npm:web-push@3.6.7';
import { BRAND, escapeHtml, renderEmailShell } from "../_shared/emailStyles.ts";

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET           = Deno.env.get('INTERNAL_SECRET');
const VAPID_PUBLIC_KEY          = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY         = Deno.env.get('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT             = Deno.env.get('VAPID_SUBJECT'); // e.g. mailto:hello@callmagnet.com.au
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY');

interface SubscriptionRow {
  id:       string;
  endpoint: string;
  p256dh:   string;
  auth:     string;
}

interface ClientRow {
  id:            string;
  business_name: string;
  email:         string;
  vertical:      string;
}

type EventName = 'missed_call' | 'booking_logged';

function templateFor(
  event: EventName,
  vertical: string,
  ctx: Record<string, unknown>,
): { title: string; body: string } {
  const v = vertical === 'barber' || vertical === 'restaurant' ? vertical : 'default';
  const customerName =
    typeof ctx.customer_name === 'string' && ctx.customer_name.trim()
      ? ctx.customer_name.trim()
      : 'New customer';

  if (event === 'missed_call') {
    if (v === 'barber')
      return { title: '💇 Missed call captured', body: 'Booking SMS sent automatically — check your dashboard' };
    if (v === 'restaurant')
      return { title: '🍽️ Missed call captured', body: 'Reservation SMS sent automatically — check your dashboard' };
    return   { title: '📞 Missed call captured', body: 'SMS sent automatically — check your dashboard' };
  }
  // booking_logged
  if (v === 'barber')
    return { title: '💇 Booking logged',     body: `${customerName} — added to your bookings` };
  if (v === 'restaurant')
    return { title: '🍽️ Reservation logged', body: `${customerName} — added to your reservations` };
  return   { title: '✅ Booking logged',     body: `${customerName} — added to your bookings` };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    if (
      !INTERNAL_SECRET ||
      !VAPID_PUBLIC_KEY ||
      !VAPID_PRIVATE_KEY ||
      !VAPID_SUBJECT
    ) {
      console.error(
        'send-client-notification: missing required env vars (INTERNAL_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, or VAPID_SUBJECT)',
      );
      return json(500, { error: 'config_error', detail: 'required Vault secrets not configured' });
    }

    if (req.headers.get('X-Internal-Secret') !== INTERNAL_SECRET) {
      return json(401, { error: 'unauthorized' });
    }

    const body = await req.json().catch(() => null) as
      | { client_id?: unknown; event?: unknown; context?: unknown }
      | null;
    if (!body || typeof body !== 'object') {
      return json(400, { error: 'invalid_body', detail: 'JSON body required' });
    }

    const clientId = typeof body.client_id === 'string' ? body.client_id.trim() : '';
    const event    = typeof body.event === 'string' ? body.event : '';
    const context  =
      typeof body.context === 'object' && body.context !== null
        ? body.context as Record<string, unknown>
        : {};

    if (!clientId) {
      return json(400, { error: 'missing_required_field', detail: 'client_id is required' });
    }
    if (event !== 'missed_call' && event !== 'booking_logged') {
      return json(400, { error: 'invalid_event', detail: "event must be 'missed_call' or 'booking_logged'" });
    }

    // ── lookup client (vertical, business_name, email) ──────────────────────
    const clientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,email,vertical`,
      {
        headers: {
          apikey:        SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!clientRes.ok) {
      throw new Error(`client_lookup_failed: ${clientRes.status} ${await clientRes.text()}`);
    }
    const clientArr = await clientRes.json() as ClientRow[];
    if (clientArr.length === 0) {
      return json(404, { error: 'client_not_found', detail: `no client with id ${clientId}` });
    }
    const client = clientArr[0];

    const { title, body: msg } = templateFor(event as EventName, client.vertical, context);

    // ── fetch all subscriptions for this client ─────────────────────────────
    const subsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?client_id=eq.${encodeURIComponent(clientId)}&select=id,endpoint,p256dh,auth`,
      {
        headers: {
          apikey:        SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!subsRes.ok) {
      throw new Error(`subscriptions_lookup_failed: ${subsRes.status} ${await subsRes.text()}`);
    }
    const subscriptions = await subsRes.json() as SubscriptionRow[];

    // ── configure web-push (idempotent at function-instance level) ──────────
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    // ── fan out web push in parallel; one failure must not abort others ─────
    const pushPayload = JSON.stringify({ title, body: msg, event, context });
    const pushResults = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webPush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            pushPayload,
          );
          return { id: sub.id, ok: true as const };
        } catch (e: unknown) {
          const status = (e as { statusCode?: number })?.statusCode;
          return { id: sub.id, ok: false as const, status, message: String((e as Error)?.message ?? e) };
        }
      }),
    );

    let pushSent   = 0;
    let pushFailed = 0;
    const succeededIds: string[] = [];
    const expiredIds:   string[] = [];
    for (const r of pushResults) {
      if (r.status === 'fulfilled') {
        if (r.value.ok) {
          pushSent++;
          succeededIds.push(r.value.id);
        } else {
          pushFailed++;
          // 404 (legacy) and 410 Gone — subscription expired, prune it
          if (r.value.status === 404 || r.value.status === 410) {
            expiredIds.push(r.value.id);
          }
        }
      } else {
        pushFailed++;
      }
    }

    // ── refresh last_used_at on successful subscriptions (fire-and-forget) ──
    if (succeededIds.length > 0) {
      fetch(
        `${SUPABASE_URL}/rest/v1/push_subscriptions?id=in.(${succeededIds.map(encodeURIComponent).join(',')})`,
        {
          method: 'PATCH',
          headers: {
            apikey:        SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            Prefer:        'return=minimal',
          },
          body: JSON.stringify({ last_used_at: new Date().toISOString() }),
        },
      ).catch((err) => console.warn(`last_used_at update failed: ${err}`));
    }

    // ── prune expired subscriptions (fire-and-forget) ───────────────────────
    if (expiredIds.length > 0) {
      fetch(
        `${SUPABASE_URL}/rest/v1/push_subscriptions?id=in.(${expiredIds.map(encodeURIComponent).join(',')})`,
        {
          method: 'DELETE',
          headers: {
            apikey:        SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            Prefer:        'return=minimal',
          },
        },
      ).catch((err) => console.warn(`expired sub cleanup failed: ${err}`));
    }

    // ── send Resend email (always, in parallel with the cleanups above) ─────
    let emailSent = false;
    if (RESEND_API_KEY && client.email) {
      try {
        const emailContent = `
          <h1 style="font-size:22px;font-weight:700;color:${BRAND.primaryText};margin:0 0 12px;letter-spacing:-0.02em;">${escapeHtml(title)}</h1>
          <p style="font-size:15px;color:${BRAND.secondaryText};line-height:1.5;margin:0 0 24px;">${escapeHtml(msg)}</p>
          <p style="font-size:13px;color:${BRAND.secondaryText};margin:0;">Open your dashboard at <a href="https://callmagnet.com.au" style="color:${BRAND.accent};text-decoration:none;">callmagnet.com.au</a></p>
        `;
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization:  `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from:    'CallMagnet <hello@callmagnet.com.au>',
            to:      client.email,
            subject: title,
            html:    renderEmailShell(emailContent, msg),
          }),
        });
        emailSent = resendRes.ok;
        if (!resendRes.ok) {
          console.warn(`resend_email_failed: ${resendRes.status} ${await resendRes.text()}`);
        }
      } catch (e) {
        console.warn(`resend_email_exception: ${(e as Error)?.message ?? e}`);
      }
    } else if (!RESEND_API_KEY) {
      console.warn('RESEND_API_KEY missing — skipping email');
    } else {
      console.warn(`client ${clientId} has no email — skipping email`);
    }

    return json(200, {
      ok:                  true,
      push_sent:           pushSent,
      push_failed:         pushFailed,
      push_expired_pruned: expiredIds.length,
      email_sent:          emailSent,
    });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`send-client-notification fatal: ${errMsg}`);
    return json(500, { error: 'internal_error', detail: errMsg });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
