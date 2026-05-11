-- Link-click Pushover trigger (Carl-only internal monitoring)
-- AFTER INSERT trigger on link_clicks that fires a Pushover notification to
-- Carl's iPhone every time a customer taps a booking link. Provides real-
-- time engagement signal during the early-client period. Reuses the existing
-- send-pushover-alert edge function rather than building a duplicate
-- Pushover-calling function.
--
-- PREREQUISITE: Vault entries already present and verified —
--   PUSHOVER_USER_KEY, PUSHOVER_APP_TOKEN (used by send-pushover-alert),
--   INTERNAL_SECRET (auth header on edge function call).
--
-- Alert format:
--   title:   "📲 Link tap"
--   message: "<business_name> — link tap" (+ " from <customer_number>" if known)
--
-- customer_number is often NULL because get-booking-url logs the V1 column
-- set (client_id, clicked_at, day_of_week, hour_of_day, clicked_time,
-- converted) without populating customer_number. The fallback message form
-- handles that.
--
-- is_test_account NOT filtered out — Carl explicitly wants to see test
-- taps too during the monitoring period. Mute Pushover or drop the trigger
-- if it gets noisy after client volume picks up.
--
-- Failure isolation: any notification-path error (vault miss, network blip,
-- Pushover API hiccup) is caught and downgraded to RAISE WARNING. A click
-- INSERT is never rolled back by a notification failure.
--
-- Idempotent: CREATE OR REPLACE on the function; DROP IF EXISTS + CREATE
-- on the trigger.

CREATE OR REPLACE FUNCTION notify_link_click()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  biz_name        text;
  customer_num    text;
  msg_body        text;
  internal_secret text;
BEGIN
  -- Wrap the entire notification path so any failure is non-fatal to the
  -- link_clicks INSERT itself.
  BEGIN
    SELECT c.business_name INTO biz_name
      FROM clients c
     WHERE c.id = NEW.client_id;

    IF biz_name IS NULL THEN
      biz_name := 'Unknown client';
    END IF;

    customer_num := NEW.customer_number;

    IF customer_num IS NOT NULL AND length(trim(customer_num)) > 0 THEN
      msg_body := biz_name || ' — link tap from ' || customer_num;
    ELSE
      msg_body := biz_name || ' — link tap';
    END IF;

    SELECT decrypted_secret INTO internal_secret
      FROM vault.decrypted_secrets
     WHERE name = 'INTERNAL_SECRET';

    -- Fall back to legacy entry while both coexist (same pattern as the
    -- first-booking trigger and send-pushover-alert function).
    IF internal_secret IS NULL THEN
      SELECT decrypted_secret INTO internal_secret
        FROM vault.decrypted_secrets
       WHERE name = 'PUSHOVER_INTERNAL_SECRET';
    END IF;

    IF internal_secret IS NULL THEN
      RAISE WARNING
        'notify_link_click: neither INTERNAL_SECRET nor PUSHOVER_INTERNAL_SECRET found in vault.decrypted_secrets — skipping notification';
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url     := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/send-pushover-alert',
      headers := jsonb_build_object(
        'Content-Type',      'application/json',
        'X-Internal-Secret', internal_secret
      ),
      body    := jsonb_build_object(
        'title',   '📲 Link tap',
        'message', msg_body
      )
    );

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING
      'notify_link_click: notification failed for client_id=%, sqlstate=%, message=% — link_clicks insert proceeds',
      NEW.client_id, SQLSTATE, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_link_click_trigger ON link_clicks;

CREATE TRIGGER notify_link_click_trigger
  AFTER INSERT ON link_clicks
  FOR EACH ROW
  EXECUTE FUNCTION notify_link_click();
