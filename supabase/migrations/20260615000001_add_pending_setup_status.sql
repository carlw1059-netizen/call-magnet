-- Add pending_setup as a valid account_status (used after setup fee paid, before Carl activates subscription)
ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_account_status_check;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_account_status_check
  CHECK (account_status IN ('active', 'suspended', 'cancelled', 'pending_payment', 'pending_setup'));
