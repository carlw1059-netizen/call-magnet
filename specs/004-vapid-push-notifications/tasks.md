# Tasks: VAPID Push Notifications

**Input**: Design documents from `specs/004-vapid-push-notifications/`

**User instructions**: One file per task. One commit per task. Version strings bumped where needed. Every commit includes `git push origin main`.

---

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to

---

## Phase 1: Setup (Credential Injection — Foundational)

**Purpose**: Make `VAPID_PUBLIC_KEY` and `INTERNAL_SECRET` available to the browser at runtime. Prerequisite for all user stories.

**?? CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T001 Add `VAPID_PUBLIC_KEY` and `INTERNAL_SECRET` sed injection to `netlify.toml` and add `%%VAPID_PUBLIC_KEY%%` / `%%INTERNAL_SECRET%%` placeholder constant declarations to `assets/js/dashboard.js` (top of file, alongside existing `SUPABASE_URL` / `SUPABASE_ANON_KEY` lines). Both changes go in one commit since they are a pair.

  **What to add to netlify.toml**: Two new sed passes (following the existing `SUPABASE_URL` / `SUPABASE_ANON_KEY` pattern):
  ```
  CLEAN_VAPID=$(echo -n "$VAPID_PUBLIC_KEY" | tr -d '\n\r')
  CLEAN_INTERNAL=$(echo -n "$INTERNAL_SECRET" | tr -d '\n\r')
  sed -i 's|%%VAPID_PUBLIC_KEY%%|'"$CLEAN_VAPID"'|g' assets/js/dashboard.js
  sed -i 's|%%INTERNAL_SECRET%%|'"$CLEAN_INTERNAL"'|g' assets/js/dashboard.js
  ```

  **What to add to dashboard.js** (lines 8–9, after existing consts):
  ```
  const VAPID_PUBLIC_KEY = '%%VAPID_PUBLIC_KEY%%';
  const INTERNAL_SECRET  = '%%INTERNAL_SECRET%%';
  ```

  **Commit**: `feat: inject VAPID_PUBLIC_KEY and INTERNAL_SECRET into dashboard.js at build time && git push origin main`

  **Verification**: After deploy, open `https://callmagnet.com.au/assets/js/dashboard.js` in devtools → search for `%%VAPID_PUBLIC_KEY%%` — must NOT appear.

**Checkpoint**: T001 complete — browser can read `VAPID_PUBLIC_KEY` and `INTERNAL_SECRET` at runtime.

---

## Phase 2: User Story 5 — Device Registration at Login (Priority: P1)

**Goal**: On every login, the PWA calls `PushManager.subscribe()` and saves the subscription to `push_subscriptions`.

**Independent Test**: Log in to PWA on iOS, grant permission, check `push_subscriptions` table — a row must appear for the logged-in client within 10 seconds.

- [ ] T002 [US5] Add `urlBase64ToUint8Array(base64String)` helper and `registerVapidPush()` async function to `assets/js/dashboard.js`. Call `registerVapidPush()` immediately after `progressier.add({ id: currentClient.id })` in `loadDashboard()`.

  **Logic for `registerVapidPush()`**:
  1. Guard: `if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;`
  2. `const reg = await navigator.serviceWorker.ready;`
  3. `const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });`
  4. Extract `endpoint`, `p256dh` (`sub.getKey('p256dh')` → base64), `auth` (`sub.getKey('auth')` → base64)
  5. `fetch(SUPABASE_URL + '/functions/v1/save-push-subscription', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': INTERNAL_SECRET }, body: JSON.stringify({ client_id: currentClient.id, endpoint, p256dh, auth, user_agent: navigator.userAgent }) })`
  6. All errors: `console.warn(...)` only — never throw, never interrupt dashboard load.

  **`urlBase64ToUint8Array` standard implementation** (~6 lines, converts URL-safe base64 to Uint8Array for `applicationServerKey`).

  **Version bump**: Bump the `dashboard.js` version string in `index.html` in the same commit (CLAUDE.md iOS service worker cache rule).

  **Commit**: `feat: register VAPID push subscription on every dashboard login && git push origin main`

  **Verification**: Login on iOS PWA → `push_subscriptions` has row. Login again → same row (upserted). Login with permission denied → dashboard loads normally.

**Checkpoint**: T002 complete — `push_subscriptions` is now being populated on login.

---

## Phase 3: User Stories 1 & 2 — Audible Notification for Button Tap / Form Submission (Priority: P1)

**Goal**: Customer taps a URL button or submits a form → enrolled iOS device gets an audible push notification via VAPID.

**Independent Test**: Enrolled device registers (T002 done) → tap a button on a Middle Man page → iOS plays notification sound within 10 seconds.

### T003 and T004 can be worked in parallel (different files)

