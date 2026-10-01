# Implementation Plan: Function Enquiry Notification Company Name

**Branch**: `001-fix-enquiry-company-name` | **Date**: 2026-09-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-fix-enquiry-company-name/spec.md`

## Summary

When a function enquiry is submitted with a `company_name` in the payload, inject that name into the push notification message so the business owner can identify corporate enquirers at a glance. The payload field is already parsed but discarded; the fix is a conditional string modification in a single function before the notification fires.

## Technical Context

**Language/Version**: TypeScript (Deno runtime — Supabase Edge Functions)

**Primary Dependencies**: `@supabase/supabase-js@2` (already in use — no new dependencies)

**Storage**: N/A — no schema changes, no new DB fields

**Testing**: Manual end-to-end via Supabase function logs / test POST request

**Target Platform**: Supabase Edge Runtime (Deno)

**Project Type**: Serverless edge function

**Performance Goals**: N/A — existing notification path, no performance change

**Constraints**: Must not alter existing notification gate (skip if no custom push wording configured). Must not affect non-function form types.

**Scale/Scope**: Single file edit, one function (`submit-middle-man-form/index.ts`), ~5 lines changed

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

No project constitution has been defined yet (constitution.md contains the blank template). No gates to evaluate. Proceeding.

## Project Structure

### Documentation (this feature)

```text
specs/001-fix-enquiry-company-name/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (created by /speckit-tasks)
```

### Source Code (affected files only)

```text
supabase/functions/submit-middle-man-form/
└── index.ts             # Only file changed — ~5 lines modified in the notification block
```

No new files. No migrations. No frontend changes.

## Complexity Tracking

No constitution violations.

---

## Phase 0: Research

### Findings

All context was resolved by reading the existing source code directly. No external research required.

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Modify `push_message` in-place before the fetch call | `companyName` is already in scope at the notification dispatch site (line 216). Keeps the change local and avoids touching the downstream `send-client-notification` contract. | Passing `company_name` as a new field in the `context` payload and modifying the downstream function — rejected: wider surface, second file change, risk of breaking other callers of that function |
| Conditional on `formType === 'function' && companyName` | Spec requires company name enrichment only for function enquiries. The `formType` and `companyName` variables are both in scope at the dispatch site. | Enriching all form types — rejected by spec FR-004 |
| Format: append `— from [company_name]` to the existing `customPushMessage` | Preserves the business owner's custom wording while adding the new context. | Prepend or replace — rejected because the custom push_message is the business owner's configured text; appending respects it |

**Resolution of open questions from spec:**

- FR-005 format: `${customPushMessage} — from ${companyName}` when company name is present. Uses em-dash separator for readability. Falls back to unmodified `customPushMessage` when absent.
- Empty-after-trim guard: `companyName` is already trimmed at parse time (line 112). The `if (companyName)` conditional is sufficient — empty string is falsy.
- 100-char cap: already enforced at parse time via `.slice(0, 100)`. No additional truncation needed.

---

## Phase 1: Design

### data-model.md summary

No data model changes. `company_name` is already accepted in the POST body, already extracted and trimmed in the edge function, and is not persisted to the database (out of scope). See [data-model.md](data-model.md).

### contracts/ summary

The existing POST body contract already accepts `company_name`. No contract change required. The fix is purely internal. See [contracts/submit-form.md](contracts/submit-form.md).

### quickstart.md summary

Two test scenarios: POST with company_name present (verify notification message contains company name) and POST without company_name (verify notification is unaffected). See [quickstart.md](quickstart.md).

### Implementation approach

In `supabase/functions/submit-middle-man-form/index.ts`, immediately before the `fetch(...)` call (currently around line 216), construct `finalPushMessage`:

```
if formType is 'function' AND companyName is non-empty:
    finalPushMessage = customPushMessage + " — from " + companyName
else:
    finalPushMessage = customPushMessage (unchanged)
```

Pass `finalPushMessage` instead of `customPushMessage` in the fetch body. The existing gate on `!customPushTitle || !customPushMessage` is unaffected — it still guards on the original configured value.
