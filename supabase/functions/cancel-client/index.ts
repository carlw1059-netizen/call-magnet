import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

    const client_id = String(body.client_id ?? '').trim();
    if (!client_id) return json(400, { error: 'missing_field', field: 'client_id' });

    // ── 3. Read client row ─────────────────────────────────────────────────────
    const { data: client, error: clientErr } = await supa
      .from('clients')
      .select('id, business_name, stripe_subscription_id, stripe_customer_id, cancellation_scheduled')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return json(404, { error: 'client_not_found', detail: clientErr?.message });
    }
    if (client.cancellation_scheduled) {
      return json(409, { error: 'already_scheduled', detail: 'Cancellation already scheduled for this client' });
    }
    if (!client.stripe_subscription_id) {
      return json(400, { error: 'no_subscription', detail: 'Client has no stripe_subscription_id' });
    }

    // ── 4. Fetch Stripe key from Vault ─────────────────────────────────────────
    const { data: stripeKey, error: vaultErr } = await supa
      .rpc('get_vault_secret', { secret_name: 'stripe_secret_key' });
    if (vaultErr || !stripeKey) {
      throw new Error(`Vault fetch failed: ${vaultErr?.message ?? 'key not found'}`);
    }

    // ── 5. Set cancel_at_period_end on Stripe subscription ────────────────────
    const stripeRes = await fetch(
      `https://api.stripe.com/v1/subscriptions/${client.stripe_subscription_id}`,
      {
        method:  'POST',
        headers: {
          'Authorization':  `Basic ${btoa(stripeKey + ':')}`,
          'Content-Type':   'application/x-www-form-urlencoded',
          'Stripe-Version': '2025-01-27.acacia',
        },
        body: new URLSearchParams({ cancel_at_period_end: 'true' }).toString(),
      }
    );
    const stripeData = await stripeRes.json() as Record<string, unknown>;
    if (!stripeRes.ok) {
      throw new Error(`Stripe API ${stripeRes.status}: ${JSON.stringify(stripeData)}`);
    }

    const cancel_at = stripeData.cancel_at
      ? new Date((stripeData.cancel_at as number) * 1000).toISOString()
      : null;

    console.log(`cancel-client: subscription ${client.stripe_subscription_id} set to cancel at ${cancel_at}`);

    // ── 6. Update clients table ────────────────────────────────────────────────
    const { error: updateErr } = await supa
      .from('clients')
      .update({
        cancellation_scheduled: true,
        cancelled_at:           cancel_at,
      })
      .eq('id', client_id);

    if (updateErr) {
      throw new Error(`clients UPDATE failed: ${updateErr.message}`);
    }

    return json(200, {
      success:           true,
      client_id,
      cancel_at,
    });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`cancel-client fatal: ${errMsg}`);
    return json(500, { error: 'internal_error', detail: errMsg });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
