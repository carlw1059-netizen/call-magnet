-- mm_submissions_client_select: allow authenticated clients to SELECT their
-- own middle_man_form_submissions rows on the dashboard.
--
-- The table was created with RLS enabled but no policies (service_role only).
-- Without this policy the dashboard's authenticated Supabase client returns
-- an empty array for every query against middle_man_form_submissions.
--
-- Policy scope:
--   client_id IN (SELECT id FROM clients WHERE email = auth.email())
--   → each authenticated user only sees submissions for their own business.
--   service_role bypasses RLS and is unaffected.

CREATE POLICY "Clients read own form submissions"
  ON public.middle_man_form_submissions
  FOR SELECT
  TO authenticated
  USING (
    client_id IN (
      SELECT id FROM public.clients WHERE email = auth.email()
    )
  );
