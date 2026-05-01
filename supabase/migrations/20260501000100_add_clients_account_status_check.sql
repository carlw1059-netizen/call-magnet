-- Session 2: schema-drift recovery.
-- Documents the CHECK constraint that was manually applied via the Supabase
-- SQL Editor on 2026-05-01. Idempotent: a no-op when the constraint already
-- exists (production), correctly applied on a fresh dev database.
-- Going forward, all schema changes go through migration files — no exceptions.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname  = 'clients_account_status_check'
      AND conrelid = 'public.clients'::regclass
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_account_status_check
      CHECK (account_status IN ('active', 'suspended', 'cancelled'));
  END IF;
END $$;
