-- add_poster_url: adds middle_man_background_poster_url to clients.
--
-- This column stores the public URL of a JPEG poster frame extracted from the
-- client's video background by the admin browser (client-side canvas extraction)
-- immediately after upload. Used as the <video poster="..."> attribute on the
-- caller-facing Middle Man page (/b/<slug>) to eliminate the blank-screen delay
-- while the video buffers — the poster JPEG is shown instantly.
--
-- Extraction path: admin uploads MP4 → upload-middle-man-background stores it →
--   admin JS creates <video>, seeks to 0.1s, draws to canvas, uploads JPEG to
--   <clientId>/poster.jpg in the middle-man-backgrounds bucket, then writes this URL.
--
-- If extraction fails (e.g. iOS canvas restriction, CORS, network), the column
-- stays NULL. The caller page falls back to the dark #0E1419 body background,
-- which already prevents any white flash.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS middle_man_background_poster_url text;

COMMENT ON COLUMN public.clients.middle_man_background_poster_url IS
  'JPEG URL of the first video frame, extracted client-side in the admin browser '
  'after video upload and stored in middle-man-backgrounds/<clientId>/poster.jpg. '
  'Used as the <video poster> attribute on /b/<slug> to show an instant preview '
  'while the MP4 buffers. NULL if extraction failed or client has no video background.';
