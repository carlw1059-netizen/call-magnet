ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS middle_man_show_whats_on boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clients.middle_man_show_whats_on IS
'When true, the See What''s On button appears on the Middle Man page. Admin toggles this per client. Default off.';
