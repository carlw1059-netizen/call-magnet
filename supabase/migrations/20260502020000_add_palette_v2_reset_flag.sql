-- Adds palette_v2_reset flag for the palette refresh one-off reset.
-- false → true on first dashboard load post-deploy via JS in loadDashboard, then never again.
-- New clients default to false → also reset on first login (harmless, would already be at 0,0).

ALTER TABLE clients ADD COLUMN IF NOT EXISTS palette_v2_reset boolean DEFAULT false NOT NULL;
