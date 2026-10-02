import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { escapeHtml, renderEmailShell } from "../_shared/emailStyles.ts";
import { ui } from "../_shared/emailUi.ts";
import { getEmailParts } from "../_shared/emailCopy.ts";


Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');


    const body = await req.text();
    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      return new Response(JSON.stringify({ error: 'Missing stripe-signature header' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const timestampMatch = signature.match(/t=(\d+)/);
    const sigMatch = signature.match(/v1=([a-f0-9]+)/);


    if (!timestampMatch || !sigMatch) {
      return new Response('Invalid signature', { status: 400 });
    }


    const timestamp = timestampMatch[1];
    const expectedSig = sigMatch[1];
    const signedPayload = `${timestamp}.${body}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(webhookSecret);
    const messageData = encoder.encode(signedPayload);
    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    const computedSig = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');


    if (computedSig !== expectedSig) {
      return new Response('Signature mismatch', { status: 400 });
    }


    const event = JSON.parse(body);


    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      const stripeCustomerId = invoice.customer;


      const clientRes = await fetch(
        `${supabaseUrl}/rest/v1/clients?stripe_customer_id=eq.${stripeCustomerId}&select=id,business_name`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );
      const clients = await clientRes.json();


      if (!clients || clients.length === 0) {
        return new Response(JSON.stringify({ message: 'Client not found' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }


      const client = clients[0];


      await fetch(
        `${supabaseUrl}/rest/v1/clients?id=eq.${client.id}`,
        {
          method: 'PATCH',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ account_status: 'suspended' }),
        }
      );
      console.log(`Suspended account for ${client.business_name}`);
    }


    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });


  } catch (error) {
    const alertCopy = await getEmailParts('error_alert', { FUNCTION_NAME: 'stripe-payment-failed' });
    const alertHtml = renderEmailShell(
      alertCopy.top +
      ui.sub('A Stripe failed-payment webhook errored before completing.') +
      ui.panel(ui.rows([
        ['Function', 'stripe-payment-failed (hyper-endpoint)'],
        ['Error', escapeHtml(String(error?.message ?? error))],
        ['Time', new Date().toISOString()],
      ])) +
      ui.small('Log in to Supabase to investigate.'),
      alertCopy.preheader,
    );
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'CallMagnet Alerts <alerts@callmagnet.com.au>',
        to: 'hello@callmagnet.com.au',
        subject: alertCopy.subject,
        html: alertHtml
      })
    }).catch(() => {})


    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
