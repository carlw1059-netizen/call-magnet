-- Session 2: analytics layer — view 3 of 5.
-- v_call_patterns_daily: per-client missed-call counts bucketed by dow,
-- summed from v_call_patterns_hourly (same 90-day Melbourne-local window).
-- Reads from v_call_patterns_hourly so the rolling cutoff has a single source of truth.
-- security_invoker = on so RLS on sms_events (via the underlying view) carries through.

CREATE OR REPLACE VIEW v_call_patterns_daily AS
SELECT
  client_id,
  dow,
  SUM(call_count)::bigint AS call_count
FROM v_call_patterns_hourly
GROUP BY client_id, dow;

ALTER VIEW v_call_patterns_daily SET (security_invoker = on);
