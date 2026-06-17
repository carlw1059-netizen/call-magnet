import "jsr:@supabase/functions-js/edge-runtime.d.ts"




const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}




Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Warmup — return before body parsing so the 300-second replay guard is
  // never reached. Stripe sends POST; warmup pings arrive as GET ?warmup=1.
  if (new URL(req.url).searchParams.get('warmup') === '1') {
    return new Response(JSON.stringify({ warmup: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET_SUCCEEDED')
    const resendKey = Deno.env.get('RESEND_API_KEY')

    const body = await req.text()
    const signature = req.headers.get('stripe-signature')
    if (!signature) {
      return new Response(JSON.stringify({ error: 'Missing stripe-signature header' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      })
    }
    const timestampMatch = signature.match(/t=(\d+)/)
    const sigMatch = signature.match(/v1=([a-f0-9]+)/)




    if (!timestampMatch || !sigMatch) {
      return new Response('Invalid signature', { status: 400 })
    }

    // Replay attack protection: reject webhooks more than 5 minutes old
    const webhookTimestamp = parseInt(timestampMatch[1], 10)
    if (Math.abs(Date.now() / 1000 - webhookTimestamp) > 300) {
      return new Response('Webhook timestamp too old', { status: 400 })
    }

    const signedPayload = `${timestampMatch[1]}.${body}`
    const encoder = new TextEncoder()
    const cryptoKey = await crypto.subtle.importKey(
      'raw', encoder.encode(webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(signedPayload))
    const computedSig = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('')




    if (computedSig !== sigMatch[1]) {
      return new Response('Signature mismatch', { status: 400 })
    }




    const event = JSON.parse(body)




    if (event.type === 'checkout.session.completed') {
      const session        = event.data.object
      const clientId       = session.metadata?.client_id
      const pricingPackage = session.metadata?.pricing_package || ''

      if (!clientId) {
        return new Response(JSON.stringify({ message: 'no client_id in metadata' }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        })
      }

      // Set account to pending_setup — Carl will manually activate after account configuration
      await fetch(
        `${supabaseUrl}/rest/v1/clients?id=eq.${clientId}`,
        {
          method: 'PATCH',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ account_status: 'pending_setup' }),
        }
      )
      console.log(`checkout.session.completed: set client ${clientId} to pending_setup`)

      // Fetch client details for notifications
      const clientRes = await fetch(
        `${supabaseUrl}/rest/v1/clients?id=eq.${clientId}&select=email,business_name`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      )
      const clients = await clientRes.json()
      const client  = clients?.[0]

      // Pushover alert to Carl
      const internalSecret = Deno.env.get('INTERNAL_SECRET')
      if (internalSecret && client) {
        fetch(`${supabaseUrl}/functions/v1/send-pushover-alert`, {
          method:  'POST',
          headers: {
            'Content-Type':      'application/json',
            'X-Internal-Secret': internalSecret,
          },
          body: JSON.stringify({
            title:   'New client paid',
            message: `${client.business_name} has paid their setup fee. Go to admin to activate.`,
          }),
        }).catch((e: Error) => console.warn(`checkout pushover alert failed — ${e?.message}`))
      }

      // Confirmation email to client
      if (client && resendKey) {
        const bizSafe = String(client.business_name).replace(/[&<>"']/g, (c: string) =>
          ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
        )
        const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Payment received</title></head>
<body style="margin:0;padding:0;background:#0E1419;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#FFFFFF;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0E1419;">
  <tr><td align="center" style="padding:32px 16px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:rgba(255,255,255,0.04);border:1px solid rgba(16,185,129,0.22);border-radius:14px;">
      <tr><td style="padding:36px 30px 32px;color:#FFFFFF;">
        <div style="font-size:14px;letter-spacing:0.16em;color:#10b981;text-transform:uppercase;font-weight:700;margin-bottom:28px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">★ CallMagnet</div>
        <h1 style="margin:0 0 12px;font-size:24px;font-weight:600;color:#FFFFFF;letter-spacing:-0.01em;">Payment received.</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:rgba(255,255,255,0.75);">Thanks for your payment, ${bizSafe}. Carl will be in touch within 24 hours to get your account configured and live.</p>
        <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.4);">Questions? Contact hello@callmagnet.com.au</p>
      </td></tr>
    </table>
    <div style="font-size:12px;color:rgba(255,255,255,0.25);margin-top:18px;letter-spacing:0.06em;">CallMagnet</div>
  </td></tr>
</table>
</body></html>`
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from:    'CallMagnet <hello@callmagnet.com.au>',
            to:      client.email,
            subject: 'Payment received — we\'re setting up your account',
            html,
            text: `Payment received.\n\nThanks for your payment, ${client.business_name}. Carl will be in touch within 24 hours to get your account configured and live.\n\nQuestions? Contact hello@callmagnet.com.au\n\nCallMagnet — callmagnet.com.au\n`,
          }),
        }).catch((e: Error) => console.warn(`checkout confirmation email failed — ${e?.message}`))
        console.log(`checkout.session.completed: confirmation email sent to ${client.email}`)
      }

      return new Response(JSON.stringify({ received: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      })

    } else if (event.type === 'invoice.payment_succeeded') {
      const stripeCustomerId      = event.data.object.customer
      const stripeSubscriptionId  = typeof event.data.object.subscription === 'string'
        ? event.data.object.subscription
        : null




      const clientRes = await fetch(
        `${supabaseUrl}/rest/v1/clients?stripe_customer_id=eq.${stripeCustomerId}&is_test_account=eq.false&select=*`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      )
      const clients = await clientRes.json()




      if (!clients || clients.length === 0) {
        return new Response(JSON.stringify({ message: 'Client not found' }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        })
      }




      const client = clients[0]

      if (client.is_test_account) {
        console.log(`stripe-payment-succeeded: Skipping test account ${client.business_name}`)
        return new Response(JSON.stringify({ received: true, skipped: 'test_account' }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        })
      }

      // Reactivate account
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
          body: JSON.stringify({
            account_status: 'active',
            ...(stripeSubscriptionId ? { stripe_subscription_id: stripeSubscriptionId } : {}),
          })
        }
      )
      console.log(`Reactivated account for ${client.business_name}`)




      // Send welcome email if first payment
      const emailsSent = client.emails_sent || []
      if (!emailsSent.includes('welcome') && resendKey) {
        // Locked dark palette. Only 7 hex/rgba values appear in this HTML:
        // #0E1419 (bg) #161D24 (card) #06D6A0 (accent) #CC5500 (edge)
        // #FFFFFF (text) #B0B8C1 (secondary) #6B7480 (muted) rgba(6,214,160,0.15) (border)
        const bizSafe = String(client.business_name).replace(/[&<>"']/g, (c) =>
          ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]
        )
        const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>You're live, ${bizSafe}.</title></head>
<body style="margin:0;padding:0;background:#0E1419;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#FFFFFF;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:transparent;">Your CallMagnet system is now live.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0E1419;">
  <tr><td align="center" style="padding:32px 16px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#161D24;border:1px solid rgba(6,214,160,0.15);border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.35);">
      <tr><td style="padding:40px 36px;color:#FFFFFF;">
        <div style="font-size:14px;letter-spacing:0.16em;color:#06D6A0;text-transform:uppercase;font-weight:700;margin-bottom:28px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">★ CallMagnet</div>
        <h1 style="margin:0 0 8px;font-size:26px;font-weight:600;color:#FFFFFF;letter-spacing:-0.01em;">You're live, ${bizSafe}.</h1>
        <p style="margin:0 0 28px;font-size:15px;line-height:1.55;color:#B0B8C1;">Your CallMagnet system is active right now.</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#FFFFFF;">From this moment — every time someone calls your business number and can't get through, they'll automatically receive an SMS with your booking link within seconds.</p>
        <p style="margin:0 0 28px;font-size:15px;line-height:1.65;color:#FFFFFF;">You don't need to do anything. No app to monitor. No calls to return. CallMagnet runs silently in the background and catches the revenue you would have lost.</p>
        <div style="background:#0E1419;border:1px solid rgba(6,214,160,0.15);border-left:3px solid #CC5500;border-radius:10px;padding:18px 20px;margin:0 0 28px;">
          <div style="font-size:11px;letter-spacing:0.12em;color:#06D6A0;text-transform:uppercase;font-weight:700;margin-bottom:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">One thing to do now</div>
          <p style="margin:0 0 6px;font-size:14px;line-height:1.5;color:#FFFFFF;">When a missed caller books with you — tap <strong style="color:#06D6A0;">+ Log a booking</strong> in your dashboard.</p>
          <p style="margin:0;font-size:14px;line-height:1.5;color:#B0B8C1;">It takes two seconds and tracks exactly how much revenue CallMagnet is recovering for you.</p>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="left" style="padding:0 0 20px;">
          <a href="https://callmagnet.com.au" style="display:inline-block;background:#06D6A0;color:#0E1419;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;letter-spacing:0.01em;">View your dashboard →</a>
        </td></tr></table>
        <p style="margin:32px 0 0;font-size:13px;line-height:1.5;color:#B0B8C1;">Questions? Reply to this email or contact <a href="mailto:hello@callmagnet.com.au" style="color:#06D6A0;text-decoration:none;">hello@callmagnet.com.au</a></p>
        <p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:#6B7480;">We will never sell your data. Ever.</p>
      </td></tr>
    </table>
    <div style="font-size:12px;color:#6B7480;margin-top:18px;letter-spacing:0.06em;">CallMagnet</div>
  </td></tr>
</table>
</body></html>`
        const text =
          `You're live, ${client.business_name}.\n\n` +
          `Your CallMagnet system is active right now.\n\n` +
          `From this moment — every time someone calls your business number and can't get through, they'll automatically receive an SMS with your booking link within seconds.\n\n` +
          `You don't need to do anything. No app to monitor. No calls to return.\n\n` +
          `One thing to do now: when a missed caller books with you, tap "+ Log a booking" in your dashboard. It takes two seconds and tracks exactly how much revenue CallMagnet is recovering for you.\n\n` +
          `View your dashboard: https://callmagnet.com.au\n\n` +
          `Questions? Reply to this email or contact hello@callmagnet.com.au\n` +
          `We will never sell your data. Ever.\n`
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'CallMagnet <hello@callmagnet.com.au>',
            to: client.email,
            subject: `You're live, ${client.business_name}.`,
            html,
            text
          })
        })
        const emailData = await emailRes.json()
        console.log(`Welcome email response: ${JSON.stringify(emailData)}`)




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
            body: JSON.stringify({ emails_sent: [...emailsSent, 'welcome'] })
          }
        )
        console.log(`Welcome email sent to ${client.business_name}`)
      }
    }




    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })




  } catch (error) {
    const errSafe = String(error.message ?? error).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c])
    const alertHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0E1419;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#FFFFFF;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0E1419;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:#161D24;border:1px solid rgba(6,214,160,0.15);border-left:3px solid #CC5500;border-radius:14px;">
