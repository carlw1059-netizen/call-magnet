# Implementation Plan: VAPID Push Notifications

**Branch**: `004-vapid-push-notifications` | **Date**: 2026-09-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-vapid-push-notifications/spec.md`

---

## Summary

Replace Progressier API delivery for all notification events with direct W3C Web Push (VAPID) delivery, so iOS 16.4+ devices receive audible notification sounds. The existing `push_subscriptions` table and `save-push-subscription` edge function are used as-is. Four files change: credential injection in `index.html` build process, subscription registration in `dashboard.js`, a push event handler in `service-worker.js`, and delivery routing in `send-client-notification/index.ts`. Progressier remains active for PWA install, manifest, and service worker chaining.

---

## Technical Context

**Language/Version**: JavaScript (browser, ES2020+), TypeScript (Deno Edge Functions)

**Primary Dependencies**:
- `npm:web-push@3.6.7` — already imported in `send-client-notification`; provides VAPID-signed Web Push delivery
- W3C Push API (`PushManager`) — browser-native; no new library needed
- Supabase JS SDK — already loaded; used for auth token retrieval

**Storage**: `push_subscriptions` table (PostgreSQL via Supabase) — already exists. Schema: `id`, `client_id`, `endpoint`, `p256dh`, `auth`, `user_agent`, `created_at`, `last_used_at`. Unique on `(client_id, endpoint)`.

**Testing**: Manual device testing (no automated test framework in this project). Required: real iOS 16.4+ device with CallMagnet PWA installed.

**Target Platform**: iOS 16.4+ (primary goal), Android Chrome, desktop PWA. Edge Function runtime: Deno.

**Constraints**:
- VAPID_PUBLIC_KEY and INTERNAL_SECRET must be available to the browser at runtime — injected at build time via netlify.toml sed, same as `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- Service worker push handler must co-exist with Progressier's hosted `sw.js` handler in the same chain. A `source` discriminator in the payload separates our pushes from Progressier's.
- `service-worker.js` CACHE_VERSION must be bumped alongside this change to force re-installation of the new service worker on all existing devices.

---

## Constitution Check

Constitution is unpopulated (template only) — no project-specific gates to enforce. No violations.

---

## Project Structure

### Documentation (this feature)

```
specs/004-vapid-push-notifications/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   ├── save-push-subscription.md
│   └── send-client-notification.md
└── tasks.md             ← /speckit-tasks output (not yet created)
```

### Source Code (files that change)

```
index.html                                          ← add VAPID_PUBLIC_KEY + INTERNAL_SECRET placeholders
netlify.toml                                        ← add VAPID_PUBLIC_KEY + INTERNAL_SECRET sed injection
assets/js/dashboard.js                              ← add registerVapidPush() called at login
service-worker.js                                   ← add push + notificationclick event handlers; bump CACHE_VERSION
supabase/functions/send-client-notification/
└── index.ts                                        ← route link_tapped through VAPID fan-out with Progressier fallback
```

**Unchanged** (confirmed working, do not touch):

```
supabase/functions/save-push-subscription/index.ts  ← already correct
supabase/migrations/                                 ← no schema changes needed
progressier.js                                       ← stays as-is (SW chaining entry point)
assets/css/dashboard.css                             ← no UI changes
```

---

## Complexity Tracking

No constitution violations — table not required.

---

## Change Details by File

### 1. `netlify.toml` + `index.html` / `dashboard.js`

**Problem**: `PushManager.subscribe()` requires the VAPID public key as an `applicationServerKey`. `save-push-subscription` requires `X-Internal-Secret`. Neither is currently available in the browser.

**Approach**: Follow the existing `%%SUPABASE_URL%%` / `%%SUPABASE_ANON_KEY%%` injection pattern in netlify.toml. The code comment in `save-push-subscription/index.ts` explicitly documents and approves frontend exposure of INTERNAL_SECRET ("the frontend ships the secret in the index.html bundle for now — fine because the secret only gates a low-stakes write, and any direct push_subscriptions access still requires service_role").

**netlify.toml changes**:
- Add `CLEAN_VAPID=$(echo -n "$VAPID_PUBLIC_KEY" | tr -d '\n\r')` and a `sed -i 's|%%VAPID_PUBLIC_KEY%%|...|g'` pass over `dashboard.js`
- Add `CLEAN_INTERNAL=$(echo -n "$INTERNAL_SECRET" | tr -d '\n\r')` and a `sed -i 's|%%INTERNAL_SECRET%%|...|g'` pass over `dashboard.js`
- Both environment variables are already set in the Netlify project (they exist in the Edge Functions Vault)

**dashboard.js changes** (top of file, alongside existing `SUPABASE_URL` / `SUPABASE_ANON_KEY` declarations):
```
const VAPID_PUBLIC_KEY = '%%VAPID_PUBLIC_KEY%%';
const INTERNAL_SECRET  = '%%INTERNAL_SECRET%%';
```

---

### 2. `assets/js/dashboard.js` — `registerVapidPush()`

**Where it runs**: Called immediately after `progressier.add({ id: currentClient.id })` in `loadDashboard()` (currently lines 314–315). Both Progressier registration and VAPID registration happen on every login.

