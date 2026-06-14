-- Public helper that lets edge functions read a single Vault secret by name.
-- SECURITY DEFINER so it can access vault.decrypted_secrets without the caller
-- needing direct vault permissions. Callable via supa.rpc('get_vault_secret').
CREATE OR REPLACE FUNCTION public.get_vault_secret(secret_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  secret_value text;
BEGIN
  SELECT decrypted_secret
    INTO secret_value
    FROM vault.decrypted_secrets
   WHERE name = secret_name
   LIMIT 1;
  RETURN secret_value;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_vault_secret(text) TO service_role;
