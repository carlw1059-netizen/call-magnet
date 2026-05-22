-- Full cancellation flow infrastructure
--
-- 1. clients.stripe_subscription_id TEXT — stored on first
--    invoice.payment_succeeded so submit-cancellation can call Stripe's
--    cancel_at_period_end API without hitting the Dashboard.
--
-- 2. cancellation_reasons table — records why each client cancelled.
--    Inserted by submit-cancellation (self-service) and admin-cancel-client
--    (admin override). RLS: clients INSERT their own row only; service role
--    can see all.
--
-- 3. get_client_vertical RPC — adds AND account_status = 'active' filter.
--    Without this, cancelled clients whose Twilio number is still registered
--    continue receiving the full SMS-send flow after their subscription ends.
--    The RPC is called by the fetch-client-vertical Twilio Serverless Function.

-- ── 1. clients.stripe_subscription_id ───────────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

-- ── 2. cancellation_reasons ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cancellation_reasons (
  id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id     uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  reason_key    text        NOT NULL,
  reason_detail text,
  cancelled_by  text        NOT NULL DEFAULT 'client', -- 'client' | 'admin'
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cancellation_reasons ENABLE ROW LEVEL SECURITY;

-- Clients may insert only their own row (used by cancel.html → submit-cancellation).
-- Reads are service-role only; clients have no need to re-read their exit reason.
CREATE POLICY "Clients insert own cancellation reason"
  ON public.cancellation_reasons
  FOR INSERT TO authenticated
  WITH CHECK (client_id = (SELECT id FROM public.clients WHERE email = auth.email()));

-- ── 3. get_client_vertical: add account_status = 'active' filter ─────────────
-- Drop and recreate (function signature is unchanged — only WHERE clause changes).
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
    AND account_status = 'active'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_vertical(text) TO anon;

NOTIFY pgrst, 'reload schema';
