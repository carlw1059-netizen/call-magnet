# Feature Specification: VAPID Push Notifications

**Feature Branch**: `004-vapid-push-notifications`

**Created**: 2026-09-23

**Status**: Draft

**Input**: Route all push notifications (link_tapped, missed_call, booking_logged) through the W3C Web Push (VAPID) system instead of the Progressier API, so iOS devices receive audible notification sounds.

---

## Clarifications

### Session 2026-09-23

- Q: Should all three events (missed_call, booking_logged, link_tapped) migrate to VAPID in this feature? → A: All three events migrate to VAPID.
- Q: When permission is denied or PushManager is unavailable, what should happen? → A: Silent skip — dashboard loads normally.
- Q: If push_subscriptions is empty when a notification fires, should the system fall back? → A: Fall back to Progressier API for link_tapped if no subscriptions exist; missed_call/booking_logged send no push (existing behaviour unchanged).
- Q: Should subscription registration run on every login (upsert) or only when no subscription exists? → A: Always upsert on every login.
- Q: When a notification is tapped, where should the user be taken? → A: Always open https://callmagnet.com.au.

### Session 2026-09-24

- Q: When registerVapidPush() overwrites Progressier's push subscription with ours and progressier.add() re-subscribes on the next page load, which subscription should win? → A: Our VAPID subscription always wins (keep calling progressier.add() and re-overwrite immediately after). The implementation MUST guarantee registerVapidPush() awaits Progressier's subscribe() completion before calling pushManager.subscribe() — awaiting the progressier.add() call alone is not sufficient.
- Q: When we overwrite Progressier's push subscription with our VAPID key, Progressier's server will receive 410 Gone errors and can no longer push to enrolled devices — should Progressier's push delivery remain functional for logged-in clients, or is it acceptable for VAPID to be the sole push channel for enrolled devices? → A: Acceptable. VAPID is the only push channel for enrolled (logged-in) devices. Progressier fallback remains only for clients with no push_subscriptions row.
- Q: Does the unsubscribe → subscribe sequence need a race guard against Progressier re-subscribing between the two calls, or is an immediate sequence sufficient? → A: Add a retry. After subscribing, verify the active subscription uses our VAPID key and retry if not.
- Q: How many retry attempts before giving up, and what happens on final failure — silent skip or flagged? → A: One retry, then log a console warning. No user-visible error; dashboard loads normally.
- Q: Should vapid_debug_log and vapidLog() calls be kept as permanent observability or removed once the fix is confirmed working? → A: Remove after fix is confirmed. Console warning and edge function logs are sufficient ongoing observability.

---

## User Scenarios & Testing

### User Story 1 — Client receives audible notification on iOS for a customer button tap (P1)

A client has installed the CallMagnet PWA on their iPhone and granted notification permission. When a customer visits their Middle Man page and taps a link button (e.g. "Book Now"), the client's phone produces an audible notification sound and displays the notification title and message — identical to how a standard SMS or email alert sounds.

**Why this priority**: This is the primary reported failure. iOS users currently receive silent notifications (or none) for button taps, so they miss time-sensitive customer actions.

**Independent Test**: Install the PWA on an iPhone, grant notifications, tap a link button on the Middle Man page, and verify an audible notification arrives on the iPhone.

**Acceptance Scenarios**:

1. **Given** a client has a device registered for push notifications, **When** a customer taps a URL-type button on their Middle Man page, **Then** the client's iOS device receives a visible and audible push notification within 10 seconds.
2. **Given** a client has no registered device (never logged in on this device), **When** a customer taps a button, **Then** the system falls back to Progressier API delivery and no error occurs.
3. **Given** the client's iOS notification sound is enabled for the app, **When** the notification arrives, **Then** the device plays its default notification sound (not silent).

---

### User Story 2 — Client receives audible notification on iOS for a customer form submission (P1)

When a customer fills out and submits a form on the Middle Man page (e.g. a function enquiry or lost-and-found report), the client's iPhone receives an audible push notification indicating the form type submitted.

