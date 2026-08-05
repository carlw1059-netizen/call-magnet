ALTER TABLE public.weekly_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.weekly_summaries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "admin_full_access" ON public.weekly_summaries
  FOR ALL
  TO authenticated
  USING (
    auth.uid() = (
      SELECT id FROM auth.users WHERE email = 'car312@hotmail.com' LIMIT 1
    )
  )
  WITH CHECK (
    auth.uid() = (
      SELECT id FROM auth.users WHERE email = 'car312@hotmail.com' LIMIT 1
    )
  );
