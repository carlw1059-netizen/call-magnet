-- protect_clients_from_delete
-- Adds a BEFORE DELETE trigger on public.clients that blocks accidental row
-- deletion. The only way to delete a client is to explicitly set the session
-- variable app.allow_client_delete = 'true' in the same transaction first.
--
-- Usage (psql / migration runner only):
--   BEGIN;
--   SET LOCAL app.allow_client_delete = 'true';
--   DELETE FROM public.clients WHERE id = '<uuid>';
--   COMMIT;
--
-- All normal paths (edge functions, admin UI, Supabase REST API) never set
-- this variable, so they can never accidentally delete a client row.

CREATE OR REPLACE FUNCTION public.prevent_client_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF current_setting('app.allow_client_delete', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Client deletion blocked. Set app.allow_client_delete=true to override.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_client_delete ON public.clients;

CREATE TRIGGER trg_prevent_client_delete
  BEFORE DELETE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_client_delete();
