# Quickstart Validation Guide: Function Enquiry Notification Company Name

**Date**: 2026-09-18

## Prerequisites

- Supabase CLI installed and authenticated
- A test client slug that has a `function` button configured with custom push_title and push_message
- A device registered for push notifications on that client account (to receive and verify the notification)

## Scenario 1: Function enquiry WITH company name

**Goal**: Verify the push notification message includes the company name.

```bash
curl -X POST https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/submit-middle-man-form \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "<test-client-slug>",
    "form_type": "function",
    "caller_name": "Jane Smith",
    "caller_phone": "0412345678",
    "company_name": "Acme Events"
  }'
```

**Expected response**: `{ "ok": true }`

**Expected notification**: The push message received should end with `— from Acme Events` (appended to the button's configured push_message text).

**Verification via logs**:
```bash
npx supabase functions logs submit-middle-man-form --project-ref iskvvnhacqdxybpmwuni --limit 10
```
Confirm no errors. The `send-client-notification` call should show `push_message` containing "Acme Events".

---

## Scenario 2: Function enquiry WITHOUT company name

**Goal**: Verify the push notification is sent normally with no blank fragment.

```bash
curl -X POST https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/submit-middle-man-form \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "<test-client-slug>",
    "form_type": "function",
    "caller_name": "John Doe",
    "caller_phone": "0498765432"
  }'
```

**Expected notification**: Push message matches the button's configured text exactly — no "from" fragment, no trailing em-dash.

---

## Scenario 3: Non-function form type with company name in payload

**Goal**: Verify other form types are unaffected.

```bash
curl -X POST https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/submit-middle-man-form \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "<test-client-slug>",
    "form_type": "change_cancel",
    "caller_name": "Jane Smith",
    "caller_phone": "0412345678",
    "company_name": "Acme Events"
  }'
```

**Expected notification**: Push message matches the change/cancel button's configured text exactly — company name does not appear.

## Deploy Command

After implementing:

```bash
npx supabase functions deploy submit-middle-man-form --project-ref iskvvnhacqdxybpmwuni
```
