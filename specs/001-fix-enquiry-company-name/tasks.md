# Tasks: Function Enquiry Notification Company Name

**Input**: Design documents from `specs/001-fix-enquiry-company-name/`

**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

**Tests**: Not requested — validation scenarios in quickstart.md cover acceptance criteria.

**Scope**: Single-file change in `supabase/functions/submit-middle-man-form/index.ts`. No new files. No schema changes. No frontend changes.

---

## Phase 1: Setup

**N/A** — No project initialization required. The edge function exists with all dependencies in place.

---

## Phase 2: Foundational

**N/A** — `companyName` is already extracted and in scope at the notification dispatch site (line 112). No infrastructure changes needed.

---

## Phase 3: User Story 1 — Business owner receives complete enquiry context (Priority: P1) ✦ MVP

**Goal**: When a function enquiry is submitted with a non-empty company name, the push notification message is appended with `— from [company_name]`.

**Independent Test**: POST a function enquiry with `company_name: "Acme Events"` per Scenario 1 in `specs/001-fix-enquiry-company-name/quickstart.md` and verify the received notification contains "Acme Events".

### Implementation for User Story 1

- [x] T001 [US1] In `supabase/functions/submit-middle-man-form/index.ts`, immediately before the `fetch(...)` call in the notification dispatch block (around line 216), declare `finalPushMessage`: when `formType === 'function'` and `companyName` is non-empty, set it to `\`${customPushMessage} — from ${companyName}\``; otherwise set it to `customPushMessage`
- [x] T002 [US1] In `supabase/functions/submit-middle-man-form/index.ts`, in the fetch body JSON, replace `push_message: customPushMessage` with `push_message: finalPushMessage`. The existing gate `if (!customPushTitle || !customPushMessage)` must remain unchanged, guarding on the original `customPushMessage` variable.

**Checkpoint**: T001 + T002 complete → validate with Scenario 1 from quickstart.md before proceeding.

---

## Phase 4: User Story 2 — Non-function form types are unaffected (Priority: P2)

**Goal**: The `formType === 'function'` guard in T001 ensures all other form types pass through unmodified. This phase is verification-only.

**Independent Test**: POST a change/cancel enquiry with `company_name: "Acme Events"` per Scenario 3 in `specs/001-fix-enquiry-company-name/quickstart.md` and verify the notification is unchanged.

### Implementation for User Story 2

- [x] T003 [US2] Verify in `supabase/functions/submit-middle-man-form/index.ts` that the guard added in T001 uses `formType === 'function'` (not a looser check) and that `finalPushMessage` falls back to `customPushMessage` for all non-function form types.

**Checkpoint**: T003 confirms guard is correct — no separate implementation needed.

---

## Phase 5: Polish & Deployment

**Purpose**: Deploy, validate all three quickstart scenarios, commit.

- [x] T004 Deploy the updated function: `npx supabase functions deploy submit-middle-man-form --project-ref iskvvnhacqdxybpmwuni`
- [ ] T005 [P] Validate Scenario 1 from `specs/001-fix-enquiry-company-name/quickstart.md` — function enquiry WITH company name → notification contains company name
- [ ] T006 [P] Validate Scenario 2 from `specs/001-fix-enquiry-company-name/quickstart.md` — function enquiry WITHOUT company name → no "from" fragment in notification
- [ ] T007 [P] Validate Scenario 3 from `specs/001-fix-enquiry-company-name/quickstart.md` — non-function form type WITH company name → notification unchanged
- [x] T008 Commit and push: `git add supabase/functions/submit-middle-man-form/index.ts && git commit -m "fix: include company_name in function enquiry push notification" && git push origin main`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 3 (US1)**: No blocking prerequisites — start immediately
- **Phase 4 (US2)**: Depends on T001 (guard must exist to verify)
- **Phase 5 (Polish)**: Depends on T001 + T002 + T003

### Within Phase 3

- T001 before T002 (variable declared before use)

### Parallel Opportunities

- T005, T006, T007 can all run in parallel after T004 (deploy)

---

## Implementation Strategy

### MVP (User Story 1 Only)

1. T001 — declare `finalPushMessage` with conditional logic
2. T002 — wire `finalPushMessage` into fetch body
3. T004 — deploy
4. **STOP and VALIDATE**: Run Scenario 1 from quickstart.md
5. Notification contains company name → MVP done

### Full Delivery

T001 → T002 → T003 → T004 → T005 + T006 + T007 (parallel) → T008

---

## Notes

- [P] tasks = different files or no dependencies — can run in parallel
- [Story] label maps each task to its user story for traceability
- The entire fix is contained within one existing file — no new files created
- `companyName` is already in scope; no new variable extraction needed
- The existing notification gate (`if (!customPushTitle || !customPushMessage)`) must NOT be modified
