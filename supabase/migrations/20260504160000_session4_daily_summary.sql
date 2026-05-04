-- Session 4: 11pm daily summary email
-- Adds:
--   - daily_summary_runs table (one row per client per Melbourne calendar day)
--   - dispatch_daily_summary() function — pulls INTERNAL_SECRET from
--     Postgres Vault and POSTs to the send-daily-summary edge function
--   - pg_cron schedule that runs the dispatcher once daily
--
-- DST caveat: the cron runs at 13:00 UTC, which is 23:00 Melbourne in winter
-- (AEST UTC+10) but 00:00 Melbourne in summer (AEDT UTC+11). When AEDT
-- begins (typically first Sunday of October), the daily summary will fire
-- at 00:00 Melbourne local and the "past 24 hours" window will shift by an
-- hour. A future migration should switch to the self-gating pattern used
-- by fire_daily_summary (hourly cron + an EXTRACT(HOUR FROM ... AT TIME
-- ZONE 'Australia/Melbourne') = 23 self-check inside the function) to
-- remove this drift entirely. Documented and explicitly accepted for now.
--
-- Security model: daily_summary_runs is service_role only — RLS enabled
-- with no policies, matching push_subscriptions.
--
-- Idempotent: safe to re-run. CREATE TABLE / FUNCTION use IF NOT EXISTS /
-- CREATE OR REPLACE; the cron job is unscheduled-then-rescheduled inside
-- a DO block.

CREATE TABLE IF NOT EXISTS daily_summary_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  summary_date             date NOT NULL,
  missed_calls_count       int  NOT NULL DEFAULT 0,
  sms_sent_count           int  NOT NULL DEFAULT 0,
  estimated_bookings_low   int  NOT NULL DEFAULT 0,
  estimated_bookings_high  int  NOT NULL DEFAULT 0,
  estimated_revenue_low    numeric NOT NULL DEFAULT 0,
  estimated_revenue_high   numeric NOT NULL DEFAULT 0,
  email_sent               boolean NOT NULL DEFAULT false,
  sent_at                  timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, summary_date)
);

ALTER TABLE daily_summary_runs ENABLE ROW LEVEL SECURITY;

-- The pg_cron worker that wakes daily at 23:00 Melbourne. Pulls the shared
-- secret from Postgres Vault and POSTs to send-daily-summary, which does
-- the heavy lifting (per-client iteration, count queries, Resend dispatch).
CREATE OR REPLACE FUNCTION dispatch_daily_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  internal_secret text;
BEGIN
  -- Prefer the canonical INTERNAL_SECRET; fall back to legacy
  -- PUSHOVER_INTERNAL_SECRET while both Vault entries coexist.
  SELECT decrypted_secret INTO internal_secret
    FROM vault.decrypted_secrets
   WHERE name = 'INTERNAL_SECRET';

  IF internal_secret IS NULL THEN
    SELECT decrypted_secret INTO internal_secret
      FROM vault.decrypted_secrets
     WHERE name = 'PUSHOVER_INTERNAL_SECRET';
  END IF;

  IF internal_secret IS NULL THEN
    RAISE EXCEPTION
      'dispatch_daily_summary: neither INTERNAL_SECRET nor PUSHOVER_INTERNAL_SECRET found in vault.decrypted_secrets. '
      'Seed the vault entry before this cron can fire.';
  END IF;

  PERFORM net.http_post(
    url     := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/send-daily-summary',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'X-Internal-Secret', internal_secret
    ),
    body    := jsonb_build_object()
  );
END;
$$;

-- (Re)schedule the cron job idempotently.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-summary-23-melbourne') THEN
    PERFORM cron.unschedule('daily-summary-23-melbourne');
  END IF;
END $$;

SELECT cron.schedule(
  'daily-summary-23-melbourne',
  '0 13 * * *',
  $$ SELECT dispatch_daily_summary(); $$
);
