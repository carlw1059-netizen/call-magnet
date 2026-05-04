-- Adds twilio_call_sid for idempotent sms_events inserts on Twilio retries.
-- The twilio-missed-call edge function relies on this column's UNIQUE
-- constraint to short-circuit retries: a duplicate CallSid raises a unique
-- violation, the function catches it and returns 200 OK, Twilio stops retrying.
--
-- Partial index: constraint applies only to rows where twilio_call_sid IS NOT
-- NULL, so the existing legacy rows (all NULL) remain unaffected and the
-- analytics views (v_repeat_callers, v_call_patterns_*, v_tap_rate,
-- v_suburb_benchmarks) are untouched.
--
-- Idempotent: safe to re-run.

ALTER TABLE sms_events ADD COLUMN IF NOT EXISTS twilio_call_sid text;

CREATE UNIQUE INDEX IF NOT EXISTS sms_events_twilio_call_sid_key
  ON sms_events (twilio_call_sid)
  WHERE twilio_call_sid IS NOT NULL;
