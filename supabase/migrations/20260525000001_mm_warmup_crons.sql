-- mm_warmup_crons: keep submit-middle-man-form and log-middle-man-tap warm.
--
-- Both functions are customer-facing (called from /b/<slug> in the browser)
-- and latency-sensitive. Without a warmup cron the Deno isolate is evicted
-- after ~5 minutes of idle, adding 300–500 ms cold-start penalty on the
-- first real customer request.
--
-- Both functions already handle ?warmup=1 at the very top of their handlers
-- (before auth, DB calls, or any business logic) and return 200 {"warmup":"ok"}
-- immediately. verify_jwt = false is set in config.toml for both functions so
-- the gateway passes the GET request through without a JWT.
--
-- Idempotent: cron.schedule() overwrites an existing job of the same name.
-- Safe to re-run.
--
-- Verification after apply:
--   SELECT jobname, schedule FROM cron.job
--   WHERE jobname IN ('warmup-submit-middle-man-form','warmup-log-middle-man-tap');
-- Expected: 2 rows, schedule '*/5 * * * *'.

SELECT cron.schedule(
  'warmup-submit-middle-man-form',
  '*/5 * * * *',
  $$SELECT net.http_get(
    url                  := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/submit-middle-man-form?warmup=1',
    timeout_milliseconds := 5000
  ) AS request_id$$
);

SELECT cron.schedule(
  'warmup-log-middle-man-tap',
  '*/5 * * * *',
  $$SELECT net.http_get(
    url                  := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/log-middle-man-tap?warmup=1',
    timeout_milliseconds := 5000
  ) AS request_id$$
);
