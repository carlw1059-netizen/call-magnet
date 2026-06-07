-- Schedule weekly-summary edge function every Sunday 23:00 UTC
-- = Monday 9am AEST (UTC+10) / approximately Monday 9am AEDT (UTC+11 in summer)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-summary') THEN
    PERFORM cron.unschedule('weekly-summary');
  END IF;
  PERFORM cron.schedule(
    'weekly-summary',
    '0 23 * * 0',
    $cmd$
      SELECT net.http_post(
        url     := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/weekly-summary',
        body    := '{}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type',      'application/json',
          'X-Internal-Secret', COALESCE(
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'INTERNAL_SECRET' LIMIT 1),
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'PUSHOVER_INTERNAL_SECRET' LIMIT 1)
          )
        ),
        timeout_milliseconds := 300000
      );
    $cmd$
  );
END $$;
