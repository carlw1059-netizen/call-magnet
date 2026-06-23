-- Fix monthly-report cron: replace Authorization: Bearer <service_role_key>
-- with X-Internal-Secret header, which is what monthly-report/index.ts checks.
-- The old cron was firing with the wrong auth and returning 401 on every run.
--
-- The existing job is named 'monthly-report' (set by 20260502010000_schedule_monthly_report_cron.sql).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monthly-report') THEN
    PERFORM cron.unschedule('monthly-report');
  END IF;
END $$;

SELECT cron.schedule(
  'monthly-report',
  '0 22 1 * *',
  $$
  DO $body$
  DECLARE
    v_secret TEXT;
    v_period TEXT;
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'INTERNAL_SECRET'
    LIMIT 1;

    v_period := to_char(
      date_trunc('month', now() AT TIME ZONE 'Australia/Melbourne') - interval '1 month',
      'YYYY-MM-01'
    );

    PERFORM net.http_post(
      url := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/monthly-report',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Internal-Secret', v_secret
      ),
      body := jsonb_build_object('period_month', v_period)
    );
  END;
  $body$ LANGUAGE plpgsql;
  $$
);
