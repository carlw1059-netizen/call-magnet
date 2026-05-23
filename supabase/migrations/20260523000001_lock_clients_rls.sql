-- lock_clients_rls: replace the two unsafe Studio-created policies on
-- public.clients with explicit deny policies so that INSERT and UPDATE are
-- only possible via service_role (edge functions). service_role bypasses RLS
-- entirely, so it is unaffected by these policies.
--
-- Gaps being closed:
--
--   "Allow insert for authenticated users"
--     Despite its name this policy was granted to the `anon` role with
--     WITH CHECK (true), meaning any unauthenticated HTTP request could INSERT
--     any row directly into clients, bypassing the create-client edge function.
--
--   "Clients can update own row"
--     Granted UPDATE to public with no column allowlist. Clients could flip
--     is_test_account, account_status, cancellation_scheduled, etc. on their
--     own row directly via the PostgREST API.
--
-- What is kept:
--   "Users see own client record" (SELECT) — left untouched. Clients need to
--   read their own row so the dashboard loads correctly.
--
-- DELETE: no policy exists and none is added. With RLS enabled and no matching
-- DELETE policy, all roles (including authenticated) are denied by default.
-- service_role can still delete via edge functions if ever needed.

-- ── 1. Drop the two unsafe policies ──────────────────────────────────────────

DROP POLICY IF EXISTS "Allow insert for authenticated users" ON public.clients;
DROP POLICY IF EXISTS "Clients can update own row"           ON public.clients;

-- ── 2. Explicit deny: INSERT ──────────────────────────────────────────────────
-- Grants the policy to `authenticated` so the intent is auditable.
-- WITH CHECK (false) means no row ever satisfies the check → INSERT denied.
-- `anon` has no INSERT policy at all → also denied (RLS default-deny).
-- `service_role` bypasses RLS → edge functions unaffected.

CREATE POLICY "Clients cannot insert directly"
  ON public.clients
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

-- ── 3. Explicit deny: UPDATE ──────────────────────────────────────────────────
-- USING (false) means no existing row qualifies → UPDATE denied at the row
-- visibility check before WITH CHECK is even evaluated.
-- `anon` has no UPDATE policy → also denied.
-- `service_role` bypasses RLS → edge functions unaffected.

CREATE POLICY "Clients cannot update directly"
  ON public.clients
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);
