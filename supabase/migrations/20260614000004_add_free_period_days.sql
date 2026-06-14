ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS free_period_days integer NOT NULL DEFAULT 0;
