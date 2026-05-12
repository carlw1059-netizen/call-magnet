-- Add owner_phone to clients — the OWNER'S personal mobile, distinct from
-- twilio_number (the business's leased Twilio inbound number).
--
-- Used for:
--   1. SMS-delivered magic-link login (request-login-link edge function
--      looks up auth user by owner_phone → generates magic link → sends via Twilio)
--   2. SMS-delivered welcome login link on admin onboarding (create-client
--      edge function)
--
-- Nullable so existing client rows don't break. New clients (via create-client)
-- always populate it. Indexed because login lookups query by this column.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS owner_phone text;

CREATE INDEX IF NOT EXISTS clients_owner_phone_idx
  ON public.clients (owner_phone)
  WHERE owner_phone IS NOT NULL;

NOTIFY pgrst, 'reload schema';
