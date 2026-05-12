-- Customizable customer SMS messages — per-client editable body, vertical-aware
-- defaults, plus 2-3 alternate example templates per vertical.
--
-- WHY:
--   Until now the customer-facing SMS was a single hardcoded Liquid template
--   in Twilio Studio. With this migration each client gets their own body,
--   editable at admin onboarding time. The mandatory tail " Reply STOP to
--   opt out" is appended at send time (NOT stored in this column) so the
--   compliance text can't be edited away.
--
-- WIRING:
--   1. Twilio Studio "Run Function" widget calls Twilio Function
--      `fetch-client-vertical` which calls `get_client_vertical()` RPC.
--   2. RPC is updated below to also return `customer_sms_template`.
--   3. Twilio Function returns it to Studio.
--   4. Studio "Send Message" widget Liquid template uses
--      `{{widgets.fetch_client.parsed.customer_sms_template}} Reply STOP to opt out`
--      Carl updates the Studio flow Liquid template manually (cloud-side).
--
-- COLUMNS:
--   clients.customer_sms_template       TEXT NOT NULL — editable body for this client
--   verticals.default_customer_sms      TEXT NOT NULL — pre-fill when this vertical picked
--   verticals.example_sms_templates     TEXT[]        — clickable alternates in admin form
--
-- [LINK] is a literal placeholder string. Admin form substitutes it with the
-- client's rebrandly URL when pre-filling the textarea. The stored row
-- typically has the URL baked in (no placeholder), but [LINK] survives
-- gracefully if it's never substituted.

-- ── verticals.default_customer_sms ──────────────────────────────────────────
ALTER TABLE public.verticals
  ADD COLUMN IF NOT EXISTS default_customer_sms text;

UPDATE public.verticals SET default_customer_sms =
  'Hi — sorry I missed your call. Reserve a table here: [LINK]'
WHERE vertical_key = 'restaurant';

UPDATE public.verticals SET default_customer_sms =
  'Hi mate — sorry I missed your call. Book a chair: [LINK]'
WHERE vertical_key = 'barber';

UPDATE public.verticals SET default_customer_sms =
  'Hi! Sorry I missed your call — book your appointment here: [LINK]'
WHERE vertical_key = 'hairdresser';

UPDATE public.verticals SET default_customer_sms =
  'Hi — sorry I missed your call. Click to book: [LINK]'
WHERE vertical_key = 'default';

ALTER TABLE public.verticals
  ALTER COLUMN default_customer_sms SET NOT NULL;

-- ── verticals.example_sms_templates ─────────────────────────────────────────
ALTER TABLE public.verticals
  ADD COLUMN IF NOT EXISTS example_sms_templates text[] NOT NULL DEFAULT '{}';

UPDATE public.verticals SET example_sms_templates = ARRAY[
  'Hi! Sorry we missed you. Book a table: [LINK]',
  'Hi — couldn''t reach the phone. Reserve here: [LINK]',
  'Hi! Sorry I missed your call. Tap to book: [LINK]'
] WHERE vertical_key = 'restaurant';

UPDATE public.verticals SET example_sms_templates = ARRAY[
  'G''day — couldn''t get to the phone. Book in: [LINK]',
  'Hi mate, sorry I missed you. Tap to book: [LINK]',
  'Hey — missed your call. Grab a slot: [LINK]'
] WHERE vertical_key = 'barber';

UPDATE public.verticals SET example_sms_templates = ARRAY[
  'Hi lovely — sorry I missed you! Book here: [LINK]',
  'Hi — sorry I missed your call. Tap to book your visit: [LINK]',
  'Hi! Couldn''t reach the phone — book your appointment: [LINK]'
] WHERE vertical_key = 'hairdresser';

UPDATE public.verticals SET example_sms_templates = ARRAY[
  'Hi! Sorry I missed your call. Reach out here: [LINK]',
  'Hi — couldn''t take your call. Tap for info: [LINK]',
  'Hi! Missed your call — get in touch: [LINK]'
] WHERE vertical_key = 'default';

-- ── clients.customer_sms_template ───────────────────────────────────────────
-- NOT NULL with default; existing rows backfilled from their vertical's default
-- (with [LINK] placeholder kept literal — Twilio Studio fallback path will
-- still work because the existing Liquid template doesn't yet reference this
-- column. Once Carl updates the Studio template, existing clients show the
-- placeholder until Carl edits each row, which is acceptable for a 1-client
-- (test) DB and 0 paying clients).
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS customer_sms_template text;

UPDATE public.clients c
   SET customer_sms_template = v.default_customer_sms
  FROM public.verticals v
 WHERE c.customer_sms_template IS NULL
   AND v.vertical_key = c.vertical;

UPDATE public.clients
   SET customer_sms_template = 'Hi — sorry I missed your call. Click to book: [LINK]'
 WHERE customer_sms_template IS NULL;

ALTER TABLE public.clients
  ALTER COLUMN customer_sms_template SET NOT NULL;

-- ── Update get_client_vertical RPC to return customer_sms_template ──────────
DROP FUNCTION IF EXISTS public.get_client_vertical(text);

CREATE OR REPLACE FUNCTION public.get_client_vertical(p_twilio_number text)
RETURNS TABLE(
  vertical               text,
  business_name          text,
  booking_url            text,
  customer_sms_template  text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT vertical, business_name, booking_url, customer_sms_template
  FROM clients
  WHERE twilio_number = p_twilio_number
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_vertical(text) TO anon;

NOTIFY pgrst, 'reload schema';
