-- Session 2: analytics layer — view 5 of 5.
-- v_suburb_benchmarks: per (suburb, industry), median tap rate and median
-- bookings-per-100-calls across all clients in that cohort over the last 90 days.
-- k-anonymity guarantee: HAVING COUNT(*) >= 5. Cohorts smaller than 5 are omitted.
-- Inactive clients (sms_count = 0) are filtered out so silent rows don't drag medians.
-- Deliberately not granted to anon — read only via service_role from the
-- monthly-report edge function. No security_invoker clause: this view is meant
-- to aggregate across clients, which only the service role can do anyway.

CREATE OR REPLACE VIEW v_suburb_benchmarks AS
WITH sms_per_client AS (
  SELECT client_id, COUNT(*) AS sms_count
  FROM sms_events
  WHERE received_at >= NOW() - INTERVAL '90 days'
  GROUP BY client_id
),
clicks_per_client AS (
  SELECT client_id, COUNT(*) AS click_count
  FROM link_clicks
  WHERE created_at >= NOW() - INTERVAL '90 days'
  GROUP BY client_id
),
bookings_per_client AS (
  SELECT client_id, COUNT(*) AS booking_count
  FROM bookings
  WHERE booked_at >= NOW() - INTERVAL '90 days'
  GROUP BY client_id
),
per_client AS (
  SELECT
    c.id AS client_id,
    c.suburb,
    c.industry,
    COALESCE(s.sms_count, 0)      AS sms_count,
    COALESCE(cl.click_count, 0)   AS click_count,
    COALESCE(b.booking_count, 0)  AS booking_count
  FROM clients c
  LEFT JOIN sms_per_client      s  ON s.client_id  = c.id
  LEFT JOIN clicks_per_client   cl ON cl.client_id = c.id
  LEFT JOIN bookings_per_client b  ON b.client_id  = c.id
  WHERE c.suburb   IS NOT NULL
    AND c.industry IS NOT NULL
    AND COALESCE(s.sms_count, 0) > 0
)
SELECT
  suburb,
  industry,
  COUNT(*) AS cohort_size,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY 100.0 * click_count::numeric / sms_count
  )::numeric, 2) AS median_tap_rate_pct,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY 100.0 * booking_count::numeric / sms_count
  )::numeric, 2) AS median_bookings_per_100_calls
FROM per_client
GROUP BY suburb, industry
HAVING COUNT(*) >= 5;
