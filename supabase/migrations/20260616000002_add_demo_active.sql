-- Add demo_active column
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS demo_active boolean DEFAULT false;

-- Trigger function: when a demo row is set to demo_active = true,
-- automatically set all other demo rows to demo_active = false
CREATE OR REPLACE FUNCTION public.enforce_single_demo_active()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.demo_active = true AND NEW.is_demo_account = true THEN
    UPDATE public.clients
    SET demo_active = false
    WHERE is_demo_account = true
      AND id != NEW.id
      AND demo_active = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_single_demo_active ON public.clients;
CREATE TRIGGER trg_single_demo_active
  AFTER INSERT OR UPDATE OF demo_active ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_single_demo_active();