**Why this priority**: Form submissions are high-value customer contacts. Silent notifications mean missed leads.

**Independent Test**: Submit a form on a Middle Man page and verify an audible notification arrives on an enrolled iPhone.

**Acceptance Scenarios**:

1. **Given** a client has a registered device, **When** a customer submits any form on their Middle Man page, **Then** the client's iOS device receives an audible push notification within 10 seconds.
2. **Given** the push title and message are blank in the admin panel, **When** a form is submitted, **Then** the notification still arrives using the button label as the title and a generic submission message as the body.

---

### User Story 3 — Client receives audible notification on iOS for a missed call (P2)

When the system captures a missed call for a client, the client's iPhone receives an audible push notification.

**Why this priority**: Missed calls are the core product value event.

**Independent Test**: Trigger a missed-call event for a client with an enrolled iPhone and verify an audible notification arrives.

**Acceptance Scenarios**:

1. **Given** a client has a registered device, **When** a missed call is recorded for that client, **Then** an audible push notification arrives on the enrolled iOS device.
2. **Given** a client has no registered device, **When** a missed call is recorded, **Then** no push attempt is made and no error is logged.

---

### User Story 4 — Client receives audible notification on iOS when a booking is logged (P2)

When a booking is logged via the dashboard, the client's iPhone receives an audible notification.

**Why this priority**: Same delivery path as missed call; fixing one fixes both once subscriptions are in place.

**Independent Test**: Log a booking in the dashboard and verify an audible notification arrives on an enrolled iPhone.

**Acceptance Scenarios**:

1. **Given** a client has a registered device, **When** a booking is logged, **Then** an audible push notification arrives on the enrolled iOS device.

---

### User Story 5 — Device registers for push notifications at login (P1)

When a client logs into the CallMagnet PWA on any device and grants notification permission, that device is registered to receive push notifications automatically with no extra steps.

**Why this priority**: Without registration, no notifications can be delivered. This is the prerequisite for all other stories.

**Independent Test**: Log in to the PWA on a new device, grant permission when prompted, then trigger a notification event and confirm it arrives on that device.

**Acceptance Scenarios**:

1. **Given** a user logs into the dashboard for the first time on a device, **When** the browser prompts for notification permission and the user grants it, **Then** the device is registered and will receive future notifications.
2. **Given** a user has already granted permission on a device, **When** they log in again, **Then** their registration is refreshed without any new prompt.
3. **Given** a user denies notification permission or their browser does not support push notifications, **When** they log in, **Then** the dashboard loads normally with no error message and no interruption.
4. **Given** the PWA is installed on an iOS device running iOS 16.3 or earlier, **When** the user logs in, **Then** push registration is silently skipped (iOS Web Push requires 16.4+).

---

### Edge Cases

- What happens when a notification arrives while the app is open in the foreground? The OS displays it as usual; no special in-app interception is required.
- What happens when a subscription endpoint has expired? Delivery fails with an expiry signal; the stale record is removed automatically.
- What happens when a client has multiple devices registered? The notification is sent to all registered devices simultaneously.
- What happens when Progressier's API is unavailable during a link_tapped fallback? Delivery fails silently; no retry is attempted.
- What happens when a client reinstalls the PWA or clears app data? Their old subscription becomes invalid; the next login creates a fresh registration.
- What happens when the unsubscribe → subscribe race is lost twice? The implementation logs a console warning, skips enrollment for this login, and loads the dashboard normally. The next login retries from scratch.
- What happens to vapid_debug_log and vapidLog() after the fix is confirmed? Both MUST be removed — the table dropped and all vapidLog() call sites deleted from dashboard.js. This is a required cleanup step, not optional.

---

## Requirements

### Functional Requirements

