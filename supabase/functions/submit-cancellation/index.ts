// submit-cancellation: records a client's exit reason, schedules Stripe
// cancel_at_period_end, flags the client row, and fires a Pushover
// notification to Carl.
//
// Called by cancel.html (client self-service). The client must be logged in —
// this function validates their JWT manually via /auth/v1/user and finds their
// client record by email. verify_jwt = false in config.toml so the gateway
// doesn't pre-reject the request.
//
// Body (application/json):
//   reason_key     string   required  one of: pricing | not_enough_calls |
//                                     found_alternative | closing_business | other
//   reason_detail  string   optional  free-text elaboration (max 500 chars)
//
// Flow:
//   1. Validate JWT → get caller email
//   2. Look up client by email
//   3. Insert into cancellation_reasons
//   4. Call Stripe cancel_at_period_end (if stripe_subscription_id stored)
//   5. Patch clients: cancellation_scheduled = true
//   6. Fire-and-forget Pushover notification to Carl
//   7. Return { ok: true, cancel_at: ISO string | null }
//
// Idempotency: if cancellation_scheduled is already true, returns 409 so
// the UI can show a friendly "already requested" state.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET           = Deno.env.get('INTERNAL_SECRET');

const VALID_REASONS = new Set([
  'pricing',
  'not_enough_calls',
  'found_alternative',
  'closing_business',
  'other',
]);

const REASON_LABELS: Record<string, string> = {
  pricing:             'Too expensive',
  not_enough_calls:    'Not enough missed calls',
  found_alternative:   'Found another solution',
  closing_business:    'Closing the business',
  other:               'Other',
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  try {
    // ── Validate JWT → get caller email ───────────────────────────────────────
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
    const userJson = await userRes.json() as { email?: string };
    const email = (userJson.email ?? '').toLowerCase().trim();
    if (!email) {
      return json(401, { error: 'unauthorized', detail: 'No email in session' });
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => null) as {
      reason_key?:    unknown;
      reason_detail?: unknown;
    } | null;

    if (!body) {
      return json(400, { error: 'invalid_body', detail: 'JSON body required' });
    }

    const reasonKey    = typeof body.reason_key    === 'string' ? body.reason_key.trim()    : '';
    const reasonDetail = typeof body.reason_detail === 'string' ? body.reason_detail.trim().slice(0, 500) : null;

    if (!VALID_REASONS.has(reasonKey)) {
      return json(400, {
        error:  'invalid_reason',
        detail: `reason_key must be one of: ${[...VALID_REASONS].join(', ')}`,
      });
    }

    // ── Look up client ────────────────────────────────────────────────────────
    const clientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?email=eq.${encodeURIComponent(email)}&is_test_account=eq.false&select=id,business_name,stripe_subscription_id,cancellation_scheduled`,
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
    }[];

    if (clients.length === 0) {
      return json(404, { error: 'client_not_found', detail: 'No client account found for this email' });
    }
    const client = clients[0];

    if (client.cancellation_scheduled) {
      return json(409, { error: 'already_requested', detail: 'Cancellation has already been requested for this account' });
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
        cancelled_by:  'client',
      }),
    });
    if (!reasonRes.ok) {
      throw new Error(`reason_insert_failed: ${reasonRes.status} ${await reasonRes.text()}`);
    }

    // ── Call Stripe: cancel subscription at period end ────────────────────────
    let cancelAt: string | null = null;
    let stripeSecretKey: string | null = null;
    if (client.stripe_subscription_id) {
      const vaultRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_vault_secret`, {
        method:  'POST',
        headers: {
          apikey:         SUPABASE_SERVICE_ROLE_KEY,
          Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ secret_name: 'stripe_secret_key' }),
      });
      stripeSecretKey = vaultRes.ok ? await vaultRes.json() as string : null;
    }
    if (client.stripe_subscription_id && stripeSecretKey) {
      const stripeRes = await fetch(
        `https://api.stripe.com/v1/subscriptions/${client.stripe_subscription_id}`,
        {
          method:  'POST',
          headers: {
            Authorization:  `Bearer ${stripeSecretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ cancel_at_period_end: 'true' }),
        },
      );
      if (stripeRes.ok) {
        const sub = await stripeRes.json() as { cancel_at?: number | null; current_period_end?: number };
        const periodEnd = sub.cancel_at ?? sub.current_period_end ?? null;
        if (periodEnd) cancelAt = new Date(periodEnd * 1000).toISOString();
        console.log(`submit-cancellation: Stripe cancel_at_period_end=true for ${client.business_name}, cancel_at=${cancelAt}`);
      } else {
        const errBody = await stripeRes.text();
        // Non-fatal: DB is already updated. Carl's Pushover will prompt manual follow-up.
        console.error(`submit-cancellation: Stripe API error ${stripeRes.status}: ${errBody.slice(0, 400)}`);
      }
    } else {
      console.warn(
        `submit-cancellation: no stripe_subscription_id for ${client.business_name} — ` +
        `skipping Stripe API call; Carl must cancel in Stripe Dashboard manually`,
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
    }).catch((e) => console.warn(`submit-cancellation: client patch failed (non-fatal): ${e}`));

    // ── Pushover: notify Carl (fire-and-forget) ───────────────────────────────
    if (INTERNAL_SECRET) {
      const reasonLabel = REASON_LABELS[reasonKey] ?? reasonKey;
      const notifLines = [
        `${client.business_name} has requested cancellation.`,
        `Reason: ${reasonLabel}`,
        reasonDetail ? `Detail: "${reasonDetail}"` : null,
        cancelAt
          ? `Ends: ${new Date(cancelAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`
          : 'No Stripe sub ID — cancel manually in Dashboard.',
      ].filter(Boolean).join('\n');

      fetch(`${SUPABASE_URL}/functions/v1/send-pushover-alert`, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'X-Internal-Secret': INTERNAL_SECRET,
        },
        body: JSON.stringify({
          title:   '⚠️ Cancellation requested',
          message: notifLines,
        }),
      }).catch(() => {});
    }

    return json(200, { ok: true, cancel_at: cancelAt });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`submit-cancellation fatal: ${errMsg}`);
    return json(500, { error: 'internal_error', detail: errMsg });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
