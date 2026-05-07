-- Add ABN (Australian Business Number) column to clients table.
--
-- ABN is 11 digits, no spaces. Stored as text to preserve leading zeros
-- and avoid numeric overflow (though ABNs don't have leading zeros in practice,
-- text is the standard representation for identifier-type numbers).
--
-- The CHECK constraint enforces either NULL (not yet collected) or exactly
-- 11 characters. It does not validate the ABN checksum — that is left to
-- the application layer on collection. The constraint prevents obviously
-- wrong values (wrong length) from entering the database.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is safe to re-run.
-- The constraint uses DO $$ ... $$ with existence check for idempotency
-- because PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS syntax.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS abn text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clients_abn_check'
      AND conrelid = 'public.clients'::regclass
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT clients_abn_check
      CHECK (abn IS NULL OR length(abn) = 11);
  END IF;
END $$;

COMMENT ON COLUMN clients.abn IS
  'Australian Business Number: 11 digits, no spaces. NULL until collected.';
