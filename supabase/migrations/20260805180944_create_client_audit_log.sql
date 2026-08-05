CREATE TABLE public.client_audit_log (
  id            bigserial PRIMARY KEY,
  client_id     uuid NOT NULL,
  changed_at    timestamptz NOT NULL DEFAULT now(),
  changed_by    text NOT NULL DEFAULT current_user,
  old_row       jsonb NOT NULL
);

ALTER TABLE public.client_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.client_audit_log
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "admin_full_access" ON public.client_audit_log
  FOR ALL TO authenticated
  USING (
    auth.uid() = (SELECT id FROM auth.users WHERE email = 'car312@hotmail.com' LIMIT 1)
  )
  WITH CHECK (
    auth.uid() = (SELECT id FROM auth.users WHERE email = 'car312@hotmail.com' LIMIT 1)
  );

CREATE OR REPLACE FUNCTION public.log_client_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.client_audit_log (client_id, changed_by, old_row)
  VALUES (OLD.id, current_user, to_jsonb(OLD));
  RETURN NEW;
END;
$$;

CREATE TRIGGER clients_audit_trigger
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.log_client_update();