**Logic**:
1. Guard: if `!('serviceWorker' in navigator) || !('PushManager' in window)` → return silently.
2. Await `navigator.serviceWorker.ready` to get the SW registration.
3. Call `reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) })`.
4. Extract `endpoint`, `p256dh` (from `getKey('p256dh')`), `auth` (from `getKey('auth')`) from the subscription.
5. POST to `${SUPABASE_URL}/functions/v1/save-push-subscription` with headers `X-Internal-Secret: INTERNAL_SECRET`, `Content-Type: application/json`, and body `{ client_id: currentClient.id, endpoint, p256dh, auth, user_agent: navigator.userAgent }`.
6. Any error at any step → `console.warn(...)` and return. Do not propagate to the login flow.

**Helper**: `urlBase64ToUint8Array(base64String)` — converts the VAPID public key from URL-safe base64 to `Uint8Array`. Standard implementation, ~5 lines.

---

### 3. `service-worker.js` — push + notificationclick handlers

**Discriminator pattern**: Our VAPID push payload includes `source: 'callmagnet-vapid'`. Our `push` handler checks for this field. If absent (i.e. the push came via Progressier's path), our handler does nothing and Progressier's sw.js handles it. If present, our handler shows the notification.

**push handler**:
```
self.addEventListener('push', (event) => {
  let data = { title: 'CallMagnet', body: 'New notification' };
  try { data = event.data.json(); } catch (_) {}
  if (data.source !== 'callmagnet-vapid') return;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:  data.body,
      icon:  '/android-chrome-192x192.png',
      badge: '/favicon-32x32.png',
      data:  { url: data.url || 'https://callmagnet.com.au' },
      tag:   'callmagnet-notification',
    })
  );
});
```

**notificationclick handler**:
```
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith('https://callmagnet.com.au') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(event.notification.data?.url || 'https://callmagnet.com.au');
    })
  );
});
```

**CACHE_VERSION**: Must be bumped in the same commit so existing devices re-install the service worker and gain the push handler.

---

### 4. `supabase/functions/send-client-notification/index.ts` — link_tapped routing

**Current**: `link_tapped` calls Progressier API unconditionally.

**New**:
1. Fetch `push_subscriptions` for the client (reuse the existing query pattern already in the file for `missed_call`/`booking_logged`).
2. If subscriptions exist (length > 0): use VAPID fan-out (same `webPush.sendNotification` loop already used for `missed_call`/`booking_logged`). Use payload `{ source: 'callmagnet-vapid', title: ltTitle, body: ltBody, url: 'https://callmagnet.com.au' }`.
3. If no subscriptions: fall back to Progressier API (existing call, unchanged).
4. `logNotification` call is kept in both paths.

---

## Payload Format (VAPID pushes only)

```json
{
  "source": "callmagnet-vapid",
  "title": "Menu",
  "body": "Someone tapped \"Menu\" on your page",
  "url": "https://callmagnet.com.au"
}
```

The `source` field is the discriminator. The service worker checks `data.source !== 'callmagnet-vapid'` before calling `showNotification`.

---

## Sequence Diagrams

### Happy path — link_tapped, client has subscriptions

```
Customer taps button
  → middleman.js → log-middle-man-tap edge fn
    → send-client-notification (link_tapped)
      → fetch push_subscriptions (finds rows)
      → web-push.sendNotification(endpoint, { source:'callmagnet-vapid', title, body, url })
        → FCM/APNs push service
          → iOS device receives push
            → service-worker.js push handler fires
              → checks source === 'callmagnet-vapid' ✓
              → showNotification(title, { body, icon, tag }) ← plays sound
```

### Fallback path — link_tapped, client has no subscriptions

```
Customer taps button
  → ... → send-client-notification (link_tapped)
    → fetch push_subscriptions (empty)
    → Progressier API call (unchanged)
      → Progressier → device (silent, existing behaviour)
```

### Device registration — first login

```
User logs into dashboard
  → loadDashboard()
    → progressier.add({ id: clientId })    ← Progressier registration (unchanged)
    → registerVapidPush()                  ← new
      → navigator.serviceWorker.ready
      → pushManager.subscribe({ applicationServerKey: VAPID_PUBLIC_KEY })
        → browser prompts for permission (first time only)
        → subscription created
      → POST save-push-subscription { client_id, endpoint, p256dh, auth }
        → push_subscriptions UPSERT
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Progressier's sw.js shows a duplicate notification for our VAPID push | Low | Medium | `source` discriminator prevents our handler firing on Progressier pushes; Progressier's handler won't recognize our payload format |
| VAPID_PUBLIC_KEY injection missing from netlify.toml causes `%%VAPID_PUBLIC_KEY%%` literal in production | Medium | High | Verify placeholder is replaced post-deploy by checking dashboard.js in browser devtools |
| iOS 16.4 Safari requires HTTPS and PWA installation before Web Push works | Known constraint | Medium | Document in quickstart; test on installed PWA only |
| Existing devices don't re-install service worker | Medium | High | CACHE_VERSION bump forces re-install on next page load |
| `pushManager.subscribe()` throws if notification permission was previously denied | Low | Low | Wrapped in try/catch; silent skip |
