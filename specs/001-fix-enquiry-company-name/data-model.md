# Data Model: Function Enquiry Notification Company Name

**Date**: 2026-09-18

## No Schema Changes

This fix requires no database schema changes and no new persisted fields.

## Existing Fields in Scope

### POST body — `submit-middle-man-form`

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `company_name` | string (optional) | max 100 chars after trim | Already accepted and parsed. Not persisted. Used only to enrich the notification message for function enquiries. |
| `form_type` | string (required) | one of: change_cancel, function, late_arrival, lost_found, something_else | Guards enrichment — only `function` receives company name in the notification |
| `caller_name` | string (required) | non-empty | Present in notification context alongside company_name |

### In-memory derived value

| Variable | Source | Usage |
|----------|--------|-------|
| `finalPushMessage` | `customPushMessage` + optional company name suffix | Passed to `send-client-notification` instead of raw `customPushMessage` |

## Entities Not Changed

- `middle_man_form_submissions` table — no new columns
- `clients` table — no changes
- `send-client-notification` function contract — no new fields added to the payload
