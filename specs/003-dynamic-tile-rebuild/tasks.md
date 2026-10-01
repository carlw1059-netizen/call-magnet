# Tasks: Dynamic Tile Rebuild

**Input**: Design documents from `/specs/003-dynamic-tile-rebuild/`

**Build order is fixed** — one commit per phase, no bundling.

---

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: parallelizable (different files, no unmet dependencies)
- **[US1–US6]**: user story label

---

## Phase 1: Setup (Pre-reads)

- [ ] T001 Read `assets/js/middleman.js` — note `classifyLabel` line 131, `attachFormListeners` payload block lines 391–415, render() btn.id pass lines 804/812
- [ ] T002 [P] Read `supabase/functions/submit-middle-man-form/index.ts` — note VALID_FORM_TYPES lines 31–33, validation lines 121–123, push lookup lines 163–174, insertPayload lines 189–205
- [ ] T003 [P] Read `assets/js/dashboard.js` `loadMiddleManSection` lines 1192–1320, `openMmPanel` lines 1322–1373, `loadHeatmap` lines 1483–1572, module vars lines 1107–1116
- [ ] T004 [P] Read `supabase/functions/log-middle-man-tap/index.ts` — note client select line 84, push wording lines 146–173

---

## Phase 2: Foundational (SQL migration for US5)

**Checkpoint**: `get_mm_tap_heatmap_data` function exists in Supabase before Phase 7.

- [ ] T005 Write `supabase/migrations/YYYYMMDDHHMMSS_add_mm_tap_heatmap_function.sql` — CREATE OR REPLACE FUNCTION `get_mm_tap_heatmap_data(p_client_id uuid, p_date_from timestamptz, p_date_to timestamptz)` RETURNS TABLE(day_of_week integer, hour_of_day integer, call_count bigint) — GROUP BY on `link_clicks` WHERE `intent IS NOT NULL AND client_id = p_client_id AND clicked_at BETWEEN p_date_from AND p_date_to` — convert `link_clicks.day_of_week` text to integer via CASE ('Sunday'→0,'Monday'→1,'Tuesday'→2,'Wednesday'→3,'Thursday'→4,'Friday'→5,'Saturday'→6)
- [ ] T006 Create matching local placeholder file next to T005 (follow naming convention of existing placeholder files in `supabase/migrations/`)
- [ ] T007 Apply migration — verify function exists: `SELECT routine_name FROM information_schema.routines WHERE routine_name = 'get_mm_tap_heatmap_data'`

---

## Phase 3: US1 — btn.id stored as form_type (P1 Critical) ⭐ MVP

**Independent Test**: Submit Arcane Fairies form → `SELECT form_type FROM middle_man_form_submissions ORDER BY submitted_at DESC LIMIT 1` → value = btn.id (e.g. `"function_enquiry"`), NOT `"function"`.

- [ ] T008 [US1] In `assets/js/middleman.js` `attachFormListeners` near line 391: after email capture block add `if (btnData && btnData.id) payload.btn_id = btnData.id;`
- [ ] T009 [US1] In `supabase/functions/submit-middle-man-form/index.ts` after line 113: add `const btnId = typeof body.btn_id === 'string' ? body.btn_id.trim().slice(0, 50) : '';`
- [ ] T010 [US1] In `submit-middle-man-form/index.ts` replace validation lines 121–123: accept EITHER `VALID_FORM_TYPES.has(formType)` OR (`btnId` present AND matches `/^[a-z0-9_]{1,50}$/`) — return err400 if neither
- [ ] T011 [US1] In `submit-middle-man-form/index.ts` after validation: add `const effectiveFormType = (btnId && /^[a-z0-9_]{1,50}$/.test(btnId)) ? btnId : formType;`
- [ ] T012 [US1] In `submit-middle-man-form/index.ts` insertPayload line ~191: change `form_type: formType` to `form_type: effectiveFormType`
- [ ] T013 [US1] In `submit-middle-man-form/index.ts` push lookup line 169: change match from `classifyBtnLabel(String(b.label ?? '')) === formType` to `b.id === effectiveFormType || classifyBtnLabel(String(b.label ?? '')) === effectiveFormType`
- [ ] T014 [US1] Bump `middleman.js` version string in `b.html` (e.g. `?v=20260923a`)
- [ ] T015 [US1] Bump same version in `cm1site/b.html` — verify src uses absolute URL `https://callmagnet.com.au/assets/js/middleman.js?v=20260923a`
- [ ] T016 [US1] Run `grep "staging" b.html cm1site/b.html` — must return empty; abort if not
- [ ] T017 [US1] Deploy: `supabase functions deploy submit-middle-man-form`
- [ ] T018 [US1] Commit: `git add assets/js/middleman.js b.html cm1site/b.html supabase/functions/submit-middle-man-form/index.ts && git commit -m "fix: store btn.id as form_type in submissions" && git push origin main`

