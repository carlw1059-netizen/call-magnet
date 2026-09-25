// save-push-subscription: receives a Web Push subscription from a CallMagnet
// dashboard PWA after the user grants notification permission, and UPSERTs it
// into push_subscriptions. The frontend never writes to that table directly —
// this function is the single sanctioned write path. RLS on push_subscriptions
// blocks anon/authenticated; only this function (running as service_role)
// can write rows.
//
// Auth: shared-secret guard via X-Internal-Secret request header. Validates
// that the calling code path is part of CallMagnet (the frontend ships the
// secret in the index.html bundle for now — fine because the secret only
// gates a low-stakes write, and any direct push_subscriptions access still
// requires service_role).
//
// SECRET ROTATION: INTERNAL_SECRET lives in TWO places — the Edge Functions
// Vault (read here via Deno.env.get) AND the Postgres Vault (read by the
// callmagnet-daily-summary cron and notify_first_booking trigger). If you
// rotate, update both entries with the matching new value.
//
// Body (application/json):
//   client_id   uuid    required  — which client this subscription belongs to
//   endpoint    string  required  — Web Push endpoint URL the browser provided
//   p256dh      string  required  — subscription public key (base64url)
//   auth        string  required  — subscription auth secret (base64url)
//   user_agent  string  optional  — for diagnostics

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET           = Deno.env.get('INTERNAL_SECRET');

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const internalSecret = req.headers.get('X-Internal-Secret');
    const authHeader     = req.headers.get('Authorization');

    let authed = false;
    if (internalSecret) {
      authed = !!INTERNAL_SECRET && internalSecret === INTERNAL_SECRET;
    } else if (authHeader?.startsWith('Bearer ')) {
      const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: authHeader },
      });
      authed = authRes.ok;
    }
    if (!authed) return json(401, { error: 'unauthorized' });

    const body = await req.json().catch(() => null) as
      | { client_id?: unknown; endpoint?: unknown; p256dh?: unknown; auth?: unknown; user_agent?: unknown }
      | null;
    if (!body || typeof body !== 'object') {
      return json(400, { error: 'invalid_body', detail: 'JSON body required' });
    }

    const clientId  = typeof body.client_id  === 'string' ? body.client_id.trim()  : '';
    const endpoint  = typeof body.endpoint   === 'string' ? body.endpoint.trim()   : '';
    const p256dh    = typeof body.p256dh     === 'string' ? body.p256dh.trim()     : '';
    const authKey   = typeof body.auth       === 'string' ? body.auth.trim()       : '';
    const userAgent = typeof body.user_agent === 'string' ? body.user_agent.trim() : null;

    if (!clientId || !endpoint || !p256dh || !authKey) {
      return json(400, {
        error:  'missing_required_field',
        detail: 'client_id, endpoint, p256dh, and auth are all required',
      });
    }

    // ── verify the client_id exists ─────────────────────────────────────────
    // Pre-check rather than relying on the FK to throw — gives us a clean 404
    // response shape instead of a 409 with PostgREST-formatted error body.
    const clientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id`,
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
    const clients = await clientRes.json() as { id: string }[];
    if (clients.length === 0) {
      return json(404, { error: 'client_not_found', detail: `no client with id ${clientId}` });
    }

    // ── DELETE all existing rows for this client, then INSERT fresh ────────
    // Each login generates a new APNs endpoint so upsert-on-endpoint always
    // inserts. Delete first to keep exactly one row per client.
    const deleteRes = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?client_id=eq.${encodeURIComponent(clientId)}`,
      {
        method: 'DELETE',
        headers: {
          apikey:        SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!deleteRes.ok) {
      throw new Error(`delete_failed: ${deleteRes.status} ${await deleteRes.text()}`);
    }

    const insertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions`,
      {
        method: 'POST',
        headers: {
          apikey:        SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer:        'return=representation',
        },
        body: JSON.stringify({
          client_id:    clientId,
          endpoint,
          p256dh,
          auth:         authKey,
          user_agent:   userAgent,
          last_used_at: new Date().toISOString(),
        }),
      },
    );
    if (!insertRes.ok) {
      throw new Error(`insert_failed: ${insertRes.status} ${await insertRes.text()}`);
    }
    const inserted = await insertRes.json() as { id: string }[];
    return json(200, { ok: true, subscription_id: inserted[0]?.id });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`save-push-subscription fatal: ${errMsg}`);
    return json(500, { error: 'internal_error', detail: errMsg });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
