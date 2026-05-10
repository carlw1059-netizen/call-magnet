-- notifications_sent: per-event audit trail for every push and email send
-- attempted by send-client-notification. Rows are written fire-and-forget by
-- the edge function on every send (Progressier push, Web Push, Resend email)
-- with status='sent'|'failed'|'skipped'. Used for support debugging,
-- "I didn't get the alert" investigations, and future analytics.
--
-- channel  : 'push' or 'email' (the medium)
-- event    : 'link_tapped' | 'missed_call' | 'booking_logged' | etc.
--            Open-ended on purpose so future event types don't need a migration.
-- status   : 'sent'    -> provider returned 2xx
--            'failed'  -> provider returned non-2xx OR threw
--            'skipped' -> guard fell through (missing key, no client email, etc.)
--
-- RLS enabled with NO policies: service_role only. No anon/authenticated access.

CREATE TABLE IF NOT EXISTS notifications_sent (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  channel           text NOT NULL CHECK (channel IN ('push', 'email')),
  event             text NOT NULL,
  status            text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error_message     text,
  provider_response jsonb,
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_sent_client_created_idx
  ON notifications_sent (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_sent_event_status_idx
  ON notifications_sent (event, status);

CREATE INDEX IF NOT EXISTS notifications_sent_created_idx
  ON notifications_sent (created_at DESC);

ALTER TABLE notifications_sent ENABLE ROW LEVEL SECURITY;
