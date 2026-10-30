# Feature Specification: Cloudflare Pages Migration

**Feature Branch**: `007-cloudflare-pages-migration`

**Created**: 2026-10-31

**Status**: Draft

**Input**: Migrate callmagnet.com.au from Netlify to Cloudflare Pages, restructure URLs so the marketing site lives at the root domain, the dashboard moves to app.callmagnet.com.au, and Middle Man pages are served directly from cm1.au.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operator accesses the dashboard at its new address (Priority: P1)

Carl opens `app.callmagnet.com.au` on his phone and desktop. The dashboard loads, he logs in with his password, and all existing functionality works: client list, Middle Man admin, push notification test, CSV export, file uploads. Nothing prompts him to reinstall or re-authenticate unexpectedly once the migration is complete.

**Why this priority**: The dashboard is the primary operational tool. Any degradation in login or core function is a showstopper.

**Independent Test**: Log in at `app.callmagnet.com.au`, navigate to each admin area, confirm no console errors.

**Acceptance Scenarios**:

1. **Given** the DNS has been flipped, **When** Carl navigates to `app.callmagnet.com.au`, **Then** the dashboard loads with a valid SSL certificate and no browser security warnings
2. **Given** Carl submits his password on the login screen, **When** authentication completes, **Then** he lands on the dashboard and all data loads correctly
3. **Given** Carl clicks the password reset link in his email, **When** the link resolves, **Then** he arrives at the reset-password page at `app.callmagnet.com.au/reset-password` and can set a new password
4. **Given** Carl uses any admin function (delete client, upload background, reset client password, send test SMS), **When** the action is submitted, **Then** it completes without CORS errors

---

### User Story 2 — A customer visits a Middle Man page via SMS link (Priority: P1)

A customer receives an SMS with a `cm1.au/<slug>` link. They tap it, the Middle Man page loads, all buttons function, the booking form submits, and click tracking works. Nothing about the migration is visible to the customer. This scenario must work before and after migration.

**Why this priority**: These links are already sent in the wild. Any break is customer-facing and cannot be corrected after the fact.

**Independent Test**: Open a real `cm1.au/<slug>` link on a mobile device and confirm full page function including form submission.

**Acceptance Scenarios**:

1. **Given** a customer taps a cm1.au link from an SMS, **When** the page loads, **Then** the Middle Man page renders correctly with all buttons visible
2. **Given** a customer submits a booking form on a Middle Man page, **When** the form is submitted, **Then** the submission is recorded and the push notification is delivered to the business owner
3. **Given** a customer taps the opt-out SMS link (`callmagnet.com.au/u/<token>`), **When** the link resolves, **Then** they land on the correct unsubscribe page at `app.callmagnet.com.au/u/...`

---

### User Story 3 — A new client completes Stripe checkout (Priority: P1)

A business owner is sent an onboarding email with a Stripe payment link. They complete the payment. Stripe redirects them to the payment success page at `app.callmagnet.com.au/payment-success`. They see a confirmation and can proceed to the dashboard.

**Why this priority**: A broken post-payment redirect means a new client sees a marketing page instead of a confirmation — loss of trust at the critical activation moment.

**Independent Test**: Trigger the onboarding flow in test mode and confirm Stripe redirects to `app.callmagnet.com.au/payment-success`.

**Acceptance Scenarios**:

1. **Given** a client completes Stripe checkout, **When** Stripe redirects after payment, **Then** the browser lands on `app.callmagnet.com.au/payment-success` with a confirmation message
2. **Given** a client abandons Stripe checkout, **When** they click Cancel, **Then** they are returned to `app.callmagnet.com.au`

---

### User Story 4 — Automated emails contain correct dashboard links (Priority: P1)

A client receives an activation email, a weekly summary, a monthly report, or an expiry notice. Every "Go to dashboard" or "Log in" button in those emails links to `app.callmagnet.com.au`. No email contains a link that resolves to the marketing site instead of the dashboard.

**Why this priority**: A client clicking an email CTA and landing on the marketing page loses trust and cannot log in from that landing page.

**Independent Test**: Trigger each active email function (`activate-client`, `monthly-report`, `notify-expiry`, `weekly-summary`) and inspect every link in the rendered email HTML.

**Acceptance Scenarios**:

