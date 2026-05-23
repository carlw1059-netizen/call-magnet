-- middle_man_stage5: slug + button config columns on clients, intent on link_clicks.
--
-- middle_man_slug  — URL-safe identifier used in /b/<slug> landing page URLs.
--   NULL = not yet configured; non-NULL must be unique across all clients.
--   Enforced by a partial unique index (NULLs excluded) rather than a UNIQUE
--   column constraint, so existing rows with NULL don't collide.
--
-- middle_man_buttons — JSONB array of customer-facing action buttons.
--   Each element: { label: string, sort_order: number, enabled: boolean }
--   Default '[]' = no buttons shown on the landing page until configured.
--
-- link_clicks.intent — records which Middle Man button a customer tapped.
--   NULL for direct Rebrandly clicks (pre-existing rows unaffected).

-- ── 1. clients columns ───────────────────────────────────────────────────────

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS middle_man_slug    text,
  ADD COLUMN IF NOT EXISTS middle_man_buttons jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Slug format constraint: lowercase letters, digits, hyphens only.
ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_middle_man_slug_format_check;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_middle_man_slug_format_check
  CHECK (
    middle_man_slug IS NULL
    OR (length(middle_man_slug) BETWEEN 1 AND 50
        AND middle_man_slug ~ '^[a-z0-9][a-z0-9\-]*[a-z0-9]$|^[a-z0-9]$')
  );

-- Partial unique index: two clients cannot share a non-null slug.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_middle_man_slug
  ON public.clients(middle_man_slug)
  WHERE middle_man_slug IS NOT NULL;

COMMENT ON COLUMN public.clients.middle_man_slug IS
  'URL-safe slug for the Middle Man landing page (e.g. "brunswick-bistro"). '
  'Unique across all clients. Null when not yet configured.';

COMMENT ON COLUMN public.clients.middle_man_buttons IS
  'JSONB array of button configs: [{label, sort_order, enabled}]. '
  'Rendered on the /b/<slug> landing page. Empty array = no buttons shown.';

-- ── 2. link_clicks.intent ────────────────────────────────────────────────────

ALTER TABLE public.link_clicks
  ADD COLUMN IF NOT EXISTS intent text;

COMMENT ON COLUMN public.link_clicks.intent IS
  'Middle Man button label tapped by customer (e.g. "Book a table"). '
  'NULL for direct Rebrandly webhook clicks (pre-existing rows).';
