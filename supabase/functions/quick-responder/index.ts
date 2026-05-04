import "jsr:@supabase/functions-js/edge-runtime.d.ts"


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
        html: `<p><strong>Function:</strong> sms-overage</p><p><strong>Error:</strong> ${error.message}</p><p><strong>Time:</strong> ${new Date().toISOString()}</p><p>Log in to Supabase to investigate.</p>`
      })
    }).catch(() => {})


    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
});
