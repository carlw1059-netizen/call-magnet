import "jsr:@supabase/functions-js/edge-runtime.d.ts"




const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}




Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
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




    if (event.type === 'invoice.payment_succeeded') {
      const stripeCustomerId = event.data.object.customer




      const clientRes = await fetch(
        `${supabaseUrl}/rest/v1/clients?stripe_customer_id=eq.${stripeCustomerId}&select=*`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      )
      const clients = await clientRes.json()




      if (!clients || clients.length === 0) {
        return new Response(JSON.stringify({ message: 'Client not found' }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        })
      }




      const client = clients[0]




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
          body: JSON.stringify({ account_status: 'active' })
        }
      )
      console.log(`Reactivated account for ${client.business_name}`)




      // Send welcome email if first payment
      const emailsSent = client.emails_sent || []
      if (!emailsSent.includes('welcome') && resendKey) {
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
            html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#0d0d0d;color:#f0f0f0;padding:40px 32px;border-radius:10px;">
              <div style="font-family:monospace;font-size:22px;letter-spacing:0.15em;color:#191970;text-transform:uppercase;margin-bottom:32px;font-weight:700;">★ CallMagnet</div>
              <h1 style="font-size:28px;font-weight:700;color:#f0f0f0;margin-bottom:8px;letter-spacing:-0.02em;">You're live, ${client.business_name}.</h1>
              <p style="font-size:15px;color:#888;margin-bottom:32px;">Your CallMagnet system is active right now.</p>
              <p style="font-size:15px;color:#f0f0f0;line-height:1.7;margin-bottom:16px;">From this moment — every time someone calls your business number and can't get through, they'll automatically receive an SMS with your booking link within seconds.</p>
              <p style="font-size:15px;color:#f0f0f0;line-height:1.7;margin-bottom:16px;">You don't need to do anything. No app to monitor. No calls to return. CallMagnet runs silently in the background and catches the revenue you would have lost.</p>
              <div style="background:#161616;border:1px solid #191970;border-radius:8px;padding:20px 24px;margin:32px 0;">
                <p style="font-family:monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#191970;margin-bottom:16px;font-weight:700;">One thing to do now</p>
                <p style="font-size:14px;color:#f0f0f0;margin-bottom:8px;">When a missed caller books with you — tap <strong>+ Log a booking</strong> in your dashboard.</p>
                <p style="font-size:14px;color:#f0f0f0;margin-bottom:0;">It takes two seconds and tracks exactly how much revenue CallMagnet is recovering for you.</p>
              </div>
              <a href="https://callmagnet.com.au" style="display:inline-block;background:#191970;color:#ffffff;padding:12px 24px;border-radius:6px;font-weight:700;text-decoration:none;font-size:14px;margin-bottom:32px;">View your dashboard →</a>
              <p style="font-size:13px;color:#555;margin-top:40px;">Questions? Reply to this email or contact hello@callmagnet.com.au</p>
              <p style="font-size:13px;color:#555;">We will never sell your data. Ever.</p>
            </div>`
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})






