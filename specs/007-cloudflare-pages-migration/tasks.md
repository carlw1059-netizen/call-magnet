---
description: "Task list for Cloudflare Pages migration — callmagnet.com.au → three CF Pages projects"
---

# Tasks: Cloudflare Pages Migration

**Input**: Design documents from `/specs/007-cloudflare-pages-migration/`

**Prerequisites**: spec.md, plan.md, data-model.md, quickstart.md

**Organization**: Tasks are grouped by cutover phase. Each DNS flip is independently testable before the next begins.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to

---

## Phase 1: Setup — Code Changes & Branch Prep

**Purpose**: All 16 code/file changes from data-model.md MUST be deployed before any DNS is touched. These can be done in parallel where files differ.

- [ ] T001 Create `cf-marketing` branch cut from `main`; rename `callmagnet-website.html` → `index.html` in that branch; remove all non-marketing files from that branch
- [ ] T002 [P] Add `cm1site/_redirects` to `main` branch with single rule: `/* /b.html 200`
- [ ] T003 [P] [US2] Update `cm1site/b.html`: change asset base URL from `callmagnet.com.au/assets/` → `app.callmagnet.com.au/assets/` on lines 14, 24 and any body references; bump version string per CLAUDE.md rules; confirm zero `staging` output from grep
- [ ] T004 [P] [US1] Update `supabase/functions/delete-client/index.ts` line 8: `Access-Control-Allow-Origin` → `https://app.callmagnet.com.au`
- [ ] T005 [P] [US1] Update `supabase/functions/reset-client-password/index.ts` line 8: `Access-Control-Allow-Origin` → `https://app.callmagnet.com.au`
- [ ] T006 [P] [US1] Update `supabase/functions/send-test-sms/index.ts` line 14: `Access-Control-Allow-Origin` → `https://app.callmagnet.com.au`
- [ ] T007 [P] [US1] Update `supabase/functions/twilio-missed-call/index.ts` line 60: `Access-Control-Allow-Origin` → `https://app.callmagnet.com.au`
- [ ] T008 [P] [US1] Update `assets/js/dashboard.js` lines 167 and 303: `resetPasswordForEmail` `redirectTo` → `https://app.callmagnet.com.au/reset-password`; bump dashboard.js version string in `index.html` and bump `CACHE_VERSION` in `service-worker.js`
- [ ] T009 [P] [US3] Update `supabase/functions/create-client/index.ts` line 362: `success_url` → `https://app.callmagnet.com.au/payment-success`
- [ ] T010 [P] [US3] Update `supabase/functions/create-client/index.ts` line 363: `cancel_url` → `https://app.callmagnet.com.au`
- [ ] T011 [P] [US4] Update `supabase/functions/create-client/index.ts`: magic link `redirectTo` and all CTA links → `https://app.callmagnet.com.au` (multiple lines)
- [ ] T012 [P] [US4] Update `supabase/functions/activate-client/index.ts`: CTA links and `redirectTo` → `https://app.callmagnet.com.au` (multiple lines)
- [ ] T013 [P] [US4] Update `supabase/functions/stripe-payment-succeeded/index.ts`: CTA links and `redirectTo` → `https://app.callmagnet.com.au` (multiple lines)
- [ ] T014 [P] [US4] Update `supabase/functions/monthly-report/index.ts`: CTA links and `redirectTo` → `https://app.callmagnet.com.au` (multiple lines)
- [ ] T015 [P] [US4] Update `supabase/functions/notify-expiry/index.ts`: CTA button link → `https://app.callmagnet.com.au` (multiple lines)
- [ ] T016 [P] [US4] Update `supabase/functions/request-login-link/index.ts`: magic link `redirectTo` → `https://app.callmagnet.com.au` (multiple lines)
- [ ] T017 [P] [US4] Update `supabase/functions/send-client-notification/index.ts`: push notification `url` field → `https://app.callmagnet.com.au` (multiple lines)
- [ ] T018 [P] [US4] Update `supabase/functions/_shared/weekly-email.ts` lines 240, 242, 244: magic link `redirectTo` → `https://app.callmagnet.com.au`
- [ ] T019 Add `cf-marketing/_redirects` to `cf-marketing` branch with rules: `callmagnet.com.au/b/:slug` → 301 to `https://cm1.au/:slug`; `/reset-password` → 301 to `https://app.callmagnet.com.au/reset-password`; `/u/*` → 301 to `https://app.callmagnet.com.au/u/:splat`; `/` marketing site pass-through
- [ ] T020 Commit and push all Phase 1 changes to `main`; commit and push `cf-marketing` branch; redeploy all modified Supabase edge functions via Supabase CLI or dashboard

