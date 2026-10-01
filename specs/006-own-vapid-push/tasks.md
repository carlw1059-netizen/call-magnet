# Tasks: Own VAPID Push Notifications

**Input**: Design documents from `specs/006-own-vapid-push/`

**References**: [spec.md](spec.md) · [plan.md](plan.md) · [research.md](research.md) · [data-model.md](data-model.md) · [quickstart.md](quickstart.md) · [contracts/](contracts/)

---

## Phase 1: Foundational Gates (manual, no code)

**Purpose**: Two manual checks that block T004 (dashboard button). T001 and T002 are independent of each other and of T003 — all three can run in parallel.

---

- [ ] T001 Exploratory install-prompt test — record result before T004 ships (manual, no commit)

  **Why**: The dashboard's conditional `progressier.add()` logic (T004) skips that call on opted-in devices. If `progressier.add()` is what causes the "Add to Home Screen" install prompt to appear, skipping it would silently break the install prompt for those owners. This test resolves that unknown before any code ships.

  **Device**: Your iPhone (preferred — that is the primary platform). Android Chrome is acceptable if iPhone is unavailable.

  **Steps**:
  1. Open Safari on the iPhone. Do NOT open the installed CallMagnet PWA home screen shortcut.
  2. Tap the tabs icon → tap "Private" → open a new Private Browsing tab. Private Browsing has no prior service worker state for the site, which means `progressier.add()` has not run in this context.
  3. Navigate to `https://callmagnet.com.au` and log in with your owner credentials.
  4. Wait for the dashboard to fully load (10–15 seconds).
  5. Watch the bottom of the screen for a "Add callmagnet.com.au to Home Screen" banner.
  6. Also tap the Share button (square with upward arrow) and look for "Add to Home Screen" in the share sheet.

  **What to record**:
  - **Result A — prompt appears** (banner or in share sheet): Write this in the T004 commit message body: `"Task 0 result: install prompt confirmed independent of progressier.add() — safe to skip on opted-in devices."` Proceed to T004 as planned.
  - **Result B — prompt does not appear**: Do NOT proceed to T004. Open a new conversation: *"Task 0 exploratory result: install prompt did NOT appear in Safari Private Browsing. progressier.add() may be required for the install prompt. Plan.md Task 2 needs a revised isolation approach before T004 is written."*

---

- [ ] T002 Progressier dashboard go-live gate — disable auto-subscribe if present (manual, no commit)

  **Why**: If Progressier has an automatic push-permission or auto-subscribe toggle in its own dashboard, it can overwrite a CallMagnet-keyed registration independently of `progressier.add()`, even after T004 ships.

  **Steps**:
  1. Log into `https://progressier.app` with your CallMagnet account.
  2. Navigate to the settings for the CallMagnet app.
  3. Look for any setting named something like: "Push notifications", "Automatic subscription", "Permission prompt", "Auto-subscribe", or "Ask users to subscribe".
  4. If such a setting exists: disable it. Note its exact name.
  5. If no such setting exists: note "No auto-subscribe setting found."

  **What to record**: Setting name and new state (disabled / not found). Include in T004 commit message body.

---

## Phase 2: US2 — Notification delivery safety net during transition (Priority: P1)

**Goal**: Owners whose devices still hold a Progressier-keyed registration receive notifications (silently, via Progressier fallback) for missed calls and bookings rather than nothing.

**Independent Test**: quickstart.md Test 7 — trigger `missed_call` or `booking_logged` for a client with an invalid endpoint in `push_subscriptions`. Confirm edge function logs show `"vapid all failed, using progressier-fallback"`.

**Prerequisite**: None. Ships independently before T001/T002/T004.

---

- [ ] T003 [US2] Add Progressier fallback to `missed_call` and `booking_logged` paths in `supabase/functions/send-client-notification/index.ts`

  **Context**: `link_tapped` already has this guard (commit `9b283bf`). `missed_call` and `booking_logged` do not — when all VAPID sends fail (e.g. 400 VapidPkHashMismatch from Apple), those paths return silently and the owner gets nothing. This task adds the identical guard to both paths.

  **What to add to each path** (after `Promise.allSettled()` results are processed):
  - Compute `anyOk` = whether at least one result was `fulfilled` with `ok: true`.
  - If `anyOk` → return as now (no change to the happy path).
  - If not `anyOk` → log `"send-client-notification: [event] vapid all failed, using progressier-fallback"` then fall through to a Progressier send using the same API call and `logNotification()` pattern as the existing `link_tapped` Progressier path (`recipients: { id: clientId }`, title and body from `templateFor()`).
  - All existing `logNotification()` calls for failed sends are preserved unchanged.

  **Commit message**: `fix: add Progressier fallback to missed_call and booking_logged when all VAPID sends fail`

  **After commit**:
  ```
  npx supabase functions deploy send-client-notification --project-ref iskvvnhacqdxybpmwuni --no-verify-jwt
  git push origin main
  ```

  **Prove live**: In Supabase → Edge Function logs, trigger `send-client-notification` with `event: "missed_call"` for a client whose `push_subscriptions` row has an invalid endpoint (or temporarily insert a dummy row). Confirm the log line contains `"missed_call vapid all failed, using progressier-fallback"`. Then restore the client's real subscription row if needed.

---

**Checkpoint**: Missed-call and booking-logged delivery is protected during the transition.

---

## Phase 3: US1 + US3 + US4 — "Turn on notifications" button and conditional `progressier.add()` (Priority: P1/P2/P3)

**Goal**: Dashboard shows "Turn on notifications" when no CallMagnet-keyed registration exists. Owner taps once to register. `progressier.add()` is never called on a device that already has a valid registration.

**Independent Test**: quickstart.md Tests 1–4 (button visibility), Tests 5–6 (audible push), Tests 8–9 (conditional progressier.add()), Test 10 (non-push browser).

