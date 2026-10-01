# Research: Own VAPID Push Notifications

**Feature**: `006-own-vapid-push` | **Date**: 2026-09-26

---

## Decision 1: Detecting whether the current device has a CallMagnet-keyed registration

**Decision**: Compare the `applicationServerKey` stored in the browser's `PushSubscription` against our VAPID public key in `vapidKeyMatches()`. Restore this function from reverted commit `db27a62`.

**Rationale**: The `PushSubscription` object exposes `options.applicationServerKey` as an `ArrayBuffer`. Converting both keys to the same byte representation gives a definitive answer with no server round-trip. The function was already implemented and working — it was reverted for an unrelated reason (the subscription-replacement logic that surrounded it), not because the check itself was wrong.

**Alternatives considered**:
- Server round-trip (look up `push_subscriptions` by `client_id`): Adds latency on every page load; fails if offline. Rejected.
- localStorage flag: Can be stale or cleared by the browser; does not detect a Progressier overwrite. Rejected.

---

## Decision 2: "Turn on notifications" button placement

**Decision**: Inject the button dynamically from `dashboard.js` at the top of the dashboard content area, after login, above the existing tiles. Rendered only when `vapidKeyMatches()` returns false.

**Rationale**: The dashboard is built dynamically by `dashboard.js`. Injecting from JS is consistent with the existing pattern. The button must be prominent and immediately visible after the owner logs in.

**Alternatives considered**:
- Static HTML in `index.html`: Requires JS to manage visibility on every load regardless. No advantage. Rejected.
- Modal/overlay on login: Too intrusive for a one-time action. Rejected.

---

## Decision 3: Cache the `vapidKeyMatches()` result for the `progressier.add()` guard

**Decision**: Cache the result of `vapidKeyMatches()` from the page-load check and reuse it when deciding whether to call `progressier.add()`.

**Rationale**: The registration cannot change without a user tap, so the result is stable for the entire session. Calling the service worker API twice for the same answer is unnecessary.

---

## Decision 4: Progressier fallback for `missed_call` and `booking_logged`

**Decision**: Add the identical "if no VAPID send succeeded, fall through to Progressier" guard to `missed_call` and `booking_logged` in `send-client-notification`. Ships as Task 1.

**Rationale**: During the transition, clients with Progressier-keyed registrations receive `400 VapidPkHashMismatch` on every CallMagnet VAPID send. Without a fallback, those clients receive **no notification** for missed calls and bookings. A silent Progressier notification is better than nothing for high-stakes business events. The identical guard already exists for `link_tapped` (commit `9b283bf`).

**Alternatives considered**:
- Accept notification loss during transition: Unacceptable for missed calls and bookings. Rejected.
- Delete stale rows on page load: Requires automatic unsubscription; iPhone blocks re-registration without a user tap. Rejected.

---

## Decision 5: `service-worker.js` — no changes

**Decision**: No changes to `service-worker.js`.

**Rationale**: The push handler already calls `showNotification` for all pushes and stops Progressier's handler for `source: 'callmagnet-vapid'` payloads. The default iOS notification sound fires automatically via `showNotification` when sound is not suppressed. The handler is already correct.

---

## Decision 6: `save-push-subscription` and `push_subscriptions` schema — no changes

**Decision**: No changes to the edge function or table schema.

**Rationale**: The function already implements delete-before-insert (one row per client). The new dashboard flow calls the same endpoint on button tap. No new fields are needed.

---

## Known unknowns at research time

1. **iPhone default sound**: Assumed to fire automatically when the VAPID payload does not suppress it. Must be confirmed on a real device during Task 2 acceptance testing.

2. **Progressier auto-subscribe dashboard setting**: Unknown whether it exists. Carl must check and disable it before Task 2 ships (Manual Go-Live Gate, FR-003).

3. **Install prompt with conditional `progressier.add()`**: Task 0 (exploratory, no code) resolves this before Task 2 ships.
