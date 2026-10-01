# Feature Specification: Button Info Pack

**Feature Branch**: `002-function-package-email`

**Created**: 2026-09-19
**Updated**: 2026-09-22

**Status**: Draft

**Input**: Any button on a Middle Man page can have an optional info pack attached to it. When a customer opens that button's panel, they see an optional email field and a "Get Info Pack" button. Entering a valid email activates the button. Clicking it opens the venue's document (PDF, Google Drive link, etc.) in a new tab. The email is captured in the form submission. The venue configures the info pack URL per button in the Middle Man dashboard.

**Examples**: A restaurant's "Private dining" button → private dining PDF. A hairdresser's "Bridal packages" button → bridal package PDF. A function venue's "Function enquiry" button → function package PDF.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Customer gets the info pack document (Priority: P1)

A customer opens a button panel on a Middle Man page (e.g. "Private dining"). They see an optional email address field and an inactive "Get Info Pack" button. They type their email address. As soon as a valid email is entered, the button becomes active. They click it and the venue's document opens in a new browser tab. They can review it at their leisure without being required to submit an enquiry first.

**Why this priority**: This is the primary new user-facing capability. It delivers immediate value — the customer gets the information they need without waiting for a callback.

**Independent Test**: On a Middle Man page whose venue has an info pack URL configured on a button, open that button's panel, enter a valid email address, and confirm the "Get Info Pack" button activates. Click it and confirm the correct document opens in a new tab.

**Acceptance Scenarios**:

1. **Given** a button panel is open and no email has been entered, **When** the customer views the panel, **Then** the "Get Info Pack" button is visible but inactive (not clickable)
2. **Given** the customer has typed a valid email address, **When** they look at the "Get Info Pack" button, **Then** the button is active and can be clicked
3. **Given** the customer clicks the active "Get Info Pack" button, **When** the click is processed, **Then** the venue's info pack document opens in a new browser tab
4. **Given** the customer has not entered an email address, **When** they attempt to interact with the "Get Info Pack" button, **Then** the button does not respond
5. **Given** the venue has not configured an info pack URL on this button, **When** the customer opens the button panel, **Then** the "Get Info Pack" button and email field are not shown at all

---

### User Story 2 - Customer's email is included in the form submission (Priority: P2)

A customer fills in a panel form including their email address, then submits the form. The email address is recorded alongside the rest of the submission details so the venue can follow up directly by email.

**Why this priority**: Capturing the email ensures the venue can follow up with document-specific information and convert the enquiry. However it does not block form submission — a customer who only wants to view the document without submitting is still served by US1.

**Independent Test**: Submit a form with an email address filled in and verify the email appears in the submission record. Submit again without an email and verify the submission is accepted without error.

**Acceptance Scenarios**:

1. **Given** a customer has entered an email address and submits the form, **When** the submission is processed, **Then** the email address is included in the recorded submission data
2. **Given** a customer submits the form without entering an email address, **When** the submission is processed, **Then** the submission is accepted normally with no email in the data
3. **Given** a customer enters an email address, **When** they submit the form, **Then** the submission succeeds regardless of whether they also clicked "Get Info Pack"

---

### User Story 3 - Venue owner configures an info pack URL on a button (Priority: P3)

A venue owner logs into the Middle Man dashboard, selects a button (any type — enquiry, private dining, bridal packages, etc.), and finds a field where they can paste the URL of their info pack document. They save it. From that point on, any customer who opens that button's panel and enters a valid email will see the active "Get Info Pack" button.

**Why this priority**: This is the one-time configuration step that enables US1. It is performed by the venue rather than customers, and can be set up independently of the frontend changes.

**Independent Test**: In the Middle Man dashboard, paste a valid URL into the info pack URL field on any button and save. Then open that button's panel on the live Middle Man page, enter an email, and confirm the button is active and opens the correct document.

**Acceptance Scenarios**:

