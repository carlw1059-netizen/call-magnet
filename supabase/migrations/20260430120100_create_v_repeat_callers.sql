-- Session 2: analytics layer — view 1 of 5.
-- v_repeat_callers: one row per (client_id, customer_number) over sms_events,
-- with first/last seen, total call count, and a repeat-caller flag (>=2 calls).
-- security_invoker = on so RLS on sms_events carries through to callers of this view.

CREATE OR REPLACE VIEW v_repeat_callers AS
SELECT
  client_id,
  customer_number,
  MIN(received_at) AS first_seen,
  MAX(received_at) AS last_seen,
  COUNT(*)         AS call_count,
  COUNT(*) >= 2    AS is_repeat
FROM sms_events
WHERE customer_number IS NOT NULL
GROUP BY client_id, customer_number;

ALTER VIEW v_repeat_callers SET (security_invoker = on);
