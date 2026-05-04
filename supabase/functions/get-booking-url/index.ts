// get-booking-url: frontend-facing endpoint called when a missed-call recipient
// taps the booking link in their auto-SMS. Looks up the client's booking_url
// and logs the tap to link_clicks (for "tap rate" analytics). CORS-enabled.
//
// Email rebrand (Session 4 D2): the alert email block in the catch handler
// now uses _shared/emailStyles.ts so it matches the login palette.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { BRAND, escapeHtml, renderEmailShell } from "../_shared/emailStyles.ts";


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }


  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')


    const url = new URL(req.url)
    const clientId = url.searchParams.get('id')


    if (!clientId) {
      return new Response(JSON.stringify({ error: 'No client ID' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }


    const clientRes = await fetch(
      `${supabaseUrl}/rest/v1/clients?id=eq.${clientId}&select=booking_url`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      }
    )


    const clients = await clientRes.json()


    if (!clients || clients.length === 0 || !clients[0].booking_url) {
      return new Response(JSON.stringify({ error: 'Booking URL not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }


    const now = new Date()
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    const melbOffset = 10 * 60
    const melbTime = new Date(now.getTime() + melbOffset * 60 * 1000)
    const dayOfWeek = days[melbTime.getUTCDay()]
    const hourOfDay = melbTime.getUTCHours()
    const minutes = melbTime.getUTCMinutes().toString().padStart(2, '0')
    const clickedTime = `${hourOfDay}:${minutes}`


    await fetch(
      `${supabaseUrl}/rest/v1/link_clicks`,
      {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          client_id: clientId,
          clicked_at: now.toISOString(),
          day_of_week: dayOfWeek,
          hour_of_day: hourOfDay,
          clicked_time: clickedTime,
          converted: false
        })
      }
    )


    return new Response(JSON.stringify({ booking_url: clients[0].booking_url }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })


  } catch (error) {
    const alertContent = `
      <h1 style="font-size:22px;font-weight:700;color:${BRAND.primaryText};margin:0 0 4px;letter-spacing:-0.01em;">⚠️ get-booking-url failed</h1>
      <p style="font-size:14px;color:${BRAND.secondaryText};margin:0 0 16px;">A booking-link tap couldn't be served — the customer may have seen an error page.</p>
      <p style="font-size:13px;color:${BRAND.primaryText};margin:0 0 8px;"><strong>Function:</strong> get-booking-url</p>
      <p style="font-size:13px;color:${BRAND.primaryText};margin:0 0 8px;"><strong>Error:</strong> ${escapeHtml(String(error.message ?? error))}</p>
      <p style="font-size:13px;color:${BRAND.primaryText};margin:0 0 16px;"><strong>Time:</strong> ${new Date().toISOString()}</p>
      <p style="font-size:13px;color:${BRAND.secondaryText};margin:0;">Log in to Supabase to investigate.</p>
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
        subject: '⚠️ CallMagnet — get-booking-url failed',
        html: renderEmailShell(alertContent, 'get-booking-url failed — customer may have seen an error')
      })
    }).catch(() => {})


    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
