-- Drop old constraint (locked to Stone/Ember/Hearth/Studio/Blossom era themes).
-- Migrate existing rows to the 6 final locked themes, then re-add constraint.
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_theme_preference_check;

UPDATE clients SET theme_preference =
  CASE theme_preference
    WHEN 'stone'   THEN 'mono'
    WHEN 'ember'   THEN 'harbor'
    WHEN 'hearth'  THEN 'bloom'
    WHEN 'studio'  THEN 'cream'
    WHEN 'blossom' THEN 'bloom'
    WHEN 'mist'    THEN 'ocean'
    WHEN 'fresh'   THEN 'cream'
    ELSE 'emerald'
  END
WHERE theme_preference NOT IN ('mono', 'emerald', 'cream', 'bloom', 'ocean', 'harbor');

ALTER TABLE clients ADD CONSTRAINT clients_theme_preference_check
  CHECK (theme_preference = ANY (ARRAY['mono', 'emerald', 'cream', 'bloom', 'ocean', 'harbor']));
