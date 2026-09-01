import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { renderEmailShell, BRAND, escapeHtml } from '../_shared/emailStyles.ts';




const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function getDashboardUrl(email: string): Promise<string> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supa = createClient(supabaseUrl, serviceKey);
    const { data } = await supa.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: 'https://callmagnet.com.au' },
    });
    return data?.properties?.action_link ?? 'https://callmagnet.com.au';
  } catch {
    return 'https://callmagnet.com.au';
  }
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
      const receiptUrl = session.url ?? session.receipt_url ?? null

      if (!clientId) {
        return new Response(JSON.stringify({ message: 'no client_id in metadata' }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        })
      }

      // Fetch client row upfront for guards and notifications
      const clientGuardRes = await fetch(
        `${supabaseUrl}/rest/v1/clients?id=eq.${clientId}&select=id,account_status,is_test_account,email,business_name,emails_sent`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      )
      const clientGuardRows = await clientGuardRes.json()
      if (!clientGuardRows || clientGuardRows.length === 0) {
        console.log(`checkout.session.completed: client not found for id=${clientId}`)
        return new Response(JSON.stringify({ received: true, skipped: 'client_not_found' }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        })
      }

      if (clientGuardRows[0].is_test_account) {
        console.log(`checkout.session.completed: skipping test account id=${clientId}`)
        return new Response(JSON.stringify({ received: true, skipped: 'test_account' }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        })
      }

      if (clientGuardRows[0].account_status !== 'pending_payment') {
        console.log(`checkout.session.completed: skipping — unexpected status=${clientGuardRows[0].account_status} for id=${clientId}`)
        return new Response(JSON.stringify({ received: true, skipped: 'unexpected_status', status: clientGuardRows[0].account_status }), {
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

      // Pushover alert to Carl
      const internalSecret = Deno.env.get('INTERNAL_SECRET')
      if (internalSecret) {
        fetch(`${supabaseUrl}/functions/v1/send-pushover-alert`, {
          method:  'POST',
          headers: {
            'Content-Type':      'application/json',
            'X-Internal-Secret': internalSecret,
          },
          body: JSON.stringify({
            title:   'New client paid',
            message: `${clientGuardRows[0].business_name} has paid their setup fee. Go to admin to activate.`,
          }),
        }).catch((e: Error) => console.warn(`checkout pushover alert failed — ${e?.message}`))
      }

      // Idempotency: only send emails once per checkout event
      const emailsSent = Array.isArray(clientGuardRows[0].emails_sent) ? clientGuardRows[0].emails_sent : []
      if (emailsSent.includes('setup_confirmation')) {
        console.log(`checkout.session.completed: emails already sent for id=${clientId}`)
      } else {
        // Alert email to Carl
        if (resendKey) {
          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from:    'CallMagnet <hello@callmagnet.com.au>',
              to:      'hello@callmagnet.com.au',
              subject: 'New client paid — ready to build',
              text:    `Business: ${clientGuardRows[0].business_name}\nEmail: ${clientGuardRows[0].email}\nPackage: ${pricingPackage || '(not set)'}`,
            }),
          }).catch((e: Error) => console.warn(`checkout carl alert email failed — ${e?.message}`))
          console.log(`checkout.session.completed: carl alert email sent for ${clientGuardRows[0].business_name}`)
        }

        // Confirmation email to client
        if (resendKey) {
          const clientName = clientGuardRows[0].business_name;
          const amount = session.amount_total ? (session.amount_total / 100).toFixed(0) : '0';
          const paymentHtml = renderEmailShell(`
  <h1 class="em-heading" style="font-size:26px;font-weight:700;color:${BRAND.primaryText};margin:0 0 8px;letter-spacing:-0.02em;">Payment confirmed. We're on it.</h1>
  <p style="font-size:14px;color:${BRAND.secondaryText};margin:0 0 24px;">${escapeHtml(clientName)} — Setup fee</p>
  <div style="background:${BRAND.successBg};border:1px solid ${BRAND.accent};border-radius:8px;padding:20px;margin:0 0 24px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${BRAND.accent};margin-bottom:8px;">Amount paid</div>
    <div style="font-size:32px;font-weight:300;color:${BRAND.primaryText};">$${amount} AUD</div>
  </div>
  <p style="font-size:14px;color:${BRAND.primaryText};line-height:1.6;margin:0 0 16px;">We're now setting up your Middle Man page and getting everything ready. We'll be in touch shortly with your login details and next steps.</p>
  <p style="margin:0;font-size:12px;color:${BRAND.mutedText};">Questions? Contact hello@callmagnet.com.au</p>
`, 'Payment received — we are setting up your account');
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from:    'CallMagnet <hello@callmagnet.com.au>',
              to:      clientGuardRows[0].email,
              subject: 'Payment received — we\'re setting up your account',
              html: paymentHtml,
              text: `Payment received.\n\nThanks for your payment, ${clientGuardRows[0].business_name}. We will be in touch within 24 hours to get your account configured and live.\n\nQuestions? hello@callmagnet.com.au\n\ncallmagnet.com.au\n`,
            }),
          }).catch((e: Error) => console.warn(`checkout confirmation email failed — ${e?.message}`))
          console.log(`checkout.session.completed: confirmation email sent to ${clientGuardRows[0].email}`)
        }

        // Mark emails sent so retries don't re-send
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
            body: JSON.stringify({ emails_sent: [...emailsSent, 'setup_confirmation'] }),
          }
        )
        console.log(`checkout.session.completed: emails_sent updated for id=${clientId}`)
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
        const dashboardUrl = await getDashboardUrl(client.email);
        const liveHtml = renderEmailShell(`
  <h1 class="em-heading" style="font-size:26px;font-weight:700;color:${BRAND.primaryText};margin:0 0 8px;letter-spacing:-0.02em;">You're live, ${escapeHtml(client.business_name)}.</h1>
  <p style="font-size:14px;color:${BRAND.secondaryText};margin:0 0 24px;">Your CallMagnet system is active.</p>
  <p style="font-size:14px;color:${BRAND.primaryText};line-height:1.6;margin:0 0 24px;">From this moment, every missed call to your number triggers an automatic SMS to the caller. Your Middle Man page is live and your dashboard is ready.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;"><tr><td align="center"><a href="${dashboardUrl}" style="display:inline-block;background:${BRAND.accent};color:#000000;padding:14px 32px;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;font-family:${BRAND.fontStack};letter-spacing:0.02em;">View your dashboard →</a></td></tr></table>
  <p style="margin:0;font-size:12px;color:${BRAND.mutedText};">Questions? Contact hello@callmagnet.com.au</p>
`, 'Your CallMagnet system is live');
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
            html: liveHtml,
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






