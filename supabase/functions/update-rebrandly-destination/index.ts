// update-rebrandly-destination: admin-only edge function.
// Syncs a client's Rebrandly link destination whenever middle_man_enabled is toggled.
//
// Auth: verify_jwt = true (Supabase gateway rejects invalid/missing JWTs before
// the function runs). The function then applies the dual gate:
//   is_admin === true  AND  email === 'car312@hotmail.com'
//
// Body (application/json):
//   client_id  string  required  UUID of the client to update
//
// Logic:
//   middle_man_enabled = true  AND middle_man_slug is set
//     → destination = https://callmagnet.com.au/b/<middle_man_slug>
//   middle_man_enabled = false  OR  middle_man_slug is null
//     → destination = clients.booking_url   (the original booking platform URL)
//
// Calls Rebrandly API:
//   PATCH https://api.rebrandly.com/v1/links/<rebrandly_link_id>
//   Header:  apikey: <REBRANDLY_API_KEY>
//   Body:    { "destination": "<destination>" }
//
// On success: patches clients.middle_man_updated_at = now()
//
// Vault prereqs:
//   REBRANDLY_API_KEY     Rebrandly account API key
//
// Responses:
//   200  { ok: true,  destination, rebrandly_response: <Rebrandly HTTP status> }
//   400  { ok: false, error: 'missing_client_id' }
//   400  { ok: false, error: 'no_rebrandly_link_id' }        — client has no link ID set
//   400  { ok: false, error: 'no_booking_url' }              — booking_url is null/empty
//   403  { ok: false, error: 'forbidden', detail }
//   404  { ok: false, error: 'client_not_found' }
//   502  { ok: false, error: 'rebrandly_error', status, detail }
//   500  { ok: false, error: 'internal_error', detail }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const REBRANDLY_API_KEY         = Deno.env.get('REBRANDLY_API_KEY');

