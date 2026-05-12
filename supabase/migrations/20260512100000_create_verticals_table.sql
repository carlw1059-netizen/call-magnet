-- Verticals reference table — drives the admin onboarding dropdown + future
-- public self-serve signup. Replaces the hardcoded vertical CHECK on clients.
--
-- Why a table not just a wider CHECK: each vertical needs metadata
-- (display name, default avg_job_value, tile template, pricing tier). A table
-- exposes that cleanly to the admin form and edge functions; future additions
-- don't need a migration.
--
-- RLS: enabled with a public SELECT policy. Admin form (anon JWT) needs to
-- read the active verticals to populate its dropdown. No write policies —
-- service_role bypasses RLS for inserts/updates, and Carl mutates seed rows
-- via SQL Editor not the dashboard.

CREATE TABLE IF NOT EXISTS verticals (
  vertical_key            text PRIMARY KEY,
  display_name            text NOT NULL,
  tile_template           text NOT NULL,
  sms_template_id         text,
  default_avg_job_value   numeric NOT NULL,
  pricing_tier            text NOT NULL,
  active                  boolean NOT NULL DEFAULT true,
  display_order           integer NOT NULL DEFAULT 99,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verticals_active_order_idx
  ON verticals (active, display_order)
  WHERE active = true;

ALTER TABLE verticals ENABLE ROW LEVEL SECURITY;

-- Public read of active verticals — admin form populates dropdown via anon.
DROP POLICY IF EXISTS verticals_read_active ON verticals;
CREATE POLICY verticals_read_active ON verticals
  FOR SELECT
  USING (active = true);

-- Seed the four verticals matching the locked product surface.
INSERT INTO verticals (vertical_key, display_name, tile_template, default_avg_job_value, pricing_tier, active, display_order)
VALUES
  ('restaurant',  'Restaurant',     'restaurant_v1',  80,  'restaurant', true,  1),
  ('barber',      'Barber Shop',    'hairdresser_v1', 45,  'standard',   true,  2),
  ('hairdresser', 'Hairdresser',    'hairdresser_v1', 120, 'standard',   true,  3),
  ('default',     'Other / Generic','hairdresser_v1', 100, 'standard',   false, 99)
ON CONFLICT (vertical_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