1. **Given** an activation email is sent, **When** the client clicks the login button, **Then** they land on the dashboard login at `app.callmagnet.com.au`
2. **Given** a weekly summary or monthly report email is sent, **When** the recipient clicks the dashboard CTA, **Then** the link resolves to `app.callmagnet.com.au`
3. **Given** a magic link email is sent (`request-login-link`), **When** the link is clicked and auth completes, **Then** the recipient lands at `app.callmagnet.com.au`

---

### User Story 5 — Marketing site is accessible at the root domain (Priority: P2)

A prospective customer visits `callmagnet.com.au`. They see the marketing page ("Never miss a booking again") with a clear link to the dashboard login at `app.callmagnet.com.au`. The marketing site loads instantly, has a valid SSL certificate, and no dashboard or credential content is present.

**Why this priority**: Separating the marketing site from the dashboard is a goal of the migration, but does not affect existing clients or operations.

**Independent Test**: Visit `callmagnet.com.au` and verify marketing content loads, confirm the dashboard link is present and correct.

**Acceptance Scenarios**:

1. **Given** anyone visits `callmagnet.com.au`, **When** the page loads, **Then** they see the marketing site with a valid SSL certificate
2. **Given** a visitor clicks the dashboard link on the marketing site, **When** they are redirected, **Then** they arrive at `app.callmagnet.com.au`

---

### Edge Cases

- **Old callmagnet.com.au/b/<slug> links**: Any bookmarked or shared Middle Man links using the old domain path must 301-redirect to `cm1.au/<slug>` rather than 404.
- **portal.callmagnet.com.au**: Visiting this subdomain must not result in a DNS error; it resolves to the dashboard.
- **Netlify fallback**: If a critical failure is detected within 14 days of cutover, DNS can be reverted to Netlify and all functionality restores.
- **Send-client-notification push URL**: Push notification tap targets must open `app.callmagnet.com.au`, not the marketing site.

---

## Requirements *(mandatory)*

### Functional Requirements

**Dashboard and authentication**

- **FR-001**: The dashboard MUST be accessible at `app.callmagnet.com.au` with a valid SSL certificate
- **FR-002**: Login with password MUST function at `app.callmagnet.com.au`
- **FR-003**: The password reset flow MUST complete entirely at `app.callmagnet.com.au/reset-password`
- **FR-004**: All dashboard admin functions (delete client, reset client password, send test SMS, upload Middle Man background) MUST function without origin-related errors from `app.callmagnet.com.au`
- **FR-005**: `portal.callmagnet.com.au` MUST resolve to the dashboard

**Middle Man pages**

- **FR-006**: All existing `cm1.au/<slug>` links MUST continue to render the correct Middle Man page
- **FR-007**: Form submissions on Middle Man pages MUST be recorded and trigger push notifications as before
- **FR-008**: Middle Man page assets (CSS, JavaScript, service worker) MUST load from `app.callmagnet.com.au/assets/`
- **FR-009**: `callmagnet.com.au/b/<slug>` MUST 301-redirect to `cm1.au/<slug>`

**Email and notifications**

- **FR-010**: All active email functions MUST use `app.callmagnet.com.au` as the base URL for dashboard links and magic link redirects: `activate-client`, `create-client`, `stripe-payment-succeeded`, `monthly-report`, `notify-expiry`, `request-login-link`, `_shared/weekly-email.ts`
- **FR-011**: Push notification tap targets (`send-client-notification` url field) MUST open `app.callmagnet.com.au`

**Stripe**

- **FR-012**: Stripe checkout success MUST redirect to `app.callmagnet.com.au/payment-success`
- **FR-013**: Stripe checkout cancel MUST redirect to `app.callmagnet.com.au`

**Marketing site**

- **FR-014**: `callmagnet.com.au` MUST serve the marketing site with no dashboard content, no credentials, and no build-time secrets
- **FR-015**: The marketing site MUST contain a clearly visible link to `app.callmagnet.com.au`
- **FR-016**: `callmagnet.com.au/u/*` MUST redirect to `app.callmagnet.com.au/u/:splat`

**Cutover sequence**

