// admin-cancel-client: admin override to cancel a client's Stripe subscription.
//
// Called by admin/clients.html. The caller must be an authenticated admin
// (app_metadata.is_admin = true). Looks up the client by email, calls Stripe
// cancel_at_period_end, flags the client row, inserts a cancellation_reason
// record, and fires a Pushover notification.
//
// Auth: verify_jwt = false in config.toml (manual JWT validation inside the
// function). The caller's JWT must come from a user whose app_metadata.is_admin
// = true, verified via /auth/v1/user.
//
// Body (application/json):
//   client_email   string   required  email address of the client to cancel
//   reason_key     string   required  one of: pricing | not_enough_calls |
//                                     found_alternative | closing_business |
//                                     admin_decision | other
//   reason_detail  string   optional  free-text note (max 500 chars)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY         = Deno.env.get('STRIPE_SECRET_KEY');
const INTERNAL_SECRET           = Deno.env.get('INTERNAL_SECRET');

const VALID_REASONS = new Set([
  'pricing',
  'not_enough_calls',
  'found_alternative',
  'closing_business',
  'admin_decision',
  'other',
]);

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  try {
    // ── Validate JWT + admin check ────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return json(401, { error: 'unauthorized', detail: 'Bearer token required' });
    }

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey:        SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!userRes.ok) {
      return json(401, { error: 'unauthorized', detail: 'Invalid or expired session' });
    }
    const userJson = await userRes.json() as { email?: string; app_metadata?: { is_admin?: boolean } };
    if (userJson.app_metadata?.is_admin !== true) {
      return json(403, { error: 'forbidden', detail: 'Admin access required' });
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => null) as {
      client_email?:  unknown;
      reason_key?:    unknown;
      reason_detail?: unknown;
    } | null;

    if (!body) {
      return json(400, { error: 'invalid_body', detail: 'JSON body required' });
    }

    const clientEmail  = typeof body.client_email  === 'string' ? body.client_email.trim().toLowerCase()  : '';
    const reasonKey    = typeof body.reason_key    === 'string' ? body.reason_key.trim()                  : '';
    const reasonDetail = typeof body.reason_detail === 'string' ? body.reason_detail.trim().slice(0, 500) : null;

    if (!clientEmail) {
      return json(400, { error: 'missing_required_field', detail: 'client_email is required' });
    }
    if (!VALID_REASONS.has(reasonKey)) {
      return json(400, {
        error:  'invalid_reason',
        detail: `reason_key must be one of: ${[...VALID_REASONS].join(', ')}`,
      });
    }

    // ── Look up client ────────────────────────────────────────────────────────
    const clientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?email=eq.${encodeURIComponent(clientEmail)}&select=id,business_name,stripe_subscription_id,cancellation_scheduled,account_status`,
      {
        headers: {
          apikey:        SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!clientRes.ok) {
      throw new Error(`client_lookup_failed: ${clientRes.status} ${await clientRes.text()}`);
    }
    const clients = await clientRes.json() as {
      id: string;
      business_name: string;
      stripe_subscription_id: string | null;
      cancellation_scheduled: boolean;
      account_status: string;
    }[];

    if (clients.length === 0) {
      return json(404, { error: 'client_not_found', detail: `No client found for email: ${clientEmail}` });
    }
    const client = clients[0];

    if (client.cancellation_scheduled) {
      return json(409, { error: 'already_requested', detail: `Cancellation already scheduled for ${client.business_name}` });
    }

    // ── Insert cancellation reason ────────────────────────────────────────────
    const reasonRes = await fetch(`${SUPABASE_URL}/rest/v1/cancellation_reasons`, {
      method:  'POST',
      headers: {
        apikey:         SUPABASE_SERVICE_ROLE_KEY,
        Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer:         'return=minimal',
      },
      body: JSON.stringify({
        client_id:     client.id,
        reason_key:    reasonKey,
        reason_detail: reasonDetail || null,
        cancelled_by:  'admin',
      }),
    });
    if (!reasonRes.ok) {
      throw new Error(`reason_insert_failed: ${reasonRes.status} ${await reasonRes.text()}`);
    }

    // ── Call Stripe: cancel subscription at period end ────────────────────────
    let cancelAt: string | null = null;
    if (client.stripe_subscription_id && STRIPE_SECRET_KEY) {
      const stripeRes = await fetch(
        `https://api.stripe.com/v1/subscriptions/${client.stripe_subscription_id}`,
        {
          method:  'POST',
          headers: {
            Authorization:  `Bearer ${STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ cancel_at_period_end: 'true' }),
        },
      );
      if (stripeRes.ok) {
        const sub = await stripeRes.json() as { cancel_at?: number | null; current_period_end?: number };
        const periodEnd = sub.cancel_at ?? sub.current_period_end ?? null;
        if (periodEnd) cancelAt = new Date(periodEnd * 1000).toISOString();
        console.log(`admin-cancel-client: Stripe cancel_at_period_end=true for ${client.business_name}, cancel_at=${cancelAt}`);
      } else {
        const errBody = await stripeRes.text();
        console.error(`admin-cancel-client: Stripe API error ${stripeRes.status}: ${errBody.slice(0, 400)}`);
        // Non-fatal — DB patch and notification still go through
      }
    } else {
      console.warn(
        `admin-cancel-client: no stripe_subscription_id for ${client.business_name} — ` +
        `skipping Stripe API call`,
      );
    }

    // ── Patch client: cancellation_scheduled = true ───────────────────────────
    await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${client.id}`, {
      method:  'PATCH',
      headers: {
        apikey:         SUPABASE_SERVICE_ROLE_KEY,
        Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer:         'return=minimal',
      },
      body: JSON.stringify({ cancellation_scheduled: true }),
    }).catch((e) => console.warn(`admin-cancel-client: client patch failed (non-fatal): ${e}`));

    // ── Pushover: notify Carl (fire-and-forget) ───────────────────────────────
    if (INTERNAL_SECRET) {
      const notifLines = [
        `Admin cancelled: ${client.business_name}`,
        `Reason: ${reasonKey}`,
        reasonDetail ? `Note: "${reasonDetail}"` : null,
        cancelAt
          ? `Ends: ${new Date(cancelAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`
          : 'No Stripe sub ID — cancel in Dashboard if needed.',
      ].filter(Boolean).join('\n');

      fetch(`${SUPABASE_URL}/functions/v1/send-pushover-alert`, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'X-Internal-Secret': INTERNAL_SECRET,
        },
        body: JSON.stringify({
          title:   '🔴 Admin cancelled a client',
          message: notifLines,
        }),
      }).catch(() => {});
    }

    return json(200, {
      ok:              true,
      business_name:   client.business_name,
      cancel_at:       cancelAt,
      stripe_sub_id:   client.stripe_subscription_id,
    });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`admin-cancel-client fatal: ${errMsg}`);
    return json(500, { error: 'internal_error', detail: errMsg });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
