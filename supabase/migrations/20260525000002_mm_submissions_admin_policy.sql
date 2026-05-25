-- mm_submissions_admin_policy: grant the real admin SELECT access to all
-- middle_man_form_submissions rows.
--
-- The table was created in 20260524000005 with RLS enabled and a single
-- SELECT policy for the authenticated role (clients see own rows only).
-- The Middle Man manager page (admin/middle-man.html) reads submissions
-- via the Supabase JS client (authenticated role + admin JWT) and returns
-- an empty array without this policy.
--
-- Uses the same dual gate as every other admin policy in this project:
--   (auth.jwt() ->> 'email') = 'car312@hotmail.com'
--   AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
--
-- Verification after apply:
--   SELECT policyname, cmd, roles
--   FROM pg_policies
--   WHERE schemaname = 'public'
--   AND tablename = 'middle_man_form_submissions';
-- Expected: 2 rows.

CREATE POLICY "Admin sees all form submissions"
  ON public.middle_man_form_submissions
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() ->> 'email') = 'car312@hotmail.com'
    AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
  );
