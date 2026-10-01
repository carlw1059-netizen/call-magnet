# Feature Specification: Own VAPID Push Notifications

**Feature Branch**: `006-own-vapid-push`

**Created**: 2026-09-26

**Status**: Draft

**Input**: User description: "Feature: Own push notifications on the dashboard, with sound on iPhone, without Progressier interfering."

---

## Background

A business owner installs the CallMagnet dashboard as a PWA on their phone. When a customer taps a Middle Man button or a call is missed, the owner receives a push notification.

Currently two systems compete for the device's single push registration slot: CallMagnet's own VAPID-based system and Progressier. On 25 September 2026 Progressier overwrote the registration with its own VAPID key. Apple now rejects all CallMagnet-originated sends (`400 VapidPkHashMismatch`). Notifications still arrive via Progressier fallback but arrive silently on iPhone because Progressier-delivered pushes do not trigger the device's default notification sound.

This feature removes the conflict by making CallMagnet the sole owner of every push registration and giving the owner a one-tap dashboard control to re-subscribe whenever the registration is lost.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — First-time notification opt-in (Priority: P1)

A business owner opens the CallMagnet dashboard on their iPhone for the first time after this feature ships. They see a prominent "Turn on notifications" button. They tap it once, are prompted by the browser to allow notifications, and grant permission. The button disappears. The next customer interaction triggers a push notification that arrives with the device's default alert sound.

**Why this priority**: Without this story there is no path for any owner to receive audible push notifications. It is the core unlock for the entire feature.

**Independent Test**: Can be fully tested by opening the dashboard on a freshly installed PWA, tapping the button, granting permission, and confirming the button is gone and a test notification arrives with sound.

**Acceptance Scenarios**:

1. **Given** the owner opens the dashboard and has no push registration linked to CallMagnet's VAPID key, **When** the page finishes loading, **Then** a "Turn on notifications" button is visible in the dashboard.
2. **Given** the "Turn on notifications" button is visible, **When** the owner taps it and grants browser permission, **Then** the registration is saved and the button disappears.
3. **Given** a valid registration is saved, **When** the owner reloads the dashboard, **Then** the "Turn on notifications" button does not appear.
4. **Given** the owner has granted permission but the registration is lost or replaced by a third party, **When** the owner loads the dashboard, **Then** the "Turn on notifications" button reappears.

---

### User Story 2 — Audible notification on iPhone after customer interaction (Priority: P1)

A business owner has opted in. A customer taps a Middle Man button. The owner's iPhone (screen off, app not open) receives a push notification that plays the default iOS alert sound and displays the notification title and body from the button's push wording.

**Why this priority**: This is the primary value of the feature. Silent notifications on iPhone are the confirmed problem being solved.

**Independent Test**: Can be tested end-to-end by having a customer tap a configured Middle Man button, then confirming sound and content on the owner's locked iPhone.

**Acceptance Scenarios**:

1. **Given** the owner has a valid registration made with CallMagnet's VAPID key, **When** a customer taps a Middle Man button with push wording set, **Then** the owner's device receives a push notification with the correct title, body, and the device's default alert sound within 10 seconds.
2. **Given** the owner has a valid registration, **When** a missed call is captured, **Then** a push notification with the appropriate missed-call wording arrives with sound.
3. **Given** the owner has a valid registration, **When** a booking is logged from the dashboard, **Then** a push notification with the booking-logged wording arrives with sound.

---

### User Story 3 — Progressier limited to install prompt only (Priority: P2)

Progressier continues to show the "Add to Home Screen" install prompt and provide the PWA manifest/icon on every device, but it does not register the device for push notifications, does not hold a push subscription, and does not deliver any push notifications.

**Why this priority**: Necessary to prevent future registration conflicts, but secondary to the positive subscription flow.

**Independent Test**: Can be tested by inspecting `push_subscriptions` after loading the dashboard — only CallMagnet-keyed entries should be present. No Progressier-managed subscription should exist.

**Acceptance Scenarios**:

1. **Given** Progressier is loaded on the dashboard, **When** the page loads (without a user tap on "Turn on notifications"), **Then** no push subscription is created or modified.
2. **Given** the owner has a CallMagnet registration, **When** Progressier loads, **Then** the existing registration remains unchanged (endpoint and key are not replaced).
3. **Given** the owner has not yet tapped "Turn on notifications", **When** Progressier's install prompt fires, **Then** the install prompt appears as normal (unaffected).

**Progressier push isolation approach (confirmed)**: `progressier.add()` MUST only be called on devices that do NOT yet have a push registration made with CallMagnet's VAPID key. Once a device has a valid CallMagnet registration (i.e., the owner has tapped "Turn on notifications"), `progressier.add()` MUST NOT be called on that device again. This keeps Progressier delivering notifications via its fallback path for clients who have not yet opted in, while preventing it from overwriting the registration for clients who have.

**Progressier dashboard setting — FLAG FOR CARL**: The Progressier dashboard may contain an automatic push permission prompt or auto-subscribe toggle that operates independently of `progressier.add()`. Before this feature ships, Carl must check the Progressier dashboard for any such setting and disable it. The exact setting name is unknown — do not assume. This is a manual verification step required before go-live.

---

### User Story 4 — Button absent on non-push-capable browsers (Priority: P3)

On a browser that does not support Web Push, the "Turn on notifications" button does not appear, and no error is shown.

**Why this priority**: Edge case; primary audience is mobile owners, but non-push environments must not show a broken UI element.

**Independent Test**: Open the dashboard in a browser without Web Push support and confirm the button is absent.

**Acceptance Scenarios**:

