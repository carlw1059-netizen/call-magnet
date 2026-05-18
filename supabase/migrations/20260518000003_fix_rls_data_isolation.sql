-- RLS data isolation fix: scope sms_events and bookings SELECT policies to
-- the authenticated user's own client record only.
--
-- Problem: both existing policies had qual = true, meaning any authenticated
-- user could SELECT every row across all clients — a complete data isolation
-- failure for a multi-tenant schema.
--
-- Fix: replace each policy with a subquery that resolves the caller's
-- client_id from clients.email = auth.email(). This ensures:
--   - A user with email foo@bar.com sees only rows where client_id matches
--     the clients row whose email column is foo@bar.com.
--   - No other client's data is ever returned, even if RLS is bypassed at
--     a higher layer.
--   - service_role continues to bypass RLS for all edge functions (unchanged).
--
-- Idempotent: DROP POLICY IF EXISTS before each CREATE POLICY.

-- ── sms_events ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users see own sms events" ON public.sms_events;

CREATE POLICY "Users see own sms events"
ON public.sms_events
FOR SELECT
TO authenticated
USING (
  client_id = (
    SELECT id FROM public.clients WHERE email = auth.email()
  )
);

-- ── bookings ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users see own bookings" ON public.bookings;

CREATE POLICY "Users see own bookings"
ON public.bookings
FOR SELECT
TO authenticated
USING (
  client_id = (
    SELECT id FROM public.clients WHERE email = auth.email()
  )
);
