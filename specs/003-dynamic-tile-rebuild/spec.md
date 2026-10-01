# Feature Specification: Dynamic Tile Rebuild

**Feature Branch**: `003-dynamic-tile-rebuild`

**Created**: 2026-09-23
**Status**: Draft

**Input**: The PWA dashboard's "Customer requests" tile section has 6 connected bugs preventing it from working correctly for all clients. This spec covers all 6 fixes in priority order.

---

## User Stories

### US1 — Tile counts show real submission data (P1 — Critical)

**Problem**: Any button with `btn.id` set (e.g. `"function_enquiry"`) always shows 0. The tile queries `form_type = "function_enquiry"` but submissions store `form_type = "function"` (from `classifyLabel()`). They never match.

**Fix**: `middleman.js` passes `btn.id` as `btn_id` in the POST payload. `submit-middle-man-form` stores `btn.id` as `form_type` when present; falls back to `classifyLabel()` when absent (backward compat for old data). The `VALID_FORM_TYPES` whitelist is expanded to accept slug-format btn.id values.

**Acceptance**:
1. Submit a form on a button with `btn.id = "function_enquiry"` → `middle_man_form_submissions.form_type` = `"function_enquiry"`
2. Dashboard tile for that button shows count = 1
3. Submit a form on a button with no `btn.id` → `form_type` = `classifyLabel(label)` (unchanged behaviour)
4. Existing data with old form_type values still visible in panel (query uses correct formType per tile)

---

### US2 — All Middle Man clients see tiles (P1 — Critical)

**Problem**: `loadMiddleManSection()` line 1194 returns early if `getDashboardMode() !== 'restaurant'`. Any hairdresser, function venue, or other non-restaurant client with Middle Man enabled sees no tiles.

**Fix**: Remove the vertical gate. Keep only `if (!currentClient.middle_man_enabled) return`.

**Acceptance**:
1. A non-restaurant client with `middle_man_enabled = true` sees tiles on their dashboard
2. A client with `middle_man_enabled = false` sees no tiles (unchanged)

---

### US3 — Reset button affects tile counts (P2)

**Problem**: Tile count queries always use `monthStartIso` (first of current month) regardless of `reset_date`. The reset button has no effect on tile counts.

**Fix**: Use `MAX(reset_date, monthStartIso)` as the query start date. If `reset_date` is in the current month and after `monthStartIso`, use `reset_date`.

**Acceptance**:
1. Before reset: tile shows count = 5
2. After clicking reset: tile shows count = 0
3. New submission after reset: tile shows count = 1
4. If `reset_date` is from a previous month: tile still shows current month data

---

### US4 — Tiles update every 30 seconds (P2)

**Problem**: Tile counts only update on page reload.

**Fix**: `setInterval(() => loadMiddleManSection(), 30_000)` wired after the initial load completes. Must guard against duplicate intervals.

**Acceptance**:
1. Submit a form on the Middle Man page
2. Within 30 seconds, the dashboard tile count increments without a page reload

---

### US5 — Heatmap grid shows button tap data (P3)

**Problem**: The heatmap grid sources data from `get_heatmap_data` RPC which returns missed call counts from `sms_events`. Should show button tap frequency by day/hour from `link_clicks`.

**Fix**: New SQL function `get_mm_tap_heatmap_data(p_client_id, p_date_from, p_date_to)` aggregating `link_clicks` by `day_of_week` (converted to integer Sunday=0…Saturday=6) and `hour_of_day`. Same return shape as `get_heatmap_data`. Dashboard replaces the heatmap RPC call with this new function for clients with Middle Man enabled.

**Acceptance**:
1. Heatmap grid shows tap frequency data, not missed call data
2. Cells with more taps show brighter colour
3. Empty state message says "No tap data yet" (not "No missed call data")
4. Peak label shows tap count, not missed calls

---

### US6 — Booking button push uses admin-configured wording (P3)

**Problem**: `log-middle-man-tap` sends hardcoded push wording for booking taps. Admin-configured wording is ignored.

**Fix**: The edge function already selects `id, business_name` from clients. Extend to also select `middle_man_buttons`, then find the button whose label matches the intent, and use its `push_title` / `push_message` if present. Falls back to hardcoded wording when absent.

**Acceptance**:
1. Set custom push wording on a booking button in admin
2. Tap that button on the Middle Man page
3. Venue receives push notification with custom wording

---

## Out of Scope

- SMS, Twilio, Stripe, missed call flow — untouched
- Background video / image / canplay listener — untouched
- Intent-bars section in heatmap — already reads link_clicks correctly, untouched
- Real-time via Supabase websockets — polling only (US4)
