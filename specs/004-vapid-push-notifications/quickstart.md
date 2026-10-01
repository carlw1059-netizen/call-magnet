# Quickstart Validation Guide: VAPID Push Notifications

**Phase**: 1 — Design | **Date**: 2026-09-23

This guide describes how to validate the feature works end-to-end after implementation. Manual testing only.

---

## Prerequisites

- iOS 16.4+ device with CallMagnet PWA installed to Home Screen
- Netlify build deployed with `VAPID_PUBLIC_KEY` and `INTERNAL_SECRET` injected
- `CACHE_VERSION` bumped in `service-worker.js` (forces SW re-install on all devices)

---

## Validation Scenarios

### Scenario 1 — Device registration (SC-003)

1. Open callmagnet.com.au as installed PWA on iOS
2. Log in; when prompted tap Allow notifications
3. Check Supabase → `push_subscriptions` table, filter by `client_id`

**Pass**: New row present within 10 seconds with `endpoint`, `p256dh`, `auth`, `user_agent`.

---

### Scenario 2 — Re-login is idempotent (SC-003)

1. Log out, log in again on same device
2. Check `push_subscriptions` — same row, no duplicate

**Pass**: Row count unchanged, `created_at` unchanged.

---

### Scenario 3 — Link button tap → audible notification on iOS (SC-001, SC-002)

1. Device registered (Scenario 1 passed)
2. On another device, open the client's Middle Man page
3. Tap any URL-type button (e.g. "Menu")

**Pass**: iOS device plays default notification sound within 10 seconds. Silent = FAIL.

---

### Scenario 4 — Form submission → audible notification (SC-001, SC-002)

1. Tap a form button on the Middle Man page
2. Fill and submit the form

**Pass**: Same as Scenario 3 — audible notification within 10 seconds.

---

### Scenario 5 — Missed call → audible notification (SC-002)

1. Trigger a missed-call event for the test client

**Pass**: Audible notification on enrolled iOS device within 10 seconds.

---

### Scenario 6 — Fallback to Progressier when no subscription (SC-006)

1. Delete all rows for a test client from `push_subscriptions`
2. Trigger a button tap on their Middle Man page
3. Check `notifications_sent` for that client

**Pass**: Notification record exists (via Progressier). No error in edge function logs.

---

### Scenario 7 — PWA install and offline behaviour unchanged (SC-004)

1. Add CallMagnet to Home Screen on iOS Safari
2. Open as PWA; toggle Airplane Mode; navigate dashboard

**Pass**: PWA installs normally; offline behaviour unchanged.

---

### Scenario 8 — Permission denied does not break login (FR-002)

1. Log in on a device where push permission is denied

**Pass**: Dashboard loads normally, no error shown, no row in `push_subscriptions`.

---

## Post-Deploy Verification

1. Open `https://callmagnet.com.au/assets/js/dashboard.js` in browser devtools
2. Search for `%%VAPID_PUBLIC_KEY%%` — must NOT appear
3. Search for `%%INTERNAL_SECRET%%` — must NOT appear
4. DevTools → Application → Service Workers — `progressier.js` registered and active

---

## Rollback Signals

| Symptom | Likely cause |
|---------|-------------|
| No row in `push_subscriptions` after login | `registerVapidPush()` not wired or placeholder not injected |
| Row exists but no notification delivered | `send-client-notification` routing not changed |
| Notification arrives but silent | Service worker `push` handler missing or `source` discriminator mismatch |
| Notification arrives twice | Progressier's sw.js also handling — check `source` discriminator |
| PWA broken after deploy | SW re-install issue — verify CACHE_VERSION bump |
