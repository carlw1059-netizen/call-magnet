-- SMS delivery receipt columns for sms_events.
--
-- twilio_message_sid: populated when send-twilio-sms sends a programmatic SMS
--   (login-link, onboarding). NULL for Studio-sent missed-call SMS rows until
--   the Studio "Send Message" widget's StatusCallback is configured in Twilio
--   Console and a future migration links it.
--
-- delivery_status: updated by twilio-sms-status edge function when Twilio fires
--   a StatusCallback POST. Mirrors Twilio's message status enum:
--   unknown | queued | sent | delivered | undelivered | failed
--   Defaults to 'unknown' so existing rows are not affected.
--
-- Index on twilio_message_sid enables O(1) lookup in twilio-sms-status
-- (partial: only indexes non-NULL rows, which are the ones that matter).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

ALTER TABLE public.sms_events
  ADD COLUMN IF NOT EXISTS twilio_message_sid text,
  ADD COLUMN IF NOT EXISTS delivery_status    text NOT NULL DEFAULT 'unknown';

CREATE INDEX IF NOT EXISTS sms_events_twilio_message_sid_idx
  ON public.sms_events (twilio_message_sid)
  WHERE twilio_message_sid IS NOT NULL;
