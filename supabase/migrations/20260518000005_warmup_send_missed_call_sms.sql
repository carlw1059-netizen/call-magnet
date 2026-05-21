-- Warmup cron for send-missed-call-sms.
--
-- send-missed-call-sms is called on every missed call via Twilio Studio's
-- HTTP widget. It is latency-sensitive — a cold-start adds 300–500 ms before
-- the Twilio API call even begins. This job keeps the isolate warm on the
-- same 5-minute schedule as all other critical functions.
--
-- The function already handles ?warmup=1 (returns {"warmup":"ok"} immediately,
-- before any Twilio API or DB calls).
--
-- verify_jwt = false is set in config.toml so the gateway passes the GET
-- request through without a JWT.
--
-- Idempotent: unschedule-then-reschedule inside a DO block.
--
-- Verification after apply:
--   SELECT jobid, jobname, schedule, active
--   FROM cron.job WHERE jobname = 'warmup-send-missed-call-sms';
-- Expected: 1 row, schedule '*/5 * * * *', active = true.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'warmup-send-missed-call-sms') THEN
    PERFORM cron.unschedule('warmup-send-missed-call-sms');
  END IF;
END $$;

SELECT cron.schedule(
  'warmup-send-missed-call-sms',
  '*/5 * * * *',
  $cmd$ SELECT net.http_get(
    url                  := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/send-missed-call-sms?warmup=1',
    timeout_milliseconds := 5000
  ); $cmd$
);
