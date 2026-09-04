// upload-middle-man-poster: uploads a video poster/thumbnail JPEG to R2.
//
// Called by the admin UI immediately after a video upload. Accepts the JPEG
// blob extracted from the video's first frame and stores it at:
//   <client_id>/poster.jpg  in the callmagnet-media R2 bucket
//
// Auth: same two-tier gate as the other upload functions.
// Input: multipart/form-data — client_id (uuid), file (JPEG blob)
// Returns: { ok: true, url: <publicUrl> }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
import { S3Client, PutObjectCommand } from 'npm:@aws-sdk/client-s3@3';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADMIN_EMAIL               = 'car312@hotmail.com';

const R2_ACCOUNT_ID  = Deno.env.get('CLOUDFLARE_ACCOUNT_ID')!;
const R2_ACCESS_KEY  = Deno.env.get('CLOUDFLARE_R2_ACCESS_KEY_ID')!;
const R2_SECRET_KEY  = Deno.env.get('CLOUDFLARE_R2_SECRET_ACCESS_KEY')!;
const R2_BUCKET      = 'callmagnet-media';
const R2_PUBLIC_BASE = 'https://media.callmagnet.com.au';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
});

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

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
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const userJwt    = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!userJwt) {
      return json(401, { ok: false, error: 'missing_authorization' });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userErr } = await supa.auth.getUser(userJwt);
    if (userErr || !userData?.user) {
      return json(401, { ok: false, error: 'invalid_token' });
    }

    const callerEmail = (userData.user.email ?? '').toLowerCase();
    const isAdminCall = userData.user.app_metadata?.is_admin === true
                        && callerEmail === ADMIN_EMAIL;

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return json(400, { ok: false, error: 'validation_failed', detail: 'Request must be multipart/form-data' });
    }

    const clientId  = (formData.get('client_id') as string | null)?.trim() ?? '';
    const fileEntry =  formData.get('file');

    if (!clientId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
      return json(400, { ok: false, error: 'validation_failed', detail: 'client_id is required and must be a valid UUID' });
    }
    if (!fileEntry || !(fileEntry instanceof File)) {
      return json(400, { ok: false, error: 'validation_failed', detail: 'file field is required' });
    }

    if (!isAdminCall) {
      const { data: clientRow } = await supa
        .from('clients').select('id').eq('id', clientId).eq('email', callerEmail).maybeSingle();
      if (!clientRow) return json(403, { ok: false, error: 'forbidden' });
    }

    const fileBytes = new Uint8Array(await fileEntry.arrayBuffer());
    if (fileBytes.byteLength > MAX_BYTES) {
      return json(400, { ok: false, error: 'validation_failed', detail: 'Poster must be under 2 MB' });
    }

    const storagePath = `${clientId}/poster.jpg`;
    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: storagePath,
      Body: fileBytes,
      ContentType: 'image/jpeg',
    }));
    const publicUrl = `${R2_PUBLIC_BASE}/${storagePath}`;

    const { error: updateErr } = await supa
      .from('clients')
      .update({ middle_man_background_poster_url: publicUrl })
      .eq('id', clientId);
    if (updateErr) throw new Error(`clients update failed: ${updateErr.message}`);

    return json(200, { ok: true, url: publicUrl });

  } catch (err) {
    console.error('upload-middle-man-poster unhandled error:', err);
    return json(500, { ok: false, error: 'server_error',
                        detail: err instanceof Error ? err.message : String(err) });
  }
});
