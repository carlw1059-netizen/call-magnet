# Data Model: Dynamic Tile Rebuild

## Existing entities (no schema changes required)

### `middle_man_form_submissions.form_type`
Currently stores classifyLabel() result ('function', 'change_cancel', etc.). After fix: stores btn.id value when passed ('function_enquiry'), falls back to classifyLabel() for legacy submissions. Max 50 chars, slug format. No ALTER TABLE needed — column already accepts any text.

### `link_clicks`
Has `day_of_week TEXT` (pre-computed: 'Sunday'…'Saturday') and `hour_of_day SMALLINT`. Both already populated by trigger. No changes needed.

### `clients`
- `middle_man_enabled BOOLEAN` — gate for tile section (replaces the vertical gate)
- `reset_date TIMESTAMPTZ` — used for tile count start date (MAX with monthStartIso)
- `middle_man_buttons JSONB` — each element has {id, label, sort_order, enabled, push_title, push_message, infopack_url, …}

## New entity: SQL function `get_mm_tap_heatmap_data`

**Signature**: `get_mm_tap_heatmap_data(p_client_id uuid, p_date_from timestamptz, p_date_to timestamptz)`

**Returns**: `TABLE(day_of_week integer, hour_of_day integer, call_count bigint)` — same shape as `get_heatmap_data`.

**Logic**: GROUP BY on `link_clicks` WHERE `intent IS NOT NULL`, converting text day_of_week to integer via CASE (Sunday=0…Saturday=6).

**Migration**: `supabase/migrations/YYYYMMDD000000_add_mm_tap_heatmap_function.sql`
