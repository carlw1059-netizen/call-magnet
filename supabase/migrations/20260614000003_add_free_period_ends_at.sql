ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS free_period_ends_at timestamptz;
