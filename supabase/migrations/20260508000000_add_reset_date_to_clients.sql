-- Add reset_date to clients table.
-- Used by confirmReset() in the PWA to set a timestamp; loadStats() then uses it
-- as effectiveStart so counters only include events after the reset point.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS reset_date timestamptz;

COMMENT ON COLUMN clients.reset_date IS
  'Timestamp set when the client resets their stats counter. loadStats() uses this as the lower bound for all metric queries, so only events after this date are counted.';