- **FR-001**: On every successful dashboard login, the system MUST attempt to register the current device for push notifications using the browser's native push notification API. The VAPID subscription MUST be created only after any existing Progressier push subscription process has fully completed on the same service worker registration — not merely after the Progressier initialisation call has been issued. After subscribing, the implementation MUST verify that the active subscription uses our VAPID key; if it does not (indicating Progressier re-subscribed between our unsubscribe and subscribe calls), the implementation MUST retry the unsubscribe → subscribe sequence exactly once. If the retry also fails to secure our subscription, the implementation MUST log a console warning and silently skip enrollment for this login — the dashboard MUST load normally.
- **FR-002**: If the user denies notification permission, or if the browser/device does not support push notifications, the system MUST continue loading the dashboard normally without displaying any error or blocking the user.
- **FR-003**: A successful push subscription MUST be saved as an association between the device and the client account (one record per device per client, with deduplication on re-registration).
- **FR-004**: When any notification event fires for a client, the system MUST deliver the push to every device the client has registered.
- **FR-005**: Delivered notifications MUST display using the device's default notification sound; they MUST NOT be marked as silent.
- **FR-006**: Tapping a received notification MUST open https://callmagnet.com.au in the PWA or browser.
- **FR-007**: For link_tapped events where no device is registered for the client, the system MUST fall back to Progressier API delivery.
- **FR-008**: For missed_call and booking_logged events where no device is registered, the system MUST NOT attempt delivery and MUST NOT produce an error.
- **FR-009**: Push notification title and body MUST use admin-configured wording when set; MUST fall back to the button label (title) and a generic action message (body) when not set.
- **FR-010**: PWA installation flow, offline caching, manifest handling, and service worker lifecycle management MUST remain unchanged after this migration.
- **FR-011**: Stale or expired device registrations MUST be automatically removed when a delivery attempt to them fails with an expiry signal.

### Key Entities

- **Push Subscription**: Represents one device enrolled to receive notifications for one client. Key attributes: device endpoint URL, encryption keys, client association, last-used timestamp. One record per unique device per client.
- **Notification Event**: An action that triggers push delivery — one of: customer tapped a link button, customer submitted a form, client missed an incoming call, booking was logged. Each event carries a title and body for the notification.
- **Client**: The business owner who receives notifications. A client may have zero or many registered devices.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Push notifications triggered by button taps and form submissions produce an audible sound on enrolled iOS 16.4+ devices when the device's notification sounds are enabled for the app.
- **SC-002**: All three event types (button tap, form submission, missed call) successfully deliver push notifications to enrolled iOS devices within 10 seconds of the triggering action.
- **SC-003**: A device becomes enrolled for push notifications within the same login session as permission is granted, with no additional steps required from the user.
- **SC-004**: The PWA install prompt, offline behaviour, and page caching are unaffected — verifiable by reinstalling the PWA after the change and confirming all existing features work.
- **SC-005**: Enrolled Android and desktop devices continue to receive notifications without interruption after the migration.
- **SC-006**: Clients who have never logged into the dashboard continue to receive link_tapped notifications via the Progressier fallback path.

---

## Assumptions

- The VAPID key pair is already provisioned in the server-side secrets vault and does not need to be generated as part of this feature.
- iOS 16.4 or later is the minimum version for iOS Web Push support; devices on older iOS versions will silently receive no notifications and this is acceptable.
- Progressier remains active as the service worker chain entry point and for PWA manifest and install functionality; it is not being removed. Progressier's push subscription will be overwritten with ours on every login; this is intentional and our subscription always takes precedence. Because Progressier may re-subscribe with its own key during page initialisation, the implementation must detect and overwrite this on every login — not only on the first. Progressier's push delivery will silently fail for enrolled (logged-in) devices — this is acceptable. VAPID is the sole push channel for enrolled devices; the Progressier fallback applies only to clients with no entry in push_subscriptions.
- A client must have logged into the CallMagnet dashboard at least once on a device for that device to be enrolled; there is no out-of-band enrollment path.
- The push subscription store and write endpoint already exist and are correctly implemented; no database schema changes are required.
- The VAPID public key must be made available to the browser at runtime to create a compatible subscription; exposing the public key is safe because VAPID public keys are by design non-secret.
- Notification permission prompts are controlled entirely by the browser/OS; the app cannot force a re-prompt once a user has denied permission.
