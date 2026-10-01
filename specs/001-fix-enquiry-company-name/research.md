# Research: Function Enquiry Notification Company Name

**Date**: 2026-09-18

## Source Review

All unknowns resolved by reading `supabase/functions/submit-middle-man-form/index.ts` directly. No external research required.

## Key Findings

| Decision | Rationale | Alternatives Rejected |
|----------|-----------|----------------------|
| Modify `customPushMessage` string locally before the fetch call | `companyName` is already in scope at the notification dispatch site. Single-file, single-location change. | Passing `company_name` downstream to `send-client-notification` — adds a second file change, risks breaking other callers |
| Conditional on `formType === 'function' && companyName` | Spec requires enrichment only for function enquiries. Both variables already in scope. | Enriching all form types — rejected by FR-004 |
| Format: `${customPushMessage} — from ${companyName}` | Appending preserves business owner's custom push wording. Em-dash separator is readable. | Prepend/replace — discards business owner's configured text |

## Resolved Edge Cases

- **Empty company name**: `companyName` is already trimmed at parse time (line 112). `if (companyName)` guards correctly — empty string is falsy.
- **Long company name**: `.slice(0, 100)` already applied at parse time (line 112). No additional truncation needed.
- **Missing custom push wording**: Existing gate `if (!customPushTitle || !customPushMessage)` skips notification entirely. This fix runs only inside the else branch, so the gate is unaffected.
- **Non-function form types**: Guard on `formType === 'function'` prevents any enrichment for change/cancel, late_arrival, lost_found, something_else.

## No Unknowns Remain
