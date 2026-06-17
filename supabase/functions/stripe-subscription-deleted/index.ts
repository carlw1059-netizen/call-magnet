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

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY');
const INTERNAL_SECRET           = Deno.env.get('INTERNAL_SECRET');
const ALERT_TO                  = 'car312@hotmail.com';

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
        const bizSafe = escapeHtml(client.business_name);

        const statRow = (label: string, value: string | number) =>
          `<tr>
            <td style="padding:8px 0;font-size:14px;color:${BRAND.secondaryText};border-bottom:1px solid rgba(255,255,255,0.06);">${label}</td>
            <td style="padding:8px 0;font-size:14px;font-weight:700;color:${BRAND.primaryText};text-align:right;border-bottom:1px solid rgba(255,255,255,0.06);">${value}</td>
          </tr>`;

        const emailContent = `
          <h1 class="em-heading" style="font-size:26px;font-weight:600;color:${BRAND.primaryText};letter-spacing:-0.01em;margin:0 0 10px;">
            Thanks for trying CallMagnet, ${bizSafe}.
          </h1>
          <p style="font-size:15px;line-height:1.6;color:${BRAND.secondaryText};margin:0 0 28px;">
            Your subscription has ended. Here's a look back at what CallMagnet did for you.
          </p>

          <div style="background:${BRAND.pageBackground};border:1px solid ${BRAND.borderColor};border-radius:12px;padding:20px 24px;margin:0 0 28px;">
            <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.accent};margin-bottom:16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
              Your lifetime stats
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${statRow('SMS replies sent', totalSms.toLocaleString())}
              ${statRow('Confirmed delivered', deliveredSms.toLocaleString())}
              ${statRow('Bookings logged', bookings.toLocaleString())}
              ${statRow('Days as a client', daysAsClient.toLocaleString())}
              <tr>
                <td style="padding:8px 0;font-size:14px;color:${BRAND.secondaryText};">Member since</td>
                <td style="padding:8px 0;font-size:14px;font-weight:700;color:${BRAND.primaryText};text-align:right;">${joinedLabel}</td>
              </tr>
            </table>
          </div>

          <p style="font-size:15px;line-height:1.6;color:${BRAND.secondaryText};margin:0 0 24px;">
            If there's anything we could have done better, or if you'd like to come back,
            we'd love to hear from you.
          </p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:0 0 24px;">
              <a href="mailto:hello@callmagnet.com.au"
                 style="display:inline-block;background:transparent;color:${BRAND.accent};text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;letter-spacing:0.01em;border:1px solid ${BRAND.accent};">
                Send us feedback →
              </a>
            </td></tr>
          </table>

          <p style="font-size:13px;line-height:1.55;color:${BRAND.mutedText};margin:0;">
            Wishing you and ${bizSafe} all the best. 🙏
          </p>
        `;

        fetch('https://api.resend.com/emails', {
          method:  'POST',
          headers: {
            Authorization:  `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from:    'CallMagnet <hello@callmagnet.com.au>',
            to:      client.email,
            subject: `Your CallMagnet subscription has ended — thanks for being with us`,
            html:    renderEmailShell(emailContent, `Thanks for being a CallMagnet client, ${client.business_name}.`),
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
      const alertContent = `
        <h1 style="font-size:22px;font-weight:700;color:${BRAND.primaryText};margin:0 0 4px;letter-spacing:-0.01em;">⚠️ stripe-subscription-deleted failed</h1>
        <p style="font-size:14px;color:${BRAND.secondaryText};margin:0 0 16px;">A subscription-cancellation webhook errored before completing.</p>
        <p style="font-size:13px;color:${BRAND.primaryText};margin:0 0 8px;"><strong>Function:</strong> stripe-subscription-deleted</p>
        <p style="font-size:13px;color:${BRAND.primaryText};margin:0 0 8px;"><strong>Error:</strong> ${errSafe}</p>
        <p style="font-size:13px;color:${BRAND.primaryText};margin:0 0 16px;"><strong>Time:</strong> ${new Date().toISOString()}</p>
        <p style="font-size:13px;color:${BRAND.mutedText};margin:0;">Log in to Supabase to investigate.</p>
      `;
      fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    'CallMagnet Alerts <hello@callmagnet.com.au>',
          to:      ALERT_TO,
          subject: '⚠️ CallMagnet — stripe-subscription-deleted failed',
          html:    renderEmailShell(alertContent, 'stripe-subscription-deleted failed'),
        }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