- [ ] T003 [P] [US1] [US2] Add `push` event handler and `notificationclick` event handler to `service-worker.js`. Bump `CACHE_VERSION` in the same file.

  **push handler**:
  ```js
  self.addEventListener('push', (event) => {
    let data = { title: 'CallMagnet', body: 'New notification' };
    try { data = event.data.json(); } catch (_) {}
    if (data.source !== 'callmagnet-vapid') return;
    event.waitUntil(
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/android-chrome-192x192.png',
        badge: '/favicon-32x32.png',
        data: { url: data.url || 'https://callmagnet.com.au' },
        tag: 'callmagnet-notification',
      })
    );
  });
  ```

  **notificationclick handler**:
  ```js
  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if (client.url.startsWith('https://callmagnet.com.au') && 'focus' in client) return client.focus();
        }
        return clients.openWindow(event.notification.data?.url || 'https://callmagnet.com.au');
      })
    );
  });
  ```

  **CACHE_VERSION bump**: Change e.g. `'callmagnet-v66'` → `'callmagnet-v67-vapid-push'`.

  Also bump the `service-worker.js` version string in `index.html` in the same commit (CLAUDE.md iOS service worker cache rule).

  **Commit**: `feat: add VAPID push + notificationclick handlers to service-worker.js && git push origin main`

  **Verification**: After deploy with enrolled device — trigger a notification → audible sound + banner on iOS. Tap notification → callmagnet.com.au opens. Progressier push fires → no duplicate.

- [ ] T004 [P] [US1] [US2] Modify the `link_tapped` block in `supabase/functions/send-client-notification/index.ts` to use VAPID fan-out when subscriptions exist, with Progressier fallback when empty.

  **Changes in the `link_tapped` handler** (lines ~285–321):
  1. Before the existing Progressier API call, query: `const { data: subs } = await supa.from('push_subscriptions').select('endpoint,p256dh,auth').eq('client_id', clientId);`
  2. If `subs && subs.length > 0`: fan out via `webPush.sendNotification` (same library already imported for `missed_call`/`booking_logged`). Payload: `JSON.stringify({ source: 'callmagnet-vapid', title: ltTitle, body: ltBody, url: 'https://callmagnet.com.au' })`. On 410/404 status from `sendNotification`: delete that row from `push_subscriptions`.
  3. If `subs` is empty or null: execute the existing Progressier API call unchanged.
  4. `logNotification` call kept in both paths.

  Note: `ltTitle` and `ltBody` are the `context.push_title` and `context.push_message` values already extracted in this block.

  **Commit**: `feat: route link_tapped through VAPID fan-out with Progressier fallback && git push origin main`

  **Verification**: Enrolled device → button tap → VAPID push arrives with sound. Delete `push_subscriptions` rows → button tap → Progressier fallback fires, no error in logs.

**Checkpoint**: T003 + T004 complete — US1 and US2 fully functional.

---

## Phase 4: User Stories 3 & 4 — Missed Call / Booking Logged (Priority: P2)

**Goal**: Missed calls and logged bookings deliver audible push notifications to enrolled iOS devices.

**Note**: No code changes needed. The server-side VAPID fan-out for `missed_call` and `booking_logged` already exists in `send-client-notification/index.ts`. Once T002 (device registration) and T003 (push handler) are deployed, these events automatically deliver with sound.

- [ ] T005 [US3] [US4] Validate `missed_call` and `booking_logged` on enrolled iOS device. Trigger a missed-call event. Confirm audible notification arrives. No code change — validation only.

  **Verification**: Missed-call event → audible notification on iOS within 10 seconds. Booking logged → audible notification on iOS within 10 seconds.

**Checkpoint**: All P1 and P2 user stories are fully functional.

---

## Phase 5: Polish & Verification

- [ ] T006 [P] Verify deployment: open `https://callmagnet.com.au/assets/js/dashboard.js` in devtools → confirm `%%VAPID_PUBLIC_KEY%%` and `%%INTERNAL_SECRET%%` do NOT appear literally. Verify PWA install flow still works on iOS (Add to Home Screen → opens → offline cache works). No code change.

- [ ] T007 [P] Verify stale subscription cleanup: set a `push_subscriptions` endpoint to an invalid URL, trigger a notification, confirm the row is deleted after the 410/404 response. No code change.

---

## Dependencies & Execution Order

```
T001 (netlify.toml + dashboard.js placeholders)
  └── T002 (registerVapidPush in dashboard.js)
        ├── T003 (push handler in service-worker.js)   [parallel]
        └── T004 (link_tapped VAPID routing)           [parallel]
              └── T005 (validate missed_call/booking)
                    ├── T006 (deployment verification) [parallel]
                    └── T007 (stale cleanup check)     [parallel]
```

---

## Commit Checklist (per CLAUDE.md)

Every commit must end with `&& git push origin main`.

| Task | File | Version bump required |
|------|------|-----------------------|
| T001 | `netlify.toml` + `assets/js/dashboard.js` | None (version-bumped in T002) |
| T002 | `assets/js/dashboard.js` | Bump `dashboard.js` version in `index.html` |
| T003 | `service-worker.js` | Bump `CACHE_VERSION` in `service-worker.js` + bump SW version in `index.html` |
| T004 | `supabase/functions/send-client-notification/index.ts` | None |
| T005 | No code change | N/A |
| T006 | No code change | N/A |
| T007 | No code change | N/A |
