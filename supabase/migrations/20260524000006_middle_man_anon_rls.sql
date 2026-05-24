-- middle_man_anon_rls: add a narrow SELECT policy so the anon role can read
-- clients rows for the Middle Man landing page (/b/<slug>).
--
-- Without this policy the PostgREST REST API returns [] for every anon request
-- against the clients table (RLS default-deny), causing b.html to always show
-- the "not found" state regardless of whether the slug is valid.
--
-- The policy is intentionally narrow:
--   middle_man_enabled = true   — only clients that have opted in
--   account_status = 'active'   — no suspended / cancelled accounts
--   middle_man_slug IS NOT NULL — slug must be set (prevents accidental match)
--
-- service_role bypasses RLS entirely and is unaffected.
-- authenticated users already have their own SELECT policy ("Users see own
-- client record") and are also unaffected by this change.

CREATE POLICY "Public read active middle man clients"
  ON public.clients
  FOR SELECT
  TO anon
  USING (
    middle_man_enabled = true
    AND account_status = 'active'
    AND middle_man_slug IS NOT NULL
  );
