-- Session 2: analytics layer — view 4 of 5.
-- v_tap_rate: per (client_id, month) in Melbourne calendar time, the SMS sent count,
-- link click count, and tap rate percentage. Anchored on months that had SMS
-- (LEFT JOIN clicks onto sms) so the denominator is never zero — months with
-- only tail clicks from prior-month SMS are intentionally excluded.
-- security_invoker = on so RLS on sms_events and link_clicks carries through.

CREATE OR REPLACE VIEW v_tap_rate AS
WITH monthly_sms AS (
  SELECT
    client_id,
    date_trunc('month', received_at AT TIME ZONE 'Australia/Melbourne')::date AS month,
    COUNT(*) AS sms_count
  FROM sms_events
  GROUP BY client_id, month
),
monthly_clicks AS (
  SELECT
    client_id,
    date_trunc('month', created_at AT TIME ZONE 'Australia/Melbourne')::date AS month,
    COUNT(*) AS click_count
  FROM link_clicks
  GROUP BY client_id, month
)
SELECT
  s.client_id,
  s.month,
  s.sms_count,
  COALESCE(c.click_count, 0) AS click_count,
  ROUND(100.0 * COALESCE(c.click_count, 0)::numeric / s.sms_count, 2) AS tap_rate_pct
FROM monthly_sms s
LEFT JOIN monthly_clicks c USING (client_id, month);

ALTER VIEW v_tap_rate SET (security_invoker = on);