**Checkpoint**: Live form submission → form_type = btn.id in DB.

---

## Phase 4: US2 — Remove restaurant vertical gate (P1 Critical)

**Independent Test**: Non-restaurant client with `middle_man_enabled = true` → tile section visible.

- [ ] T019 [US2] In `assets/js/dashboard.js` line 1194: delete `if (getDashboardMode() !== 'restaurant') return;` — keep line 1195 `if (!currentClient.middle_man_enabled) return;`
- [ ] T020 [US2] Bump `dashboard.js` version string in `index.html`
- [ ] T021 [US2] Run `grep "staging" b.html cm1site/b.html` — zero output required
- [ ] T022 [US2] Commit: `git add assets/js/dashboard.js index.html && git commit -m "fix: remove restaurant vertical gate from tile section" && git push origin main`

---

## Phase 5: US3 — Reset date in tile counts (P2)

**Independent Test**: Click reset → tile count = 0 → submit form → count = 1.

- [ ] T023 [US3] In `assets/js/dashboard.js` `loadMiddleManSection()` replace `const monthStartIso = ...` (line ~1266) with: `const rawMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(); const tileStartDate = (currentClient.reset_date && new Date(currentClient.reset_date) > new Date(rawMonthStart)) ? currentClient.reset_date : rawMonthStart;` — replace both `.gte(..., monthStartIso)` calls with `tileStartDate`
- [ ] T024 [US3] Apply same `tileStartDate` pattern in `openMmPanel()` (line ~1343) — same two-line block, replace both `.gte()` calls in that function
- [ ] T025 [US3] Bump `dashboard.js` version in `index.html`
- [ ] T026 [US3] Run `grep "staging" b.html cm1site/b.html` — zero output required
- [ ] T027 [US3] Commit: `git add assets/js/dashboard.js index.html && git commit -m "fix: wire reset_date into tile count queries" && git push origin main`

---

## Phase 6: US4 — 30-second polling (P2)

**Independent Test**: Submit form → tile count increments within 30s, no reload.

- [ ] T028 [US4] In `assets/js/dashboard.js` add `let _mmPollInterval = null;` at module level immediately after `let mmDataLoaded = false;` (line ~1115)
- [ ] T029 [US4] In `assets/js/dashboard.js` at end of `loadMiddleManSection()` after `mmDataLoaded = true;` add: `if (_mmPollInterval) clearInterval(_mmPollInterval); _mmPollInterval = setInterval(function() { loadMiddleManSection(); }, 30000);`
- [ ] T030 [US4] Bump `dashboard.js` version in `index.html`
- [ ] T031 [US4] Run `grep "staging" b.html cm1site/b.html` — zero output required
- [ ] T032 [US4] Commit: `git add assets/js/dashboard.js index.html && git commit -m "feat: poll tile counts every 30 seconds" && git push origin main`

---

## Phase 7: US5 — Heatmap shows tap data (P3)

