-- Add middle_man_logo_url to clients.
-- Stores the public URL of the business logo shown on the Middle Man caller page.
-- NULL = no logo uploaded; page falls back to showing the business name text.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS middle_man_logo_url text;
