// stripe-subscription-deleted: handles Stripe's customer.subscription.deleted
// webhook. Fires when a subscription actually ends (either by expiry after
// cancel_at_period_end, or immediate cancellation in the Dashboard).
//
// On event:
//   1. Verify Stripe HMAC-SHA256 signature + replay-attack guard.
//   2. Look up client by stripe_customer_id.
//   3. Patch client: cancellation_scheduled=true, cancelled_at=now,
//      account_status='cancelled'.
//   4. Query lifetime stats (parallel): SMS sent, delivered, bookings logged.
//   5. Send farewell email to the client via Resend.
//   6. Fire Pushover notification to Carl.
//   7. Return 200 to Stripe.
//
// Auth: verify_jwt = false (Stripe carries no Supabase JWT). HMAC-SHA256
// signature verification is the actual auth layer.
//
// Idempotency: if the client row already has account_status='cancelled' we
// still return 200 OK so Stripe stops retrying, but skip the email + Pushover
// to avoid duplicates.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { BRAND, escapeHtml, renderEmailShell } from "../_shared/emailStyles.ts";
import { ui } from "../_shared/emailUi.ts";
import { getEmailParts } from "../_shared/emailCopy.ts";

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY');
const INTERNAL_SECRET           = Deno.env.get('INTERNAL_SECRET');
const ALERT_TO                  = 'hello@callmagnet.com.au';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  if (new URL(req.url).searchParams.get('warmup') === '1') {
    return new Response(JSON.stringify({ warmup: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET_CANCELLED');

    const body      = await req.text();
    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      return new Response(JSON.stringify({ error: 'Missing stripe-signature header' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const timestampMatch = signature.match(/t=(\d+)/);
    const sigMatch       = signature.match(/v1=([a-f0-9]+)/);

    if (!timestampMatch || !sigMatch) {
      return new Response('Invalid signature', { status: 400 });
    }

    // Replay-attack protection: reject webhooks older than 5 minutes
    const webhookTimestamp = parseInt(timestampMatch[1], 10);
    if (Math.abs(Date.now() / 1000 - webhookTimestamp) > 300) {
      return new Response('Webhook timestamp too old', { status: 400 });
    }

    const signedPayload = `${timestampMatch[1]}.${body}`;
    const encoder       = new TextEncoder();
    const cryptoKey     = await crypto.subtle.importKey(
      'raw', encoder.encode(webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(signedPayload));
    const computedSig     = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    if (computedSig !== sigMatch[1]) {
      return new Response('Signature mismatch', { status: 400 });
    }

    const event = JSON.parse(body);

    if (event.type === 'customer.subscription.deleted') {
      const stripeCustomerId = event.data.object.customer;

      // ── Look up client ────────────────────────────────────────────────────
      const clientRes = await fetch(
        `${SUPABASE_URL}/rest/v1/clients?stripe_customer_id=eq.${stripeCustomerId}&is_test_account=eq.false&select=id,business_name,email,account_status,created_at,is_test_account`,
        { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
      );
      const clients = await clientRes.json() as {
        id: string;
        business_name: string;
        email: string | null;
        account_status: string;
        created_at: string;
        is_test_account: boolean;
      }[];

      if (!clients || clients.length === 0) {
        console.warn(`stripe-subscription-deleted: no client for stripe_customer_id=${stripeCustomerId}`);
        return new Response(JSON.stringify({ received: true, skipped: 'no_client' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      const client = clients[0];

      if (client.is_test_account) {
        console.log(`stripe-subscription-deleted: Skipping test account ${client.business_name}`);
        return new Response(JSON.stringify({ received: true, skipped: 'test_account' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      // Idempotency: if already cancelled, return 200 without re-sending email
      if (client.account_status === 'cancelled') {
        console.log(`stripe-subscription-deleted: ${client.business_name} already cancelled — skipping`);
        return new Response(JSON.stringify({ received: true, skipped: 'already_cancelled' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      const cancelledAt = new Date().toISOString();

      // ── Patch client ──────────────────────────────────────────────────────
      await fetch(
        `${SUPABASE_URL}/rest/v1/clients?id=eq.${client.id}`,
        {
          method: 'PATCH',
          headers: {
            apikey:         SUPABASE_SERVICE_ROLE_KEY,
            Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            Prefer:         'return=minimal',
          },
          body: JSON.stringify({
            cancellation_scheduled: true,
            cancelled_at:           cancelledAt,
            account_status:         'cancelled',
          }),
        },
      );
      console.log(`stripe-subscription-deleted: patched ${client.business_name} → account_status=cancelled`);

      // ── Lifetime stats (parallel) ─────────────────────────────────────────
      const [smsTotalRes, smsDeliveredRes, bookingsRes] = await Promise.allSettled([
        fetch(
          `${SUPABASE_URL}/rest/v1/sms_events?client_id=eq.${client.id}&select=id`,
          { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Prefer: 'count=exact', Range: '0-0' } },
        ),
        fetch(
          `${SUPABASE_URL}/rest/v1/sms_events?client_id=eq.${client.id}&delivery_status=eq.delivered&select=id`,
          { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Prefer: 'count=exact', Range: '0-0' } },
        ),
        fetch(
          `${SUPABASE_URL}/rest/v1/bookings?client_id=eq.${client.id}&select=id`,
          { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Prefer: 'count=exact', Range: '0-0' } },
        ),
      ]);

      function parseCount(result: PromiseSettledResult<Response>): number {
        if (result.status !== 'fulfilled') return 0;
        const range = result.value.headers.get('content-range') ?? '';
        // content-range: 0-0/42  → extract 42
        const m = range.match(/\/(\d+)$/);
        return m ? parseInt(m[1], 10) : 0;
      }

      const totalSms     = parseCount(smsTotalRes);
      const deliveredSms = parseCount(smsDeliveredRes);
      const bookings     = parseCount(bookingsRes);

      const joinedDate   = new Date(client.created_at);
      const daysAsClient = Math.round((Date.now() - joinedDate.getTime()) / (1000 * 60 * 60 * 24));
      const joinedLabel  = joinedDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

      // ── Farewell email ────────────────────────────────────────────────────
      if (client.email && RESEND_API_KEY) {
        const byeCopy = await getEmailParts('farewell', { BUSINESS_NAME: client.business_name });
        const emailContent =
          byeCopy.top +
          ui.panel(
            ui.label('Your lifetime stats') +
            ui.rows([
              ['SMS replies sent', totalSms.toLocaleString()],
              ['Confirmed delivered', deliveredSms.toLocaleString()],
              ['Bookings logged', bookings.toLocaleString()],
              ['Days as a client', daysAsClient.toLocaleString()],
              ['Member since', escapeHtml(joinedLabel)],
            ])
          ) +
          (byeCopy.buttonLabel ? ui.outlineButton('mailto:hello@callmagnet.com.au', escapeHtml(byeCopy.buttonLabel)) : '') +
          byeCopy.footnoteHtml;

        fetch('https://api.resend.com/emails', {
          method:  'POST',
          headers: {
            Authorization:  `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from:    'CallMagnet <hello@callmagnet.com.au>',
            to:      client.email,
            subject: byeCopy.subject,
            html:    renderEmailShell(emailContent, byeCopy.preheader),
          }),
        }).catch((e) => console.warn(`stripe-subscription-deleted: farewell email failed (non-fatal): ${e}`));
      }

      // ── Pushover: notify Carl ─────────────────────────────────────────────
      if (INTERNAL_SECRET) {
        fetch(`${SUPABASE_URL}/functions/v1/send-pushover-alert`, {
          method:  'POST',
          headers: {
            'Content-Type':      'application/json',
            'X-Internal-Secret': INTERNAL_SECRET,
          },
          body: JSON.stringify({
            title:   '🔴 Subscription ended',
            message: `${client.business_name} subscription has now expired.\nSMS: ${totalSms} sent, ${deliveredSms} delivered. Bookings: ${bookings}.`,
          }),
        }).catch(() => {});
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errSafe = escapeHtml(String((error as Error).message ?? error));
    console.error(`stripe-subscription-deleted fatal: ${errSafe}`);

    // Alert email to Carl (fire-and-forget)
    if (RESEND_API_KEY) {
      const alertCopy = await getEmailParts('error_alert', { FUNCTION_NAME: 'stripe-subscription-deleted' });
      const alertContent =
        alertCopy.top +
        ui.sub('A subscription-cancellation webhook errored before completing.') +
        ui.panel(ui.rows([
          ['Function', 'stripe-subscription-deleted'],
          ['Error', errSafe],
          ['Time', new Date().toISOString()],
        ])) +
        ui.small('Log in to Supabase to investigate.');
      fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    'CallMagnet Alerts <alerts@callmagnet.com.au>',
          to:      ALERT_TO,
          subject: alertCopy.subject,
          html:    renderEmailShell(alertContent, alertCopy.preheader),
        }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
