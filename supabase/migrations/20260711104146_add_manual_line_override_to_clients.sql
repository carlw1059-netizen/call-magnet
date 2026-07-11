ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS manual_line_override smallint DEFAULT NULL
CHECK (manual_line_override IN (1, 2));
