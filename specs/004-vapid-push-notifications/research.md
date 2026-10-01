# Research: VAPID Push Notifications

**Phase**: 0 — Pre-planning research | **Date**: 2026-09-23

---

## 1. Current push architecture (from codebase audit)

### Two parallel push systems exist

**System A — Progressier (link_tapped only)**
- Caller: `send-client-notification/index.ts` lines 309–321
- Endpoint: `https://progressier.app/9kXZoGF2Dlfeqec880My/send`
- Payload: `{ recipients: { id: clientId }, title, body, url }`
- Device identification: Progressier's own managed subscriber list, keyed by `clientId`
- Registration: `progressier.add({ id: currentClient.id })` in `dashboard.js` at login
- Problem: Progressier delivers silently on iOS. Their hosted sw.js does not produce an audible sound.

**System B — VAPID web-push (missed_call, booking_logged)**
- Caller: `send-client-notification/index.ts` lines 387–404
- Library: `npm:web-push@3.6.7` (already imported)
- Endpoint: each row in `push_subscriptions WHERE client_id = ?`
- Payload: `{ title, body, event, context }` (current shape; will gain `source` discriminator)
- Device identification: `push_subscriptions` table — one row per device per client
- Registration: NOT currently wired from frontend; `save-push-subscription` edge function exists but `PushManager.subscribe()` is never called in `dashboard.js`

### Key finding: VAPID system is half-built
The server-side VAPID fan-out works for `missed_call`/`booking_logged` but `push_subscriptions` is always empty because no frontend code ever calls `PushManager.subscribe()`. This is why iOS never gets VAPID pushes — no subscriptions exist to deliver to.

---

## 2. Service worker chain

```
progressier.js (entry point, registered as SW at /progressier.js)
├── importScripts('https://progressier.app/9kXZoGF2Dlfeqec880My/sw.js')
│   └── Handles: push (Progressier pushes), notification display, PWA install
└── importScripts('/service-worker.js')
    └── Handles: install, activate, fetch (cache logic only)
    └── Does NOT have: push handler, notificationclick handler
```

Adding a `push` handler to `service-worker.js` co-exists with Progressier's because both fire for every push via `addEventListener`. The `source: 'callmagnet-vapid'` discriminator prevents double-notification without touching Progressier's code.

---

## 3. Netlify build injection pattern

Current `netlify.toml` (paraphrased):
```bash
CLEAN_URL=$(echo -n "$SUPABASE_URL" | tr -d '\n\r')
CLEAN_ANON=$(echo -n "$SUPABASE_ANON_KEY" | tr -d '\n\r')
sed -i 's|%%SUPABASE_URL%%|'"$CLEAN_URL"'|g' assets/js/dashboard.js ...
sed -i 's|%%SUPABASE_ANON_KEY%%|'"$CLEAN_ANON"'|g' [same files]
```

Pattern: `%%PLACEHOLDER%%` in source files → env var injection at build time. The same pattern will be used for `%%VAPID_PUBLIC_KEY%%` and `%%INTERNAL_SECRET%%` in `dashboard.js`.

---

## 4. VAPID public key safety

VAPID public keys are by design public. The W3C Web Push spec requires the server's VAPID public key to be sent to the browser when creating a subscription. Embedding it in `dashboard.js` is correct and safe. The private key stays server-side only.

---

## 5. INTERNAL_SECRET in frontend

`save-push-subscription/index.ts` contains an explicit code comment approving frontend exposure: "the frontend ships the secret in the index.html bundle for now — fine because the secret only gates a low-stakes write, and any direct push_subscriptions access still requires service_role".

---

## 6. iOS Web Push requirements

- Requires iOS 16.4 or later
- Requires HTTPS (satisfied: callmagnet.com.au)
- Requires PWA installed to Home Screen
- `showNotification()` must NOT include `silent: true` to get audio (our handler does not set it)
- Permission prompt fires once; re-grant only via device Settings

---

## 7. Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Expose VAPID public key | Build-time sed injection (netlify.toml) | Consistent with existing SUPABASE_URL pattern |
| Expose INTERNAL_SECRET to frontend | Build-time sed injection (netlify.toml) | Explicitly approved in save-push-subscription code comment |
| Service worker co-existence | `source` discriminator in payload | Prevents double-notification without touching Progressier |
| Fallback for link_tapped, no subscriptions | Progressier API | Per spec FR-007 |
| No fallback for missed_call / booking_logged | Skip | Per spec FR-008; existing behaviour |
| When to call registerVapidPush() | After progressier.add() on every login | Per spec: always upsert |
| Notification click destination | https://callmagnet.com.au | Per spec FR-006 |
