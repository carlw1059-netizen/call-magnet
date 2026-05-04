import "jsr:@supabase/functions-js/edge-runtime.d.ts"


Deno.serve(async () => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const resendKey = Deno.env.get('RESEND_API_KEY')


    console.log(`RESEND_API_KEY present: ${!!resendKey}, length: ${resendKey?.length || 0}`)


    if (!resendKey) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY missing' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      })
    }


    const now = new Date()
    const clientsRes = await fetch(
      `${supabaseUrl}/rest/v1/clients?account_status=eq.active&select=*`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    )
    const clients = await clientsRes.json()
    console.log(`Found ${clients.length} active clients`)


    for (const client of clients) {
      if (!client.email) continue
      const emailsSent = client.emails_sent || []
      const subStart = new Date(client.subscription_start || client.created_at)
      const daysSinceStart = Math.floor((now - subStart) / 86400000)
      console.log(`${client.business_name} — day ${daysSinceStart}, emails sent: ${JSON.stringify(emailsSent)}`)


      // ── DAY 14 ──────────────────────────────────────────────────────────────
      if (daysSinceStart >= 14 && !emailsSent.includes('day14')) {
        const smsRes = await fetch(
          `${supabaseUrl}/rest/v1/sms_events?client_id=eq.${client.id}&select=id`,
          { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        )
        const smsEvents = await smsRes.json()
        const smsCount = smsEvents.length


        const clickRes = await fetch(
          `${supabaseUrl}/rest/v1/link_clicks?client_id=eq.${client.id}&select=id`,
          { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        )
        const clicks = await clickRes.json()
        const clickCount = clicks.length


        const avgJob = client.avg_job_value || 0
        const recovered = clickCount > 0 ? Math.round(clickCount * avgJob * 0.7) : smsCount * avgJob * 0.3


        console.log(`Sending day 14 email to ${client.email}`)
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'CallMagnet <hello@callmagnet.com.au>',
            to: client.email,
            subject: `Two weeks in, ${client.business_name}.`,
            html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#0d0d0d;color:#f0f0f0;padding:40px 32px;border-radius:10px;">
              <div style="font-family:monospace;font-size:22px;letter-spacing:0.15em;color:#191970;text-transform:uppercase;margin-bottom:32px;font-weight:700;">★ CallMagnet</div>
              <h1 style="font-size:28px;font-weight:700;color:#f0f0f0;margin-bottom:8px;letter-spacing:-0.02em;">Two weeks in, ${client.business_name}.</h1>
              <p style="font-size:15px;color:#888;margin-bottom:32px;">Here's what's been happening while you've been busy.</p>
              <div style="background:#161616;border:1px solid #191970;border-radius:8px;padding:24px;margin-bottom:32px;text-align:center;">
                <p style="font-family:monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#191970;margin-bottom:20px;font-weight:700;">Two weeks</p>
                <p style="font-size:52px;font-weight:300;color:#191970;letter-spacing:-0.02em;margin-bottom:4px;">${smsCount}</p>
                <p style="font-size:14px;color:#888;margin-bottom:${clickCount > 0 ? '24px' : '0'};">missed calls caught</p>
                ${clickCount > 0 ? `
                <p style="font-size:36px;font-weight:300;color:#9c6fdc;letter-spacing:-0.02em;margin-bottom:4px;">${clickCount}</p>
                <p style="font-size:14px;color:#888;margin-bottom:${recovered > 0 ? '24px' : '0'};">customers tapped your booking link</p>` : ''}
                ${recovered > 0 ? `
                <p style="font-size:36px;font-weight:300;color:#4caf50;letter-spacing:-0.02em;margin-bottom:4px;">$${recovered.toLocaleString()}</p>
                <p style="font-size:14px;color:#888;">estimated revenue recovered</p>` : ''}
              </div>
              <p style="font-size:15px;color:#f0f0f0;line-height:1.7;margin-bottom:16px;">Every one of those callers tried to reach your business number and couldn't get through. Without CallMagnet — they would have called someone else.</p>
              <p style="font-size:15px;color:#f0f0f0;line-height:1.7;margin-bottom:32px;">When a missed caller books with you — tap <strong>+ Log a booking</strong> in your dashboard. It keeps your revenue total accurate and shows you exactly what CallMagnet is recovering.</p>
              <a href="https://callmagnet.com.au" style="display:inline-block;background:#191970;color:#ffffff;padding:12px 24px;border-radius:6px;font-weight:700;text-decoration:none;font-size:14px;margin-bottom:32px;">View your dashboard →</a>
              <p style="font-size:13px;color:#555;margin-top:40px;">Questions? Reply to this email or contact hello@callmagnet.com.au</p>
            </div>`
          })
        })
        const emailData = await emailRes.json()
        console.log(`Day 14 Resend response: ${JSON.stringify(emailData)}`)


        await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${client.id}`, {
          method: 'PATCH',
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ emails_sent: [...emailsSent, 'day14'] })
        })
      }


      // ── DAY 30 ──────────────────────────────────────────────────────────────
      if (daysSinceStart >= 30 && !emailsSent.includes('day30')) {
        const smsRes = await fetch(
          `${supabaseUrl}/rest/v1/sms_events?client_id=eq.${client.id}&select=id`,
          { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        )
        const smsEvents = await smsRes.json()
        const clickRes = await fetch(
          `${supabaseUrl}/rest/v1/link_clicks?client_id=eq.${client.id}&select=id`,
          { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        )
        const clicks = await clickRes.json()
        const bookRes = await fetch(
          `${supabaseUrl}/rest/v1/bookings?client_id=eq.${client.id}&select=id`,
          { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        )
        const bookings = await bookRes.json()


        const smsCount = smsEvents.length
        const clickCount = clicks.length
        const bookCount = bookings.length
        const avgJob = client.avg_job_value || 0
        const convRate = clickCount > 0 && bookCount > 0 ? bookCount / clickCount : 0.7
        const recovered = clickCount > 0 ? Math.round(clickCount * avgJob * convRate) : bookCount * avgJob


        console.log(`Sending day 30 email to ${client.email}`)
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'CallMagnet <hello@callmagnet.com.au>',
            to: client.email,
            subject: `Your first month, ${client.business_name}.`,
            html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#0d0d0d;color:#f0f0f0;padding:40px 32px;border-radius:10px;">
              <div style="font-family:monospace;font-size:22px;letter-spacing:0.15em;color:#191970;text-transform:uppercase;margin-bottom:32px;font-weight:700;">★ CallMagnet</div>
              <h1 style="font-size:28px;font-weight:700;color:#f0f0f0;margin-bottom:8px;letter-spacing:-0.02em;">Your first month, ${client.business_name}.</h1>
              <p style="font-size:15px;color:#888;margin-bottom:32px;">One month of catching what you would have lost.</p>
              <div style="background:#161616;border:1px solid #191970;border-radius:8px;padding:24px;margin-bottom:32px;">
                <p style="font-family:monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#191970;margin-bottom:20px;font-weight:700;">Month one</p>
                <div style="margin-bottom:${recovered > 0 ? '24px' : '0'};">
                  <p style="font-size:36px;font-weight:300;color:#191970;letter-spacing:-0.02em;margin-bottom:4px;">${smsCount}</p>
                  <p style="font-size:13px;color:#888;margin-bottom:16px;">missed calls caught</p>
                  <p style="font-size:36px;font-weight:300;color:#9c6fdc;letter-spacing:-0.02em;margin-bottom:4px;">${clickCount}</p>
                  <p style="font-size:13px;color:#888;margin-bottom:16px;">customers tapped your booking link</p>
                  <p style="font-size:36px;font-weight:300;color:#4caf50;letter-spacing:-0.02em;margin-bottom:4px;">${bookCount}</p>
                  <p style="font-size:13px;color:#888;">bookings logged</p>
                </div>
                ${recovered > 0 ? `
                <div style="border-top:1px solid #2a2a2a;padding-top:20px;text-align:center;">
                  <p style="font-size:48px;font-weight:300;color:#4caf50;letter-spacing:-0.02em;margin-bottom:4px;">$${recovered.toLocaleString()}</p>
                  <p style="font-size:14px;color:#888;">estimated revenue recovered</p>
                </div>` : ''}
              </div>
              <p style="font-size:15px;color:#f0f0f0;line-height:1.7;margin-bottom:16px;">Those are customers who called your business number, couldn't get through, and still booked — because CallMagnet sent them straight to your booking link before they moved on.</p>
              <p style="font-size:15px;color:#f0f0f0;line-height:1.7;margin-bottom:32px;">At 3 recovered bookings a week at $80 each — CallMagnet pays for itself in the first week of every month. The other three weeks are yours.</p>
              <a href="https://callmagnet.com.au" style="display:inline-block;background:#191970;color:#ffffff;padding:12px 24px;border-radius:6px;font-weight:700;text-decoration:none;font-size:14px;margin-bottom:32px;">View your dashboard →</a>
              <p style="font-size:13px;color:#555;margin-top:8px;">Thank you for being one of our first clients.</p>
              <p style="font-size:13px;color:#555;">We will never sell your data. Ever.</p>
            </div>`
          })
        })
        const emailData = await emailRes.json()
        console.log(`Day 30 Resend response: ${JSON.stringify(emailData)}`)


        await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${client.id}`, {
          method: 'PATCH',
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ emails_sent: [...emailsSent, 'day30'] })
        })
      }
    }


    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    })


  } catch (error) {
    console.log(`Error: ${error.message}`)


    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'CallMagnet Alerts <hello@callmagnet.com.au>',
        to: 'car312@hotmail.com',
        subject: '⚠️ CallMagnet — send-email-sequence failed',
        html: `<p><strong>Function:</strong> send-email-sequence</p><p><strong>Error:</strong> ${error.message}</p><p><strong>Time:</strong> ${new Date().toISOString()}</p><p>Log in to Supabase to investigate.</p>`
      })
    }).catch(() => {})


    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})
