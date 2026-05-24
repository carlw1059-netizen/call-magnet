-- middle_man_form_submissions: stores form submissions from the Middle Man
-- customer-facing landing page (/b/<slug>).
--
-- Captures all form types (change/cancel, function enquiry, late arrival,
-- lost & found, something else). Written by the submit-middle-man-form edge
-- function using service_role. No client-facing read/write policies — admin
-- reviews via Supabase dashboard or a future admin page.

CREATE TABLE IF NOT EXISTS public.middle_man_form_submissions (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  form_type            text        NOT NULL
    CONSTRAINT mmfs_form_type_check
    CHECK (form_type IN ('change_cancel','function','late_arrival','lost_found','something_else')),
  caller_name          text        NOT NULL,
  caller_phone         text        NOT NULL,
  original_booking_time text,
  requested_change     text,
  note                 text,
  submitted_at         timestamptz NOT NULL DEFAULT now(),
  ip_hash              text,
  user_agent           text
);

-- No policies needed: edge function uses service_role which bypasses RLS.
-- Future admin page can add admin-gated SELECT/DELETE policies if needed.
ALTER TABLE public.middle_man_form_submissions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_mmfs_client_id
  ON public.middle_man_form_submissions(client_id);

CREATE INDEX IF NOT EXISTS idx_mmfs_submitted_at
  ON public.middle_man_form_submissions(submitted_at DESC);
