-- 1) Flag Carl as admin via auth.users.raw_app_meta_data->>'is_admin'.
--    raw_app_meta_data is the right home for role flags: admin-controlled
--    (not user-editable through the JS client) and surfaced in the JWT so
--    edge functions + frontend can both check it without a DB round-trip.
--
-- 2) Replace the legacy CHECK constraint on clients.vertical with a FK to
--    verticals.vertical_key. Typos become impossible. Pre-flight (Carl in
--    Studio) confirmed all existing rows use values that are seeded in the
--    new verticals table, so the FK applies clean.

-- ── 1. Admin flag ──────────────────────────────────────────────────────────

UPDATE auth.users
   SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                        || jsonb_build_object('is_admin', true)
 WHERE email = 'car312@hotmail.com';

DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'car312@hotmail.com';
  IF v_user_id IS NULL THEN
    RAISE WARNING 'admin flag: no auth.users row found for car312@hotmail.com — Carl must sign in once before admin flag takes effect';
  ELSE
    RAISE NOTICE 'admin flag set on auth user id=%', v_user_id;
  END IF;
END $$;

-- ── 2. clients.vertical → verticals.vertical_key FK ────────────────────────

-- Drop the legacy CHECK (Session 4 widened set: barber/restaurant/hairdresser/tradie/default)
DO $$
DECLARE
  v_check_name text;
BEGIN
  FOR v_check_name IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.clients'::regclass
       AND contype  = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%vertical%IN%'
  LOOP
    EXECUTE format('ALTER TABLE public.clients DROP CONSTRAINT %I', v_check_name);
    RAISE NOTICE 'dropped legacy CHECK constraint %', v_check_name;
  END LOOP;
END $$;

-- Add the FK (idempotent: skip if it already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.clients'::regclass
       AND conname  = 'clients_vertical_fkey'
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_vertical_fkey
      FOREIGN KEY (vertical) REFERENCES public.verticals(vertical_key)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
