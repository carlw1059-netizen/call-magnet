CREATE POLICY "Users update own sms events"
  ON public.sms_events
  FOR UPDATE
  USING (client_id = (SELECT clients.id FROM clients WHERE clients.email = auth.email()))
  WITH CHECK (client_id = (SELECT clients.id FROM clients WHERE clients.email = auth.email()));
