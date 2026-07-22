import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin':  'https://callmagnet.com.au',
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
    // ── 1. Verify caller is admin ──────────────────────────────────────────
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
      return json(401, { error: 'invalid_token', detail: userErr?.message ?? 'token did not resolve to a user' });
    }
    const isAdmin = (userData.user.app_metadata as Record<string, unknown> | undefined)?.is_admin === true;
    if (!isAdmin) {
      return json(403, { error: 'not_admin', detail: 'caller does not have is_admin flag in app_metadata' });
    }
    if ((userData.user.email ?? '').toLowerCase() !== 'car312@hotmail.com') {
      return json(403, { error: 'forbidden', detail: 'admin email mismatch' });
    }

    // ── 2. Parse + validate body ───────────────────────────────────────────
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json(400, { error: 'invalid_body', detail: 'JSON body required' });

    const client_id    = typeof body.client_id    === 'string' ? body.client_id.trim()    : '';
    const new_password = typeof body.new_password === 'string' ? body.new_password.trim() : '';

    if (!client_id)    return json(400, { error: 'missing_field', field: 'client_id' });
    if (!new_password || new_password.length < 8) {
      return json(400, { error: 'invalid_field', field: 'new_password', detail: 'new_password must be at least 8 characters' });
    }

    // ── 3. Look up client email ────────────────────────────────────────────
    const { data: clientRow, error: clientErr } = await supa
      .from('clients')
      .select('email')
      .eq('id', client_id)
      .single();
    if (clientErr || !clientRow) {
      return json(404, { error: 'client_not_found', detail: clientErr?.message ?? 'no client with that id' });
    }

    // ── 4. Find auth user by email (direct lookup — no full scan) ──────────
    const { data: foundUser, error: userError } = await supa.auth.admin.getUserByEmail(clientRow.email);
    if (userError || !foundUser?.user) {
      return json(404, { error: 'auth_user_not_found', detail: `no auth user found for email ${clientRow.email}` });
    }
    const authUser = foundUser.user;

    // ── 5. Update password ─────────────────────────────────────────────────
    const { error: updateErr } = await supa.auth.admin.updateUserById(authUser.id, {
      password: new_password,
    });
    if (updateErr) {
      return json(500, { error: 'password_update_failed', detail: updateErr.message });
    }

    await supa.from('clients').update({ must_change_password: true }).eq('email', clientRow.email);

    return json(200, { ok: true, email: clientRow.email });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`reset-client-password fatal: ${errMsg}`);
    return json(500, { error: 'internal_error', detail: errMsg });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
