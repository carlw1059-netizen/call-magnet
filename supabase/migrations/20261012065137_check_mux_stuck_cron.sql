-- pg_cron: check-mux-stuck every 10 minutes.
-- Calls the check-mux-stuck edge function to alert via Pushover if any client's
-- video has been stuck in 'processing' for more than 10 minutes.
--
-- Auth: X-Internal-Secret header — same pattern as pushover_daily_summary_cron.
-- Secret read from Vault at fire-time (never in git history).
-- PREREQUISITE: vault entry named 'PUSHOVER_INTERNAL_SECRET' must exist.
--
-- Idempotent: unschedules existing job if present, then reschedules.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-mux-stuck') THEN
    PERFORM cron.unschedule('check-mux-stuck');
  END IF;

  PERFORM cron.schedule(
    'check-mux-stuck',
    '*/10 * * * *',
    $cmd$
      SELECT net.http_post(
        url     := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/check-mux-stuck',
        headers := jsonb_build_object(
          'Content-Type',      'application/json',
          'X-Internal-Secret', (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'PUSHOVER_INTERNAL_SECRET'
          )
        ),
        body    := '{}'::jsonb
      );
    $cmd$
  );
END $$;

-- Verification:
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'check-mux-stuck';
