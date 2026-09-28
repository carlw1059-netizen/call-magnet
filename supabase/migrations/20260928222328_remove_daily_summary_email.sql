-- Switch off daily summary email crons (2026-09-29).
-- Weekly summary replaces the daily summary. Code and daily_summary_runs table are kept.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-summary-23-melbourne') THEN
    PERFORM cron.unschedule('daily-summary-23-melbourne');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-summary-23-melbourne-aedt') THEN
    PERFORM cron.unschedule('daily-summary-23-melbourne-aedt');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'warmup-send-daily-summary') THEN
    PERFORM cron.unschedule('warmup-send-daily-summary');
  END IF;
END $$;

-- Remove daily-summary jobs from the expected-jobs list in monitor_cron_health().
CREATE OR REPLACE FUNCTION public.monitor_cron_health()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  internal_secret       text;
  supabase_url          text;
  failed_jobs_text      text;
  missing_jobs_text     text;
  monthly_report_alert  text;
  weekly_summary_alert  text;
  alert_message         text;
  v_monthly_period      date;
  v_monthly_period_txt  text;
  v_monthly_count       int;
  v_weekly_period       date;
  v_weekly_period_txt   text;
  v_weekly_count        int;
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
  SELECT string_agg(expected_job, E'\n' ORDER BY expected_job)
  INTO missing_jobs_text
  FROM (VALUES
    ('monitor-cron-health'),
    ('quick-responder-nightly'),
    ('warmup-quick-responder'),
    ('warmup-twilio-missed-call')
  ) AS t(expected_job)
  WHERE NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = t.expected_job
  );

  -- ── 3. Monthly report sentinel ──────────────────────────────────────────────
  IF EXTRACT(DAY FROM now()) = 2 THEN
    v_monthly_period     := date_trunc('month', now() - interval '1 month')::date;
    v_monthly_period_txt := to_char(v_monthly_period, 'YYYY-MM-01');

    SELECT COUNT(*) INTO v_monthly_count
    FROM public.monthly_reports
    WHERE period_month = v_monthly_period;

    IF v_monthly_count = 0 THEN
      monthly_report_alert :=
        'MONTHLY REPORT: No rows found in monthly_reports for '
        || v_monthly_period_txt
        || ' — monthly-report cron may have 401d silently.';
    END IF;
  END IF;

  -- ── 4. Weekly summary sentinel ──────────────────────────────────────────────
  IF EXTRACT(DOW FROM now()) = 1 THEN
    v_weekly_period     := date_trunc('week', now() - interval '1 week')::date;
    v_weekly_period_txt := to_char(v_weekly_period, 'YYYY-MM-DD');

    SELECT COUNT(*) INTO v_weekly_count
    FROM public.weekly_summaries
    WHERE period_week = v_weekly_period;

    IF v_weekly_count = 0 THEN
      weekly_summary_alert :=
        'WEEKLY SUMMARY: No rows found in weekly_summaries for '
        || v_weekly_period_txt
        || ' — weekly-summary cron may have 401d silently.';
    END IF;
  END IF;

  -- Nothing to report on any check — exit cleanly.
  IF failed_jobs_text IS NULL AND missing_jobs_text IS NULL
     AND monthly_report_alert IS NULL AND weekly_summary_alert IS NULL THEN
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
    IF alert_message <> '' THEN alert_message := alert_message || E'\n\n'; END IF;
    alert_message := alert_message
      || 'MISSING jobs (not in cron.job):' || E'\n'
      || missing_jobs_text;
  END IF;
  IF monthly_report_alert IS NOT NULL THEN
    IF alert_message <> '' THEN alert_message := alert_message || E'\n\n'; END IF;
    alert_message := alert_message || monthly_report_alert;
  END IF;
  IF weekly_summary_alert IS NOT NULL THEN
    IF alert_message <> '' THEN alert_message := alert_message || E'\n\n'; END IF;
    alert_message := alert_message || weekly_summary_alert;
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
$function$;