1. **Given** the venue owner is editing a button in the Middle Man dashboard, **When** they paste a URL into the info pack URL field and save, **Then** the URL is stored against that button
2. **Given** an info pack URL has been saved on a button, **When** a customer enters a valid email on that button's panel, **Then** the "Get Info Pack" button is active
3. **Given** the venue owner clears the info pack URL field on a button and saves, **When** a customer opens that button's panel, **Then** the "Get Info Pack" button and email field are no longer shown

---

### Edge Cases

- What if the customer enters an email, then clears it before submitting? → The button deactivates; the form can still be submitted without an email (email is optional).
- What if the info pack URL is a very long or special-character URL? → Stored and opened as-is; URL format validation is out of scope beyond confirming a non-empty value is present.
- What does the button look like when inactive vs active? → A visible distinction is required (e.g. greyed-out vs full-colour); exact styling is a UI implementation detail.
- What if the email field is visible but the button has no info pack URL? → The email field and "Get Info Pack" button are both hidden when no URL is configured.
- Can multiple buttons on the same page each have their own info pack? → Yes. Each button is configured independently; a venue may have zero, one, or many buttons with info packs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Any button panel MAY include an optional email address field and "Get Info Pack" button when the venue has configured an info pack URL on that button
- **FR-002**: The panel MUST display the email field and "Get Info Pack" button only when the venue has configured an info pack URL on that button
- **FR-003**: The "Get Info Pack" button MUST be inactive (not clickable) when no valid email address has been entered
- **FR-004**: The "Get Info Pack" button MUST become active when the customer enters a valid email address
- **FR-005**: Clicking the active "Get Info Pack" button MUST open the venue's info pack URL in a new browser tab
- **FR-006**: Clicking "Get Info Pack" MUST NOT submit the panel form — it is an independent action
- **FR-007**: When the customer submits a panel form with an email address entered, the email MUST be included in the submission data
- **FR-008**: When the customer submits a panel form without an email address, the form MUST still be accepted
- **FR-009**: The "Get Info Pack" button and email field MUST NOT appear on a panel where no info pack URL is configured
- **FR-010**: Each button is configured independently — multiple buttons on the same page may each have their own info pack URL, and some buttons may have none
- **FR-011**: Venue owners MUST be able to set, update, and clear the info pack URL on any button via the Middle Man dashboard

### Key Entities

- **Info Pack URL**: A publicly accessible document URL stored per button. Determines whether the email field and "Get Info Pack" button appear on that button's panel. May be absent (hidden) or present (shown when email entered).
- **Customer Email**: An optional email address entered by the customer on a button panel. Activates the "Get Info Pack" button when valid. Included in the form submission data when the form is submitted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Customers who enter an email on a configured button's panel can access the info pack document in under 2 clicks
- **SC-002**: 100% of form submissions where the customer entered an email include that email address in the submission record
- **SC-003**: 100% of form submissions where no email was entered are accepted without error
- **SC-004**: Venue owners can update an info pack URL on any button and the change is reflected on the live panel without any additional steps beyond saving
- **SC-005**: The "Get Info Pack" button never appears on a panel where no info pack URL is configured, preventing dead-end interactions
- **SC-006**: Each button's info pack configuration is independent — changing one button's URL does not affect any other button

## Assumptions

- Clicking "Get Info Pack" opens the document without submitting the form — these are fully independent actions
- Email format is validated to a basic standard (contains "@" and a domain) before the button activates; no deep MX or deliverability validation is required
- The info pack URL is stored as-is; the system does not fetch or validate the linked content
- The "Get Info Pack" button and email field are hidden (not shown at all) when no URL is configured, rather than shown in a permanently disabled state
- No automated email is sent to the customer as part of this feature; the email is captured solely for the venue's follow-up use
- The info pack URL field in the dashboard accepts any text input (paste-friendly); file upload is out of scope
- The feature applies to any button type — there is no restriction by form type
