# Quickstart Validation Guide: Own VAPID Push Notifications

**Feature**: `006-own-vapid-push` | **Date**: 2026-09-26

All tests are manual. Run them after both tasks are deployed and the Manual Go-Live Gate is confirmed.

---

## Prerequisites

- Task 1 (`send-client-notification` fallback) deployed.
- Task 2 (`dashboard.js` button + conditional `progressier.add()`) deployed.
- Progressier auto-subscribe setting checked and disabled (Manual Go-Live Gate, FR-003).
- Task 0 exploratory result recorded.
- Test client in Supabase with a Middle Man button that has `push_title` and `push_message` set.

---

## Test 1 — Button visible when no CallMagnet registration exists

**Setup**: Delete any row in `push_subscriptions` for the test client.

1. Log into the dashboard on iPhone (installed PWA).
2. **Expected**: "Turn on notifications" button is visible above the dashboard tiles.

---

## Test 2 — Tap registers device and hides button

**Setup**: Test 1 state.

1. Tap "Turn on notifications". Grant iOS permission.
2. **Expected**: Button disappears immediately (no page reload). A row appears in `push_subscriptions` for this client.

---

## Test 3 — Button stays hidden after reload

**Setup**: Test 2 state (valid registration).

1. Close and reopen the PWA.
2. **Expected**: Button is not visible.

---

## Test 4 — Button reappears if registration is replaced

**Setup**: Test 2 state.

1. In `push_subscriptions`, delete the row for the test client and insert a row with a different `p256dh` (simulating a Progressier overwrite).
2. Reload the dashboard.
3. **Expected**: Button reappears.

---

## Test 5 — Audible push on iPhone: Middle Man button tap

**Setup**: Test 2 state. iPhone screen off.

1. From another device, tap a Middle Man button with push wording set.
2. **Expected**: Notification arrives within 10 seconds with the default iOS alert sound. Title and body match `push_title` / `push_message`.

---

## Test 6 — Audible push on iPhone: missed call

**Setup**: Test 2 state.

1. Trigger a `missed_call` event (call the Twilio number and hang up, or POST directly to `send-client-notification` with `event: "missed_call"`).
2. **Expected**: Notification arrives within 10 seconds with sound. Title matches the missed-call template for the client's vertical.

---

## Test 7 — Progressier fallback fires when VAPID fails (transition regression test)

**Setup**: Insert a row in `push_subscriptions` for the test client with an invalid/expired endpoint.

1. POST to `send-client-notification` with `event: "missed_call"` or `event: "booking_logged"`.
2. **Expected**: `notifications_sent` shows a `failed` row for the VAPID attempt. Edge function logs contain `"vapid all failed, using progressier-fallback"`.

---

## Test 8 — `progressier.add()` not called on opted-in device

**Setup**: Test 2 state (valid CallMagnet registration).

1. Reload the dashboard. Open DevTools → Network, filter for `progressier.app`.
2. **Expected**: No request to `progressier.app`.

---

## Test 9 — `progressier.add()` still called when no registration

**Setup**: Test 1 state (no CallMagnet registration).

1. Load the dashboard. Open DevTools → Network, filter for `progressier.app`.
2. **Expected**: Request to `progressier.app` is made during page load.

---

## Test 10 — Button not rendered on non-push browser

**Setup**: Browser without Web Push support (e.g. Firefox on iOS).

1. Log into the dashboard.
2. **Expected**: "Turn on notifications" button is absent. No console errors.
