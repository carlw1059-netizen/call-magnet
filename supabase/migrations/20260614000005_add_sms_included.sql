ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS sms_included integer NOT NULL DEFAULT 50;
