-- Session 2: post-apply privacy lockdown on v_suburb_benchmarks.
-- Supabase's public-schema default privileges grant SELECT/INSERT/UPDATE/DELETE
-- to anon and authenticated when a view is created in the public schema. The
-- k=5 cohort floor in v_suburb_benchmarks's HAVING clause is the data-layer
-- privacy guarantee; this migration adds the access-layer guarantee — only
-- service_role (which bypasses GRANTs) can read the view from the monthly-report
-- edge function.
-- PUBLIC included for belt-and-braces against any future role that inherits
-- the default. service_role and postgres are unaffected.
-- Idempotent: REVOKE on a non-existent grant is a no-op.

REVOKE ALL ON public.v_suburb_benchmarks FROM PUBLIC, anon, authenticated;

-- Post-apply verification (read-only, run in Studio):
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND table_name='v_suburb_benchmarks';
-- Expected: empty, or only postgres / service_role.
