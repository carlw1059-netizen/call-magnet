DROP POLICY IF EXISTS admin_full_access ON public.client_schedules;
CREATE POLICY admin_full_access ON public.client_schedules
  FOR ALL
  TO authenticated
  USING (auth.email() = 'car312@hotmail.com')
  WITH CHECK (auth.email() = 'car312@hotmail.com');
