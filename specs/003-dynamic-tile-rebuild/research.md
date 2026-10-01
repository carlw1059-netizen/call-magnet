# Research: Dynamic Tile Rebuild

All technical unknowns resolved from codebase inspection. No external research required.

---

## Decision: form_type key for tile counts (US1)

**Decision**: Pass `btn.id` as `btn_id` in the form submission payload. Edge function stores it as `form_type` when `btn_id` is present; falls back to the existing `classifyLabel()` result when absent.

**Rationale**: `btn.id` is set by `saveButtons()` in middle-man-admin.js:1246 as `existing.id || slugifyLabel(label)` — every saved button has an id. The dashboard tile already computes `formType = btnId || mmClassifyLabel(rawLabel)` (dashboard.js:1232), so it expects btn.id as the `form_type` key. Aligning the submission to match this is the minimal correct fix.

**Alternatives considered**:
- Use classifyLabel() in tile instead of btn.id — rejected: multiple buttons can share the same classifyLabel result (e.g. both "Private dining" and "Event enquiry" return "function"), making them indistinguishable.
- Add a new `btn_id` column to `middle_man_form_submissions` — rejected: btn.id IS the form_type identifier; repurposing the existing column avoids schema changes.

---

## Decision: VALID_FORM_TYPES validation (US1)

**Decision**: Expand the edge function to allow values matching `/^[a-z0-9_]{1,50}$/` in addition to the 5 legacy values. Legacy values pass unchanged.

**Rationale**: `slugifyLabel()` produces lowercase alphanumeric + underscore strings max 40 chars. Adding a slug regex allows any btn.id through without the edge function needing to look up the client's button list for validation.

**Alternatives considered**:
- Look up client's `middle_man_buttons` and validate btn_id is a real button id — rejected: adds an extra DB query on the hot path; slug format is self-validating.

---

## Decision: Backward compatibility for old form_type values (US1)

**Decision**: No data migration. Old submissions with `form_type = "function"` will no longer appear in tiles that map to `btn.id = "function_enquiry"`.

**Rationale**: A migration would require mapping old classifyLabel values to btn.id values — non-trivial when multiple buttons share the same classifyLabel result. Risk of corrupting existing data outweighs benefit. Current state is already broken (tiles show 0); the fix corrects new data going forward.

---

## Decision: Heatmap data source (US5)

**Decision**: New SQL function `get_mm_tap_heatmap_data(p_client_id uuid, p_date_from timestamptz, p_date_to timestamptz)` aggregating `link_clicks` by integer day_of_week and hour_of_day. Returns `{day_of_week integer, hour_of_day integer, call_count bigint}` — same shape as `get_heatmap_data`.

**Rationale**: `link_clicks.day_of_week` is stored as text (e.g. 'Monday') by the existing trigger. The heatmap grid needs integer 0–6 (Sunday=0). A server-side CASE expression converts it without fetching raw rows. Matching the return shape of `get_heatmap_data` minimises dashboard.js changes.

**Implementation detail**: The CASE expression mapping is:
```
'Sunday'→0, 'Monday'→1, 'Tuesday'→2, 'Wednesday'→3,
'Thursday'→4, 'Friday'→5, 'Saturday'→6
```

**Alternatives considered**:
- Compute day_of_week client-side from `clicked_at` timestamps — rejected: requires fetching all raw rows (potentially thousands) instead of aggregated counts.

---

## Decision: Polling interval (US4)

**Decision**: `setInterval` at 30_000ms. Store interval ID in module-level variable `_mmPollInterval`; call `clearInterval(_mmPollInterval)` before re-arming to prevent duplicates.

**Rationale**: User specification. Simple and reliable for an ops dashboard with low write frequency.

---

## Decision: Reset date for tile counts (US3)

**Decision**: `const tileStartDate = (currentClient.reset_date && new Date(currentClient.reset_date) > new Date(monthStartIso)) ? currentClient.reset_date : monthStartIso;`

**Rationale**: `currentClient.reset_date` is already loaded in the dashboard object (used by `loadStats()`). No additional query. Taking the later of the two dates ensures never showing data from before the current month OR before the last reset.
