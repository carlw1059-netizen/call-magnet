-- Session 4 cleanup: modernize monthly-report cron to use the X-Internal-Secret
-- header instead of Bearer SUPABASE_SERVICE_ROLE_KEY. Fixes the silent 401s
-- caused by Postgres-Vault drift against the now-deprecated, system-managed
-- Edge Functions Vault SUPABASE_SERVICE_ROLE_KEY env var. Aligns with the
-- INTERNAL_SECRET pattern used by send-pushover-alert /
-- save-push-subscription / send-client-notification / send-daily-summary.
--
-- Schedule unchanged: '0 22 1 * *' (22:00 UTC on day 1 = ~8-9am Melbourne
-- on day 2). The function's getMelbournePreviousMonth(now) still resolves
-- the previous Melbourne calendar month correctly — the slight delay is
-- intentional, documented in the original 20260502010000 migration.
--
-- Body unchanged: explicit period_month override so the cron-time period
-- selection is deterministic and idempotent across re-fires.
--
-- Headers CHANGED: drop Authorization Bearer (was reading
-- vault.decrypted_secrets WHERE name='service_role_key' which had drifted
-- from the live env var). Replace with X-Internal-Secret pulled from the
-- INTERNAL_SECRET vault entry, with PUSHOVER_INTERNAL_SECRET fallback
-- while both names coexist. COALESCE handles the rolling-rename safety net
-- in one expression.
--
-- PREREQUISITE: the function-side change (monthly-report reads
-- X-Internal-Secret instead of Bearer SUPABASE_SERVICE_ROLE_KEY) must be
-- deployed BEFORE this migration is applied, otherwise the cron will fire
-- with the new header but the old function will 401.
--
-- Idempotent: unschedules existing 'monthly-report' job, reschedules fresh.

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
          'Content-Type',      'application/json',
          'X-Internal-Secret', COALESCE(
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'INTERNAL_SECRET'         LIMIT 1),
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'PUSHOVER_INTERNAL_SECRET' LIMIT 1)
          )
        ),
        timeout_milliseconds := 300000
      );
    $cmd$
  );
END $$;

-- Verification (read-only, after apply):
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'monthly-report';
-- Expected: schedule unchanged, command shows X-Internal-Secret + COALESCE
-- against INTERNAL_SECRET / PUSHOVER_INTERNAL_SECRET (no Bearer).
