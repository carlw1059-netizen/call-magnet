-- Update get_client_vertical() to return shortio_link and middle_man_slug.
--
-- WHY:
--   fetch-client-vertical.js (Twilio Serverless Function) needs these two
--   columns to build the SMS link fallback chain:
--     1. shortio_link         — prefer Short.io link (tracking + brevity)
--     2. middle_man_slug      — if no Short.io link, build callmagnet.com.au/b/<slug>
--     3. booking_url          — last resort (raw Fresha / OpenTable URL)
--
-- All existing columns are preserved unchanged. SECURITY DEFINER,
-- search_path, and GRANT EXECUTE TO anon are all kept.
--
-- Prior definitions (for history):
--   20260506140000 — original (vertical, business_name, booking_url)
--   20260512110000 — added customer_sms_template
--   20260522000001 — added account_status = 'active' WHERE clause
--   (this migration) — adds shortio_link, middle_man_slug

DROP FUNCTION IF EXISTS public.get_client_vertical(text);

CREATE OR REPLACE FUNCTION public.get_client_vertical(p_twilio_number text)
RETURNS TABLE(
  vertical               text,
  business_name          text,
  booking_url            text,
  customer_sms_template  text,
  shortio_link           text,
  middle_man_slug        text
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
    middle_man_slug
  FROM clients
  WHERE twilio_number    = p_twilio_number
    AND account_status   = 'active'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_vertical(text) TO anon;

NOTIFY pgrst, 'reload schema';
