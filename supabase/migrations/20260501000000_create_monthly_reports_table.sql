-- Session 2: analytics layer — Chunk C of E.
-- monthly_reports: idempotency log for the monthly-report cron.
-- One row per (client_id, period_month). Status tracks pending → sent | failed.
-- Service-role only: no anon/authenticated GRANTs, no RLS policies.
-- Idempotent: safe to re-run via CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS monthly_reports (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_month      date        NOT NULL,
  status            text        NOT NULL DEFAULT 'pending',
  generated_at      timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz,
  resend_message_id text,
  error_message     text,
  payload           jsonb,
  CONSTRAINT monthly_reports_status_check
    CHECK (status IN ('pending', 'sent', 'failed')),
  CONSTRAINT monthly_reports_period_first_of_month
    CHECK (period_month = date_trunc('month', period_month)::date),
  CONSTRAINT monthly_reports_unique_attempt
    UNIQUE (client_id, period_month)
);
