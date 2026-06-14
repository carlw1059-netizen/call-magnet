-- Allow pending_payment as a valid account_status (used during payment-first onboarding)
ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_account_status_check;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_account_status_check
  CHECK (account_status IN ('active', 'suspended', 'cancelled', 'pending_payment'));
