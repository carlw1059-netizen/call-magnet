-- Allow the admin browser to write directly to the middle-man-backgrounds
-- storage bucket.
--
-- Context: the bucket was created in 20260523000003_middle_man_schema.sql
-- with public SELECT only. All writes were intentionally service_role-only
-- (edge functions bypass RLS). Poster frame extraction (_extractAndUploadPoster)
-- runs client-side in the admin browser using the user's JWT (authenticated
-- role), which hits the default-deny and returns:
--   "new row violates row-level security policy"
--
-- Fix: add INSERT + UPDATE policies for the single admin user.
-- Same dual gate used throughout CallMagnet admin:
--   (auth.jwt() ->> 'email') = 'car312@hotmail.com'
--   AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
--
-- SELECT is already public (any visitor can read asset URLs — unchanged).
-- DELETE is left service_role-only (no admin-facing delete-from-storage action).

-- ── INSERT (first poster.jpg upload for a client) ─────────────────────────────

DROP POLICY IF EXISTS "Admin can upload to middle-man-backgrounds" ON storage.objects;

CREATE POLICY "Admin can upload to middle-man-backgrounds"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'middle-man-backgrounds'
    AND (auth.jwt() ->> 'email') = 'car312@hotmail.com'
    AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
  );

-- ── UPDATE (upsert: storage does an UPDATE when poster.jpg already exists) ────

DROP POLICY IF EXISTS "Admin can update middle-man-backgrounds" ON storage.objects;

CREATE POLICY "Admin can update middle-man-backgrounds"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'middle-man-backgrounds'
    AND (auth.jwt() ->> 'email') = 'car312@hotmail.com'
    AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
  )
  WITH CHECK (
    bucket_id = 'middle-man-backgrounds'
    AND (auth.jwt() ->> 'email') = 'car312@hotmail.com'
    AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
  );
