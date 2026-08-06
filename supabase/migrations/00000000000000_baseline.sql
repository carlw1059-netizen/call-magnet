-- Baseline: creates tables that predate the migration tracking system.
-- These tables were created manually before migration discipline was established.
-- All subsequent migrations use ADD COLUMN IF NOT EXISTS so they are safe to
-- run on top of this baseline without conflicts.

-- ── clients ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clients (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name         text        NOT NULL,
  email                 text        NOT NULL,
  twilio_number         text,
  avg_job_value         integer     DEFAULT 0,
  created_at            timestamptz DEFAULT now(),
  plan_type             text        DEFAULT 'bronze',
  sms_included          integer     DEFAULT 50,
  subscription_start    timestamptz DEFAULT now(),
  last_renewal_date     timestamptz,
  account_status        text        DEFAULT 'active',
  date_of_birth         date,
  calcom_username       text,
  stripe_customer_id    text,
  booking_url           text,
  last_overage_reported date,
  cancelled_at          timestamptz,
  cancellation_scheduled boolean    DEFAULT false,
  emails_sent           text[]      DEFAULT '{}',
  terms_accepted        boolean     DEFAULT false,
  terms_accepted_at     timestamptz,
  owner_name            text
);

-- ── sms_events ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sms_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid,
  customer_number text,
  client_number   text,
  message_body    text,
  received_at     timestamptz DEFAULT now()
);

-- ── link_clicks ──────────────────────────────────────────────────────────────
-- V1 table — predates migration discipline. id is bigint auto-increment, no FK
-- on client_id (FK added by migration 20260505110000). RLS already enabled.
CREATE TABLE IF NOT EXISTS public.link_clicks (
  id              bigserial   PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  client_id       uuid,
  clicked_at      timestamptz,
  customer_number text,
  day_of_week     text,
  hour_of_day     smallint,
  converted       boolean,
  clicked_time    text
);

ALTER TABLE public.link_clicks ENABLE ROW LEVEL SECURITY;

-- ── bookings ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bookings (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid,
  customer_name  text,
  customer_email text,
  booked_at      timestamptz DEFAULT now(),
  source         text,
  deposit_amount numeric
);

-- ── test_sms_log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.test_sms_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_slug  text        NOT NULL,
  to_number    text        NOT NULL,
  message_body text        NOT NULL,
  twilio_sid   text,
  cost         numeric     NOT NULL DEFAULT 0.1000,
  sent_at      timestamptz NOT NULL DEFAULT now()
);