**Prerequisite**: Phase 2 complete (T007 verified).

**Independent Test**: Middle Man client heatmap grid shows tap frequency. Empty state = "No button tap data yet."

- [ ] T033 [US5] In `assets/js/dashboard.js` `loadHeatmap()` line ~1493: replace the `sb.rpc('get_heatmap_data', ...)` call with a conditional — `currentClient.middle_man_enabled ? sb.rpc('get_mm_tap_heatmap_data', ...) : sb.rpc('get_heatmap_data', ...)` — same params object `{ p_client_id: currentClient.id, p_date_from: ninetyDaysAgo, p_date_to: new Date().toISOString() }`
- [ ] T034 [US5] In `assets/js/dashboard.js` `loadHeatmap()` empty state (line ~1551): change `'No missed call data yet.'` to `currentClient.middle_man_enabled ? 'No button tap data yet.' : 'No missed call data yet.'`
- [ ] T035 [US5] In `assets/js/dashboard.js` peak label (line ~1543): change `'missed call'` string(s) to `currentClient.middle_man_enabled ? 'tap' : 'missed call'`
- [ ] T036 [US5] Bump `dashboard.js` version in `index.html`
- [ ] T037 [US5] Run `grep "staging" b.html cm1site/b.html` — zero output required
- [ ] T038 [US5] Commit: `git add assets/js/dashboard.js index.html && git commit -m "feat: heatmap shows button tap data for Middle Man clients" && git push origin main`

---

## Phase 8: US6 — Booking push uses admin wording (P3)

**Independent Test**: Set custom push wording on booking button → tap → push arrives with custom text.

- [ ] T039 [US6] In `supabase/functions/log-middle-man-tap/index.ts` line 84: change `.select('id, business_name')` to `.select('id, business_name, middle_man_buttons')`
- [ ] T040 [US6] In `log-middle-man-tap/index.ts` after `const businessName` (line ~101): parse `clientRow.middle_man_buttons` as array, find button where label overlaps with intentSafe (case-insensitive substring match either direction), extract `customPushTitle` and `customPushMessage` — wrap entire block in try/catch (non-fatal)
- [ ] T041 [US6] In `log-middle-man-tap/index.ts` push body (lines ~162–168): replace hardcoded title/message with `customPushTitle ?? \`New booking tap – ${intentSafe}\`` and `customPushMessage ?? \`Someone tapped "${intentSafe}" on your page\``
- [ ] T042 [US6] Deploy: `supabase functions deploy log-middle-man-tap`
- [ ] T043 [US6] Commit: `git add supabase/functions/log-middle-man-tap/index.ts && git commit -m "feat: booking push uses admin-configured wording" && git push origin main`

---

## Phase 9: E2E Regression (mandatory)

- [ ] T044 Open `cm1.au/arcane-fairies` on real device — logo fully visible, all buttons on screen, layout unchanged
- [ ] T045 Submit Arcane Fairies form → verify `form_type` = btn.id in Supabase
- [ ] T046 Open Arcane Fairies admin → Save buttons without changes → `✓ Saved` → reload → all data unchanged
- [ ] T047 Verify tile count increments within 30s of form submit (no reload)
- [ ] T048 Click Reset → confirm tile count drops to 0
- [ ] T049 Run `grep "staging" b.html cm1site/b.html` — zero output

---

## Dependencies

- Phase 1 → unblocks all phases
- Phase 2 → must complete before Phase 7
- Phase 3 + Phase 4: can run in parallel (different files: middleman.js vs dashboard.js)
- Phase 3 + Phase 8: can run in parallel (different files: middleman.js vs log-middle-man-tap)
- Phases 4 → 5 → 6 → 7: sequential (all edit dashboard.js)
- Phase 9: after all phases complete

### MVP path

Phase 1 → Phase 3 → Phase 4 → Phase 9 (US1 + US2 only — tiles work, all clients visible)
