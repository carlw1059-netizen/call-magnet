# Implementation Plan: Dynamic Tile Rebuild

**Branch**: `003-dynamic-tile-rebuild` | **Date**: 2026-09-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-dynamic-tile-rebuild/spec.md`

## Summary

Fixes 6 connected bugs in the PWA dashboard tile section so it accurately reflects each client's `middle_man_buttons` JSONB configuration. Core fix: aligns `submit-middle-man-form` to store `btn.id` as `form_type`, matching what the dashboard tile queries. Secondary fixes: remove the restaurant-vertical gate, wire reset_date into tile count queries, add 30s polling, replace heatmap source with tap data, and use admin-configured push wording for booking notifications.

---

## Technical Context

**Language/Version**: Vanilla JavaScript (ES5-compatible), TypeScript (Deno edge functions)

**Primary Dependencies**: Supabase (Postgres + Edge Functions), Netlify CDN

**Storage**: PostgreSQL — `middle_man_form_submissions`, `link_clicks`, `clients`

**Testing**: Manual E2E on Arcane Fairies (live client)

**Target Platform**: Browser (PWA dashboard), Deno (edge functions)

**Project Type**: Web application — Netlify frontend + Supabase backend

**Performance Goals**: Tile counts load within 1s; 30s polling is background non-blocking

**Constraints**: No new libraries. No new edge functions. No SMS/Twilio/Stripe/video touches.

**Scale/Scope**: ~50 clients, hundreds of submissions/day

---

## Constitution Check

*Constitution is an unpopulated template — no blocking gates.*

---

## ⚠️ Risk Register

### R1 — CRITICAL: VALID_FORM_TYPES whitelist rejects btn.id values

**Risk**: `submit-middle-man-form` lines 121-123 return HTTP 400 for any `form_type` not in `Set(['change_cancel', 'function', 'late_arrival', 'lost_found', 'something_else'])`. Sending `btn_id = "function_enquiry"` will cause every form submission from a button with `btn.id` to silently fail.

**Mitigation**: Expand validation to also accept values matching `/^[a-z0-9_]{1,50}$/`. Legacy values still accepted via the existing Set. Purely additive change.

**Test**: After change, submit with `btn_id = "custom_label"` → confirm row inserted.

---

### R2 — HIGH: Arcane Fairies historical tile counts show 0 after fix

**Risk**: Existing submissions have `form_type = "function"`. After fix, tiles look for `form_type = "function_enquiry"`. Historical count disappears from tile.

**Context**: Current state is ALSO 0 (same mismatch, current bug). Fix doesn't regress — it just continues to show 0 for old data. New submissions after deployment count correctly.

**Mitigation**: Document in commit. No data migration. Monitor that new submissions count within same day.

---

### R3 — HIGH: Duplicate polling intervals on dashboard re-render

**Risk**: `loadMiddleManSection()` can be called multiple times (client switch, section refresh). Each call arms a new 30s interval.

**Mitigation**: Module-level `let _mmPollInterval = null`. `clearInterval(_mmPollInterval)` before re-arming. Arm AFTER Phase 2 fetch completes, not at function top.

---

### R4 — MEDIUM: Push notification lookup breaks with btn.id as form_type (US1 side-effect)

**Risk**: `submit-middle-man-form` push lookup (lines 163-174) matches buttons via `classifyBtnLabel(label) === formType`. After fix, `formType = "function_enquiry"` but `classifyBtnLabel()` returns `"function"`. Lookup silently fails → push uses fallback wording.

**Mitigation**: Bundle into US1 fix — update lookup to match `b.id === effectiveFormType || classifyBtnLabel(b.label) === effectiveFormType`.

---

### R5 — MEDIUM: `saveNotifications()` must preserve btn.id

**Risk**: `saveNotifications()` writes the full button array to `clients.middle_man_buttons`. If it omits `btn.id`, every notification save loses btn.id from JSONB → tile counts break again.

**Mitigation**: Read `saveNotifications()` before ANY edit to middle-man-admin.js. Confirm `id: existing.id || slugifyLabel(label)` is present in its button object builder (line ~1477). If absent, add it as a pre-requisite fix.

---

### R6 — LOW: Heatmap empty-state string still says "missed call"

**Mitigation**: Change "No missed call data yet." → "No button tap data yet." — one-liner in US5.

---

### R7 — LOW: dashboard.js version string not bumped

**Mitigation**: Bump `dashboard.js?v=` in index.html on every dashboard.js change. One commit per phase.

---

## Project Structure

### Documentation (this feature)

```
specs/003-dynamic-tile-rebuild/
├── spec.md        ← user stories
├── plan.md        ← this file
├── research.md    ← decisions
├── data-model.md  ← entity changes
├── quickstart.md  ← validation guide
├── contracts/     ← API contracts
└── tasks.md       ← /speckit-tasks output
```

### Source files affected

```
assets/js/middleman.js                          ← US1: pass btn_id in payload
assets/js/dashboard.js                          ← US2, US3, US4, US5
supabase/functions/submit-middle-man-form/      ← US1: accept btn_id, fix push lookup
supabase/functions/log-middle-man-tap/          ← US6: use admin push wording
supabase/migrations/YYYYMMDD_mm_tap_heatmap.sql ← US5: new SQL function
b.html                                          ← version bumps
cm1site/b.html                                  ← version bumps (absolute URLs)
index.html                                      ← dashboard.js version bump
```

---

## Implementation Phases (priority order)

### Phase 1 — btn.id → form_type fix (US1) — P1 CRITICAL

**Files**: `middleman.js`, `submit-middle-man-form/index.ts`

1. Read both files in full
2. `middleman.js` `attachFormListeners`: add `if (btnData && btnData.id) payload.btn_id = btnData.id;` after email capture, before fetch
3. `submit-middle-man-form`:
   - Parse `btn_id` from body: `const btnId = typeof body.btn_id === 'string' ? body.btn_id.trim().slice(0, 50) : '';`
   - Expand validation: accept slug format in addition to VALID_FORM_TYPES
   - `const effectiveFormType = (btnId && /^[a-z0-9_]{1,50}$/.test(btnId)) ? btnId : formType;`
   - Store `form_type: effectiveFormType` in insertPayload
   - Fix push button lookup (R4): `btns.find(b => b.id === effectiveFormType || classifyBtnLabel(b.label) === effectiveFormType)`
4. Bump `middleman.js` version in BOTH `b.html` and `cm1site/b.html`
5. Deploy edge function
6. `grep "staging" b.html cm1site/b.html` → zero
7. Commit + push

**Checkpoint**: Live Arcane Fairies form submission → `form_type` = btn.id in Supabase dashboard.

---

### Phase 2 — Remove vertical gate (US2) — P1 CRITICAL

**Files**: `dashboard.js`

1. Read `loadMiddleManSection()` in full
2. Delete line 1194: `if (getDashboardMode() !== 'restaurant') return;`
3. Bump `dashboard.js` version in `index.html`
4. Commit + push

**Checkpoint**: Non-restaurant client with `middle_man_enabled = true` → tiles visible.

---

### Phase 3 — Reset date in tile counts (US3) — P2

**Files**: `dashboard.js`

1. In `loadMiddleManSection()`, add:
   ```js
   const rawMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
   const tileStartDate = (currentClient.reset_date && new Date(currentClient.reset_date) > new Date(rawMonthStart))
     ? currentClient.reset_date : rawMonthStart;
   ```
2. Replace both `.gte('submitted_at', monthStartIso)` and `.gte('clicked_at', monthStartIso)` with `tileStartDate`
3. Apply same pattern to `openMmPanel()` line ~1343
4. Bump `dashboard.js` version in `index.html`
5. Commit + push

**Checkpoint**: Click reset → tile count drops to 0 → new submission → count = 1.

---

### Phase 4 — 30-second polling (US4) — P2

**Files**: `dashboard.js`

1. Add `let _mmPollInterval = null;` at module level (near `mmLastCounts`)
2. At end of `loadMiddleManSection()`, after `mmDataLoaded = true`:
   ```js
   if (_mmPollInterval) clearInterval(_mmPollInterval);
   _mmPollInterval = setInterval(function() { loadMiddleManSection(); }, 30000);
   ```
3. Bump `dashboard.js` version in `index.html`
4. Commit + push

**Checkpoint**: Submit form → tile count increments within 30s, no reload.

---

### Phase 5 — Heatmap → tap data (US5) — P3

**Files**: `dashboard.js`, new migration

1. Write migration SQL (per data-model.md) → `apply_migration` → create local placeholder
2. In `loadHeatmap()`, conditionally use new RPC:
   ```js
   var heatmapRpc = currentClient.middle_man_enabled
     ? sb.rpc('get_mm_tap_heatmap_data', {...})
     : sb.rpc('get_heatmap_data', {...});
   ```
3. Update empty state string and peak label for Middle Man clients
4. Bump `dashboard.js` version in `index.html`
5. Commit + push

**Checkpoint**: Middle Man client heatmap shows tap frequency data.

---

### Phase 6 — Booking push uses admin wording (US6) — P3

**Files**: `log-middle-man-tap/index.ts`

1. Read full file
2. Extend client select: `.select('id, business_name, middle_man_buttons')`
3. Parse buttons, find match by label similarity to intent, extract `push_title`/`push_message`
4. Use custom wording with fallback to current hardcoded strings
5. Deploy edge function
6. Commit + push

**Checkpoint**: Custom push wording arrives after booking tap.

---

### Phase 7 — Arcane Fairies E2E regression (mandatory)

1. `cm1.au/arcane-fairies` on real device — logo, all buttons, layout unchanged
2. Submit any form → `form_type` stores btn.id in DB
3. Dashboard tile increments within 30s (no reload)
4. Reset → count drops to 0 → new submit → count = 1
5. `grep "staging" b.html cm1site/b.html` → zero output

---

## One-commit-per-phase rule

Never bundle two phases in one commit. Each phase has its own commit and version bump. Simple bisect if anything regresses.

---

## Complexity Tracking

No constitution violations. No new tables. One new SQL function. No new edge functions (modifying existing). No new libraries.
