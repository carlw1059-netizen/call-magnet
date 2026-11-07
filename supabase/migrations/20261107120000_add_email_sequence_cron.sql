-- Re-enable Day 14 / Day 30 email sequence cron (2026-11-07).
-- Was removed 2026-09-30 in _remove_email_sequence_cron.sql.
-- Runs weekly Monday 11am AEDT (00:00 UTC Monday).

SELECT cron.schedule(
  'email-sequence-nightly',
  '0 0 * * 1',
  $$
  DO $body$
  DECLARE
    v_secret TEXT;
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'INTERNAL_SECRET'
    LIMIT 1;

    PERFORM net.http_post(
      url     := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/SEND-EMAIL-SEQUENCE',
      body    := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type',      'application/json',
        'X-Internal-Secret', v_secret
      ),
      timeout_milliseconds := 300000
    );
  END;
  $body$ LANGUAGE plpgsql;
  $$
);
