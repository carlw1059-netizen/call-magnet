-- Session 4: rebrand.ly webhook infrastructure (dormant until Pro upgrade)
--
-- Builds the receiver-side plumbing now so when rebrand.ly upgrades to Pro,
-- tap data starts flowing immediately with zero code changes. Until that
-- upgrade, no webhook posts arrive (free tier doesn't fire webhooks).
--
-- Scope:
--   1. Extend public.link_clicks with rebrand.ly-specific columns
--   2. Add the missing FK on link_clicks.client_id (V1-era table never had one)
--   3. Add an index supporting per-client today/window queries (dashboard + email)
--   4. Add clients.rebrandly_link_id (lookup key for incoming webhooks)
--
-- Pre-existing state:
--   - link_clicks already exists (created out-of-band in V1, no prior migration)
--   - id is bigint (auto-increment) — kept as-is to avoid orphaning v_tap_rate
--     and existing tap rows; spec asked for uuid but the swap isn't worth it
--   - V1 columns kept untouched (customer_number, day_of_week, hour_of_day,
--     clicked_time, converted) — populated by get-booking-url, orthogonal to
--     rebrand.ly tracking
--   - RLS already enabled, no policies (service_role only) — matches spec
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, ADD CONSTRAINT IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS — safe to re-run.

-- ── 1. Extend link_clicks with rebrand.ly webhook fields ─────────────────────
ALTER TABLE link_clicks
  ADD COLUMN IF NOT EXISTS rebrand_id   text,
  ADD COLUMN IF NOT EXISTS device_type  text,
  ADD COLUMN IF NOT EXISTS country      text,
  ADD COLUMN IF NOT EXISTS city         text,
  ADD COLUMN IF NOT EXISTS referrer     text,
  ADD COLUMN IF NOT EXISTS user_agent   text,
  ADD COLUMN IF NOT EXISTS raw_payload  jsonb;

-- ── 2. Backfill missing FK on client_id ──────────────────────────────────────
-- V1 table predated migration discipline and never declared this FK. Verified
-- zero orphaned rows before migration, so the constraint adds without cleanup.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.link_clicks'::regclass
       AND conname  = 'link_clicks_client_id_fkey'
  ) THEN
    ALTER TABLE link_clicks
      ADD CONSTRAINT link_clicks_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 3. Index for dashboard and email per-client queries ──────────────────────
-- Ordered (client_id, clicked_at DESC) so PostgREST count queries scoped by
-- client_id and a clicked_at window can satisfy from the index.
CREATE INDEX IF NOT EXISTS link_clicks_client_clicked_idx
  ON link_clicks (client_id, clicked_at DESC);

-- ── 4. clients.rebrandly_link_id ─────────────────────────────────────────────
-- Stores the rebrand.ly link ID for each client. Incoming webhooks carry the
-- link ID in their payload; this column is the lookup key into clients.
-- Nullable: existing clients haven't had a rebrand.ly link generated yet.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS rebrandly_link_id text;
