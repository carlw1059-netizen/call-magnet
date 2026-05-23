-- lock_reset_client_counter: revoke world-callable EXECUTE on the
-- reset_client_counter(uuid) RPC and restrict it to service_role only.
--
-- Background:
--   PostgreSQL grants EXECUTE to PUBLIC by default when a function is created.
--   This means any authenticated (or even anon) request can call
--   reset_client_counter(<any uuid>) directly via PostgREST/RPC, bypassing
--   the edge function that is supposed to gate this action. A malicious or
--   misconfigured client could silently reset another client's call counter.
--
-- What this migration does:
--   1. REVOKE EXECUTE from anon and authenticated — direct RPC calls will be
--      denied for all client-facing roles.
--   2. GRANT EXECUTE to service_role — edge functions (which Carl controls,
--      running with service_role credentials) remain fully functional.
--
-- service_role is not affected by RLS and always bypasses permission checks
-- imposed on lower-privileged roles, so no edge function needs modification.

-- ── 1. Revoke from client-facing roles ───────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.reset_client_counter(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reset_client_counter(uuid) FROM authenticated;

-- ── 2. Grant exclusively to service_role ─────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.reset_client_counter(uuid) TO service_role;
