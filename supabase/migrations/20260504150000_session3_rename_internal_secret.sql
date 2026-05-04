-- Session 3 cleanup: rename PUSHOVER_INTERNAL_SECRET → INTERNAL_SECRET in
-- the Postgres-resident notification functions (fire_daily_summary cron job
-- and notify_first_booking trigger). The matching Edge Functions Vault
-- rename happens via `supabase secrets set` (run separately, NOT in this
-- migration, so the secret value never enters git).
--
-- During the rolling rename both Vault entries (INTERNAL_SECRET and the
-- legacy PUSHOVER_INTERNAL_SECRET) coexist with the same value. Each
-- function reads INTERNAL_SECRET first; if NULL, falls back to
-- PUSHOVER_INTERNAL_SECRET. RAISE only if BOTH are missing. A future
-- cleanup migration will drop the legacy lookup once Vault is pruned.
--
-- Idempotent: CREATE OR REPLACE FUNCTION makes re-running a no-op when the
-- function definitions already match. The existing cron schedule and the
-- existing AFTER INSERT trigger continue to point at these functions
-- unchanged because function names are preserved.

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
  -- Makes the hourly cron schedule DST-agnostic.
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
    msg_text := format('No activity today across %s client(s)', active_clients);
  ELSE
    msg_text := format(
      'Today across %s client(s): %s missed calls, %s link taps, %s bookings',
      active_clients, sms_count, click_count, booking_count
    );
  END IF;

  -- Pull the shared secret from Postgres Vault.
  -- Prefer the canonical INTERNAL_SECRET; fall back to the legacy
  -- PUSHOVER_INTERNAL_SECRET while both Vault entries coexist. Drop the
  -- fallback in a follow-up migration after the legacy entry is removed.
  SELECT decrypted_secret INTO internal_secret
    FROM vault.decrypted_secrets
   WHERE name = 'INTERNAL_SECRET';

  IF internal_secret IS NULL THEN
    SELECT decrypted_secret INTO internal_secret
      FROM vault.decrypted_secrets
     WHERE name = 'PUSHOVER_INTERNAL_SECRET';
  END IF;

  IF internal_secret IS NULL THEN
    RAISE EXCEPTION
      'fire_daily_summary: neither INTERNAL_SECRET nor PUSHOVER_INTERNAL_SECRET found in vault.decrypted_secrets. '
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


CREATE OR REPLACE FUNCTION notify_first_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  melb_now        timestamptz := now();
  melb_today      date;
  window_start    timestamptz;
  bookings_today  bigint;
  biz_name        text;
  internal_secret text;
BEGIN
  -- Skip if booked_at is missing or outside today's Melbourne window.
  IF NEW.booked_at IS NULL THEN
    RETURN NEW;
  END IF;

  melb_today   := (melb_now AT TIME ZONE 'Australia/Melbourne')::date;
  window_start := melb_today::timestamp AT TIME ZONE 'Australia/Melbourne';

  IF NEW.booked_at < window_start OR NEW.booked_at > melb_now THEN
    RETURN NEW;
  END IF;

  -- Wrap the notification path so any failure is non-fatal to the INSERT.
  BEGIN
    SELECT COUNT(*) INTO bookings_today
      FROM bookings
     WHERE client_id = NEW.client_id
       AND booked_at >= window_start
       AND booked_at <= melb_now;

    -- Not the first today → silent.
    IF bookings_today <> 1 THEN
      RETURN NEW;
    END IF;

    SELECT c.business_name INTO biz_name
      FROM clients c
     WHERE c.id = NEW.client_id;

    -- Fall back rather than skip — a first booking is worth telling Carl
    -- about even if the business_name lookup misses unexpectedly.
    IF biz_name IS NULL THEN
      biz_name := 'Unknown client';
    END IF;

    -- Pull the shared secret from Postgres Vault.
    -- Prefer INTERNAL_SECRET; fall back to legacy PUSHOVER_INTERNAL_SECRET
    -- while both names coexist.
    SELECT decrypted_secret INTO internal_secret
      FROM vault.decrypted_secrets
     WHERE name = 'INTERNAL_SECRET';

    IF internal_secret IS NULL THEN
      SELECT decrypted_secret INTO internal_secret
        FROM vault.decrypted_secrets
       WHERE name = 'PUSHOVER_INTERNAL_SECRET';
    END IF;

    IF internal_secret IS NULL THEN
      RAISE WARNING
        'notify_first_booking: neither INTERNAL_SECRET nor PUSHOVER_INTERNAL_SECRET found in vault.decrypted_secrets — skipping notification';
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url     := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/send-pushover-alert',
      headers := jsonb_build_object(
        'Content-Type',      'application/json',
        'X-Internal-Secret', internal_secret
      ),
      body    := jsonb_build_object(
        'title',   '💰 First booking today',
        'message', biz_name
      )
    );

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING
      'notify_first_booking: notification failed for client_id=%, sqlstate=%, message=% — booking insert proceeds',
      NEW.client_id, SQLSTATE, SQLERRM;
  END;

  RETURN NEW;
END;
$$;
