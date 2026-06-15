import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    // ── 1. Verify admin JWT ────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const userJwt    = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!userJwt) {
      return json(401, { error: 'missing_authorization' });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userErr } = await supa.auth.getUser(userJwt);
    if (userErr || !userData?.user) {
      return json(401, { error: 'invalid_token', detail: userErr?.message });
    }
    const isAdmin = (userData.user.app_metadata as Record<string, unknown> | undefined)?.is_admin === true;
    if (!isAdmin) {
      return json(403, { error: 'not_admin' });
    }
    if ((userData.user.email ?? '').toLowerCase() !== 'car312@hotmail.com') {
      return json(403, { error: 'forbidden', detail: 'admin email mismatch' });
    }

    // ── 2. Parse body ──────────────────────────────────────────────────────────
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json(400, { error: 'invalid_body' });

    const client_id      = String(body.client_id      ?? '').trim();
    const pricing_package = String(body.pricing_package ?? '').trim();
    if (!client_id) return json(400, { error: 'missing_field', field: 'client_id' });

    // ── 3. Read client row ─────────────────────────────────────────────────────
    const { data: client, error: clientErr } = await supa
      .from('clients')
      .select('id, business_name, email, stripe_customer_id, account_status')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return json(404, { error: 'client_not_found', detail: clientErr?.message });
    }
    if (!client.stripe_customer_id) {
      return json(400, { error: 'no_stripe_customer', detail: 'Client has no stripe_customer_id — cannot create subscription' });
    }

    // Use pricing_package from body if provided, else reject
    const pkg = pricing_package || '';
    if (!['restaurant', 'hairdresser'].includes(pkg)) {
      return json(400, { error: 'invalid_pricing_package', detail: 'pricing_package must be restaurant or hairdresser' });
    }

    // ── 4. Fetch Stripe key from Vault ─────────────────────────────────────────
    const { data: stripeKey, error: vaultErr } = await supa
      .rpc('get_vault_secret', { secret_name: 'stripe_secret_key' });
    if (vaultErr || !stripeKey) {
      throw new Error(`Vault fetch failed: ${vaultErr?.message ?? 'key not found'}`);
    }

    // ── 5. Create Stripe subscription ─────────────────────────────────────────
    // Card was saved via setup_future_usage=off_session during checkout.
    // Restaurant: monthly + SMS overage. Hairdresser: monthly + SMS overage.
    const monthlyPriceId = pkg === 'restaurant'
      ? 'price_1Ti51u3MTu8r2rLhBNxFra0k'
      : 'price_1TD12P3MTu8r2rLhJYFPksVx';
    const SMS_OVERAGE_PRICE = 'price_1TMmTG3MTu8r2rLhYSWnqheS';

    const subParams = new URLSearchParams({
      customer:                  client.stripe_customer_id,
      'items[0][price]':         monthlyPriceId,
      'items[1][price]':         SMS_OVERAGE_PRICE,
      collection_method:         'charge_automatically',
    });

    const subRes = await fetch('https://api.stripe.com/v1/subscriptions', {
      method:  'POST',
      headers: {
        'Authorization':  `Basic ${btoa(stripeKey + ':')}`,
        'Content-Type':   'application/x-www-form-urlencoded',
        'Stripe-Version': '2025-01-27.acacia',
      },
      body: subParams.toString(),
    });
    const subData = await subRes.json() as Record<string, unknown>;
    if (!subRes.ok) {
      throw new Error(`Stripe subscription ${subRes.status}: ${JSON.stringify(subData)}`);
    }
    const stripe_subscription_id = subData.id as string;
    console.log(`activate-client: subscription created — ${stripe_subscription_id} for client ${client_id}`);

    // ── 6. Update clients table ────────────────────────────────────────────────
    const { error: updateErr } = await supa
      .from('clients')
      .update({
        account_status:         'active',
        stripe_subscription_id,
      })
      .eq('id', client_id);

    if (updateErr) {
      throw new Error(`clients UPDATE failed: ${updateErr.message}`);
    }

    // ── 7. Send "account is live" email to client ──────────────────────────────
    if (RESEND_API_KEY && client.email) {
      const bizSafe = String(client.business_name).replace(/[&<>"']/g, (c: string) =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
      );
      const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Your CallMagnet account is now live</title></head>
<body style="margin:0;padding:0;background:#0E1419;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#FFFFFF;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0E1419;">
  <tr><td align="center" style="padding:32px 16px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:rgba(255,255,255,0.04);border:1px solid rgba(16,185,129,0.22);border-radius:14px;">
      <tr><td style="padding:36px 30px 32px;color:#FFFFFF;">
        <div style="font-size:14px;letter-spacing:0.16em;color:#10b981;text-transform:uppercase;font-weight:700;margin-bottom:28px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">★ CallMagnet</div>
        <h1 style="margin:0 0 12px;font-size:24px;font-weight:600;color:#FFFFFF;letter-spacing:-0.01em;">Your account is now live.</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:rgba(255,255,255,0.75);">Hi ${bizSafe} — your CallMagnet account is set up and live. Log in to your dashboard to get started.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:0 0 24px;">
          <a href="https://callmagnet.com.au" style="display:inline-block;background:#10b981;color:#0a1a14;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;letter-spacing:0.01em;">Go to my dashboard</a>
        </td></tr></table>
        <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.4);">Questions? Contact hello@callmagnet.com.au</p>
      </td></tr>
    </table>
    <div style="font-size:12px;color:rgba(255,255,255,0.25);margin-top:18px;letter-spacing:0.06em;">CallMagnet</div>
  </td></tr>
</table>
</body></html>`;
      await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    'CallMagnet <hello@callmagnet.com.au>',
          to:      client.email,
          subject: 'Your CallMagnet account is now live',
          html,
          text: `Your account is now live, ${client.business_name}.\n\nYour CallMagnet account is set up and live. Log in at https://callmagnet.com.au to get started.\n\nQuestions? Contact hello@callmagnet.com.au\n\nCallMagnet — callmagnet.com.au\n`,
        }),
      }).catch((e: Error) => console.warn(`activate-client: live email failed — ${e?.message}`));
      console.log(`activate-client: live email sent to ${client.email}`);
    }

    return json(200, {
      success:               true,
      client_id,
      stripe_subscription_id,
    });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`activate-client fatal: ${errMsg}`);
    return json(500, { error: 'internal_error', detail: errMsg });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
