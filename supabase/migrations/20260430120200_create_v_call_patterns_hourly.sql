-- Session 2: analytics layer — view 2 of 5.
-- v_call_patterns_hourly: per-client missed-call counts bucketed by (dow, hour)
-- in Melbourne local time, over a rolling 90-day window. Powers the heatmap.
-- dow convention: 0=Sun..6=Sat (Postgres default); relabel in presentation, not here.
-- security_invoker = on so RLS on sms_events carries through.

CREATE OR REPLACE VIEW v_call_patterns_hourly AS
SELECT
  client_id,
  EXTRACT(DOW  FROM received_at AT TIME ZONE 'Australia/Melbourne')::int AS dow,
  EXTRACT(HOUR FROM received_at AT TIME ZONE 'Australia/Melbourne')::int AS hour,
  COUNT(*) AS call_count
FROM sms_events
WHERE received_at >= NOW() - INTERVAL '90 days'
GROUP BY client_id, dow, hour;

ALTER VIEW v_call_patterns_hourly SET (security_invoker = on);
