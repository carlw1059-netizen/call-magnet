import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { renderEmailShell, BRAND, escapeHtml } from '../_shared/emailStyles.ts';
import { ui } from '../_shared/emailUi.ts';
import { getEmailParts } from '../_shared/emailCopy.ts';




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
          const carlCopy = await getEmailParts('carl_new_client_alert', { BUSINESS_NAME: clientGuardRows[0].business_name });
          const carlHtml = renderEmailShell(
            carlCopy.top +
            ui.panel(ui.rows([
              ['Business', escapeHtml(clientGuardRows[0].business_name ?? '')],
              ['Email', escapeHtml(clientGuardRows[0].email ?? '')],
              ['Package', escapeHtml(pricingPackage || '(not set)')],
            ])) +
            (carlCopy.buttonLabel ? ui.button('https://callmagnet.com.au', escapeHtml(carlCopy.buttonLabel)) : '') +
            carlCopy.footnoteHtml,
            carlCopy.preheader,
          );
          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from:    'CallMagnet <hello@callmagnet.com.au>',
              to:      'hello@callmagnet.com.au',
              subject: carlCopy.subject,
              html:    carlHtml,
              text:    `Business: ${clientGuardRows[0].business_name}\nEmail: ${clientGuardRows[0].email}\nPackage: ${pricingPackage || '(not set)'}`,
            }),
          }).catch((e: Error) => console.warn(`checkout carl alert email failed — ${e?.message}`))
          console.log(`checkout.session.completed: carl alert email sent for ${clientGuardRows[0].business_name}`)
        }

        // Confirmation email to client
        if (resendKey) {
          const clientName = clientGuardRows[0].business_name;
          const amount = session.amount_total ? (session.amount_total / 100).toFixed(0) : '0';
          const payCopy = await getEmailParts('payment_received', { BUSINESS_NAME: clientName });
          const paymentHtml = renderEmailShell(
            payCopy.top +
            ui.panel(ui.label('Amount paid') + `<div style="font-family:${BRAND.fontStack};font-size:32px;font-weight:300;color:${BRAND.primaryText};">$${amount} AUD</div>`) +
            (payCopy.buttonLabel ? ui.button('https://callmagnet.com.au', escapeHtml(payCopy.buttonLabel)) : '') +
            payCopy.footnoteHtml +
            ui.contact(),
            payCopy.preheader,
          );
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from:    'CallMagnet <hello@callmagnet.com.au>',
              to:      clientGuardRows[0].email,
              subject: payCopy.subject,
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
        const liveCopy = await getEmailParts('you_are_live', { BUSINESS_NAME: client.business_name });
        const liveHtml = renderEmailShell(
          liveCopy.top +
          (liveCopy.buttonLabel ? ui.button(dashboardUrl, escapeHtml(liveCopy.buttonLabel)) : '') +
          liveCopy.footnoteHtml +
          ui.contact(),
          liveCopy.preheader,
        );
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
            subject: liveCopy.subject,
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
    const alertCopy = await getEmailParts('error_alert', { FUNCTION_NAME: 'stripe-payment-succeeded' });
    const alertHtml = renderEmailShell(
      alertCopy.top +
      ui.sub('A payment webhook errored before completing — client account may still be suspended despite successful payment.') +
      ui.panel(ui.rows([
        ['Function', 'stripe-payment-succeeded'],
        ['Error', escapeHtml(String(error?.message ?? error))],
        ['Time', new Date().toISOString()],
      ])) +
      ui.small('Log in to Supabase and manually set account_status = active for the affected client.'),
      alertCopy.preheader,
    );
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from:    'CallMagnet Alerts <hello@callmagnet.com.au>',
        to:      'hello@callmagnet.com.au',
        subject: alertCopy.subject,
        html:    alertHtml
      })
    }).catch(() => {})

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})






