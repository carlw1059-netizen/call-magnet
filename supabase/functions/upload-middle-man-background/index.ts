// upload-middle-man-background: authenticated upload for Middle Man page assets.
//
// Auth gate (two-tier):
//   - Valid JWT required (verify_jwt = true in config.toml handles gateway check)
//   - Inside function: caller must EITHER own the client_id (email match) OR be
//     the real admin (is_admin === true AND email === car312@hotmail.com)
//
// Input: multipart/form-data
//   client_id  (string, uuid)   — required
//   file       (binary)         — required, JPEG/PNG image OR MP4 video
//   promo_text (string, ≤80ch)  — optional
//
// Image processing (JPEG/PNG — imagescript, pure TS, no native deps):
//   • Validates minimum 600×800px before processing
//   • Produces 3 JPEG variants via cover-crop (center):
//       portrait  1080×1920  → <client_id>/portrait.jpg   quality 85
//       landscape 1920×1080  → <client_id>/landscape.jpg  quality 85
//       square    1080×1080  → <client_id>/square.jpg     quality 85
//
// Video (MP4 only — Phase 1.5):
//   • Accepts video/mp4 only. MOV / WebM / AVI are rejected with clear messages.
//   • Max 10 MB. Stored as-is at <client_id>/video.mp4 (no transcoding).
//   • Returns { ok: true, urls: { video: <publicUrl> }, type: 'video' }
//
// NOTE: npm:sharp requires native Node.js bindings (libvips) which are NOT
// available in Supabase Edge Functions (Deno Deploy). imagescript is the
// correct zero-native alternative for this runtime.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient }   from 'npm:@supabase/supabase-js@2';
import { Image }          from 'https://deno.land/x/imagescript@1.2.15/mod.ts';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADMIN_EMAIL               = 'car312@hotmail.com';
const BUCKET                    = 'middle-man-backgrounds';

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);
const MAX_IMAGE_BYTES     = 5  * 1024 * 1024;   // 5 MB
const MAX_VIDEO_BYTES     = 10 * 1024 * 1024;   // 10 MB

// Maps unsupported video MIME types to human-readable format names for errors.
const UNSUPPORTED_VIDEO_LABELS: Record<string, string> = {
  'video/quicktime':  'MOV',
  'video/webm':       'WebM',
  'video/x-msvideo':  'AVI',
  'video/avi':        'AVI',
  'video/x-matroska': 'MKV',
};
const MIN_IMG_W           = 600;
const MIN_IMG_H           = 800;

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

/**
 * Cover-crop semantics: scale the image up until both dimensions meet the
 * target, then crop from the center. Mutates the passed-in Image clone.
 */
