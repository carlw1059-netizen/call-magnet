// quick-responder (display name: sms-overage): nightly cron at 0 0 * * * UTC.
// Two batch jobs in one function:
//   1. SMS-overage reporting to Stripe billing meters (per active client
//      with stripe_customer_id who's exceeded their cycle's sms_included).
//   2. Cancellation finaliser — flips account_status to 'cancelled' for
//      clients whose cancellation_scheduled was set 30+ days ago.
//
// Email rebrand (Session 4 D2): the alert email block in the catch handler
// now uses _shared/emailStyles.ts so it matches the login palette. Same
// pattern as the other alert paths in this codebase.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { BRAND, escapeHtml, renderEmailShell } from "../_shared/emailStyles.ts";

Deno.serve(async () => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();


    // ── OVERAGE REPORTING ──────────────────────────────────────────────────────


    const clientsRes = await fetch(
      `${supabaseUrl}/rest/v1/clients?account_status=eq.active&select=*`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    const clients = await clientsRes.json();
    const results = [];


    for (const client of clients) {
      if (!client.stripe_customer_id) continue;


      if (client.last_overage_reported === today) {
        console.log(`Already reported today for ${client.business_name} — skipping`);
        continue;
      }


      const subStart = new Date(client.subscription_start || client.created_at);
      const totalDays = Math.floor((now - subStart) / 86400000);
      const cycleDay = totalDays % 30;
      const cycleStart = new Date(now.getTime() - cycleDay * 86400000);
      cycleStart.setHours(0, 0, 0, 0);


      const smsRes = await fetch(
        `${supabaseUrl}/rest/v1/sms_events?client_id=eq.${client.id}&received_at=gte.${cycleStart.toISOString()}&select=id`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );
      const smsEvents = await smsRes.json();
      const smsCount = smsEvents.length;
      const included = client.sms_included || 50;
      const overage = smsCount - included;


      if (overage <= 0) continue;


      const stripeRes = await fetch(
        'https://api.stripe.com/v1/billing/meter_events',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${stripeKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            event_name: 'sms_overage',
            'payload[stripe_customer_id]': client.stripe_customer_id,
            'payload[value]': String(overage),
            identifier: `${client.id}-${today}`,
            timestamp: String(Math.floor(Date.now() / 1000)),
          }),
        }
      );


      const stripeData = await stripeRes.json();
      console.log(`Stripe response for ${client.business_name}: ${JSON.stringify(stripeData)}`);


      if (stripeData.object === 'billing.meter_event' || stripeRes.ok) {
        await fetch(
          `${supabaseUrl}/rest/v1/clients?id=eq.${client.id}`,
          {
            method: 'PATCH',
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal'
            },
            body: JSON.stringify({ last_overage_reported: today })
          }
        );
        results.push({ client: client.business_name, overage, stripe: stripeData });
        console.log(`Reported ${overage} overage SMS for ${client.business_name}`);
      } else {
        console.log(`Stripe error for ${client.business_name}: ${JSON.stringify(stripeData)}`);
      }
    }


    // ── CANCELLATION FINALISER ─────────────────────────────────────────────────


    const cancelRes = await fetch(
      `${supabaseUrl}/rest/v1/clients?cancellation_scheduled=eq.true&account_status=eq.active&select=*`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    const cancelClients = await cancelRes.json();


    for (const client of cancelClients) {
      if (!client.cancelled_at) continue;


      const cancelledAt = new Date(client.cancelled_at);
      const daysSinceCancellation = Math.floor((now - cancelledAt) / 86400000);


      if (daysSinceCancellation >= 30) {
        await fetch(
          `${supabaseUrl}/rest/v1/clients?id=eq.${client.id}`,
          {
            method: 'PATCH',
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal'
            },
            body: JSON.stringify({ account_status: 'cancelled' })
          }
        );
        console.log(`Access ended for ${client.business_name} — 30 days since cancellation`);
      } else {
        console.log(`${client.business_name} — ${30 - daysSinceCancellation} days access remaining`);
      }
    }


    return new Response(JSON.stringify({ success: true, results }), {
      headers: { 'Content-Type': 'application/json' }
    });


  } catch (error) {
    console.log(`Fatal error: ${error.message}`);

    const alertContent = `
      <h1 style="font-size:22px;font-weight:700;color:${BRAND.primaryText};margin:0 0 4px;letter-spacing:-0.01em;">⚠️ sms-overage failed</h1>
      <p style="font-size:14px;color:${BRAND.secondaryText};margin:0 0 16px;">A nightly run errored before completing.</p>
      <p style="font-size:13px;color:${BRAND.primaryText};margin:0 0 8px;"><strong>Function:</strong> sms-overage (slug: quick-responder)</p>
      <p style="font-size:13px;color:${BRAND.primaryText};margin:0 0 8px;"><strong>Error:</strong> ${escapeHtml(String(error.message ?? error))}</p>
      <p style="font-size:13px;color:${BRAND.primaryText};margin:0 0 16px;"><strong>Time:</strong> ${new Date().toISOString()}</p>
      <p style="font-size:13px;color:${BRAND.secondaryText};margin:0;">Investigate in Supabase logs.</p>
    `;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'CallMagnet Alerts <hello@callmagnet.com.au>',
        to: 'car312@hotmail.com',
        subject: '⚠️ CallMagnet — sms-overage failed',
        html: renderEmailShell(alertContent, 'sms-overage run errored — check Supabase logs')
      })
    }).catch(() => {})


    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
});
