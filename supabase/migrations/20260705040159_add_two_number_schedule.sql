-- Two-number auto-schedule feature: additive columns only, no data changes.
-- twilio_number_2: secondary Twilio number used outside active_hours.
-- active_hours_start / active_hours_end: local time window twilio_number is active in.
-- schedule_enabled: per-client toggle; false until the client opts in.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS twilio_number_2 text,
  ADD COLUMN IF NOT EXISTS active_hours_start time,
  ADD COLUMN IF NOT EXISTS active_hours_end time,
  ADD COLUMN IF NOT EXISTS schedule_enabled boolean NOT NULL DEFAULT false;