const ADMIN_EMAIL = 'car312@hotmail.com';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    // ── 1. Extract JWT (gateway already verified it's valid) ──────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const userJwt    = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!userJwt) {
      return json(403, { ok: false, error: 'forbidden', detail: 'Authorization header required' });
    }

    // ── 2. Resolve caller + dual admin gate ───────────────────────────────────
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userErr } = await supa.auth.getUser(userJwt);
    if (userErr || !userData?.user) {
      return json(403, { ok: false, error: 'forbidden', detail: 'Token did not resolve to a user' });
    }

    const isAdmin = (userData.user.app_metadata as Record<string, unknown> | undefined)
                    ?.is_admin === true;
    const callerEmail = (userData.user.email ?? '').toLowerCase();

    if (!isAdmin || callerEmail !== ADMIN_EMAIL) {
      return json(403, { ok: false, error: 'forbidden', detail: 'Admin access required' });
    }

    // ── 3. Parse body ─────────────────────────────────────────────────────────
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      return json(400, { ok: false, error: 'invalid_json', detail: 'JSON body required' });
    }

    const clientId = typeof body.client_id === 'string' ? body.client_id.trim() : '';
    if (!clientId) {
      return json(400, { ok: false, error: 'missing_client_id', detail: 'client_id is required' });
    }

    // ── 4. Fetch client row ───────────────────────────────────────────────────
    const { data: clientRow, error: clientErr } = await supa
      .from('clients')
      .select('id, business_name, middle_man_enabled, middle_man_slug, booking_url, rebrandly_link_id')
      .eq('id', clientId)
      .maybeSingle();

    if (clientErr) {
      console.error('update-rebrandly-destination client lookup error:', clientErr);
      return json(500, { ok: false, error: 'internal_error', detail: clientErr.message });
    }
    if (!clientRow) {
      return json(404, { ok: false, error: 'client_not_found', detail: `No client with id ${clientId}` });
    }

    // ── 5. Check rebrandly_link_id ────────────────────────────────────────────
    const rebrandlyLinkId = clientRow.rebrandly_link_id as string | null | undefined;
    if (!rebrandlyLinkId) {
      console.warn(`update-rebrandly-destination: client ${clientRow.business_name} (${clientId}) has no rebrandly_link_id`);
      return json(400, { ok: false, error: 'no_rebrandly_link_id',
                          detail: `Client "${clientRow.business_name}" has no rebrandly_link_id set — set one in the clients table before using this function` });
    }

    // ── 6. Determine destination ──────────────────────────────────────────────
    // middle_man_enabled = true AND slug is set → Middle Man page
    // otherwise                                 → real booking URL
    const mmEnabled = clientRow.middle_man_enabled as boolean;
    const mmSlug    = clientRow.middle_man_slug as string | null | undefined;
    const bookingUrl = clientRow.booking_url as string | null | undefined;

    let destination: string;
    if (mmEnabled && mmSlug) {
      destination = `https://callmagnet.com.au/b/${encodeURIComponent(mmSlug)}`;
    } else {
      if (!bookingUrl) {
        return json(400, { ok: false, error: 'no_booking_url',
                            detail: `Client "${clientRow.business_name}" has no booking_url set — cannot fall back to direct booking destination` });
      }
      destination = bookingUrl;
    }

    console.log(`update-rebrandly-destination: ${clientRow.business_name} → ${destination} (enabled=${mmEnabled}, slug=${mmSlug ?? 'null'})`);

    // ── 7. Check REBRANDLY_API_KEY ────────────────────────────────────────────
    if (!REBRANDLY_API_KEY) {
      console.error('update-rebrandly-destination: REBRANDLY_API_KEY not in Vault');
      return json(500, { ok: false, error: 'internal_error', detail: 'REBRANDLY_API_KEY not configured in Vault' });
    }

    // ── 8. Call Rebrandly PATCH /v1/links/<id> ────────────────────────────────
    const rebrandlyRes = await fetch(
      `https://api.rebrandly.com/v1/links/${encodeURIComponent(rebrandlyLinkId)}`,
      {
        method:  'PATCH',
        headers: {
          apikey:         REBRANDLY_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ destination }),
      },
    );

    if (!rebrandlyRes.ok) {
      const errBody = await rebrandlyRes.text();
      console.error(`update-rebrandly-destination: Rebrandly API error ${rebrandlyRes.status}: ${errBody.slice(0, 400)}`);
      return json(502, {
        ok:     false,
        error:  'rebrandly_error',
        status: rebrandlyRes.status,
        detail: errBody.slice(0, 400),
      });
    }

    const rebrandlyData = await rebrandlyRes.json().catch(() => ({}));
    console.log(`update-rebrandly-destination: Rebrandly updated OK — link_id=${rebrandlyLinkId}, new_dest=${destination}`);

    // ── 9. Patch clients.middle_man_updated_at ────────────────────────────────
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}`,
      {
        method:  'PATCH',
        headers: {
          apikey:         SUPABASE_SERVICE_ROLE_KEY,
          Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer:         'return=minimal',
        },
        body: JSON.stringify({ middle_man_updated_at: new Date().toISOString() }),
      },
    );
    if (!patchRes.ok) {
      // Non-fatal — Rebrandly already updated successfully. Log and continue.
      console.warn(`update-rebrandly-destination: middle_man_updated_at patch failed (non-fatal): ${patchRes.status}`);
    }

    // ── 10. Success ───────────────────────────────────────────────────────────
    return json(200, {
      ok:                  true,
      destination,
      rebrandly_link_id:   rebrandlyLinkId,
      rebrandly_response:  rebrandlyRes.status,
      short_url:           typeof rebrandlyData?.shortUrl === 'string'
                             ? rebrandlyData.shortUrl
                             : undefined,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`update-rebrandly-destination fatal: ${msg}`);
    return json(500, { ok: false, error: 'internal_error', detail: msg });
  }
});
