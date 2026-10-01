# Data Model: Own VAPID Push Notifications

**Feature**: `006-own-vapid-push` | **Date**: 2026-09-26

---

## Existing tables — no schema changes

### `push_subscriptions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Row identifier |
| `client_id` | uuid (FK → clients) | The business owner this registration belongs to |
| `endpoint` | text | The push service URL for this device |
| `p256dh` | text | Device public key (base64url) |
| `auth` | text | Auth secret (base64url) |
| `last_used_at` | timestamptz | Updated on each successful VAPID send |
| `created_at` | timestamptz | When the row was created |

**Key constraint**: One row per `client_id` enforced by `save-push-subscription` (delete-before-insert). This feature does not change that constraint. **No new columns, no new tables, no migrations.**

---

## In-browser runtime state (not persisted)

### `hasValidReg` (boolean, session-scoped)

Cached result of `vapidKeyMatches()`. Set once after client data loads. Used to decide:
- Whether to render the "Turn on notifications" button.
- Whether to call `progressier.add()`.

Derived fresh on every page load from the live `PushSubscription` object. Not stored in `localStorage` or `sessionStorage`.

---

## What `vapidKeyMatches()` compares

The `PushSubscription` stores the server's public key as raw bytes in `options.applicationServerKey` (an `ArrayBuffer`). Our VAPID public key is distributed as a URL-safe base64 string. `vapidKeyMatches()` converts both to the same byte array and compares them element-by-element.

| Scenario | `vapidKeyMatches()` result | Button |
|----------|---------------------------|--------|
| No push subscription on device | `false` | Visible |
| Subscription with Progressier's key | `false` | Visible |
| Subscription with CallMagnet's key | `true` | Hidden |

---

## Entity relationships (unchanged)

```
clients (1) ──< push_subscriptions (0..* per client, one per device)
```

Delete-before-insert in `save-push-subscription` means re-registering on the same device replaces the old row for that `client_id`. Multiple devices for one client each have their own row; fan-out is already implemented.
