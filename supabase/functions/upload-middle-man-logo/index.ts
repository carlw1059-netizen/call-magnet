// upload-middle-man-logo: authenticated upload for Middle Man page business logo.
//
// Auth gate (two-tier):
//   - Valid JWT required (verify_jwt = true in config.toml handles gateway check)
//   - Inside function: caller must EITHER own the client_id (email match) OR be
//     the real admin (is_admin === true AND email === car312@hotmail.com)
//
// Input: multipart/form-data
//   client_id  (string, uuid)   — required
//   file       (binary)         — required, JPEG / PNG / WebP / GIF image
//
// No image processing — file uploaded as-is to middle-man-backgrounds bucket.
// Storage path: <client_id>/logo.png  (always the same filename; upsert=true)
// DB update: { middle_man_logo_url: <publicUrl>, middle_man_updated_at: <now> }
//
// Returns: { ok: true, url: <publicUrl> }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADMIN_EMAIL               = 'car312@hotmail.com';
const BUCKET                    = 'middle-man-backgrounds';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES          = 2 * 1024 * 1024;  // 2 MB

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
    // ── 1. Verify JWT and resolve caller identity ───────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const userJwt    = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!userJwt) {
      return json(401, { ok: false, error: 'missing_authorization',
                          detail: 'Authorization: Bearer <jwt> header required' });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userErr } = await supa.auth.getUser(userJwt);
    if (userErr || !userData?.user) {
      return json(401, { ok: false, error: 'invalid_token',
                          detail: userErr?.message ?? 'token did not resolve to a user' });
    }

    const callerEmail = (userData.user.email ?? '').toLowerCase();
    const isAdminCall = userData.user.app_metadata?.is_admin === true
                        && callerEmail === ADMIN_EMAIL;

    // ── 2. Parse multipart/form-data ───────────────────────────────────────
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return json(400, { ok: false, error: 'validation_failed',
                          detail: 'Request must be multipart/form-data' });
    }

    const clientId  = (formData.get('client_id') as string | null)?.trim() ?? '';
    const fileEntry =  formData.get('file');

    if (!clientId) {
      return json(400, { ok: false, error: 'validation_failed', detail: 'client_id is required' });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
      return json(400, { ok: false, error: 'validation_failed', detail: 'client_id must be a valid UUID' });
    }
    if (!fileEntry || !(fileEntry instanceof File)) {
      return json(400, { ok: false, error: 'validation_failed', detail: 'file field is required' });
    }

    // ── 2b. Auth: confirm ownership or admin ────────────────────────────────
    if (!isAdminCall) {
      const { data: clientRow } = await supa
        .from('clients')
        .select('id')
        .eq('id', clientId)
        .eq('email', callerEmail)
        .maybeSingle();
      if (!clientRow) {
        return json(403, { ok: false, error: 'forbidden',
                            detail: 'Caller does not own this client_id' });
      }
    }

    // ── 3. Validate MIME type and file size ────────────────────────────────
    const mime = fileEntry.type;
    if (!ALLOWED_MIME_TYPES.has(mime)) {
      return json(400, { ok: false, error: 'validation_failed',
                          detail: `Unsupported file type "${mime}". Allowed: JPEG, PNG, WebP, GIF.` });
    }

    const fileBytes = new Uint8Array(await fileEntry.arrayBuffer());
    if (fileBytes.byteLength > MAX_BYTES) {
      return json(400, { ok: false, error: 'validation_failed',
                          detail: `Logo must be under 2 MB (got ${(fileBytes.byteLength / 1024 / 1024).toFixed(1)} MB).` });
    }

    // ── 4. Upload to storage ───────────────────────────────────────────────
    // Always stored at the same path — upsert:true overwrites previous logo.
    const storagePath = `${clientId}/logo.png`;
    const { error: upErr } = await supa.storage
      .from(BUCKET)
      .upload(storagePath, fileBytes, { contentType: mime, upsert: true });
    if (upErr) {
      console.error('upload-middle-man-logo: storage upload failed:', upErr.message);
      throw new Error(`Storage upload failed: ${upErr.message}`);
    }

    const { data: { publicUrl } } = supa.storage.from(BUCKET).getPublicUrl(storagePath);

    // ── 5. Update clients row ──────────────────────────────────────────────
    const { error: updateErr } = await supa
      .from('clients')
      .update({
        middle_man_logo_url:  publicUrl,
        middle_man_updated_at: new Date().toISOString(),
      })
      .eq('id', clientId);
    if (updateErr) {
      console.error('upload-middle-man-logo: clients update failed:', updateErr.message);
      throw new Error(`clients update failed: ${updateErr.message}`);
    }

    console.log(`upload-middle-man-logo: logo saved for client ${clientId} → ${publicUrl}`);
    return json(200, { ok: true, url: publicUrl });

  } catch (err) {
    console.error('upload-middle-man-logo unhandled error:', err);
    return json(500, { ok: false, error: 'server_error',
                        detail: err instanceof Error ? err.message : String(err) });
  }
});
