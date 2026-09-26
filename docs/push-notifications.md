# Push Notifications

## How it works today (26 Sep 2026)

- A customer taps a button or submits a form on the Middle Man page. This calls `log-middle-man-tap` or `submit-middle-man-form`, which then calls `send-client-notification`.
- `send-client-notification` sends via our own VAPID push first. If every VAPID send fails (e.g. Apple 400, expired endpoint), it falls back to Progressier's send API. This fallback applies to all three event types: `link_tapped`, `missed_call`, and `booking_logged`.
- The owner's phone registers for our push in `registerVapidPush` (`assets/js/dashboard.js`). The subscription is saved via the `save-push-subscription` edge function — one row per client in `push_subscriptions`, delete-before-insert.
- The service worker push handler (`service-worker.js`) always calls `showNotification`. It stops Progressier's own handler from running for notifications that come from our system (identified by `source: 'callmagnet-vapid'`).

---

## Things we learned the hard way

- **iPhone gives a website one push registration slot.** Progressier and our own VAPID system both use the same slot. Whichever one registers last owns it.
- **Progressier's "enable notifications" banner, if tapped, replaces the registration with Progressier's key.** Our sends then fail with Apple `400 VapidPkHashMismatch` because Apple enforces that the key used to send must match the key used to register. The banner appears automatically to unsubscribed owners in standalone (installed PWA) mode because `pushAutoPromptStandalone: true` is set in the Progressier dashboard config.
- **iPhone only allows subscribing to push when the user taps something.** Code cannot re-register on page load. Any `PushManager.subscribe()` call that happens outside a user gesture will be blocked by iOS. This means we cannot silently fix a mismatched registration — the owner must tap a button.
- **If a push arrives and no notification is shown, iPhone eventually cancels the registration.** The service worker push handler must always show a notification, even as a fallback with a generic title. Never add a code path that silently swallows a push.
- **Chrome drops tap logging during page navigation unless `sendBeacon` with `text/plain` is used.** `fetch` with `keepalive` is not enough — Chrome still drops it on some navigations. `sendBeacon` bypasses the CORS preflight that `application/json` would trigger.
- **`progressier.add()` only attaches the client ID to Progressier's user profile.** It does not register the phone for push, does not call `requestPermission()`, and does not create or replace a push subscription. The actual registration happens inside Progressier's `subscribeToPush()`, which is only called when a user interacts with Progressier's push UI.
- **Apple's rejection reason is in the response body, not just the status code.** Always log the full response body on failed VAPID sends, not just the HTTP status. The status alone (`400`) doesn't tell you whether it was `VapidPkHashMismatch`, `BadDeviceToken`, `ExpiredProviderToken`, or something else.

---

## Incident log

- **25 Sep 2026** — Progressier took the dashboard phone's push registration at approximately 09:59 UTC. From 12:17 UTC onwards, every VAPID send to that device failed with Apple `400 VapidPkHashMismatch`. Cause: the Progressier push permission banner was shown (because `pushAutoPromptStandalone: true`) and tapped, which called Progressier's `subscribeToPush()` using the `vapKey` configured in the Progressier dashboard — a different key from our VAPID key. Apple then rejected all our sends because we were signing with the wrong key for that registration. Fixed 26 Sep 2026 by adding the Progressier fallback to all three event paths (commits `9b283bf`, `e4e9117`). Owners now receive (silent) notifications via Progressier while the key mismatch exists. A permanent fix — a "Turn on notifications" button that re-registers with our key — is tracked in `specs/006-own-vapid-push/`.

---

## Change log

