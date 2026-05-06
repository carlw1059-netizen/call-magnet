-- Anon-safe RPC for fetch-client-vertical Twilio Function.
--
-- Problem: the clients table has RLS enabled with no anon SELECT policy, so
-- Twilio cannot query it directly with just the anon key. Previously the
-- Twilio Function used the service_role key to bypass RLS — but service_role
-- keys must be treated as secrets and should not live in Twilio's environment.
--
-- Solution: a SECURITY DEFINER function that runs as its owner (postgres),
-- bypassing RLS, but exposes only the three fields Twilio actually needs.
-- We grant EXECUTE to the anon role so the function is callable via PostgREST
-- RPC with the public anon key. Nothing else about the clients table is exposed.
--
-- Idempotent: CREATE OR REPLACE + GRANT are both safe to re-run.

CREATE OR REPLACE FUNCTION public.get_client_vertical(p_twilio_number text)
RETURNS TABLE(vertical text, business_name text, booking_url text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT vertical, business_name, booking_url
  FROM clients
  WHERE twilio_number = p_twilio_number
  LIMIT 1;
$$;

-- Allow the anon role (used by the Twilio Function's anon-key requests) to
-- call this function via PostgREST /rest/v1/rpc/get_client_vertical.
GRANT EXECUTE ON FUNCTION public.get_client_vertical(text) TO anon;
