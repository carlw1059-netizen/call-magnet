-- Switch off Day 14 / Day 30 email sequence cron (2026-09-30).
-- Edge function send-email-sequence and its data are kept.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-sequence-nightly') THEN
    PERFORM cron.unschedule('email-sequence-nightly');
  END IF;
END $$;
