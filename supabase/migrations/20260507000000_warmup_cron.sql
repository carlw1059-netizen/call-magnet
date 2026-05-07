-- Warmup cron: ping 6 critical edge functions every 5 minutes with ?warmup=1
-- so Deno isolates stay warm and cold-start latency doesn't affect real
-- missed-call and notification events.
--
-- Each function checks for the warmup query param at the very top of its
-- handler (before auth, before body parsing) and returns 200 {"warmup":"ok"}
-- immediately — zero business logic executes on warmup pings.
--
-- net.http_get timeout is 5 seconds; Supabase edge functions must respond
-- well within that window on warmup (they return instantly with no DB calls).
--
-- pg_cron and pg_net were already enabled by the monthly-report migration
-- (20260502010000). Repeating CREATE EXTENSION IF NOT EXISTS is idempotent.
--
-- Idempotent: each job is unscheduled-then-rescheduled inside a DO block.
-- Safe to re-run. Does NOT touch existing cron jobs (daily-summary-23-melbourne,
-- callmagnet-daily-summary, monthly-report).
--
-- Verification after apply:
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname LIKE 'warmup-%';
-- Expected: 6 rows, schedule '*/5 * * * *', active = true.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── twilio-missed-call ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'warmup-twilio-missed-call') THEN
    PERFORM cron.unschedule('warmup-twilio-missed-call');
  END IF;
END $$;

SELECT cron.schedule(
  'warmup-twilio-missed-call',
  '*/5 * * * *',
  $cmd$ SELECT net.http_get(
    url                  := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/twilio-missed-call?warmup=1',
    timeout_milliseconds := 5000
  ); $cmd$
);

-- ── send-client-notification ────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'warmup-send-client-notification') THEN
    PERFORM cron.unschedule('warmup-send-client-notification');
  END IF;
END $$;

SELECT cron.schedule(
  'warmup-send-client-notification',
  '*/5 * * * *',
  $cmd$ SELECT net.http_get(
    url                  := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/send-client-notification?warmup=1',
    timeout_milliseconds := 5000
  ); $cmd$
);

-- ── send-daily-summary ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'warmup-send-daily-summary') THEN
    PERFORM cron.unschedule('warmup-send-daily-summary');
  END IF;
END $$;

SELECT cron.schedule(
  'warmup-send-daily-summary',
  '*/5 * * * *',
  $cmd$ SELECT net.http_get(
    url                  := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/send-daily-summary?warmup=1',
    timeout_milliseconds := 5000
  ); $cmd$
);

-- ── monthly-report ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'warmup-monthly-report') THEN
    PERFORM cron.unschedule('warmup-monthly-report');
  END IF;
END $$;

SELECT cron.schedule(
  'warmup-monthly-report',
  '*/5 * * * *',
  $cmd$ SELECT net.http_get(
    url                  := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/monthly-report?warmup=1',
    timeout_milliseconds := 5000
  ); $cmd$
);

-- ── rebrandly-webhook ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'warmup-rebrandly-webhook') THEN
    PERFORM cron.unschedule('warmup-rebrandly-webhook');
  END IF;
END $$;

SELECT cron.schedule(
  'warmup-rebrandly-webhook',
  '*/5 * * * *',
  $cmd$ SELECT net.http_get(
    url                  := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/rebrandly-webhook?warmup=1',
    timeout_milliseconds := 5000
  ); $cmd$
);

-- ── send-pushover-alert ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'warmup-send-pushover-alert') THEN
    PERFORM cron.unschedule('warmup-send-pushover-alert');
  END IF;
END $$;

SELECT cron.schedule(
  'warmup-send-pushover-alert',
  '*/5 * * * *',
  $cmd$ SELECT net.http_get(
    url                  := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/send-pushover-alert?warmup=1',
    timeout_milliseconds := 5000
  ); $cmd$
);
