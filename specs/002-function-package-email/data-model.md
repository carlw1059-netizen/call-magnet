# Data Model: Button Info Pack

**Phase 1 output for `/speckit-plan`**

---

## Entity 1: Button object (in `clients.middle_man_buttons` JSONB)

Existing button object shape (no change to existing fields):

```json
{
  "id":           "function_enquiry",
  "label":        "Function enquiry",
  "sort_order":   1,
  "enabled":      true,
  "color":        "#00D4FF",
  "animate":      true,
  "sparkles":     false,
  "effect":       "",
  "url":          "",
  "emoji":        "🎉",
  "push_title":   "",
  "push_message": ""
}
```

New optional field added by this feature:

```json
{
  "infopack_url": "https://example.com/package.pdf"
}
```

**Rules**:
- `infopack_url` is optional — absence (field missing or `""`) means no info pack for this button
- Value is stored as-is (any non-empty string)
- All existing buttons without `infopack_url` continue to work unchanged
- Admin UI saves `infopack_url` as `""` when the field is cleared

---

## Entity 2: `middle_man_form_submissions` row

Existing columns (no change):

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| client_id | uuid | FK → clients |
| form_type | text | change_cancel / function / late_arrival / lost_found / something_else |
| caller_name | text | required |
| caller_phone | text | required |
| original_booking_time | text | optional |
| requested_change | text | optional |
| note | text | optional |
| submitted_at | timestamptz | default now() |
| ip_hash | text | optional |
| user_agent | text | optional |

New column added by this feature:

| Column | Type | Notes |
|--------|------|-------|
| email | text | nullable; populated when customer enters email on form |

**Migration**: `ALTER TABLE public.middle_man_form_submissions ADD COLUMN IF NOT EXISTS email TEXT;`

---

## State transitions

### Admin configures info pack on a button
1. Venue opens Middle Man admin, edits a button row
2. Pastes URL into new `infopack_url` input field
3. Clicks "Save buttons"
4. `saveButtons()` reads all button rows → builds array including `infopack_url`
5. Supabase UPDATE on `clients.middle_man_buttons` — full JSONB array replaced

### Customer opens a button WITH info pack configured
1. Customer opens Middle Man page → `render()` fetches client data including buttons
2. Button has truthy `infopack_url` → `buildFormHtml(formType, businessName, btn)` adds email field
3. Customer fills form, submits
4. `submit-middle-man-form` edge function stores submission including `email` when present
5. `handleSuccess` receives `infopack_url` → shows "View Info Pack →" link on success screen
6. Auto-close is suppressed; customer clicks link → document opens in new tab
7. Customer closes form manually (X button)

### Customer opens a button WITHOUT info pack
1. Button has `infopack_url: ""` or field absent
2. `buildFormHtml` — no additional email field for non-function types (unchanged)
3. `handleSuccess` — no info pack link; auto-closes after 2 seconds (unchanged)
4. Behaviour is **identical to today** for all existing Arcane Fairies buttons
