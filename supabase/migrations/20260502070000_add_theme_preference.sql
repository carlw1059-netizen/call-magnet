ALTER TABLE clients ADD COLUMN IF NOT EXISTS theme_preference text DEFAULT 'emerald' NOT NULL;

ALTER TABLE clients ADD CONSTRAINT clients_theme_preference_check
  CHECK (theme_preference IN ('emerald', 'stone', 'ember', 'hearth', 'studio', 'mist'));

-- Existing accent_preference and bg_preference columns stay for backward compat — they'll just be ignored by the new code
