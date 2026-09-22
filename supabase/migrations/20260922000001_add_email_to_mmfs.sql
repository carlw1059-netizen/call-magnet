-- Add optional email capture to Middle Man form submissions.
-- Written by the submit-middle-man-form edge function when the customer
-- enters their email on a button form that has infopack_url configured.
ALTER TABLE public.middle_man_form_submissions
  ADD COLUMN IF NOT EXISTS email TEXT;
