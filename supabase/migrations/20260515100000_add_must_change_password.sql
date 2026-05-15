-- Add must_change_password flag to clients.
-- Set to true by create-client when a new client is onboarded with an
-- auto-generated temporary password. Cleared to false by the frontend
-- after the client successfully sets their own password on first login.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
