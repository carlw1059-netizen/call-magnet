# Quickstart: Dynamic Tile Rebuild Validation

## Prerequisites

- Admin access to CallMagnet dashboard
- Access to Supabase SQL editor (production)
- A test client with Middle Man enabled and at least one button with btn.id set
- Arcane Fairies available as the live regression client at cm1.au/arcane-fairies

---

## Phase 1 Validation — btn.id stored as form_type

1. In Supabase SQL editor, note the btn.id values for Arcane Fairies buttons.
2. Open cm1.au/arcane-fairies, open any button panel, fill required fields, submit.
3. Query: `SELECT form_type FROM middle_man_form_submissions ORDER BY submitted_at DESC LIMIT 1`
   **Expected**: form_type = the btn.id value (e.g. "function_enquiry"), NOT the classifyLabel result ("function").

---

## Phase 2 Validation — Vertical gate removed

1. Log in as a non-restaurant client with middle_man_enabled = true.
2. **Expected**: Customer requests tile section is visible.

---

## Phase 3 Validation — Reset affects tile counts

1. Note current tile count. Click Reset counter. Confirm.
2. **Expected**: Count drops to 0.
3. Submit new form on Middle Man page.
4. **Expected**: Count increments to 1 within 30s.

---

## Phase 4 Validation — Auto-polling

1. Open dashboard. Note tile count.
2. On separate device, submit a form.
3. Watch dashboard without reload.
4. **Expected**: Count increments within 30 seconds.

---

## Phase 5 Validation — Heatmap shows tap data

1. Navigate to heatmap on a Middle Man client.
2. **Expected**: Grid shows button tap frequency. Empty state: "No button tap data yet."
3. Peak label says "tap/taps" — not "missed calls".

---

## Phase 6 Validation — Custom push wording

1. Set custom push_title and push_message on a booking button in admin.
2. Tap that button on Middle Man page.
3. **Expected**: Push arrives with custom wording.

---

## Full Arcane Fairies Regression (run after every phase)

```bash
grep "staging" b.html cm1site/b.html
```
Must return zero output. Then: logo visible, all buttons, layout unchanged, form submits, admin save passes.
