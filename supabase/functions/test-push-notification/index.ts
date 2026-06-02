// test-push-notification: sends a real Progressier push to all devices
// registered for a given client. Used by the Middle Man admin "Test 🔔" button.
//
// Auth: valid Supabase JWT required + is_admin flag in app_metadata.
//
// POST { client_id: string, title: string, message: string }
// Returns { ok: true } on success.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PROGRESSIER_API_KEY       = Deno.env.get('PROGRESSIER_API_KEY');

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (new URL(req.url).searchParams.get('warmup') === '1') {
    return new Response(JSON.stringify({ warmup: 'ok' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

  try {
    // ── Verify caller JWT and admin flag ─────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const userJwt    = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!userJwt) return json(401, { error: 'missing_authorization' });

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userErr } = await supa.auth.getUser(userJwt);
    if (userErr || !userData?.user) return json(401, { error: 'invalid_token' });

    const isAdmin = (userData.user.app_metadata as Record<string, unknown> | undefined)?.is_admin === true;
    if (!isAdmin) return json(403, { error: 'not_admin' });

    // ── Parse body ───────────────────────────────────────────────────────────
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json(400, { error: 'invalid_body', detail: 'JSON body required' });

    const client_id = typeof body.client_id === 'string' ? body.client_id.trim() : '';
    const title     = typeof body.title     === 'string' ? body.title.trim()     : '';
    const message   = typeof body.message   === 'string' ? body.message.trim()   : '';

    if (!client_id) return json(400, { error: 'missing_field', field: 'client_id' });
    if (!title)     return json(400, { error: 'missing_field', field: 'title' });
    if (!message)   return json(400, { error: 'missing_field', field: 'message' });

    if (!PROGRESSIER_API_KEY) {
      console.warn('test-push-notification: PROGRESSIER_API_KEY not configured');
      return json(500, { error: 'progressier_not_configured' });
    }

    // ── Send via Progressier — same pattern as send-client-notification ───────
    const progRes = await fetch('https://progressier.app/9kXZoGF2Dlfeqec880My/send', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${PROGRESSIER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipients: { id: client_id },
        title,
        body:  message,
        url:   'https://callmagnet.com.au',
      }),
    });

    if (!progRes.ok) {
      const errText = await progRes.text();
      console.error(`test-push-notification: progressier error ${progRes.status}: ${errText}`);
      return json(200, { ok: false, reason: 'progressier_error', status: progRes.status });
    }

    console.log(`test-push-notification: sent — client ${client_id} — "${title}"`);
    return json(200, { ok: true });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`test-push-notification fatal: ${errMsg}`);
    return json(500, { error: 'internal_error', detail: errMsg });
  }
});
