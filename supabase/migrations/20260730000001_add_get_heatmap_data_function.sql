-- Returns missed call counts grouped by day of week and hour of day
-- day_of_week: 0 = Sunday, 1 = Monday ... 6 = Saturday
-- hour_of_day: 0-23
CREATE OR REPLACE FUNCTION get_heatmap_data(
  p_client_id uuid,
  p_date_from timestamptz,
  p_date_to   timestamptz
)
RETURNS TABLE (
  day_of_week integer,
  hour_of_day integer,
  call_count  integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    EXTRACT(DOW  FROM received_at AT TIME ZONE 'Australia/Melbourne')::integer AS day_of_week,
    EXTRACT(HOUR FROM received_at AT TIME ZONE 'Australia/Melbourne')::integer AS hour_of_day,
    COUNT(*)::integer AS call_count
  FROM sms_events
  WHERE
    client_id  = p_client_id
    AND received_at >= p_date_from
    AND received_at <= p_date_to
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;
GRANT EXECUTE ON FUNCTION get_heatmap_data(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION get_heatmap_data(uuid, timestamptz, timestamptz) TO service_role;
