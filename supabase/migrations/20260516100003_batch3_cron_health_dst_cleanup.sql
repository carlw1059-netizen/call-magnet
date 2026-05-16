-- Batch 3: Cron health monitoring, DST self-gate for daily summary,
-- warmup for twilio-sms-status, and legacy column cleanup.
--
-- Fix 1: monitor_cron_health() + pg_cron schedule
--   Queries cron.job_run_details for failures in the last 25 hours.
--   If any found, fires a Pushover alert via pg_net. Runs at 14:00 UTC
--   (midnight Melbourne AEST / 1am Melbourne AEDT — 1 hour after daily summary).
--
-- Fix 2: warmup-twilio-sms-status added to 5-minute warmup schedule.
--
-- Fix 3: Second daily-summary dispatch at 12:00 UTC (= 23:00 Melbourne AEDT).
--   The self-gate inside send-daily-summary ensures only the correctly-timed
--   firing actually processes (hour check via Intl in the edge function).
--
-- Fix 4: DROP legacy preference columns no longer referenced in any code.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, ADD COLUMN IF NOT EXISTS (none here),
-- DROP COLUMN IF EXISTS, cron unschedule-then-reschedule pattern.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── FIX 1: cron health monitor ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION monitor_cron_health()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  internal_secret  text;
  supabase_url     text;
  failed_jobs_text text;
  alert_message    text;
BEGIN
  -- Build list of failed cron jobs in the last 25 hours.
  SELECT string_agg(
    jobname || ' at ' || to_char(start_time AT TIME ZONE 'Australia/Melbourne', 'DD Mon HH24:MI'),
    E'\n'
    ORDER BY start_time DESC
  )
  INTO failed_jobs_text
  FROM cron.job_run_details
  WHERE status    = 'failed'
    AND start_time > now() - interval '25 hours';

  -- Nothing to report — exit cleanly.
  IF failed_jobs_text IS NULL THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO internal_secret
    FROM vault.decrypted_secrets
   WHERE name = 'INTERNAL_SECRET'
   LIMIT 1;

  IF internal_secret IS NULL THEN
    RAISE WARNING 'monitor_cron_health: INTERNAL_SECRET not found in vault — cannot send alert';
    RETURN;
  END IF;

  -- Use app.supabase_url if set, fall back to hardcoded project URL.
  supabase_url := current_setting('app.supabase_url', true);
  IF supabase_url IS NULL OR supabase_url = '' THEN
    supabase_url := 'https://iskvvnhacqdxybpmwuni.supabase.co';
  END IF;

  alert_message := 'Failed cron jobs (last 25 h):' || E'\n' || failed_jobs_text;

  PERFORM net.http_post(
    url     := supabase_url || '/functions/v1/send-pushover-alert',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'X-Internal-Secret', internal_secret
    ),
    body    := jsonb_build_object(
      'title',    'CallMagnet: Cron Health Alert',
      'message',  alert_message,
      'priority', 1
    )
  );
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monitor-cron-health') THEN
    PERFORM cron.unschedule('monitor-cron-health');
  END IF;
END $$;

SELECT cron.schedule(
  'monitor-cron-health',
  '0 14 * * *',
  $$ SELECT monitor_cron_health(); $$
);

-- ── FIX 2: warmup — twilio-sms-status ────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'warmup-twilio-sms-status') THEN
    PERFORM cron.unschedule('warmup-twilio-sms-status');
  END IF;
END $$;

SELECT cron.schedule(
  'warmup-twilio-sms-status',
  '*/5 * * * *',
  $cmd$ SELECT net.http_get(
    url                  := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/twilio-sms-status?warmup=1',
    timeout_milliseconds := 5000
  ); $cmd$
);

-- ── FIX 3: second daily-summary dispatch for AEDT ────────────────────────────
-- 12:00 UTC = 23:00 Melbourne AEDT (UTC+11, summer).
-- 13:00 UTC = 23:00 Melbourne AEST (UTC+10, winter) — existing job unchanged.
-- The DST self-gate inside send-daily-summary blocks the wrong firing each night.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-summary-23-melbourne-aedt') THEN
    PERFORM cron.unschedule('daily-summary-23-melbourne-aedt');
  END IF;
END $$;

SELECT cron.schedule(
  'daily-summary-23-melbourne-aedt',
  '0 12 * * *',
  $$ SELECT dispatch_daily_summary(); $$
);

-- ── FIX 4: drop legacy preference columns ────────────────────────────────────

ALTER TABLE public.clients
  DROP COLUMN IF EXISTS accent_preference,
  DROP COLUMN IF EXISTS bg_preference;
