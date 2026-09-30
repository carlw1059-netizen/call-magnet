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
//
// Restaurant stats email (Session 5 Job 3): missed_call events for the
// 'restaurant' vertical now include today's and this week's missed-call
// counts plus estimated revenue recovered, fetched live from sms_events at
// send time. Week window resets on Monday at 17:00 Melbourne local time.
// Revenue formula: count × avg_job_value (or $75 fallback) × 0.62
// (Lead Connect 2025 research rate). Other verticals keep existing format.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webPush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';


const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET           = Deno.env.get('INTERNAL_SECRET');
const VAPID_PUBLIC_KEY          = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY         = Deno.env.get('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT             = Deno.env.get('VAPID_SUBJECT'); // e.g. mailto:hello@callmagnet.com.au

const PROGRESSIER_API_KEY       = Deno.env.get('PROGRESSIER_API_KEY');

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
  avg_job_value: number | null;
}

type EventName = 'missed_call' | 'booking_logged' | 'link_tapped';

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
    if (!INTERNAL_SECRET) {
      console.error('send-client-notification: INTERNAL_SECRET missing from env');
      return json(500, { error: 'config_error', detail: 'INTERNAL_SECRET not configured in Vault' });
    }

    if (req.headers.get('X-Internal-Secret') !== INTERNAL_SECRET) {
      return json(401, { error: 'unauthorized' });
    }

    // VAPID keys are required for Web Push but not for email. If missing, log a
    // loud error, fire a Pushover alert (fire-and-forget), and continue — email
    // will still deliver. Push resumes automatically once keys are seeded.
    const vapidAvailable = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
    if (!vapidAvailable) {
      console.error('send-client-notification: VAPID keys missing from Vault — Web Push disabled, email will still send');
      fetch(`${SUPABASE_URL}/functions/v1/send-pushover-alert`, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'X-Internal-Secret': INTERNAL_SECRET,
          Authorization:       `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          title:    '⚠️ VAPID keys missing',
          message:  'send-client-notification: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, or VAPID_SUBJECT not set in Edge Functions Vault. Web Push is disabled — email only. Seed the keys to re-enable.',
          priority: 1,
        }),
      }).catch(() => {});
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
    if (event !== 'missed_call' && event !== 'booking_logged' && event !== 'link_tapped') {
      return json(400, { error: 'invalid_event', detail: "event must be 'missed_call', 'booking_logged', or 'link_tapped'" });
    }

    // Missed calls: no push or email to client — the phone already shows the missed call (Carl, 30 Sep 2026).
    if (event === 'missed_call') {
      return json(200, { sent: false, skipped: 'missed_call_notifications_off', event: 'missed_call', client_id: clientId });
    }

    // ── link_tapped: VAPID fan-out with Progressier fallback ────────────────
    if (event === 'link_tapped') {
      const ltClientRes = await fetch(
        `${SUPABASE_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,vertical`,
        {
          headers: {
            apikey:        SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      );
      if (!ltClientRes.ok) {
        throw new Error(`client_lookup_failed: ${ltClientRes.status} ${await ltClientRes.text()}`);
      }
      const ltClientArr = await ltClientRes.json() as Array<{ id: string; business_name: string; vertical: string }>;
      if (ltClientArr.length === 0) {
        return json(404, { error: 'client_not_found', detail: `no client with id ${clientId}` });
      }

      // Notification title and body come only from the admin-set push_title and
      // push_message on each Middle Man button. If either is missing, skip.
      const ctxPushTitle   = typeof context.push_title   === 'string' ? (context.push_title   as string).trim() : '';
      const ctxPushMessage = typeof context.push_message === 'string' ? (context.push_message as string).trim() : '';

      if (!ctxPushTitle || !ctxPushMessage) {
        console.log(`link_tapped: no push wording set for client ${clientId} — skipping push`);
        return json(200, { sent: false, reason: 'no_override', event, client_id: clientId });
      }

      const ltTitle = ctxPushTitle;
      const ltBody  = ctxPushMessage;

      // Check push_subscriptions — determines VAPID vs Progressier path
      const ltSubsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/push_subscriptions?client_id=eq.${encodeURIComponent(clientId)}&select=id,endpoint,p256dh,auth`,
        {
          headers: {
            apikey:        SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      );
      if (!ltSubsRes.ok) {
        throw new Error(`subscriptions_lookup_failed: ${ltSubsRes.status} ${await ltSubsRes.text()}`);
      }
      const ltSubs = await ltSubsRes.json() as SubscriptionRow[];

      if (vapidAvailable && ltSubs.length > 0) {
        // ── VAPID path ──────────────────────────────────────────────────────
        console.log('send-client-notification: link_tapped via vapid');
        webPush.setVapidDetails(VAPID_SUBJECT!, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
        const ltPayload = JSON.stringify({ source: 'callmagnet-vapid', title: ltTitle, body: ltBody, url: 'https://callmagnet.com.au' });

        const ltResults = await Promise.allSettled(
          ltSubs.map(async (sub) => {
            try {
              await webPush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                ltPayload,
              );
              return { id: sub.id, ok: true as const };
            } catch (e: unknown) {
              const status = (e as { statusCode?: number })?.statusCode;
              const body   = (e as { body?: string })?.body;
              return { id: sub.id, ok: false as const, status, message: String((e as Error)?.message ?? e), body, host: new URL(sub.endpoint).host };
            }
          }),
        );

        const ltExpiredIds: string[] = [];
        for (const r of ltResults) {
          if (r.status === 'fulfilled') {
            if (r.value.ok) {
              logNotification({ client_id: clientId, channel: 'push', event: 'link_tapped', status: 'sent', metadata: { subscription_id: r.value.id, title: ltTitle, body: ltBody } });
            } else {
              if (r.value.status === 404 || r.value.status === 410) ltExpiredIds.push(r.value.id);
              logNotification({ client_id: clientId, channel: 'push', event: 'link_tapped', status: 'failed', error_message: 'status ' + (r.value.status ?? 'unknown') + ': ' + (r.value.body || r.value.message), provider_response: { statusCode: r.value.status }, metadata: { subscription_id: r.value.id, statusCode: r.value.status, body: r.value.body, host: r.value.host } });
            }
          } else {
            logNotification({ client_id: clientId, channel: 'push', event: 'link_tapped', status: 'failed', error_message: String((r as PromiseRejectedResult).reason ?? 'rejected') });
          }
        }
        if (ltExpiredIds.length > 0) {
          fetch(
            `${SUPABASE_URL}/rest/v1/push_subscriptions?id=in.(${ltExpiredIds.map(encodeURIComponent).join(',')})`,
            { method: 'DELETE', headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Prefer: 'return=minimal' } },
          ).catch((err) => console.warn(`expired sub cleanup failed: ${err}`));
        }
        const ltAnyOk = ltResults.some(r => r.status === 'fulfilled' && r.value.ok);
        if (ltAnyOk) {
          return json(200, { sent: true, event: 'link_tapped', path: 'vapid', client_id: clientId });
        }
        console.log('send-client-notification: link_tapped vapid all failed, using progressier-fallback');
      }

      // ── Progressier fallback ────────────────────────────────────────────────
      console.log('send-client-notification: link_tapped via progressier-fallback');

      if (!PROGRESSIER_API_KEY) {
        console.warn('link_tapped: PROGRESSIER_API_KEY missing — skipping push');
        logNotification({
          client_id:     clientId,
          channel:       'push',
          event:         'link_tapped',
          status:        'skipped',
          error_message: 'PROGRESSIER_API_KEY not configured',
          metadata:      { title: ltTitle, body: ltBody },
        });
        fetch(`${SUPABASE_URL}/functions/v1/send-pushover-alert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': INTERNAL_SECRET!, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ title: '⚠️ Push failed', message: `${ltClientArr[0].business_name} — link_tapped — PROGRESSIER_API_KEY not configured` }),
        }).catch(() => {});
        return json(200, { sent: false, reason: 'PROGRESSIER_API_KEY not configured', event, client_id: clientId });
      }

      const progRes = await fetch('https://progressier.app/9kXZoGF2Dlfeqec880My/send', {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${PROGRESSIER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipients: { id: clientId },
          title:      ltTitle,
          body:       ltBody,
          url:        'https://callmagnet.com.au',
        }),
      });

      if (!progRes.ok) {
        const errText = await progRes.text();
        console.error(`link_tapped: progressier api error ${progRes.status}: ${errText}`);
        logNotification({
          client_id:         clientId,
          channel:           'push',
          event:             'link_tapped',
          status:            'failed',
          error_message:     errText,
          provider_response: { status: progRes.status, body: errText },
          metadata:          { title: ltTitle, body: ltBody },
        });
        fetch(`${SUPABASE_URL}/functions/v1/send-pushover-alert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': INTERNAL_SECRET!, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ title: '⚠️ Push failed', message: `${ltClientArr[0].business_name} — link_tapped — progressier ${progRes.status}: ${errText}` }),
        }).catch(() => {});
        return json(200, { sent: false, reason: 'progressier_api_error', status: progRes.status, event, client_id: clientId });
      }

      console.log(`link_tapped: progressier push sent for client ${clientId}`);
      logNotification({
        client_id:         clientId,
        channel:           'push',
        event:             'link_tapped',
        status:            'sent',
        provider_response: { status: progRes.status },
        metadata:          { title: ltTitle, body: ltBody, url: 'https://callmagnet.com.au' },
      });
      return json(200, { sent: true, event: 'link_tapped', path: 'progressier', client_id: clientId });
    }

    // ── lookup client (vertical, business_name, email, avg_job_value) ───────
    const clientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,email,vertical,avg_job_value`,
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

    // ── configure web-push and fan out (skipped gracefully if VAPID keys missing) ──
    if (vapidAvailable) {
      webPush.setVapidDetails(VAPID_SUBJECT!, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
    }
    const pushPayload = JSON.stringify({ title, body: msg, event, context });
    const pushResults = vapidAvailable ? await Promise.allSettled(
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
    ) : [];

    let pushSent   = 0;
    let pushFailed = 0;
    const succeededIds: string[] = [];
    const expiredIds:   string[] = [];
    for (const r of pushResults) {
      if (r.status === 'fulfilled') {
        if (r.value.ok) {
          pushSent++;
          succeededIds.push(r.value.id);
          logNotification({
            client_id: clientId,
            channel:   'push',
            event,
            status:    'sent',
            metadata:  { subscription_id: r.value.id, title, body: msg, context },
          });
        } else {
          pushFailed++;
          const expired = r.value.status === 404 || r.value.status === 410;
          // 404 (legacy) and 410 Gone — subscription expired, prune it
          if (expired) {
            expiredIds.push(r.value.id);
          }
          logNotification({
            client_id:         clientId,
            channel:           'push',
            event,
            status:            'failed',
            error_message:     r.value.message,
            provider_response: { statusCode: r.value.status },
            metadata:          { subscription_id: r.value.id, expired },
          });
        }
      } else {
        pushFailed++;
        logNotification({
          client_id:     clientId,
          channel:       'push',
          event,
          status:        'failed',
          error_message: String((r as PromiseRejectedResult).reason ?? 'rejected'),
        });
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

    // ── Progressier fallback when every VAPID send failed ──────────────────
    if (pushSent === 0 && PROGRESSIER_API_KEY) {
      console.log(`send-client-notification: ${event} vapid all failed, using progressier-fallback`);
      const progFallbackRes = await fetch('https://progressier.app/9kXZoGF2Dlfeqec880My/send', {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${PROGRESSIER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipients: { id: clientId },
          title,
          body:       msg,
          url:        'https://callmagnet.com.au',
        }),
      });
      if (progFallbackRes.ok) {
        logNotification({
          client_id:         clientId,
          channel:           'push',
          event,
          status:            'sent',
          provider_response: { status: progFallbackRes.status },
          metadata:          { title, body: msg, path: 'progressier-fallback' },
        });
      } else {
        const errText = await progFallbackRes.text();
        console.error(`${event}: progressier fallback api error ${progFallbackRes.status}: ${errText}`);
        logNotification({
          client_id:         clientId,
          channel:           'push',
          event,
          status:            'failed',
          error_message:     errText,
          provider_response: { status: progFallbackRes.status, body: errText },
          metadata:          { title, body: msg, path: 'progressier-fallback' },
        });
        fetch(`${SUPABASE_URL}/functions/v1/send-pushover-alert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': INTERNAL_SECRET!, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ title: '⚠️ Push failed', message: `${client.business_name} — ${event} — progressier fallback ${progFallbackRes.status}: ${errText}` }),
        }).catch(() => {});
      }
    } else if (pushSent === 0 && !PROGRESSIER_API_KEY) {
      console.warn(`${event}: vapid all failed and PROGRESSIER_API_KEY missing — no push fallback`);
      fetch(`${SUPABASE_URL}/functions/v1/send-pushover-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': INTERNAL_SECRET!, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ title: '⚠️ Push failed', message: `${client.business_name} — ${event} — PROGRESSIER_API_KEY not configured` }),
      }).catch(() => {});
    }

    return json(200, {
      ok:                  true,
      push_sent:           pushSent,
      push_failed:         pushFailed,
      push_expired_pruned: expiredIds.length,
      email_sent:          false,
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

// Fire-and-forget audit log. Failure to write the audit row must never tank
// the actual notification path. NOTE: fetch() only rejects on network errors
// — a 4xx/5xx HTTP response resolves the promise normally. Without an HTTP-
// error branch, schema-cache misses (PGRST205) and RLS denials would be
// invisible. So we inspect res.ok in .then() and console.error any non-2xx
// alongside the .catch() for network failures.
function logNotification(row: {
  client_id:         string;
  channel:           'push' | 'email';
  event:             string;
  status:            'sent' | 'failed' | 'skipped';
  error_message?:    string | null;
  provider_response?: unknown;
  metadata?:         unknown;
}): void {
  fetch(`${SUPABASE_URL}/rest/v1/notifications_sent`, {
    method: 'POST',
    headers: {
      apikey:        SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=minimal',
    },
    body: JSON.stringify({
      client_id:         row.client_id,
      channel:           row.channel,
      event:             row.event,
      status:            row.status,
      error_message:     row.error_message ?? null,
      provider_response: row.provider_response ?? null,
      metadata:          row.metadata ?? null,
    }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '<no body>');
        console.error(`notifications_sent insert non-2xx: ${res.status} ${body}`);
      }
    })
    .catch((err) => console.error(`notifications_sent insert network error: ${err?.message ?? err}`));
}
