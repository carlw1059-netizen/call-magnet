# Contract: submit-middle-man-form

**Date**: 2026-09-18

## Endpoint

`POST /functions/v1/submit-middle-man-form`

Auth: none required (`verify_jwt = false`)

## Request Body (JSON)

| Field                   | Type   | Required | Constraints                                                               | Notes                                                                                                |
| ----------------------- | ------ | -------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `slug`                  | string | yes      | non-empty                                                                 | Middle Man page slug                                                                                 |
| `form_type`             | string | yes      | change_cancel \| function \| late_arrival \| lost_found \| something_else |                                                                                                      |
| `caller_name`           | string | yes      | non-empty                                                                 | Customer's name                                                                                      |
| `caller_phone`          | string | yes      | valid AU phone                                                            | Accepts 04XX, +614XX, etc.                                                                           |
| `company_name`          | string | no       | max 100 chars                                                             | **Already accepted. Used in notification for function enquiries.** No change to this field required. |
| `original_booking_time` | string | no       |                                                                           |                                                                                                      |
| `requested_change`      | string | no       |                                                                           |                                                                                                      |
| `note`                  | string | no       | max 200 chars                                                             |                                                                                                      |

## Response

Always `200 { ok: true }`. Errors are logged server-side only (never surfaced to caller).

## Contract Change from This Fix

**None.** `company_name` was already accepted by the endpoint. The fix is purely internal — how the field is used inside the function changes; the external contract is unchanged.
