-- SECURITY DEFINER RPC so the reset always fires regardless of RLS email-match.
-- The direct UPDATE in confirmReset() is blocked when auth.jwt()->>'email' differs
-- from clients.email (e.g. Google OAuth email ≠ client record email).
-- Running as table owner bypasses RLS; scoped to a single client_id from the session.
CREATE OR REPLACE FUNCTION reset_client_counter(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE clients SET reset_date = NOW() WHERE id = p_client_id;
END;
$$;

REVOKE ALL ON FUNCTION reset_client_counter(uuid) FROM public;
GRANT EXECUTE ON FUNCTION reset_client_counter(uuid) TO anon, authenticated;
