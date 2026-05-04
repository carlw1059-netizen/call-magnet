-- Session 4 sub-migration: widen clients.vertical CHECK constraint to
-- include 'hairdresser' and 'tradie'. The original CHECK from migration
-- 20260504140000 (Session 3 Phase 1) only allowed 'barber', 'restaurant',
-- and 'default'. send-daily-summary now ships per-vertical revenue
-- estimates for hairdresser and tradie too — without this widening, no
-- client could ever be set to those values, so the new revenue branches
-- would never fire.
--
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so this DO block emulates
-- it: drop the old constraint by name (auto-named clients_vertical_check
-- by the original inline ADD COLUMN ... CHECK ...), then add the wider
-- version. Idempotent — re-running drops + re-adds with the same shape.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clients_vertical_check'
      AND conrelid = 'public.clients'::regclass
  ) THEN
    ALTER TABLE clients DROP CONSTRAINT clients_vertical_check;
  END IF;

  ALTER TABLE clients
    ADD CONSTRAINT clients_vertical_check
    CHECK (vertical IN ('barber', 'restaurant', 'hairdresser', 'tradie', 'default'));
END $$;
