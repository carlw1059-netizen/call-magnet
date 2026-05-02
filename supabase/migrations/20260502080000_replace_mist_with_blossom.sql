-- Drop old constraint, add new one with blossom instead of mist
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_theme_preference_check;

-- Migrate any existing rows on 'mist' (none expected, but safe) to 'blossom'
UPDATE clients SET theme_preference = 'blossom' WHERE theme_preference = 'mist';

ALTER TABLE clients ADD CONSTRAINT clients_theme_preference_check
  CHECK (theme_preference IN ('emerald', 'stone', 'ember', 'hearth', 'studio', 'blossom'));