| Date | Commit | What changed | Why | Tested on phone? |
|------|--------|-------------|-----|-----------------|
| 23 Sep 2026 | `42a10ca` | `send-client-notification`: send push for every link button tap | Push notifications were only sent for specific button types | No |
| 23 Sep 2026 | `a1362eb` | `send-client-notification`: send push for every form submission with label fallback | Form submissions weren't triggering owner push | No |
| 24 Sep 2026 | `59d7090` | Expose `VAPID_PUBLIC_KEY` at build time, add `registerVapidPush` placeholder in `dashboard.js` | Foundation for own-key push registration | No |
| 24 Sep 2026 | `b60102a` | Implement VAPID push subscription at login with JWT auth | First working own-key registration on the dashboard | No |
| 24 Sep 2026 | `6919ff6` | Add push and `notificationclick` handlers to `service-worker.js` | Service worker needed to receive pushes and show notifications | No |
| 24 Sep 2026 | `40d1400` | Route `link_tapped` through VAPID with Progressier fallback | First event type to use our own key, fallback kept for transition | No |
| 24 Sep 2026 | `e34c070` | Temporary VAPID registration debug logging | Diagnosing registration failures | No |
| 24 Sep 2026 | `51e0598` | Unsubscribe Progressier push before VAPID subscribe, with retry | Progressier's registration was blocking ours from being created | No |
| 24 Sep 2026 | `27e06ce` | Delete old `push_subscriptions` rows before inserting | Prevent row buildup per client | No |
| 24 Sep 2026 | `ce08bef` | Log push arrival inside service worker to `vapid_debug_log` | Confirm pushes were arriving before showing | No |
| 24 Sep 2026 | `21c2655` | Always show notification to prevent iOS silent push penalty | iOS cancels registrations if pushes arrive without showing notifications | Yes |
| 24 Sep 2026 | `d59511f` | Reuse existing push subscription instead of unsubscribe/resubscribe on every login | Unsubscribing on every login was causing unnecessary churn | Yes |
| 24 Sep 2026 | `dbf61e8` | Recheck push subscription on `visibilitychange` to self-heal after iOS kills it | iOS kills service workers; subscription check on app foreground restores it | Yes |
| 25 Sep 2026 | `7ae346f` | Add CORS headers to `save-push-subscription` | CORS error was blocking subscription saves from the dashboard | No |
| 25 Sep 2026 | `116f77a` | Remove temporary VAPID debug logging from `dashboard.js` | Cleanup | No |
| 25 Sep 2026 | `702185e` | Remove temporary debug logging from service worker push handler | Cleanup | No |
| 26 Sep 2026 | `af8e6c5` | Log Apple push status code on failed sends | Need status code in logs to diagnose Apple rejections | No |
| 26 Sep 2026 | `05395a4` | Revert service worker push handler to last working version, bump cache to v74 | Service worker changes were breaking push display | Yes |
| 26 Sep 2026 | `98c6b4a` | Revert "remove temporary debug logging from service worker" | Was part of the broken SW batch | No |
| 26 Sep 2026 | `42e7f3b` | Revert "remove temporary vapid debug logging from dashboard" | Was part of the broken batch | No |
| 26 Sep 2026 | `ad9a33c` | Revert "add CORS headers to save-push-subscription" | Was part of the broken batch | No |
| 26 Sep 2026 | `3018a1d` | Log Apple push rejection reason (response body) on failed sends | Status code alone (`400`) doesn't identify the rejection type | No |
| 26 Sep 2026 | `69995d2` | Restore `dashboard.js` version bump after push reverts | Version had been rolled back by the revert chain | No |
| 26 Sep 2026 | `db27a62` | Replace push subscriptions not created with our VAPID key | Attempt to fix key mismatch automatically on page load | No |
| 26 Sep 2026 | `9b283bf` | Fall back to Progressier when every VAPID send fails (`link_tapped`) | Apple rejecting sends with `VapidPkHashMismatch`; owners were getting nothing | No |
| 26 Sep 2026 | `cdceb77` | Revert `db27a62` — keep Progressier registration intact until push rebuild | Auto-resubscribe on page load fails on iPhone (no user gesture); broke registration | No |
| 26 Sep 2026 | `1437905` | Bump `dashboard.js` to `v=20260926c` after revert | Cache-bust after revert chain | No |
| 26 Sep 2026 | `e4e9117` | Add Progressier fallback to `missed_call` and `booking_logged` paths | Same VapidPkHashMismatch failure was silently dropping missed call and booking notifications | No |
