-- Batch 5: extend monitor_cron_health() to detect missing critical cron jobs.
--
-- Previously the function only reported FAILED run_details entries. A deleted
-- or never-created job produces no run_details rows and was completely invisible
-- to the health monitor — a silent gap in observability.
--
-- This migration adds a second check: compare cron.job against an expected list
-- and alert via Pushover if any job is absent.
--
-- ── Job name mapping (Batch 5 task spec → actual pg_cron names) ─────────────
--   Task spec name          Actual name (from migration)
--   'send-daily-summary-13' → 'daily-summary-23-melbourne'      (0 13 * * * UTC)
--   'send-daily-summary-12' → 'daily-summary-23-melbourne-aedt' (0 12 * * * UTC)
--   'dispatch-quick-responder' → 'quick-responder-nightly'      (0  0 * * * UTC)
--   'monitor-cron-health'   → 'monitor-cron-health'             (0 14 * * * UTC)
--   'warmup-twilio-missed-call' → 'warmup-twilio-missed-call'   (*/5 * * * *)
-- Plus the new warmup job added in the same batch:
--   'warmup-quick-responder'                                     (*/5 * * * *)
--
-- The names in the task spec didn't match the names the migrations actually
-- create (spec used UTC-hour suffixes; migrations use descriptive names).
-- Actual migration-created names are used here to avoid false-positive alerts
-- every run.
--
-- Combined behaviour: a single Pushover alert is sent if EITHER a job has
-- failed in the last 25 h OR a required job is absent from cron.job entirely.
-- The alert body separates both failure types clearly.
--
-- Idempotent: CREATE OR REPLACE for the function; cron unschedule-then-
-- reschedule so the updated function body takes effect immediately.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Updated function ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION monitor_cron_health()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  internal_secret   text;
  supabase_url      text;
  failed_jobs_text  text;
  missing_jobs_text text;
  alert_message     text;
BEGIN
  -- ── 1. Failed jobs in the last 25 hours ────────────────────────────────────
  SELECT string_agg(
    jobname || ' at ' || to_char(start_time AT TIME ZONE 'Australia/Melbourne', 'DD Mon HH24:MI'),
    E'\n'
    ORDER BY start_time DESC
  )
  INTO failed_jobs_text
  FROM cron.job_run_details
  WHERE status    = 'failed'
    AND start_time > now() - interval '25 hours';

  -- ── 2. Missing critical jobs ────────────────────────────────────────────────
  -- Any name absent from cron.job is a silent failure: the job never fires
  -- and produces no run_details rows, so the existing failed-jobs check is
  -- blind to it. This check catches deletions and botched initial deployments.
  SELECT string_agg(expected_job, E'\n' ORDER BY expected_job)
  INTO missing_jobs_text
  FROM (VALUES
    ('daily-summary-23-melbourne'),
    ('daily-summary-23-melbourne-aedt'),
    ('monitor-cron-health'),
    ('quick-responder-nightly'),
    ('warmup-quick-responder'),
    ('warmup-twilio-missed-call')
  ) AS t(expected_job)
  WHERE NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = t.expected_job
  );

  -- Nothing to report on either check — exit cleanly.
  IF failed_jobs_text IS NULL AND missing_jobs_text IS NULL THEN
    RETURN;
  END IF;

  -- Fetch INTERNAL_SECRET from Vault.
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

  -- Build combined alert message with clear section headers.
  alert_message := '';
  IF failed_jobs_text IS NOT NULL THEN
    alert_message := alert_message
      || 'FAILED jobs (last 25 h):' || E'\n'
      || failed_jobs_text;
  END IF;
  IF missing_jobs_text IS NOT NULL THEN
    IF alert_message <> '' THEN
      alert_message := alert_message || E'\n\n';
    END IF;
    alert_message := alert_message
      || 'MISSING jobs (not in cron.job):' || E'\n'
      || missing_jobs_text;
  END IF;

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

-- ── Reschedule so the updated function body takes effect immediately ─────────

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

-- Verification after apply:
--   SELECT jobid, jobname, schedule, active
--   FROM cron.job WHERE jobname = 'monitor-cron-health';
-- Expected: 1 row, schedule '0 14 * * *', active = true.
--
-- To test missing-jobs detection manually (read-only):
--   SELECT * FROM (VALUES
--     ('daily-summary-23-melbourne'),('daily-summary-23-melbourne-aedt'),
--     ('monitor-cron-health'),('quick-responder-nightly'),
--     ('warmup-quick-responder'),('warmup-twilio-missed-call')
--   ) AS t(j)
--   WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = t.j);
-- Expected: 0 rows (all jobs present).
