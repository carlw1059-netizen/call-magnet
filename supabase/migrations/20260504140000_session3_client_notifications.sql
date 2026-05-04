-- Session 3: client notification infrastructure
-- Adds vertical-aware messaging on clients (barber/restaurant/default) and a
-- push_subscriptions table that send-client-notification will fan out over.
--
-- vertical: NOT NULL DEFAULT 'default', CHECK-constrained to today's three
-- supported values. Adding a fourth vertical later requires a follow-up
-- migration that DROPs and re-ADDs the check constraint with the wider set.
--
-- push_subscriptions security model: service_role only.
--   - All writes go through the save-push-subscription edge function, which
--     uses the service_role key internally and validates an X-Internal-Secret
--     request header to prove the call came from a legitimate code path.
--   - All reads go through send-client-notification (also service_role).
--   - The frontend never touches this table directly.
--   - RLS is ENABLEd with no policies — defense-in-depth: even if Supabase's
--     default grants give anon/authenticated PostgREST access, RLS having no
--     matching policy denies them. service_role bypasses RLS automatically
--     and continues to work for the edge functions.
--
-- push_subscriptions row semantics: one row per device per client.
--   - UNIQUE(client_id, endpoint) prevents duplicate rows when the same
--     device re-subscribes (browsers do this on permission re-grant or
--     when the prior subscription was expired by the push service). The
--     composite UNIQUE constraint creates a btree index that also covers
--     the fan-out lookup `WHERE client_id = ?` via left-prefix matching,
--     so no separate single-column index is needed.
--   - ON DELETE CASCADE: removing a client also wipes their device list.
--   - last_used_at is touched by send-client-notification when a push
--     succeeds; endpoints that return 404/410 will be deleted by the same
--     function so dead rows don't accumulate.
--
-- Idempotent: safe to re-run. ADD COLUMN and CREATE TABLE use IF NOT EXISTS;
-- ENABLE ROW LEVEL SECURITY is a no-op on an already-RLS-enabled table; the
-- data UPDATE for the test client is naturally idempotent.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS vertical text NOT NULL DEFAULT 'default'
    CHECK (vertical IN ('barber', 'restaurant', 'default'));

UPDATE clients
  SET vertical = 'restaurant'
  WHERE id = 'd508dde9-8f10-464b-b41b-7d84b0eaa907';

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  endpoint     text NOT NULL,
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, endpoint)
);

-- Lock the table to service_role: ENABLE RLS with no policies denies
-- anon/authenticated by default; service_role bypasses RLS and remains
-- fully functional for the edge functions.
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