**Checkpoint**: All 16 code changes deployed. Zero `callmagnet.com.au` references remain in email CTAs, CORS headers, redirectTo fields, or push URL field. Verify before moving to Phase 2.

---

## Phase 2: Cloudflare Pages Projects Setup

**Purpose**: Create the three CF Pages projects in Cloudflare dashboard. No DNS changes yet.

- [ ] T021 Create CF Pages Project A (`callmagnet-marketing`): source repo `carlw1059-netizen/call-magnet`, branch `cf-marketing`, root dir `/`, build command none, output `/`; confirm successful build on pages.dev
- [ ] T022 Create CF Pages Project B (`callmagnet-dashboard`): source repo `carlw1059-netizen/call-magnet`, branch `main`, root dir `/`, build command per `contracts/build-command-project-b.md`, environment variables `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VAPID_PUBLIC_KEY`; confirm successful build on pages.dev
- [ ] T023 Create CF Pages Project C (`callmagnet-middleman`): source repo `carlw1059-netizen/call-magnet`, branch `main`, root dir `/cm1site`, build command none, output `/cm1site`; confirm successful build on pages.dev
- [ ] T024 [US1] Pre-cutover login test on Project B pages.dev URL: add `https://<project-b>.pages.dev/**` to Supabase Auth redirect URLs temporarily; open pages.dev URL; log in with password; confirm dashboard loads, zero console errors, client list loads; remove pages.dev URL from Supabase Auth redirect URLs after test passes

**Checkpoint**: All three projects build successfully. Dashboard login verified on pages.dev. Remove pages.dev URL from Supabase Auth before proceeding.

---

## Phase 3: User Story 2 — cm1.au DNS Flip (Project C)

**Goal**: Middle Man pages serve from CF Pages. All existing SMS links continue to work.

**Independent Test**: Open `cm1.au/arcane-fairies` on a real mobile device; confirm full page load, all 6 buttons visible, form submission triggers push notification.

- [ ] T025 [US2] Update og-inject Cloudflare Worker in Cloudflare Workers dashboard: change fetch origin to new CF Pages Project C URL (instead of old Netlify URL)
- [ ] T026 [US2] Add `cm1.au` as custom domain on CF Pages Project C in Cloudflare dashboard; CF Pages creates DNS records automatically
- [ ] T027 [US2] Smoke test on real mobile device — `cm1.au/arcane-fairies`: page loads with correct content and all 6 buttons visible; no broken images or styles; tap a button — form appears; submit a test form — confirm push notification arrives on dashboard phone

**Checkpoint (FR-006, FR-007, SC-002, SC-007)**: Middle Man page loads and form submission works on real device. Do NOT touch any other DNS until this passes. If it fails: revert cm1.au DNS to Netlify and investigate.

---

## Phase 4: User Story 1 — app.callmagnet.com.au DNS Flip (Project B)

**Goal**: Dashboard accessible at its new permanent address with all admin functions working.

**Independent Test**: Log in at `app.callmagnet.com.au`; navigate to client list; run one admin action; confirm zero CORS errors in DevTools console.

**Prerequisites**: Phase 3 complete and verified.

- [ ] T028 [US1] Update Supabase Auth dashboard: Site URL → `https://app.callmagnet.com.au`; add `https://app.callmagnet.com.au/**` to allowed redirect URLs; keep `https://callmagnet.com.au/**` in redirect URLs temporarily
- [ ] T029 [US1] Add `app.callmagnet.com.au` as custom domain on CF Pages Project B; add `portal.callmagnet.com.au` as second custom domain on Project B
- [ ] T030 [US1] Smoke test `https://app.callmagnet.com.au`: login screen loads with valid SSL and no browser warnings; log in with password; confirm dashboard loads and client data loads; DevTools console → zero CORS errors; test one admin action (delete test client, OR reset test client password, OR send test SMS); open `https://app.callmagnet.com.au/reset-password` — confirm reset-password page loads
- [ ] T031 [US1] Verify `portal.callmagnet.com.au` resolves to the dashboard (FR-005)
- [ ] T032 [US3] Verify Stripe post-payment redirect: trigger onboarding flow in Stripe test mode; confirm redirect lands on `https://app.callmagnet.com.au/payment-success` (SC-006, FR-012)
- [ ] T033 [US4] Verify email CTAs: trigger `activate-client` and `weekly-summary?test=1`; inspect rendered HTML; confirm every link uses `app.callmagnet.com.au` (SC-004, FR-010)

**Checkpoint (FR-001–005, SC-003, SC-005)**: Dashboard login succeeds, zero CORS errors, Stripe redirect verified, email CTAs verified. Do NOT touch callmagnet.com.au DNS until this passes. If it fails: revert app.callmagnet.com.au DNS to Netlify and investigate.

