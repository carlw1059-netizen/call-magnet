-- Add middle_man_enabled to get_client_vertical() RPC.
--
-- WHY:
--   fetch-client-vertical.js must gate the Middle Man slug/shortio URL on
--   whether Middle Man is actually enabled for the client. Without this field,
--   a client with a slug but Middle Man OFF would still receive a /b/<slug>
--   link in their SMS, which would 404 (anon RLS blocks disabled clients).
--
-- All existing columns preserved. SECURITY DEFINER, search_path, GRANT anon kept.
--
-- Prior definitions (for history):
--   20260506140000 — original (vertical, business_name, booking_url)
--   20260512110000 — added customer_sms_template
--   20260522000001 — added account_status = 'active' WHERE clause
--   20260529000002 — added shortio_link, middle_man_slug
--   (this migration) — adds middle_man_enabled

DROP FUNCTION IF EXISTS public.get_client_vertical(text);

CREATE OR REPLACE FUNCTION public.get_client_vertical(p_twilio_number text)
RETURNS TABLE(
  vertical               text,
  business_name          text,
  booking_url            text,
  customer_sms_template  text,
  shortio_link           text,
  middle_man_slug        text,
  middle_man_enabled     boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    vertical,
    business_name,
    booking_url,
    customer_sms_template,
    shortio_link,
    middle_man_slug,
    middle_man_enabled
  FROM clients
  WHERE twilio_number    = p_twilio_number
    AND account_status   = 'active'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_vertical(text) TO anon;

NOTIFY pgrst, 'reload schema';