- **FR-017**: `cm1.au` MUST be migrated and tested before `app.callmagnet.com.au` DNS is flipped
- **FR-018**: `app.callmagnet.com.au` MUST be migrated and tested before `callmagnet.com.au` DNS is flipped
- **FR-019**: Netlify MUST remain live for 14 days after the final DNS flip as a rollback target

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `callmagnet.com.au`, `app.callmagnet.com.au`, and `cm1.au` all load with valid SSL certificates and zero browser security warnings after cutover
- **SC-002**: Every `cm1.au/<slug>` link tested on a real mobile device renders the Middle Man page and accepts form submissions
- **SC-003**: Dashboard login at `app.callmagnet.com.au` succeeds end-to-end, including the post-login redirect, within the first test after DNS flip
- **SC-004**: Zero email CTAs or magic link redirects point to `callmagnet.com.au` after cutover
- **SC-005**: Zero admin functions produce CORS errors from `app.callmagnet.com.au` after cutover
- **SC-006**: Stripe post-payment redirect lands on `app.callmagnet.com.au/payment-success` (verified via test mode)
- **SC-007**: No degradation to cm1.au Middle Man page load time or form submission success rate compared to pre-migration baseline

---

## Assumptions

- Supabase backend is not moving; all edge function URLs remain unchanged
- Stripe webhooks call Supabase edge function URLs directly and are unaffected by this migration
- Twilio Studio webhooks call Supabase edge function URLs directly and are unaffected
- DNS is already managed in Cloudflare — no registrar transfer required
- The og-inject Cloudflare Worker on `cm1.au/*` is accessible in the Cloudflare dashboard and will be updated as part of the cm1.au cutover
- There are no active client pipeline onboardings during the migration window
- No other users have access to the dashboard; only Carl will be affected by session invalidation at cutover
- `send-daily-summary` and `SEND-EMAIL-SEQUENCE` are switched off and excluded from the email URL updates
- Phase 2 (remaining edge functions referencing `callmagnet.com.au` not in the cutover checklist) will be completed within 30 days of the migration

---

## Cutover Checklist *(informational — must be completed before DNS flip)*

The following code changes MUST be deployed before any DNS is touched:

| # | File | Change |
|---|------|--------|
| 1 | `supabase/functions/create-client/index.ts` lines 362–363 | `success_url` and `cancel_url` → `app.callmagnet.com.au` |
| 2 | `supabase/functions/activate-client/index.ts` | Magic link `redirectTo` and CTA links → `app.callmagnet.com.au` |
| 3 | `supabase/functions/create-client/index.ts` | Magic link `redirectTo` and CTA links → `app.callmagnet.com.au` |
| 4 | `supabase/functions/stripe-payment-succeeded/index.ts` | Dashboard CTA and magic link `redirectTo` → `app.callmagnet.com.au` |
| 5 | `supabase/functions/monthly-report/index.ts` | CTA and magic link `redirectTo` → `app.callmagnet.com.au` |
| 6 | `supabase/functions/notify-expiry/index.ts` | CTA button → `app.callmagnet.com.au` |
| 7 | `supabase/functions/request-login-link/index.ts` | Magic link `redirectTo` → `app.callmagnet.com.au` |
| 8 | `supabase/functions/_shared/weekly-email.ts` | Magic link `redirectTo` → `app.callmagnet.com.au` |
| 9 | `supabase/functions/send-client-notification/index.ts` | Push notification `url` → `app.callmagnet.com.au` |
| 10 | `supabase/functions/delete-client/index.ts` line 8 | `Access-Control-Allow-Origin` → `app.callmagnet.com.au` |
| 11 | `supabase/functions/reset-client-password/index.ts` line 8 | `Access-Control-Allow-Origin` → `app.callmagnet.com.au` |
| 12 | `supabase/functions/send-test-sms/index.ts` line 14 | `Access-Control-Allow-Origin` → `app.callmagnet.com.au` |
| 13 | `supabase/functions/twilio-missed-call/index.ts` line 60 | `Access-Control-Allow-Origin` → `app.callmagnet.com.au` |
| 14 | `supabase/functions/upload-middle-man-background/index.ts` line 227 | `Access-Control-Allow-Origin` → `app.callmagnet.com.au` |
| 15 | `assets/js/dashboard.js` | `resetPasswordForEmail` `redirectTo` → `https://app.callmagnet.com.au/reset-password` |
| 16 | `cm1site/b.html` | Asset base URL from `callmagnet.com.au/assets/` → `app.callmagnet.com.au/assets/` (+ version bump per CLAUDE.md) |
| 17 | Supabase Auth dashboard | Site URL → `https://app.callmagnet.com.au`; add `https://app.callmagnet.com.au/**` to allowed redirect URLs |
| 18 | CLAUDE.md | Update rule "cm1site/b.html must always use absolute URLs from callmagnet.com.au" to reflect new asset base URL |