function coverCrop(img: Image, targetW: number, targetH: number): Image {
  const scaleW = targetW / img.width;
  const scaleH = targetH / img.height;
  const scale  = Math.max(scaleW, scaleH);
  const newW   = Math.ceil(img.width  * scale);
  const newH   = Math.ceil(img.height * scale);
  img.resize(newW, newH);                                         // mutates img
  const x = Math.max(0, Math.floor((newW - targetW) / 2));
  const y = Math.max(0, Math.floor((newH - targetH) / 2));
  img.crop(x, y, targetW, targetH);                              // mutates img
  return img;
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

    const clientId  = (formData.get('client_id')  as string | null)?.trim() ?? '';
    const promoRaw  = (formData.get('promo_text') as string | null)?.trim() ?? null;
    const fileEntry =  formData.get('file');

    if (!clientId) {
      return json(400, { ok: false, error: 'validation_failed', detail: 'client_id is required' });
    }
    // Basic UUID shape check — Supabase will reject malformed UUIDs anyway,
    // but fail fast here with a clear message.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
      return json(400, { ok: false, error: 'validation_failed', detail: 'client_id must be a valid UUID' });
    }
    if (!fileEntry || !(fileEntry instanceof File)) {
      return json(400, { ok: false, error: 'validation_failed', detail: 'file field is required' });
    }
    if (promoRaw !== null && promoRaw.length > 80) {
      return json(400, { ok: false, error: 'validation_failed',
                          detail: `promo_text must be ≤ 80 characters (got ${promoRaw.length})` });
    }
    const promoText = promoRaw;

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

    // ── 3. Validate MIME type ──────────────────────────────────────────────
    const mime    = fileEntry.type;
    const isImage = ALLOWED_IMAGE_TYPES.has(mime);
    const isMp4   = mime === 'video/mp4';

    // Reject known unsupported video formats with a specific message.
    if (mime in UNSUPPORTED_VIDEO_LABELS) {
      const fmt = UNSUPPORTED_VIDEO_LABELS[mime];
      return json(400, { ok: false, error: 'video_format_unsupported',
                          detail: `Only MP4 videos are supported — ${fmt} files cannot be uploaded. Please convert to MP4 first.` });
    }

    if (!isImage && !isMp4) {
      return json(400, { ok: false, error: 'validation_failed',
                          detail: 'Unsupported file type. Allowed: JPG, PNG, or MP4 video.' });
    }

    const fileBytes = new Uint8Array(await fileEntry.arrayBuffer());

    // ── 4. Process file and upload to storage ─────────────────────────────
    let urls:   Record<string, string>;
    let bgType: 'image' | 'video' = 'image';

    if (isMp4) {
      // ── MP4 video: validate size, upload as-is ─────────────────────────
      if (fileBytes.byteLength > MAX_VIDEO_BYTES) {
        return json(400, { ok: false, error: 'validation_failed',
                            detail: `Video must be under 10MB — try compressing it (got ${(fileBytes.byteLength / 1024 / 1024).toFixed(1)} MB)` });
      }

      const path = `${clientId}/video.mp4`;
      const { error: upErr } = await supa.storage
        .from(BUCKET)
        .upload(path, fileBytes, { contentType: 'video/mp4', upsert: true });
      if (upErr) throw new Error(`Storage upload failed (video): ${upErr.message}`);

      const { data: { publicUrl } } = supa.storage.from(BUCKET).getPublicUrl(path);
      urls   = { video: publicUrl };
      bgType = 'video';

    } else {
      // ── Image (JPEG or PNG): decode → validate → 3-variant encode pipeline
      if (fileBytes.byteLength > MAX_IMAGE_BYTES) {
        const limitMB = (MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0);
        return json(400, { ok: false, error: 'validation_failed',
                            detail: `File too large. Images must be ≤ ${limitMB} MB (got ${(fileBytes.byteLength / 1024 / 1024).toFixed(1)} MB)` });
      }

      let img: Image;
      try {
        img = await Image.decode(fileBytes);
      } catch (decErr) {
        console.error('Image.decode failed:', decErr);
        return json(400, { ok: false, error: 'validation_failed',
                            detail: 'Could not decode image. Ensure it is a valid JPEG or PNG.' });
      }

      if (img.width < MIN_IMG_W || img.height < MIN_IMG_H) {
        return json(400, { ok: false, error: 'validation_failed',
                            detail: `Image too small (${img.width}×${img.height}px). ` +
                                    `Minimum is ${MIN_IMG_W}×${MIN_IMG_H}px for phone-quality display.` });
      }

      const VARIANTS = [
        { key: 'portrait',  w: 1080, h: 1920 },
        { key: 'landscape', w: 1920, h: 1080 },
        { key: 'square',    w: 1080, h: 1080 },
      ] as const;

      urls = {};
      for (const { key, w, h } of VARIANTS) {
        // Clone before every variant — imagescript mutates in-place.
        const cropped   = coverCrop(img.clone() as Image, w, h);
        const jpegBytes = await cropped.encodeJPEG(85);
        const path      = `${clientId}/${key}.jpg`;

        const { error: upErr } = await supa.storage
          .from(BUCKET)
          .upload(path, jpegBytes, { contentType: 'image/jpeg', upsert: true });
        if (upErr) throw new Error(`Storage upload failed (${key}): ${upErr.message}`);

        const { data: { publicUrl } } = supa.storage.from(BUCKET).getPublicUrl(path);
        urls[key] = publicUrl;
      }
      bgType = 'image';
    }

    // ── 5. Update clients row (service_role bypasses RLS lockdown) ─────────
    const primaryUrl  = urls.portrait ?? Object.values(urls)[0];
    const updatedAtTs = new Date().toISOString();

    const updatePayload: Record<string, unknown> = {
      middle_man_background_url:  primaryUrl,
      middle_man_background_type: bgType,
      middle_man_updated_at:      updatedAtTs,
    };
    if (promoText !== null) {
      updatePayload.middle_man_promo_text = promoText;
    }

    const { error: updateErr } = await supa
      .from('clients')
      .update(updatePayload)
      .eq('id', clientId);
    if (updateErr) throw new Error(`clients update failed: ${updateErr.message}`);

    // ── 6. Success response ────────────────────────────────────────────────
    return json(200, { ok: true, urls, type: bgType, updated_at: updatedAtTs });

  } catch (err) {
    console.error('upload-middle-man-background unhandled error:', err);
    return json(500, { ok: false, error: 'server_error' });
  }
});
