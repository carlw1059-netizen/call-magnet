-- First-booking-of-day Pushover trigger
-- AFTER INSERT trigger on bookings that fires a Pushover notification when
-- the inserted row is the first booking today (Australia/Melbourne) for that
-- client. Subsequent bookings the same day are silent. Same secret pattern
-- as callmagnet-daily-summary cron — pulls X-Internal-Secret from the
-- Postgres Vault entry named 'PUSHOVER_INTERNAL_SECRET'.
--
-- PREREQUISITE: vault entry 'PUSHOVER_INTERNAL_SECRET' must already exist.
-- (Created by the one-shot vault.create_secret() that ran before the
-- 20260504120000 migration.)
--
-- Failure isolation: any error in the notification path is caught and
-- downgraded to RAISE WARNING. A Pushover hiccup, vault miss, or network
-- blip never rolls back the booking INSERT itself.
--
-- Concurrency note: two simultaneous bookings inserted in different
-- transactions can both observe count=1 if neither has committed when the
-- other's trigger reads. That would emit two "first booking" notifications
-- for the same business on the same day. Acceptable trade-off given the
-- low write rate; a serializable lock would be heavier than the bug it
-- prevents. Multi-row inserts within a single statement see all sibling
-- rows already present, so a 3-row INSERT will see count=3 on every
-- trigger invocation and emit zero notifications — also acceptable, since
-- multi-row booking inserts aren't a real-world flow here.
--
-- Idempotent: safe to re-run. Function uses CREATE OR REPLACE; trigger is
-- DROP IF EXISTS + CREATE.

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
  -- Backdated rows (yesterday or earlier) and future-dated rows shouldn't
  -- trigger "first booking today" — the just-inserted row needs to itself
  -- be a real today-booking for the notification to be meaningful.
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

    SELECT decrypted_secret INTO internal_secret
      FROM vault.decrypted_secrets
     WHERE name = 'PUSHOVER_INTERNAL_SECRET';

    IF internal_secret IS NULL THEN
      RAISE WARNING
        'notify_first_booking: PUSHOVER_INTERNAL_SECRET missing from vault.decrypted_secrets — skipping notification';
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

DROP TRIGGER IF EXISTS notify_first_booking_trigger ON bookings;

CREATE TRIGGER notify_first_booking_trigger
  AFTER INSERT ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION notify_first_booking();
