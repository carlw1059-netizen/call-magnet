-- Add is_test_account flag to clients table; permanently unlock the test account.
--
-- Test accounts must never see suspension or cancellation banners. The frontend
-- checks this flag in addition to account_status / cancellation_scheduled to
-- short-circuit banner activation. Also useful for analytics that want to
-- exclude internal test traffic from real-client metrics.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, the UPDATE is naturally idempotent,
-- and CREATE INDEX IF NOT EXISTS makes the index safe to re-run.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS is_test_account boolean NOT NULL DEFAULT false;

-- Test client (Test Business): mark as test, force-active, clear any
-- pending cancellation. Columns referenced match production schema:
--   account_status text CHECK ('active','suspended','cancelled')
--   cancellation_scheduled boolean
--   cancelled_at timestamptz
UPDATE clients
SET
  is_test_account        = true,
  account_status         = 'active',
  cancellation_scheduled = false,
  cancelled_at           = NULL
WHERE id = 'd508dde9-8f10-464b-b41b-7d84b0eaa907';

-- Partial index for analytics that filter out test accounts.
CREATE INDEX IF NOT EXISTS idx_clients_is_test_account
  ON clients(is_test_account)
  WHERE is_test_account = true;
