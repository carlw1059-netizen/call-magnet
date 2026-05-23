-- middle_man_schema: Stage 1 of 8 — data layer only.
--
-- The Middle Man feature sits between the missed-call SMS and the client's
-- booking destination. When middle_man_enabled = true, the Rebrandly short
-- link in the SMS points to /middleman?c=<client_id> (a branded landing page)
-- instead of directly to booking_url. The landing page shows a background
-- image/video, promo text, and up to four action buttons (book, change,
-- cancel, other). Each button tap is recorded in middle_man_clicks.
--
-- This migration is fully backwards-compatible:
--   • All new clients columns are nullable (except middle_man_enabled which
--     defaults false), so existing rows are unaffected.
--   • The new table and bucket have no impact on existing read paths.
--   • Existing RLS on clients is untouched.

-- ── 1. Add columns to public.clients ─────────────────────────────────────────

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS middle_man_enabled        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS middle_man_background_url text,
  ADD COLUMN IF NOT EXISTS middle_man_background_type text
    CONSTRAINT clients_middle_man_background_type_check
    CHECK (middle_man_background_type IN ('image', 'video') OR middle_man_background_type IS NULL),
  ADD COLUMN IF NOT EXISTS middle_man_promo_text     text
    CONSTRAINT clients_middle_man_promo_text_check
    CHECK (length(middle_man_promo_text) <= 80 OR middle_man_promo_text IS NULL),
  ADD COLUMN IF NOT EXISTS middle_man_book_url       text,
  ADD COLUMN IF NOT EXISTS middle_man_change_url     text,
  ADD COLUMN IF NOT EXISTS middle_man_cancel_url     text,
  ADD COLUMN IF NOT EXISTS middle_man_other_url      text,
  ADD COLUMN IF NOT EXISTS middle_man_updated_at     timestamptz;

-- Human-readable intent for the enable toggle.
COMMENT ON COLUMN public.clients.middle_man_enabled IS
  'Upsell toggle. When true, Rebrandly link points to /middleman?c=<client_id>. When false, Rebrandly link points directly to booking_url.';

-- ── 2. Create public.middle_man_clicks ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.middle_man_clicks (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  missed_caller_phone text,
  button_clicked     text        NOT NULL
    CONSTRAINT middle_man_clicks_button_clicked_check
    CHECK (button_clicked IN ('book', 'change', 'cancel', 'other')),
  clicked_at         timestamptz NOT NULL DEFAULT now(),
  user_agent         text,
  ip_hash            text,
  sms_event_id       uuid        REFERENCES public.sms_events(id) ON DELETE SET NULL
);

-- ── 3. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_middle_man_clicks_client_id
  ON public.middle_man_clicks(client_id);

CREATE INDEX IF NOT EXISTS idx_middle_man_clicks_clicked_at
  ON public.middle_man_clicks(clicked_at DESC);

-- Partial index — only rows where the feature is active need to be fast.
CREATE INDEX IF NOT EXISTS idx_clients_middle_man_enabled
  ON public.clients(middle_man_enabled)
  WHERE middle_man_enabled = true;

-- ── 4. Enable RLS on middle_man_clicks ───────────────────────────────────────

ALTER TABLE public.middle_man_clicks ENABLE ROW LEVEL SECURITY;

-- ── 5. RLS policies on middle_man_clicks ─────────────────────────────────────
--
-- INSERT: no policy → default-deny for all roles. Edge functions use
--   service_role which bypasses RLS entirely, so they can still write.
-- UPDATE: no policy → immutable click log.
-- DELETE: no policy → immutable click log.
-- SELECT: authenticated clients see only their own clicks.

DROP POLICY IF EXISTS "Clients see own middle_man clicks" ON public.middle_man_clicks;

CREATE POLICY "Clients see own middle_man clicks"
  ON public.middle_man_clicks
  FOR SELECT
  TO authenticated
  USING (
    client_id IN (
      SELECT id FROM public.clients WHERE email = auth.jwt() ->> 'email'
    )
  );

-- ── 6. Storage bucket: middle-man-backgrounds ────────────────────────────────
--
-- Public read so the Middle Man page can render the asset without a signed URL.
-- Writes are service_role-only (enforced by Storage RLS policies below).
-- 15 MB limit; image and video only.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'middle-man-backgrounds',
  'middle-man-backgrounds',
  true,
  15728640,   -- 15 MB in bytes (15 * 1024 * 1024)
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
)
ON CONFLICT (id) DO NOTHING;

-- ── 7. Storage RLS on middle-man-backgrounds ─────────────────────────────────
--
-- Public SELECT — any visitor can read the asset URL.
-- INSERT / UPDATE / DELETE — only service_role (bypasses RLS, not listed here).
-- Authenticated + anon are denied write by default (no policy → deny).

DROP POLICY IF EXISTS "Public read middle-man-backgrounds" ON storage.objects;

CREATE POLICY "Public read middle-man-backgrounds"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'middle-man-backgrounds');
