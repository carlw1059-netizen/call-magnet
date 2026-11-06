# Contract: "Turn on notifications" button

**Feature**: `006-own-vapid-push` | **Date**: 2026-09-26

This contract describes the observable behaviour of the "Turn on notifications" UI element from the owner's perspective.

---

## Visibility rules

| Condition                                                                | Button state |
| ------------------------------------------------------------------------ | ------------ |
| Browser does not support Web Push                                        | Not rendered |
| Device has a valid CallMagnet-keyed push registration                    | Hidden       |
| Device has no push registration                                          | Visible      |
| Device has a registration made with a different key (e.g. Progressier's) | Visible      |

The check runs on every dashboard load. It is asynchronous (reads from the service worker) and completes before the button is rendered or hidden.

---

## On tap

1. `PushManager.subscribe()` is called with CallMagnet's VAPID public key. This is the **only** place a subscription is initiated — never on page load.
2. If the owner grants permission:
   - Subscription is sent to `save-push-subscription`.
   - Server success → button hidden immediately (no page reload).
   - Server failure → button stays visible; failure logged.
3. If the owner denies permission (`NotAllowedError`) → button stays visible; no error shown to owner.
4. Any other error → button stays visible; error logged.

---

## Invariants

- NEVER subscribes automatically on page load.
- NEVER unsubscribes an existing registration.
- On every page load, button state is re-derived from the live device state — no stale session cache.