1. **Given** the owner opens the dashboard in a browser that does not support Web Push, **When** the page loads, **Then** the "Turn on notifications" button is not rendered.
2. **Given** the owner opens the dashboard in a supported desktop browser, **When** the page loads and no registration exists, **Then** the "Turn on notifications" button is visible and functional.

---

### Edge Cases

- What happens if the owner taps "Turn on notifications" but denies the browser permission prompt? The button must remain visible so they can try again (on supported browsers; iOS blocks re-prompting after a denial until the owner manually changes settings).
- What happens if the owner's device changes its push endpoint (e.g., after re-installing the app)? The button must reappear on the next dashboard load because the stored registration will no longer match the device.
- What happens if saving the registration to the server fails? The button must remain visible; no silent failure.
- What if a `push_subscriptions` row exists but was registered with a different VAPID key (the Progressier conflict case)? The dashboard must treat this as "not subscribed with our key" and show the button.
- What if the owner has multiple devices? Each device has its own registration row; notifications fan out to all of them (existing behaviour preserved).

---

## Requirements *(mandatory)*

### Functional Requirements

**Push registration ownership**

- **FR-001**: `progressier.add()` MUST only be called when the current device does NOT have a valid push registration made with CallMagnet's VAPID key.
- **FR-002**: Once a device has a valid CallMagnet registration, `progressier.add()` MUST NOT be called on that device on any subsequent page load.
- **FR-003**: Before this feature ships, Carl MUST verify and disable any automatic push-permission or auto-subscribe setting in the Progressier dashboard. This is a manual go-live gate.
- **FR-004**: The dashboard MUST be the sole origin of push registrations for devices where the owner has opted in.

**Pre-build exploratory gate**

- **FR-005**: Before any code that conditionally skips `progressier.add()` is deployed, a manual exploratory test MUST be completed: on a device that has never had `progressier.add()` called, confirm whether the PWA install prompt still appears. The result MUST be recorded and reviewed before proceeding.

**"Turn on notifications" button**

- **FR-006**: The dashboard MUST display a "Turn on notifications" button when the current device has no valid push registration associated with CallMagnet's VAPID key.
- **FR-007**: The button MUST only initiate a subscription attempt in direct response to a user tap — NEVER automatically on page load.
- **FR-008**: When the owner taps the button and grants permission, the system MUST register the device with CallMagnet's VAPID key and save the subscription server-side.
- **FR-009**: After a successful registration, the button MUST disappear without requiring a page reload.
- **FR-010**: If the owner taps the button and denies browser permission, the button MUST remain visible.
- **FR-011**: If saving the registration to the server fails, the button MUST remain visible and the failure MUST be logged.
- **FR-012**: On every dashboard load, the system MUST check whether the device has a valid CallMagnet-keyed registration and show or hide the button accordingly.
- **FR-013**: The button MUST NOT be rendered on browsers or environments that do not support Web Push.

**Notification delivery**

- **FR-014**: All push notifications (link_tapped, missed_call, booking_logged) MUST be delivered using CallMagnet's own VAPID key.
- **FR-015**: Notifications delivered via CallMagnet's VAPID path MUST trigger the device's default alert sound on iPhone (installed PWA) without additional configuration by the owner.
- **FR-016**: The Progressier fallback path in the notification dispatcher MUST remain active as a safety net. It will be removed in a later task once all active clients hold a valid CallMagnet registration.

**Scope constraints**

- **FR-017**: No changes MUST be made to the Middle Man page (`b.html`, `cm1site/b.html`), its CSS, JavaScript, or any video/autoplay code.
- **FR-018**: The existing rule of one `push_subscriptions` row per client (delete-before-insert) MUST be preserved.

### Key Entities

- **Push Registration**: A device-specific subscription record (endpoint URL, public encryption key, auth token) linked to one client. Created only via an explicit owner tap on "Turn on notifications".
- **VAPID Key Pair**: CallMagnet's canonical cryptographic identity used to sign push requests. Any registration made with a different key pair is invalid for CallMagnet's delivery path and triggers the "Turn on notifications" button.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After opting in via the button on an iPhone (installed PWA), 100% of test push notifications arrive with an audible alert sound within 10 seconds of the triggering event.
- **SC-002**: After this feature ships, zero VAPID push attempts result in `VapidPkHashMismatch` for any client whose device has registered via the new button.
- **SC-003**: Completing the opt-in flow requires exactly one tap on the button and one browser permission grant — no multi-step wizard, no settings detour.
- **SC-004**: The button's visible/hidden state correctly reflects the device's current registration status on every dashboard load (no false positives, no false negatives).
- **SC-005**: Progressier's install prompt continues to fire normally on all devices after push registration is restricted.

---

## Assumptions

- The device's default notification sound plays automatically on iPhone when the VAPID-delivered payload does not suppress sound. No custom sound file needs to be bundled. This must be verified on a real device during testing.
- Whether skipping `progressier.add()` on a device affects the PWA install prompt is unknown and must be tested before shipping. Progressier's documentation describes the install prompt as separate from push, but this is unproven in the live app. **An exploratory task must run first**: on a device that has never had `progressier.add()` called, confirm the install prompt still appears. Record the result before any code that conditionally skips `progressier.add()` is deployed.
- The existing `save-push-subscription` edge function and `push_subscriptions` table require no structural changes — only the client-side subscription flow changes.
- Clients who have not re-subscribed after this feature ships will continue to receive notifications via the Progressier fallback until they next log in and tap "Turn on notifications".
- All three target platforms (iPhone installed PWA iOS 16.4+, Android Chrome, desktop Chrome/Edge/Firefox) support the standard Web Push API.
- The owner's device can receive push notifications when the app is closed; this is standard behaviour for installed PWAs on iOS 16.4+ and Android and requires no additional server configuration.
