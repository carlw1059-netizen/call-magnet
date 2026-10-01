# Data Model: VAPID Push Notifications

**Phase**: 1 — Design | **Date**: 2026-09-23

No schema changes are required. The `push_subscriptions` table already exists and is correct.

---

## Existing Entity: push_subscriptions

**Table**: `push_subscriptions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | Primary key |
| `client_id` | uuid | FK → clients.id |
| `endpoint` | text | Browser push endpoint URL (unique per device) |
| `p256dh` | text | ECDH public key (encryption) |
| `auth` | text | Auth secret (encryption) |
| `user_agent` | text | Browser/OS string, for diagnostics |
| `created_at` | timestamptz | Row creation time |
| `last_used_at` | timestamptz | Updated on each successful delivery |

**Unique constraint**: `(client_id, endpoint)` — one row per device per client, upserted on re-registration.

---

## Entity Lifecycle

### Registration

1. User logs in → `registerVapidPush()` in `dashboard.js`
2. Browser calls `PushManager.subscribe({ applicationServerKey: VAPID_PUBLIC_KEY })`
3. Returns `{ endpoint, keys: { p256dh, auth } }`
4. POST to `save-push-subscription` → `push_subscriptions` UPSERT

### Delivery

1. Edge function `send-client-notification` receives event
2. Queries `push_subscriptions WHERE client_id = ?`
3. Calls `webPush.sendNotification(subscription, payload)` for each row
4. On 410 Gone or 404: subscription expired → delete row

### Stale subscription cleanup

When `webPush.sendNotification` returns 410 (Gone) or 404, the endpoint has expired. The `send-client-notification` function deletes that row from `push_subscriptions`.

---

## Push Payload (runtime, not stored)

The VAPID push payload is a transient JSON object. Shape:

```json
{
  "source": "callmagnet-vapid",
  "title": "string",
  "body":  "string",
  "url":   "https://callmagnet.com.au"
}
```

- `source`: discriminator checked by `service-worker.js` push handler
- `title` / `body`: from admin config or auto-generated fallbacks
- `url`: always `https://callmagnet.com.au` (per spec FR-006)

---

## State Transitions

```
[No subscription]
      │
      │ User logs in + grants permission
      ▼
[Subscription active] ←──── User logs in again (UPSERT, no change)
      │
      │ Device removes PWA / clears storage
      ▼
[Subscription stale]
      │
      │ Delivery attempt → 410/404
      ▼
[Row deleted]
      │
      │ User logs in again
      ▼
[New subscription active]
```