<tr><td style="padding:36px 30px;color:#FFFFFF;">
<div style="font-size:14px;letter-spacing:0.16em;color:#06D6A0;text-transform:uppercase;font-weight:700;margin-bottom:24px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">★ CallMagnet</div>
<h1 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#FFFFFF;">⚠️ stripe-payment-succeeded failed</h1>
<p style="margin:0 0 18px;font-size:13px;color:#B0B8C1;">A payment webhook errored before completing — client account may still be suspended despite successful payment.</p>
<p style="margin:0 0 6px;font-size:13px;color:#FFFFFF;"><strong>Function:</strong> stripe-payment-succeeded</p>
<p style="margin:0 0 6px;font-size:13px;color:#FFFFFF;"><strong>Error:</strong> ${errSafe}</p>
<p style="margin:0 0 16px;font-size:13px;color:#FFFFFF;"><strong>Time:</strong> ${new Date().toISOString()}</p>
<p style="margin:0;font-size:12px;color:#6B7480;">Log in to Supabase and manually set account_status = active for the affected client.</p>
</td></tr></table>
<div style="font-size:12px;color:#6B7480;margin-top:18px;letter-spacing:0.06em;">CallMagnet</div>
</td></tr></table></body></html>`
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'CallMagnet Alerts <hello@callmagnet.com.au>',
        to: 'car312@hotmail.com',
        subject: '⚠️ ALERT: stripe-payment-succeeded failed — check client account status',
        html: alertHtml
      })
    }).catch(() => {})

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})






