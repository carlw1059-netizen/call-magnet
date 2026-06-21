-- Schedule notify-expiry edge function to run daily at 9am AEST (23:00 UTC).
--
-- dispatch_notify_expiry() pulls INTERNAL_SECRET from Postgres Vault and POSTs
-- to the notify-expiry edge function with X-Internal-Secret so the function
-- can authenticate the call.
--
-- Idempotent: unschedules existing 'notify-expiry' job if present, then
-- schedules fresh. Re-running this migration is safe.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE OR REPLACE FUNCTION dispatch_notify_expiry()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  internal_secret text;
BEGIN
  SELECT decrypted_secret INTO internal_secret
    FROM vault.decrypted_secrets
   WHERE name = 'INTERNAL_SECRET';

  IF internal_secret IS NULL THEN
    RAISE EXCEPTION
      'dispatch_notify_expiry: INTERNAL_SECRET not found in vault.decrypted_secrets. '
      'Seed the vault entry before this cron can fire.';
  END IF;

  PERFORM net.http_post(
    url     := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/notify-expiry',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'X-Internal-Secret', internal_secret
    ),
    body    := jsonb_build_object()
  );
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-expiry') THEN
    PERFORM cron.unschedule('notify-expiry');
  END IF;
END $$;

SELECT cron.schedule(
  'notify-expiry',
  '0 23 * * *',
  $$ SELECT dispatch_notify_expiry(); $$
);

-- Verification:
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'notify-expiry';
-- Expected: one row, schedule '0 23 * * *', active=true.
