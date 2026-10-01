-- Fix get_client_vertical to also match twilio_number_2.
-- Callers on a client's second number were hitting the FALLBACK in
-- fetch-client-vertical.js (no link, generic text) because the WHERE
-- clause only tested twilio_number. After-hours calls always go to
-- twilio_number_2, so this was silently broken for every schedule-enabled client.
--
-- Changes from live definition:
--   WHERE clause: adds OR twilio_number_2 = p_twilio_number
--   ORDER BY: (twilio_number = p_twilio_number) DESC so Line 1 wins on overlap
-- Everything else (return columns, SECURITY DEFINER, search_path, GRANT, NOTIFY) unchanged.

CREATE OR REPLACE FUNCTION public.get_client_vertical(p_twilio_number text)
RETURNS TABLE(
  vertical              text,
  business_name         text,
  booking_url           text,
  customer_sms_template text,
  middle_man_slug       text,
  middle_man_enabled    boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT vertical, business_name, booking_url, customer_sms_template, middle_man_slug, middle_man_enabled
  FROM clients
  WHERE (twilio_number = p_twilio_number OR twilio_number_2 = p_twilio_number)
    AND account_status = 'active'
  ORDER BY (twilio_number = p_twilio_number) DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_vertical(text) TO anon;

NOTIFY pgrst, 'reload schema';
