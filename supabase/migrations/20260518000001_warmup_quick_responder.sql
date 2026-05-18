-- Batch 5: add 5-minute warmup cron for quick-responder.
--
-- quick-responder (slug: sms-overage) runs nightly via dispatch_quick_responder()
-- at 00:00 UTC. Between the nightly firing and the warmup cycle the Deno
-- isolate can still be evicted (Supabase evicts idle isolates after ~5 min).
-- A warmup-quick-responder job keeps the isolate hot on the same schedule as
-- all other critical functions (*/5 * * * *).
--
-- quick-responder already handles ?warmup=1 at the top of its handler —
-- the function returns {"warmup":"ok"} before any auth checks or DB calls.
--
-- config.toml must have [functions.quick-responder] verify_jwt = false so
-- the gateway passes the GET ?warmup=1 request through without a JWT.
-- That entry was added in the same Batch 5 commit.
--
-- Idempotent: unschedule-then-reschedule inside a DO block.
--
-- Verification after apply:
--   SELECT jobid, jobname, schedule, active
--   FROM cron.job WHERE jobname = 'warmup-quick-responder';
-- Expected: 1 row, schedule '*/5 * * * *', active = true.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'warmup-quick-responder') THEN
    PERFORM cron.unschedule('warmup-quick-responder');
  END IF;
END $$;

SELECT cron.schedule(
  'warmup-quick-responder',
  '*/5 * * * *',
  $cmd$ SELECT net.http_get(
    url                  := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/quick-responder?warmup=1',
    timeout_milliseconds := 5000
  ); $cmd$
);
