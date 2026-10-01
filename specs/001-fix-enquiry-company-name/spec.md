# Feature Specification: Function Enquiry Notification Company Name

**Feature Branch**: `001-fix-enquiry-company-name`

**Created**: 2026-09-17

**Status**: Draft

**Input**: User description: "The push notification sent when a function enquiry is submitted is missing the company name. The frontend already sends company_name in the payload but the submit-middle-man-form edge function ignores it. The notification string should conditionally include 'from [company_name]' when present."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Business owner receives complete enquiry context (Priority: P1)

A corporate customer submits a function enquiry form on the Middle Man page. They enter their name, phone number, and company name (e.g. "Acme Events"). The business owner receives a push notification that includes the company name, so they immediately know the enquiry is from a corporate client rather than an individual, and can prioritise or prepare accordingly.

**Why this priority**: The company name is the primary piece of context that differentiates a corporate function enquiry from a private one. Without it, the business owner must call back just to find out who they are dealing with.

**Independent Test**: Submit a function enquiry with a company name populated and verify the push notification received includes that company name.

**Acceptance Scenarios**:

1. **Given** a customer submits a function enquiry with company name "Acme Events" and caller name "Jane Smith", **When** the form is submitted, **Then** the push notification includes "Acme Events" in the message body
2. **Given** a customer submits a function enquiry with no company name, **When** the form is submitted, **Then** the push notification is sent without any company name reference (no blank placeholder or "from " fragment)
3. **Given** a customer submits a function enquiry with a company name, **When** the form is submitted, **Then** the caller name is still present in the notification alongside the company name

---

### User Story 2 - Non-function form types are unaffected (Priority: P2)

A customer submits a change/cancel, late arrival, lost and found, or something-else form. Even if they somehow include a company name in the payload, those notification messages remain unchanged — company name enrichment is specific to function enquiries.

**Why this priority**: Prevents unintended changes to other notification types that work correctly today.

**Independent Test**: Submit each non-function form type and verify the existing notification wording is unchanged.

**Acceptance Scenarios**:

1. **Given** a customer submits a change/cancel form, **When** the form is submitted, **Then** the push notification matches its current wording with no company name injected
2. **Given** a customer submits any non-function form type with company_name in the payload, **When** the form is submitted, **Then** the notification is unaffected by the company_name value

---

### Edge Cases

- What happens when company_name is present but empty after trimming (e.g. spaces only)? → Treat as absent; do not include a blank company name in the notification.
- What happens when company_name is very long? → It is already capped at 100 characters on receipt; the notification should use the truncated value.
- What happens when the function enquiry button has no custom push wording configured? → Existing behaviour: no notification is sent. This fix does not change that gate.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When a function enquiry is submitted with a non-empty company name, the push notification message MUST include the company name
- **FR-002**: When a function enquiry is submitted without a company name (absent or blank), the push notification message MUST NOT contain any company name placeholder or trailing fragment
- **FR-003**: The company name inclusion MUST be conditional — only applied when company_name is present and non-empty after whitespace trimming
- **FR-004**: All non-function form types MUST continue to send notifications exactly as they do today, regardless of whether company_name is in the payload
- **FR-005**: The company name MUST appear in a way that provides clear context alongside the caller's name (e.g. "Jane Smith from Acme Events")
- **FR-006**: The fix MUST NOT alter the existing gate that skips notifications when no custom push wording is configured for the button

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of function enquiry notifications where company_name is present include the company name in the message body
- **SC-002**: 0% of function enquiry notifications where company_name is absent contain a blank company name reference or orphaned "from" fragment
- **SC-003**: 0% of non-function form type notifications are changed in any way by this fix
- **SC-004**: Business owners can identify corporate enquirers from the notification alone, without needing to call back to ask who submitted the enquiry

## Assumptions

- The fix is scoped to function enquiry form type only; other form types are out of scope
- The frontend already sends `company_name` in the payload when the customer fills in that field — no frontend changes are needed
- The company name field on the Middle Man form is optional; blank submissions are valid and must not produce broken notification strings
- The existing notification delivery mechanism (push via send-client-notification) is unchanged — only the message content is affected
- Company name has already been validated to a max of 100 characters before this fix is applied
