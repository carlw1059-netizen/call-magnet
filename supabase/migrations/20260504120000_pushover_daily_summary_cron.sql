-- Pushover daily summary cron
-- Fires once per day at 18:00 Australia/Melbourne, DST-agnostic.
--
-- pg_cron schedules in UTC, and Melbourne flips between AEST (UTC+10) and
-- AEDT (UTC+11) twice yearly. Rather than maintaining two cron schedules and
-- syncing them with DST transitions, we schedule the cron hourly and let the
-- function self-gate on Melbourne local hour. 23 of the 24 daily fires are
-- a quick hour-check then RETURN; only the 18:00-Melbourne fire does work.
--
-- The function POSTs to send-pushover-alert with the X-Internal-Secret header.
-- send-pushover-alert is configured verify_jwt = false in supabase/config.toml,
-- so no Bearer token is needed — the app-level shared secret IS the auth layer.
--
-- The secret value itself is read from Postgres Vault by name, matching the
-- pattern that monthly-report cron uses for service_role_key. PREREQUISITE:
-- a vault entry named 'PUSHOVER_INTERNAL_SECRET' must already exist before
-- this migration is applied. The accompanying one-shot vault.create_secret
-- command is run separately (NOT in this file) so the secret value never
-- enters git history.
--
-- Idempotent: safe to re-run. The function uses CREATE OR REPLACE; the cron
-- job is unscheduled-then-rescheduled inside a DO block.

CREATE OR REPLACE FUNCTION fire_daily_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  melb_now        timestamptz := now();
  melb_hour       int;
  melb_today      date;
  window_start    timestamptz;
  sms_count       bigint;
  click_count     bigint;
  booking_count   bigint;
  active_clients  bigint;
  msg_text        text;
  internal_secret text;
BEGIN
  -- Self-gate: only fire when Melbourne local hour is 18 (6 PM).
  -- Makes the hourly cron schedule below DST-agnostic.
  melb_hour := EXTRACT(HOUR FROM (melb_now AT TIME ZONE 'Australia/Melbourne'))::int;
  IF melb_hour <> 18 THEN
    RETURN;
  END IF;

  -- Day window: midnight Melbourne (today, in Melbourne calendar) to now.
  melb_today   := (melb_now AT TIME ZONE 'Australia/Melbourne')::date;
  window_start := melb_today::timestamp AT TIME ZONE 'Australia/Melbourne';

  SELECT COUNT(*) INTO sms_count
    FROM sms_events
   WHERE received_at >= window_start;

  SELECT COUNT(*) INTO click_count
    FROM link_clicks
   WHERE created_at >= window_start;

  SELECT COUNT(*) INTO booking_count
    FROM bookings
   WHERE booked_at >= window_start;

  SELECT COUNT(*) INTO active_clients
    FROM clients
   WHERE account_status = 'active';

  IF sms_count + click_count + booking_count = 0 THEN
    msg_text := format(
      'No activity today across %s client(s)',
      active_clients
    );
  ELSE
    msg_text := format(
      'Today across %s client(s): %s missed calls, %s link taps, %s bookings',
      active_clients, sms_count, click_count, booking_count
    );
  END IF;

  -- Pull the shared secret from Postgres Vault. RAISE if missing so the
  -- failure is loud — silently sending a request with NULL header would
  -- 401 at send-pushover-alert, hard to debug.
  SELECT decrypted_secret INTO internal_secret
    FROM vault.decrypted_secrets
   WHERE name = 'PUSHOVER_INTERNAL_SECRET';

  IF internal_secret IS NULL THEN
    RAISE EXCEPTION
      'fire_daily_summary: vault.decrypted_secrets has no entry named ''PUSHOVER_INTERNAL_SECRET''. '
      'Seed it with vault.create_secret() before this function can run.';
  END IF;

  PERFORM net.http_post(
    url     := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/send-pushover-alert',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'X-Internal-Secret', internal_secret
    ),
    body    := jsonb_build_object(
      'title',   'CallMagnet daily',
      'message', msg_text
    )
  );
END;
$$;

-- (Re)schedule the cron job idempotently.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'callmagnet-daily-summary') THEN
    PERFORM cron.unschedule('callmagnet-daily-summary');
  END IF;
END $$;

SELECT cron.schedule(
  'callmagnet-daily-summary',
  '0 * * * *',
  $$ SELECT fire_daily_summary(); $$
);
