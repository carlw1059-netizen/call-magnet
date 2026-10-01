# Tasks: Button Info Pack

**Input**: Design documents from `/specs/002-function-package-email/`

**Build order is fixed** — do not reorder phases. Admin panel → Middle Man page → E2E test.

---

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no unmet dependencies)
- **[US1/US2/US3]**: User story from spec.md

---

## Phase 1: Setup (Pre-reads)

**Purpose**: Full file reads required before any edit.

- [ ] T001 Read `assets/js/middle-man-admin.js` in full (2126 lines — note `buildBtnRowHtml` line 998, `saveButtons` line 1218)
- [ ] T002 [P] Read `assets/js/middleman.js` in full (note `buildFormHtml` line 178, `attachFormListeners` line 311, `handleSuccess` line 431, button loop in `render()` lines 759–845)
- [ ] T003 [P] Read `supabase/functions/submit-middle-man-form/index.ts` in full (note body parsing lines 104–112, `insertPayload` block lines 188–203)

---

## Phase 2: Foundational — DB migration

**Purpose**: Add `email` column before edge function deploy.

- [ ] T004 Write `supabase/migrations/20260922000001_add_email_to_mmfs.sql`: `ALTER TABLE public.middle_man_form_submissions ADD COLUMN IF NOT EXISTS email TEXT;` with a comment explaining its purpose
- [ ] T005 Create matching local placeholder file alongside T004 (check existing placeholder naming convention in `supabase/migrations/`)
- [ ] T006 [P] In `supabase/functions/submit-middle-man-form/index.ts` after line 112 add: `const email = typeof body.email === 'string' ? body.email.trim().slice(0, 200) : '';` and in the `insertPayload` block after line 199 add: `if (email) insertPayload.email = email;`

**Checkpoint**: Migration file + placeholder written; edge function updated. ✅

---

## Phase 3: Admin panel — infopack_url per button (US3 — P3)

**Goal**: Venue can paste an info pack URL into any button row and save it.

**Independent test**: Paste URL in new field, Save buttons → ✓ Saved. Reload → URL persists. Save buttons on Arcane Fairies without changes → ✓ Saved, no data changed.

- [ ] T007 [US3] In `assets/js/middle-man-admin.js` at `buildBtnRowHtml(btn, idx)` (line 998): after the `mma-btn-effect` select, add `<input type="url" class="mma-btn-infopack" value="` + `_e(btn.infopack_url || '')` + `" placeholder="Info pack URL (optional)…" style="flex:1;min-width:0;" />` — MUST use `btn.infopack_url || ''` (never bare `btn.infopack_url` — undefined serialises to the string "undefined")
- [ ] T008 [US3] In `assets/js/middle-man-admin.js` at `saveButtons()` (line 1218) inside `rows.forEach`, after `push_message` in the button object add: `infopack_url: (row.querySelector('.mma-btn-infopack') || { value: '' }).value.trim(),`
- [ ] T009 [US3] **Critical test**: Open Middle Man admin, edit Arcane Fairies — confirm all button rows render with an empty infopack input; click "Save buttons" without changes; confirm `✓ Saved`; reload and confirm all button data (labels, colours, etc.) is unchanged

**Checkpoint**: Admin saves infopack_url. Arcane Fairies Save buttons passes. ✅

---

## Phase 4: Middle Man page — email field + success screen link (US1 + US2)

**Goal**: Panels with `infopack_url` show email field; success screen shows "View Info Pack →" and suppresses auto-close.

**Independent test**: Submit a button with infopack_url → success screen shows "View Info Pack →" link, opens URL in new tab, does NOT auto-close. Button without infopack_url → auto-closes in 2 seconds unchanged.

