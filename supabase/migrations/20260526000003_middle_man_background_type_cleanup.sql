-- middle_man_background_type_cleanup: normalise any legacy 'video' or NULL
-- background_type values to 'image'.
--
-- Video backgrounds were never shipped (deferred to Phase 1.5). Any row that
-- somehow ended up with middle_man_background_type = 'video' would have no
-- valid video file behind it. Setting it to 'image' ensures the landing page
-- renders correctly if a portrait.jpg exists for that client.
--
-- NULL rows with no background URL are also set to 'image' so the column is
-- consistent (the landing page treats NULL background_url as "no background"
-- regardless of the type column).

UPDATE public.clients
SET middle_man_background_type = 'image'
WHERE middle_man_background_type = 'video'
   OR middle_man_background_type IS NULL;
