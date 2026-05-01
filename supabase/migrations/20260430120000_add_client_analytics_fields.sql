-- Session 2: analytics layer — additive columns on `clients` for benchmarking views.
-- Live pipeline tables (sms_events, link_clicks, bookings) are not touched.
-- Idempotent: safe to re-run.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS suburb   text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS postcode text;
