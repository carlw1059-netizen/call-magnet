CREATE POLICY "Clients dismiss own link clicks" ON link_clicks
  FOR UPDATE TO authenticated
  USING (client_id IN (SELECT clients.id FROM clients WHERE clients.email = auth.email()))
  WITH CHECK (client_id IN (SELECT clients.id FROM clients WHERE clients.email = auth.email()));

REVOKE UPDATE ON link_clicks FROM authenticated;
GRANT UPDATE (dismissed) ON link_clicks TO authenticated;
