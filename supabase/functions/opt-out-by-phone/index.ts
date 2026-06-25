// opt-out-by-phone: allows a caller to opt out by entering their phone number
// directly, without needing a token. Used when they visit the Middle Man page
// without a ?u=<token> link (e.g. bookmarked page or direct visit).
//
// Auth: verify_jwt = false (anon — the caller is a member of the public)
//
// Request: POST application/json
//   slug          string  — the business's Middle Man slug (required)
//   phone_number  string  — the caller's mobile number (required)
//
// Happy-path response: 200 { ok: true }
// Errors: 400 { ok: false, error: 'validation_failed' | 'unknown_slug' }

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

/** Normalise an AU mobile to E.164 (+61XXXXXXXXX). Returns null if not valid. */
function normaliseAuMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  // 0412345678 → +61412345678
  if (/^04\d{8}$/.test(digits)) return '+61' + digits.slice(1);
  // 61412345678 → +61412345678
  if (/^614\d{8}$/.test(digits)) return '+' + digits;
  // +61412345678 (already E.164)
  if (/^\+614\d{8}$/.test(raw.replace(/\s/g, ''))) return raw.replace(/\s/g, '');
  return null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

  try {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch {
      return json(400, { ok: false, error: 'invalid_json' });
    }

    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    const phoneRaw = typeof body.phone_number === 'string' ? body.phone_number.trim() : '';

    if (!slug || !phoneRaw) {
      return json(400, { ok: false, error: 'validation_failed', detail: 'slug and phone_number are required' });
    }

    const phone = normaliseAuMobile(phoneRaw);
    if (!phone) {
      return json(400, { ok: false, error: 'invalid_phone', detail: 'Please enter a valid Australian mobile number' });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Look up client_id from slug
    const { data: clientRow, error: clientErr } = await supa
      .from('clients')
      .select('id')
      .eq('middle_man_slug', slug)
      .maybeSingle();

    if (clientErr) {
      console.error('opt-out-by-phone: client lookup error:', clientErr);
      return json(500, { ok: false, error: 'server_error' });
    }
    if (!clientRow) {
      return json(400, { ok: false, error: 'unknown_slug' });
    }

    const now = new Date().toISOString();

    // Upsert opt_out — same schema as process-unsubscribe
    const { error: upsertErr } = await supa
      .from('opt_outs')
      .upsert(
        { client_id: clientRow.id, phone_number: phone, opted_out_at: now, permanence: 'forever' },
        { onConflict: 'client_id,phone_number', ignoreDuplicates: false }
      );

    if (upsertErr) {
      console.error('opt-out-by-phone: upsert error:', upsertErr);
      return json(500, { ok: false, error: 'server_error' });
    }

    return json(200, { ok: true });

  } catch (err) {
    console.error('opt-out-by-phone: unhandled error:', err);
    return json(500, { ok: false, error: 'server_error' });
  }
});
