CREATE OR REPLACE FUNCTION set_link_click_time_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.clicked_at IS NOT NULL THEN
    NEW.day_of_week := to_char(NEW.clicked_at AT TIME ZONE 'Australia/Melbourne', 'FMDay');
    NEW.hour_of_day := EXTRACT(HOUR FROM NEW.clicked_at AT TIME ZONE 'Australia/Melbourne')::smallint;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_link_click_time_fields_trigger
BEFORE INSERT ON public.link_clicks
FOR EACH ROW EXECUTE FUNCTION set_link_click_time_fields();
