import "jsr:@supabase/functions-js/edge-runtime.d.ts"


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
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
        `${supabaseUrl}/rest/v1/clients?stripe_customer_id=eq.${stripeCustomerId}&select=id,business_name`,
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
        html: `<p><strong>Function:</strong> stripe-subscription-deleted</p><p><strong>Error:</strong> ${error.message}</p><p><strong>Time:</strong> ${new Date().toISOString()}</p><p>Log in to Supabase to investigate.</p>`
      })
    }).catch(() => {})


    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})