---

## Phase 5: User Story 5 — callmagnet.com.au DNS Flip (Project A)

**Goal**: Marketing site live at root domain. All redirect rules working. No dashboard content or credentials present.

**Independent Test**: Visit `callmagnet.com.au`; confirm marketing content visible; confirm dashboard link present and links to `app.callmagnet.com.au`.

**Prerequisites**: Phase 4 complete and verified.

- [ ] T034 [US5] Add `callmagnet.com.au` as custom domain on CF Pages Project A in Cloudflare dashboard
- [ ] T035 [US5] Smoke test `https://callmagnet.com.au`: marketing site loads ("Never miss a booking again" visible); valid SSL, no browser warnings; "Go to dashboard" link present and links to `app.callmagnet.com.au`; click dashboard link — lands on `app.callmagnet.com.au` login screen (SC-001, FR-014, FR-015)
- [ ] T036 [US5] Verify redirect rules: `callmagnet.com.au/b/arcane-fairies` → 301 to `cm1.au/arcane-fairies` (FR-009); `callmagnet.com.au/reset-password` → 301 to `app.callmagnet.com.au/reset-password`; `callmagnet.com.au/u/testtoken` → 301 to `app.callmagnet.com.au/u/testtoken` (FR-016)

**Checkpoint (FR-014–016, SC-001)**: Marketing site live, redirects working. All three DNS flips complete.

---

## Phase 6: Polish & Post-Cutover

**Purpose**: Documentation updates and monitoring setup.

- [ ] T037 Update `CLAUDE.md`: change rule "cm1site/b.html must always use absolute URLs from callmagnet.com.au" to reflect new asset base URL `app.callmagnet.com.au`; commit and push (data-model.md item 18)
- [ ] T038 Remove `https://callmagnet.com.au/**` from Supabase Auth redirect URLs (data-model.md item 17 — remove old entry after Phase 2 is stable)
- [ ] T039 [P] Verify 14-day monitoring window: confirm Netlify deployment remains live and untouched; note date after which Netlify project can be deleted
- [ ] T040 [P] Run full quickstart.md validation checklist: Steps 1–5 all checked off; record results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately. All T001–T020 can run in parallel across different files.
- **Phase 2 (CF Pages setup)**: Depends on Phase 1 complete and deployed.
- **Phase 3 (cm1.au flip)**: Depends on Phase 2. Must pass before Phase 4.
- **Phase 4 (app.callmagnet.com.au flip)**: Depends on Phase 3 passing. Must pass before Phase 5.
- **Phase 5 (callmagnet.com.au flip)**: Depends on Phase 4 passing.
- **Phase 6 (Polish)**: Depends on Phase 5 complete.

### Cutover Sequence (FR-017, FR-018)

```
cm1.au → app.callmagnet.com.au → callmagnet.com.au
```
Each DNS flip is verified before the next is attempted.

### Parallel Opportunities

```bash
# Phase 1 — all these can run simultaneously (different files):
T003  # cm1site/b.html
T004  # delete-client CORS
T005  # reset-client-password CORS
T006  # send-test-sms CORS
T007  # twilio-missed-call CORS
T008  # dashboard.js redirectTo
T009  # create-client success_url
T010  # create-client cancel_url
T011  # create-client CTA/redirectTo
T012  # activate-client
T013  # stripe-payment-succeeded
T014  # monthly-report
T015  # notify-expiry
T016  # request-login-link
T017  # send-client-notification push url
T018  # _shared/weekly-email.ts
T019  # cf-marketing _redirects

# Phase 2 — all three CF Pages projects can be created simultaneously:
T021  T022  T023
```

---

## Implementation Strategy

### MVP First (US2 — Middle Man pages, highest risk)

1. Complete Phase 1 (all code changes deployed)
2. Complete Phase 2 (CF Pages projects created, login tested on pages.dev)
3. Complete Phase 3 (cm1.au DNS flip — highest risk, SMS links in the wild)
4. **STOP and validate on real device before continuing**

### Incremental DNS Flips

1. Code changes → CM1.au flip → Dashboard flip → Marketing flip
2. Each flip verified independently before next
3. Netlify live for 14 days throughout as rollback target

---

## Notes

- [P] tasks = different files, no shared state dependencies
- `upload-middle-man-background` CORS does NOT need changing (uses `'*'`) — per data-model.md
- `send-daily-summary` and `SEND-EMAIL-SEQUENCE` are switched off — excluded per spec assumptions
- Failure criteria from quickstart.md: stop and revert DNS to Netlify if Middle Man fails, dashboard login fails, CORS errors appear, SSL errors, or push notifications stop
