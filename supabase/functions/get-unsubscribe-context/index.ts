// get-unsubscribe-context: validates an unsubscribe token and returns the
// business name so u.html can display "Stop texts from [Business Name]".
//
// Auth: verify_jwt = false (anon — caller is a missed-call customer who
// received an SMS with a ?u=<token> link; they carry no Supabase JWT).
//
// Request: POST application/json
//   token   string   required  — the unsubscribe token from the SMS link
//
// Happy-path response (200):
//   { ok: true, business_name: '...', slug: '...' }
//
// All validation failures return 400 { ok: false, error: 'invalid_token' }
// without revealing which check failed — prevents token fishing.
//
// This function does NOT mark the token as used. The token is only consumed
// when the caller taps "Opt out" and process-unsubscribe is called.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json(400, { ok: false, error: 'invalid_json' });
    }

    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) {
      return json(400, { ok: false, error: 'invalid_token' });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const now = new Date();

    // Look up token with JOIN to clients for business_name and slug
    const { data: tokenRow, error: tokenErr } = await supa
      .from('unsubscribe_tokens')
      .select('id, expires_at, used_at, clients(business_name, middle_man_slug)')
      .eq('token', token)
      .maybeSingle();

    if (tokenErr) {
      console.error('get-unsubscribe-context: token lookup error:', tokenErr);
      return json(500, { ok: false, error: 'server_error' });
    }

    // Unified error — do not leak which validation check failed
    if (
      !tokenRow ||
      tokenRow.used_at !== null ||
      new Date(tokenRow.expires_at) < now
    ) {
      return json(400, { ok: false, error: 'invalid_token' });
    }

    const clientData   = tokenRow.clients as { business_name: string | null; middle_man_slug: string | null } | null;
    const businessName = clientData?.business_name ?? '';
    const slug         = clientData?.middle_man_slug ?? '';

    return json(200, { ok: true, business_name: businessName, slug });

  } catch (err) {
    console.error('get-unsubscribe-context: unhandled error:', err);
    return json(500, { ok: false, error: 'server_error' });
  }
});
