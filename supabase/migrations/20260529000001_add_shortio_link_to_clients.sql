-- Add shortio_link to clients.
--
-- middle_man_slug was already added in 20260524000002_middle_man_stage5.sql
-- (unique partial index, format check constraint). ADD COLUMN IF NOT EXISTS
-- here is a no-op for it — included for documentation completeness only.
--
-- shortio_link stores the Short.io short URL generated at onboarding
-- (e.g. 'https://cal.mg/brunswick-bistro'). The Twilio fetch-client-vertical
-- function prefers this over the raw booking_url when building the SMS link.
-- NULL until a Short.io link has been created for the client.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS middle_man_slug text,   -- already exists; no-op
  ADD COLUMN IF NOT EXISTS shortio_link    text;

COMMENT ON COLUMN public.clients.shortio_link IS
  'Short.io short URL pointing at the Middle Man landing page '
  '(e.g. "https://cal.mg/brunswick-bistro"). Generated at onboarding. '
  'Sent in SMS as the clickable link. NULL until Short.io link is created.';
