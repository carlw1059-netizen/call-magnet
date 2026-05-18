-- RLS fix: scope bookings INSERT to the authenticated user's own client.
--
-- Context: 20260518000003 fixed the SELECT policies on sms_events and
-- bookings (qual = true → email-scoped subquery). This migration closes the
-- remaining gap: the bookings INSERT policy had no WITH CHECK clause, meaning
-- any authenticated user could insert a booking row for any client_id.
--
-- Fix: add a WITH CHECK that mirrors the SELECT policy — client_id must
-- resolve to the clients row whose email matches auth.email().
--
-- Notes:
--   - INSERT policies use WITH CHECK, not USING (USING applies to rows being
--     read; WITH CHECK applies to rows being written).
--   - service_role bypasses RLS for all edge functions — unaffected.
--   - Idempotent: DROP POLICY IF EXISTS before CREATE POLICY.

DROP POLICY IF EXISTS "Users insert own bookings" ON public.bookings;

CREATE POLICY "Users insert own bookings"
ON public.bookings
FOR INSERT
TO authenticated
WITH CHECK (
  client_id = (
    SELECT id FROM public.clients WHERE email = auth.email()
  )
);
