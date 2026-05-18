import "jsr:@supabase/functions-js/edge-runtime.d.ts"


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
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
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET_CANCELLED')

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


    if (event.type === 'customer.subscription.deleted') {
      const stripeCustomerId = event.data.object.customer


      const clientRes = await fetch(
        `${supabaseUrl}/rest/v1/clients?stripe_customer_id=eq.${stripeCustomerId}&is_test_account=eq.false&select=id,business_name`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      )
      const clients = await clientRes.json()


      if (!clients || clients.length === 0) {
        return new Response(JSON.stringify({ message: 'Client not found' }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        })
      }


      await fetch(
        `${supabaseUrl}/rest/v1/clients?id=eq.${clients[0].id}`,
        {
          method: 'PATCH',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal'
          },
          body: JSON.stringify({
            cancellation_scheduled: true,
            cancelled_at: new Date().toISOString()
          })
        }
      )
      console.log(`Cancellation scheduled for ${clients[0].business_name}`)
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
<h1 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#FFFFFF;">⚠️ stripe-subscription-deleted failed</h1>
<p style="margin:0 0 18px;font-size:13px;color:#B0B8C1;">A subscription-cancellation webhook errored before completing.</p>
<p style="margin:0 0 6px;font-size:13px;color:#FFFFFF;"><strong>Function:</strong> stripe-subscription-deleted</p>
<p style="margin:0 0 6px;font-size:13px;color:#FFFFFF;"><strong>Error:</strong> ${errSafe}</p>
<p style="margin:0 0 16px;font-size:13px;color:#FFFFFF;"><strong>Time:</strong> ${new Date().toISOString()}</p>
<p style="margin:0;font-size:12px;color:#6B7480;">Log in to Supabase to investigate.</p>
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
        subject: '⚠️ CallMagnet — stripe-subscription-deleted failed',
        html: alertHtml
      })
    }).catch(() => {})


    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})
