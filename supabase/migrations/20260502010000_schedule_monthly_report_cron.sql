-- Session 2 — Chunk E — pg_cron schedule for monthly-report.
-- Fires the monthly-report edge function once per month and passes the first
-- of the previous Melbourne calendar month as `period_month` in the body.
--
-- ⚠️ TIMEZONE NOTE ⚠️
-- Standard pg_cron does not accept a per-job timezone parameter. This schedule
-- is in UTC and approximates 9am Melbourne on the 1st by firing at 22:00 UTC
-- on the 1st of each UTC month, which becomes:
--   = 09:00 Melbourne on the 2nd (AEDT, Oct–Apr)
--   = 08:00 Melbourne on the 2nd (AEST, Apr–Oct)
-- The function's getMelbournePreviousMonth(now) still resolves to the correct
-- "month that just ended" — the report content is unaffected by the ~24h delay.
-- For exact 9am-day-1 firing, configure cron.timezone='Australia/Melbourne'
-- in Studio's Database Configuration and change the schedule to '0 9 1 * *'.
--
-- ⚠️ VAULT-STORED SERVICE-ROLE KEY ⚠️
-- This migration reads the service-role JWT from Supabase Vault at cron-firing
-- time. The secret is NEVER in this file. One-time setup before the FIRST
-- cron firing (run in Studio SQL Editor):
--   INSERT INTO vault.secrets (name, secret)
--   VALUES ('service_role_key', '<paste service-role JWT>')
--   ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret;
-- Verify with:
--   SELECT name FROM vault.secrets WHERE name = 'service_role_key';
--
-- This migration's APPLY succeeds regardless of Vault state (cron.schedule
-- stores the command as a string — the SELECT runs at fire-time, not at
-- registration). But actual firing on June 1 requires Vault to be populated.
--
-- Idempotent: unschedules an existing 'monthly-report' job if present, then
-- schedules fresh. Re-running this migration is safe.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monthly-report') THEN
    PERFORM cron.unschedule('monthly-report');
  END IF;

  PERFORM cron.schedule(
    'monthly-report',
    '0 22 1 * *',
    $cmd$
      SELECT net.http_post(
        url     := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/monthly-report',
        body    := jsonb_build_object(
          'period_month',
          (date_trunc('month', now() AT TIME ZONE 'Australia/Melbourne') - INTERVAL '1 month')::date
        ),
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'service_role_key'
          )
        ),
        timeout_milliseconds := 300000
      );
    $cmd$
  );
END $$;

-- Verification (read-only, after apply):
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'monthly-report';
-- Expected: one row, schedule '0 22 1 * *', active=true.
