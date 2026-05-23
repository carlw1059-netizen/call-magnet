-- admin_rls_policies: grant the real admin (car312@hotmail.com, is_admin=true)
-- direct read/write access to tables that admin pages need to query.
--
-- Background: existing RLS on clients blocks all UPDATE for authenticated role
-- (migration 20260523000001), and the SELECT policy limits each user to their
-- own row. The opt_outs and unsubscribe_events tables have no client-facing
-- write policies. All admin pages use the user's JWT (authenticated role) via
-- the Supabase JS client, so they hit these policies.
--
-- All policies use the same dual gate as every other admin check:
--   (auth.jwt() ->> 'email') = 'car312@hotmail.com'
--   AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
--
-- ── clients ──────────────────────────────────────────────────────────────────

-- Admin sees ALL client rows (needed by middle-man manager + any future admin page)
DROP POLICY IF EXISTS "Admin sees all client rows" ON public.clients;
CREATE POLICY "Admin sees all client rows"
  ON public.clients
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() ->> 'email') = 'car312@hotmail.com'
    AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
  );

-- Admin can UPDATE any client row (needed by middle-man manager: toggle + promo text)
DROP POLICY IF EXISTS "Admin can update any client row" ON public.clients;
CREATE POLICY "Admin can update any client row"
  ON public.clients
  FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt() ->> 'email') = 'car312@hotmail.com'
    AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
  )
  WITH CHECK (
    (auth.jwt() ->> 'email') = 'car312@hotmail.com'
    AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
  );

-- ── opt_outs ─────────────────────────────────────────────────────────────────

-- Admin sees ALL opt-out rows (unsubscribes admin page dashboard + list)
DROP POLICY IF EXISTS "Admin sees all opt_outs" ON public.opt_outs;
CREATE POLICY "Admin sees all opt_outs"
  ON public.opt_outs
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() ->> 'email') = 'car312@hotmail.com'
    AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
  );

-- Admin can DELETE opt-out rows (admin correction / removal action)
DROP POLICY IF EXISTS "Admin can delete opt_outs" ON public.opt_outs;
CREATE POLICY "Admin can delete opt_outs"
  ON public.opt_outs
  FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() ->> 'email') = 'car312@hotmail.com'
    AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
  );

-- ── unsubscribe_events ────────────────────────────────────────────────────────

-- Admin sees ALL audit events (unsubscribes admin page)
DROP POLICY IF EXISTS "Admin sees all unsubscribe_events" ON public.unsubscribe_events;
CREATE POLICY "Admin sees all unsubscribe_events"
  ON public.unsubscribe_events
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() ->> 'email') = 'car312@hotmail.com'
    AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
  );

-- Admin can INSERT audit events (admin_removed event when removing an opt-out)
DROP POLICY IF EXISTS "Admin can insert unsubscribe_events" ON public.unsubscribe_events;
CREATE POLICY "Admin can insert unsubscribe_events"
  ON public.unsubscribe_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt() ->> 'email') = 'car312@hotmail.com'
    AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
  );