- [ ] T010 [US1] In `assets/js/middleman.js` at `buildFormHtml(formType, businessName)` (line 178): add optional `btnData` third parameter; change email field condition from `} else if (formType === 'function') {` guard to `if (formType === 'function' || (btnData && btnData.infopack_url)) {` — keep existing function-type label; use `"Your email (optional)"` label for non-function types
- [ ] T011 [US1] In `assets/js/middleman.js` at `attachFormListeners` (line 311): add optional `btnData` sixth parameter; move email capture (`var email = getField('email'); if (email) payload.email = email;`) outside the `formType === 'function'` block so it runs whenever email field is present; pass `(btnData && btnData.infopack_url) || ''` as fifth argument in both `.then()` and `.catch()` calls to `handleSuccess`
- [ ] T012 [US1] In `assets/js/middleman.js` at `handleSuccess(formWrap, name, formType, businessName)` (line 431): add optional `infopackUrl` fifth parameter; when truthy, append to `successEl.innerHTML`: `'<a class="infopack-link" href="' + esc(infopackUrl) + '" target="_blank" rel="noopener">View Info Pack →</a>'`; wrap the 2-second `setTimeout(closeForm…)` in `if (!infopackUrl) { … }` so it only fires when no info pack is present
- [ ] T013 [US1] In `assets/js/middleman.js` at `render()` lines 815 and 817: update both call sites to `buildFormHtml(formType, businessName, btn)` and `attachFormListeners(formWrap, formType, businessName, display, btnDestUrl, btn)`
- [ ] T014 In `b.html`: bump `middleman.js` `?v=` query string (e.g. `?v=20260922c`)
- [ ] T015 In `cm1site/b.html`: bump `middleman.js` `?v=` to same value — verify src uses **absolute URL** (`https://callmagnet.com.au/assets/js/middleman.js?v=…`), never relative
- [ ] T016 Run `grep "staging" b.html cm1site/b.html` — output must be empty; do not commit if any staging URL found

**Checkpoint**: middleman.js changes are purely additive. Version strings bumped in both HTML files. Staging grep passes. ✅

---

## Phase 5: Deploy

- [ ] T017 [US2] Apply migration from T004 (Supabase dashboard SQL editor or `supabase db push`); verify `email` column exists in `middle_man_form_submissions`
- [ ] T018 [US2] Deploy updated edge function: `supabase functions deploy submit-middle-man-form`

**Checkpoint**: email column live; edge function storing email. ✅

---

## Phase 6: E2E Test on Arcane Fairies (mandatory before complete)

### Arcane Fairies regression

- [ ] T019 Open `cm1.au/arcane-fairies` on a real device — logo visible, all buttons on screen, layout unchanged
- [ ] T020 [US1] Open any Arcane Fairies form, submit — success screen auto-closes after 2 seconds; no "View Info Pack" link
- [ ] T021 [US3] Open admin for Arcane Fairies, click "Save buttons" without changes — `✓ Saved`; reload and confirm all button data unchanged

### Info pack round-trip

- [ ] T022 [US3] In admin for a test/demo client, paste a URL into infopack_url on one button; Save; reload — URL persists
- [ ] T023 [US1] Open live page for test client; open the configured button's form; fill in required fields; submit
- [ ] T024 [US1] Confirm "View Info Pack →" link on success screen; click it — correct URL opens in new tab; Middle Man page stays open
- [ ] T025 [US1] Wait 3+ seconds — form does NOT auto-close
- [ ] T026 [US1] Close form with X button — closes correctly
- [ ] T027 [US2] In Supabase dashboard run: `SELECT caller_name, email, submitted_at FROM middle_man_form_submissions ORDER BY submitted_at DESC LIMIT 1` — confirm `email` column exists and is populated

### Final check

- [ ] T028 Run `grep "staging" b.html cm1site/b.html` — zero output; then commit and push

---

## Dependencies & Execution Order

- **Phase 1 + 2**: Start immediately in parallel
- **Phase 3**: Requires T001 (middle-man-admin.js read)
- **Phase 4**: Requires T002 (middleman.js read); can run in parallel with Phase 3 (different files)
- **Phase 5**: Requires T004 (migration written) + Phase 4 live
- **Phase 6**: Requires Phase 3 + 4 + 5 complete

### Within Phase 4

T010 → T011 → T012 → T013 (sequential, same file) then T014 → T015 → T016

### Parallel opportunity: Phases 3 & 4

```
Track A (middle-man-admin.js): T007 → T008 → T009
Track B (middleman.js + HTML): T010 → T011 → T012 → T013 → T014 → T015 → T016
```

---

## Implementation Strategy

### MVP (US1 only — customer sees info pack link)

1. Phases 1–4 (admin + Middle Man page)
2. Deploy front-end
3. Test the link end-to-end on a non-Arcane-Fairies client
4. Email storage (Phase 5) follows independently

### Full delivery

Complete all 6 phases in order, commit and push after Phase 6 passes.

---

## Notes

- `saveButtons()` is critical infrastructure — T009 must pass before Phase 4 begins
- `cm1site/b.html` must use absolute URLs — verify at T015
- The `formType === 'function'` email field condition must be kept as an OR clause at T010 — removing it breaks Arcane Fairies function form
- All info pack behaviour is gated on `infopack_url` being truthy — zero change for clients without it
