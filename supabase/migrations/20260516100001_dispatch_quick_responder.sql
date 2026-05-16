-- Security fix: add authenticated cron dispatch for quick-responder.
--
-- quick-responder (slug: sms-overage) performs two nightly billing operations:
--   1. Reports SMS overage to Stripe billing meters per active client.
--   2. Finalises cancellations for clients 30+ days past their cancelled_at date.
--
-- Prior to this migration the edge function had no auth guard and accepted any
-- HTTP caller. This migration:
--   a. Adds dispatch_quick_responder() — reads INTERNAL_SECRET from Postgres
--      Vault and POSTs to the function with the X-Internal-Secret header, the
--      same pattern used by dispatch_daily_summary().
--   b. Unschedules any existing quick-responder cron (regardless of job name)
--      and replaces it with an authenticated schedule.
--
-- The edge function was updated in the same commit to require INTERNAL_SECRET.
--
-- Vault prerequisite (already present if daily-summary cron is working):
--   vault.secrets must contain a row with name = 'INTERNAL_SECRET'.
--   Verify: SELECT name FROM vault.secrets WHERE name = 'INTERNAL_SECRET';
--
-- Idempotent: CREATE OR REPLACE for the function; IF EXISTS guards on unschedule.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- ── dispatch function ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION dispatch_quick_responder()
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
      'dispatch_quick_responder: INTERNAL_SECRET not found in vault.decrypted_secrets. '
      'Seed the vault entry before this cron can fire.';
  END IF;

  PERFORM net.http_post(
    url     := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/quick-responder',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'X-Internal-Secret', internal_secret
    ),
    body    := jsonb_build_object()
  );
END;
$$;

-- ── (re)schedule the cron ─────────────────────────────────────────────────────
-- Unschedule under any plausible prior job names (set up manually in Dashboard).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'quick-responder-nightly') THEN
    PERFORM cron.unschedule('quick-responder-nightly');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sms-overage-nightly') THEN
    PERFORM cron.unschedule('sms-overage-nightly');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'quick-responder') THEN
    PERFORM cron.unschedule('quick-responder');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sms-overage') THEN
    PERFORM cron.unschedule('sms-overage');
  END IF;
END $$;

SELECT cron.schedule(
  'quick-responder-nightly',
  '0 0 * * *',
  $$ SELECT dispatch_quick_responder(); $$
);

-- Verification (read-only, after apply):
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'quick-responder-nightly';
-- Expected: one row, schedule '0 0 * * *', active = true.