**Prerequisites**: T001 completed (Result A recorded) AND T002 completed (Progressier gate confirmed).

---

- [ ] T004 [US1] [US3] [US4] Add "Turn on notifications" button, `vapidKeyMatches()` check, and conditional `progressier.add()` in `assets/js/dashboard.js` — bump `dashboard.js` version string in `index.html`

  **Two files, one commit** (standard paired change per CLAUDE.md whenever `dashboard.js` changes).

  **In `dashboard.js`** — four changes:

  **1. Restore `vapidKeyMatches()`** from reverted commit `db27a62` (the function itself was correct; only the subscription-replacement logic around it was reverted). The function:
  - Gets the active service worker registration and its push subscription.
  - If no subscription → returns `false`.
  - Reads `subscription.options.applicationServerKey` (an `ArrayBuffer` of raw key bytes).
  - Converts our VAPID public key from URL-safe base64 to the same byte representation.
  - Compares byte-by-byte → returns `true` only if they match.
  - Strictly read-only — no subscribe, no unsubscribe, no side effects.

  **2. Page-load check** (runs automatically after client data loads, requires no user gesture):
  - If `'PushManager' in window` is false → skip entirely, render no button.
  - Call `await vapidKeyMatches()`. Cache result as `hasValidReg`.
  - If `hasValidReg` is false → render "Turn on notifications" button (above the existing dashboard tiles, prominent).
  - If `hasValidReg` is true → no button.

  **3. Button tap handler** (runs only on explicit user tap — never on page load):
  - Call `await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <our VAPID public key> })`.
  - On success → POST subscription fields (`endpoint`, `p256dh`, `auth`, `client_id`) to `save-push-subscription` edge function. On server 2xx → hide button immediately (no page reload). On server error → button stays visible, log the error.
  - On `NotAllowedError` (permission denied by owner) → button stays visible, log denial. Show no error UI to the owner.
  - On any other error → button stays visible, log the error.

  **4. Conditional `progressier.add()` at line ~314**:
  - Use the cached `hasValidReg` from step 2.
  - If `hasValidReg` is true → do not call `progressier.add()`.
  - If `hasValidReg` is false → call `progressier.add({ id: currentClient.id })` exactly as before.
  - Do not move the existing call site — wrap it in place.

  **In `index.html`**:
  - Bump the `dashboard.js` `?v=` query string to the next value in the `20260926x` sequence.

  **Commit message** (include gate results in body):
  ```
  feat: turn on notifications button, vapid key check, conditional progressier.add()

  Task 0 result: [paste T001 result here]
  Progressier gate: [paste T002 result here]
  ```

  ```
  git push origin main
  ```

  **Prove live**:
  1. In Supabase → delete the `push_subscriptions` row for your test client.
  2. On iPhone (installed PWA): reload the dashboard. Confirm "Turn on notifications" button is visible above the tiles.
  3. Tap the button. Grant iOS permission. Confirm button disappears immediately (no reload). Check Supabase — confirm a new row in `push_subscriptions` exists for this client.
  4. Reload the dashboard. Confirm button is not shown.
  5. Trigger a Middle Man button tap from another device. Confirm push notification arrives on iPhone **with sound** within 10 seconds.
  6. Desktop Chrome (logged in as same client): reload dashboard. Open DevTools → Network. Filter for `progressier.app`. Confirm no request is made (opted-in device skips `progressier.add()`).
  7. Log in on a second device that has never subscribed. Open DevTools → Network → confirm `progressier.app` request IS made (non-opted-in device still calls `progressier.add()`).

---

**Checkpoint**: All four user stories are complete. The owner can opt in with one tap. Notifications arrive with sound on iPhone. Progressier never overwrites a CallMagnet-keyed registration.

---

## Phase 4: Verification

- [ ] T005 Run full quickstart.md acceptance test suite (Tests 1–10) and record results (manual, no commit)

  Work through every test in `specs/006-own-vapid-push/quickstart.md` in order. For any failure, open a new task rather than patching in place.

- [ ] T006 [P] Update `specs/006-own-vapid-push/checklists/requirements.md` — mark all items `[x]` and add verification date

  Commit if desired: `chore: mark 006-own-vapid-push requirements checklist complete` + `git push origin main`

---

## Dependencies & Execution Order

```
T001 (manual) ─┐
               ├──► T004 (dashboard.js) ─┐
T002 (manual) ─┘                         ├──► T005 (verify) ──► T006 (checklist)
                                          │
T003 (send-client-notification) ──────────┘
```

T001, T002, and T003 are fully independent and can start in parallel today.

---

## Parallel Opportunities

```
# Start all three in parallel right now:
T001  Carl: exploratory install-prompt test on iPhone (~15 min)
T002  Carl: Progressier dashboard gate check (~10 min)
T003  Claude Code: send-client-notification fallback (~30 min)

# Once T001=Result A AND T002=done:
T004  Claude Code: dashboard.js button (~1 hour)

# Once T003 and T004 are both deployed:
T005  Carl: acceptance testing per quickstart.md (~30 min)
T006  Claude Code: checklist update (~5 min, parallel with T005)
```

---

## Implementation Strategy

**Ship T003 immediately** — it fixes an active bug (no delivery fallback for missed calls/bookings) and has no dependencies.

**Unblock T004 in parallel** — T001 and T002 take under 30 minutes combined. They are the only gate on T004.

**T004 ships the feature** — after it deploys, owners can start opting in by tapping the button on their next dashboard visit.

**Deferred** — remove all three Progressier fallback paths from `send-client-notification` (`link_tapped`, `missed_call`, `booking_logged`) once every active client holds a CallMagnet-keyed registration. Separate future task, out of scope here.
