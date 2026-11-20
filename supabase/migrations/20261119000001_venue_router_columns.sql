ALTER TABLE public.sms_events
  ADD COLUMN IF NOT EXISTS line_type TEXT,
  ADD COLUMN IF NOT EXISTS forwarded_from TEXT,
  ADD COLUMN IF NOT EXISTS keypress TEXT,
  ADD COLUMN IF NOT EXISTS dial_status TEXT,
  ADD COLUMN IF NOT EXISTS callback_queued BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS callback_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS callback_completed BOOLEAN DEFAULT false;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS forwarded_from TEXT,
  ADD COLUMN IF NOT EXISTS venue_menu_text TEXT,
  ADD COLUMN IF NOT EXISTS venue_manager_number TEXT,
  ADD COLUMN IF NOT EXISTS venue_router_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS studio_voice_url TEXT,
  ADD COLUMN IF NOT EXISTS venue_recording_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS clients_forwarded_from_unique
  ON clients(forwarded_from)
  WHERE forwarded_from IS NOT NULL;
