// process-unsubscribe: public endpoint that handles opt-out confirmation.
//
// DORMANT UNTIL PHASE 2. This function is deployed and reachable but no SMS
// links point to it yet. It will go live when the unsubscribe SMS link
// injection is wired into twilio-missed-call.
//
// Auth: verify_jwt = false (anon — caller is the missed-caller, not a client)
//
// Request: POST application/json
//   token            string   — opaque token from the SMS link (required)
//   choice           string   — 'until_next_call' | 'forever' (required)
//   time_to_decide_ms integer — ms from page load to button tap (optional)
//   came_from        string   — 'sms' | 'middle_man' | 'admin' (optional)
//   user_agent       string   — forwarded from browser (optional)
//   referrer         string   — document.referrer from browser (optional)
//
// Happy-path response: 200 { ok: true, message: 'unsubscribed', permanence: choice }
//
// All token-validation failures return 400 { ok: false, error: 'invalid_token' }
// without revealing whether the token never existed, expired, or was already used
// (prevents fishing for valid tokens).
//
// Side-effects on success:
//   1. opt_outs: upsert (client_id, phone_number) with chosen permanence
//   2. unsubscribe_tokens: mark used_at = now()
//   3. unsubscribe_events: insert confirmed_* event with SHA-256(phone_number) hash

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

/** SHA-256 hex digest of a UTF-8 string (Web Crypto, available in Deno Deploy). */
async function sha256hex(input: string): Promise<string> {
  const buf    = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
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
    // ── 1. Parse body ──────────────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json(400, { ok: false, error: 'invalid_json', detail: 'Request body must be valid JSON' });
    }

    const token           = typeof body.token  === 'string' ? body.token.trim()  : '';
    const choice          = typeof body.choice === 'string' ? body.choice.trim() : '';
    const timeToDecideMs  = typeof body.time_to_decide_ms === 'number' ? Math.round(body.time_to_decide_ms) : null;
    const cameFrom        = typeof body.came_from  === 'string' ? body.came_from.trim()  : null;
    const userAgent       = typeof body.user_agent === 'string' ? body.user_agent.trim() : null;
    const referrer        = typeof body.referrer   === 'string' ? body.referrer.trim()   : null;

    if (!token) {
      return json(400, { ok: false, error: 'validation_failed', detail: 'token is required' });
    }
    if (choice !== 'until_next_call' && choice !== 'forever') {
      return json(400, { ok: false, error: 'invalid_choice' });
    }
    if (cameFrom !== null && !['sms', 'middle_man', 'admin'].includes(cameFrom)) {
      return json(400, { ok: false, error: 'validation_failed',
                          detail: "came_from must be 'sms', 'middle_man', or 'admin'" });
    }

    // ── 2. Look up token (service_role bypasses RLS) ───────────────────────────
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const now = new Date();

    const { data: tokenRow, error: tokenErr } = await supa
      .from('unsubscribe_tokens')
      .select('id, client_id, phone_number, used_at')
      .eq('token', token)
      .maybeSingle();

    if (tokenErr) {
      console.error('process-unsubscribe token lookup error:', tokenErr);
      return json(500, { ok: false, error: 'server_error' });
    }

    // Unified 'invalid_token' for all failure modes — do not leak which check failed.
    if (!tokenRow || tokenRow.used_at !== null) {
      return json(400, { ok: false, error: 'invalid_token' });
    }

    const { client_id, phone_number } = tokenRow;

    // ── 3. Upsert opt_outs ────────────────────────────────────────────────────
    const { error: upsertErr } = await supa
      .from('opt_outs')
      .upsert(
        {
          client_id,
          phone_number,
          opted_out_at: now.toISOString(),
          permanence:   choice,
          // reset_count intentionally omitted — kept at its existing value on conflict
        },
        {
          onConflict:        'client_id,phone_number',
          ignoreDuplicates:  false,   // DO UPDATE (overwrite permanence + opted_out_at)
        }
      );

    if (upsertErr) {
      console.error('process-unsubscribe opt_outs upsert error:', upsertErr);
      return json(500, { ok: false, error: 'server_error' });
    }

    // ── 4. Mark token used ────────────────────────────────────────────────────
    const { error: markErr } = await supa
      .from('unsubscribe_tokens')
      .update({ used_at: now.toISOString() })
      .eq('id', tokenRow.id);

    if (markErr) {
      console.error('process-unsubscribe mark-used error:', markErr);
      // opt_out already written — don't fail the whole request; log and continue
    }

    // ── 5. Insert audit event ─────────────────────────────────────────────────
    const phoneHash  = await sha256hex(phone_number);
    const eventType  = choice === 'forever' ? 'confirmed_forever' : 'confirmed_until_next_call';

    const { error: eventErr } = await supa
      .from('unsubscribe_events')
      .insert({
        client_id,
        phone_number_hash: phoneHash,
        event_type:        eventType,
        token,
        came_from:         cameFrom  ?? null,
        user_agent:        userAgent ?? null,
        referrer:          referrer  ?? null,
        time_to_decide_ms: timeToDecideMs,
        occurred_at:       now.toISOString(),
      });

    if (eventErr) {
      console.error('process-unsubscribe event insert error:', eventErr);
      // Non-fatal — opt_out written, token marked. Log and continue.
    }

    // ── 6. Success ────────────────────────────────────────────────────────────
    return json(200, { ok: true, message: 'unsubscribed', permanence: choice });

  } catch (err) {
    console.error('process-unsubscribe unhandled error:', err);
    return json(500, { ok: false, error: 'server_error' });
  }
});
