# Implementation Plan: Own VAPID Push Notifications

**Branch**: `006-own-vapid-push` | **Date**: 2026-09-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-own-vapid-push/spec.md`

---

## Summary

Make CallMagnet the sole owner of push registrations on devices that have opted in, so that VAPID-delivered notifications arrive with the default iPhone alert sound. Achieved by: (a) adding a Progressier fallback to the `missed_call` and `booking_logged` notification paths (protective, ships first), (b) adding a "Turn on notifications" button to the dashboard that is the only path to register a device, and (c) making `progressier.add()` conditional so it is never called on a device that already holds a CallMagnet-keyed registration.

---

## Technical Context

**Language/Version**: JavaScript ES2020+ (`dashboard.js`, `service-worker.js`); Deno/TypeScript (`supabase/functions/`)

**Primary Dependencies**: Web Push API (browser-native), Supabase JS v2, `npm:web-push@3.6.7` (edge function)

**Storage**: Supabase PostgreSQL — `push_subscriptions` table (endpoint, p256dh, auth, client_id, last_used_at). No schema changes required.

**Testing**: Manual device testing — iPhone (installed PWA, iOS 16.4+), Android Chrome, desktop Chrome/Edge

**Target Platform**: PWA on iOS 16.4+, Android Chrome, desktop; server-side Deno edge functions on Supabase

**Project Type**: Vanilla JS frontend (static files served by Netlify) + Supabase edge functions

**Performance Goals**: Notification delivery within 10 seconds of triggering event (existing; no change)

**Constraints**:
- iPhone requires a user gesture (tap) to call `PushManager.subscribe()` — no subscription attempt on page load ever
- One `push_subscriptions` row per client — delete-before-insert already implemented in `save-push-subscription`
- No changes to Middle Man page, video, or autoplay code
- Every commit must include `git push origin main`
- Version strings in `index.html` must be bumped whenever `dashboard.js` changes

**Scale/Scope**: One dashboard owner per `client_id`; potentially multiple devices per owner (fan-out already implemented)

---

## Constitution Check

The project constitution (`/.specify/memory/constitution.md`) has not been populated — it contains only the blank template. No governance violations can be evaluated. Proceeding on project-specific rules from `CLAUDE.md`:

- ✅ All commits include `git push origin main`
- ✅ Middle Man page untouched
- ✅ One file per task, one commit per task (dashboard.js + index.html version bump are a paired two-file commit, per `CLAUDE.md` convention)

---

## Question answered: Do missed_call and booking_logged need a Progressier fallback?

**Yes — for the same reason link_tapped got one (commit 9b283bf).**

During the transition period, any client whose device was last registered via Progressier's VAPID key will cause a `400 VapidPkHashMismatch` rejection on every CallMagnet VAPID send. Currently:

| Event | Behaviour when all VAPID sends fail |
|-------|--------------------------------------|
| `link_tapped` | Falls back to Progressier (commit 9b283bf) ✅ |
| `missed_call` | Returns silently — owner receives **nothing** ❌ |
| `booking_logged` | Returns silently — owner receives **nothing** ❌ |

A missed call or booking is a higher-stakes event than a Middle Man button tap. Dropping those notifications during the transition is unacceptable. Task 1 adds the identical "if none succeeded, fall through to Progressier" guard to both paths in `send-client-notification`. Progressier delivery is still silent on iPhone, but that is better than no delivery at all.

The Progressier fallback for all three events is removed in a later task (out of scope for this feature) once all active clients have re-registered with the CallMagnet key.

---

## Project Structure

### Documentation (this feature)

```text
specs/006-own-vapid-push/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   ├── turn-on-notifications-button.md
│   └── save-push-subscription.md
└── tasks.md             ← /speckit-tasks output (not yet created)
```

### Source Code (affected files only)

```text
supabase/functions/send-client-notification/
└── index.ts                  ← Task 1: Progressier fallback for missed_call + booking_logged

assets/js/
└── dashboard.js              ← Task 2: vapidKeyMatches(), "Turn on notifications" button, conditional progressier.add()

index.html                    ← Task 2 (paired): dashboard.js version bump
```

`service-worker.js`, `b.html`, `cm1site/b.html`, `middleman.js`, `middleman.css` are untouched.

---

## Complexity Tracking

No constitution violations identified.

---

## Task Sequence

### Task 0 — Exploratory: install prompt without `progressier.add()` (manual, no code, no commit)

**Gate**: Must be completed and result recorded before Task 2 ships.

**What to test**: Confirm whether the PWA "Add to Home Screen" install prompt appears on a device where `progressier.add()` has not been called.

**How to simulate without code changes**: Open the dashboard in a private/incognito tab on a supported iOS or Android browser. Incognito contexts have no prior service worker state, so `progressier.add()` has not run for that origin. Observe whether the install prompt banner appears.

**Acceptable outcomes**:

- **Prompt appears** → install prompt is browser-native; `progressier.add()` is not required for it. Task 2 can safely skip `progressier.add()` on opted-in devices. Document: "install prompt confirmed independent of progressier.add()."
- **Prompt does not appear** → `progressier.add()` drives the install prompt. Task 2 must use a Progressier configuration flag to disable push registration only (rather than skipping `progressier.add()` entirely). Document the finding and agree on the revised Task 2 approach before proceeding.

Record the result in the Task 2 commit message or a comment before that commit is pushed.

---

### Task 1 — `send-client-notification`: Progressier fallback for `missed_call` and `booking_logged`

**File**: `supabase/functions/send-client-notification/index.ts`
**Commit message**: `fix: add Progressier fallback to missed_call and booking_logged when all VAPID sends fail`
**Prerequisite**: None (ships independently, before Task 0 or 2)

**What changes**:

The `missed_call` and `booking_logged` paths fan out VAPID sends and then return. Add the same guard that `link_tapped` received in commit `9b283bf`:

- After `Promise.allSettled()`, check whether at least one send succeeded (`anyOk`).
- If `anyOk` → return as now.
- If not `anyOk` → log `"send-client-notification: [event] vapid all failed, using progressier-fallback"` and fall through to a Progressier send using the same API call pattern as `link_tapped`.

The Progressier send uses `recipients: { id: clientId }` with `title` and `body` from `templateFor()`. Existing `logNotification()` calls for failed sends are preserved unchanged.

**Deploy after commit**: `npx supabase functions deploy send-client-notification --project-ref iskvvnhacqdxybpmwuni --no-verify-jwt`

---

### Task 2 — `dashboard.js`: "Turn on notifications" button + conditional `progressier.add()`

**Files**: `assets/js/dashboard.js` + version bump in `index.html`
**Commit message**: `feat: turn on notifications button, vapid key check, conditional progressier.add()`
**Prerequisite**: Task 0 completed and result recorded

**What changes in `dashboard.js`**:

**1. Restore `vapidKeyMatches()`** (from reverted commit `db27a62`):
An async function that:
- Gets the service worker registration and its current push subscription.
- If no subscription exists → returns `false`.
- Extracts the subscription's `options.applicationServerKey` (raw bytes) and compares it to our VAPID public key.
- Returns `true` only if the keys match; `false` otherwise.
- Read-only: no subscribe, no unsubscribe.

**2. Page-load check (runs after client data is loaded, no user action)**:
- If `'PushManager' in window` is false → skip entirely, no button rendered.
- Call `vapidKeyMatches()` and cache the result as `hasValidReg`.
- If `hasValidReg` is false → render the "Turn on notifications" button in the dashboard.
- If `hasValidReg` is true → no button.

**3. "Turn on notifications" button tap handler (user gesture required)**:
- Call `PushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <VAPID public key> })`.
- On success → POST to `save-push-subscription` edge function → on server success, hide the button.
- On `NotAllowedError` (permission denied) → leave button visible, log the denial.
- On any other error or server-save failure → leave button visible, log the error.

**4. Conditional `progressier.add()` call (at existing line ~314)**:
- Use the cached `hasValidReg` from the page-load check.
- If `hasValidReg` is true → skip `progressier.add()`.
- If `hasValidReg` is false → call `progressier.add({ id: currentClient.id })` as before.
- Execution order relative to other initialisation is unchanged; the existing call site is wrapped, not moved.

**What changes in `index.html`**:
- Version string on the `dashboard.js` `<script>` tag bumped to the next value in the `20260926x` sequence.

**No other files change.**

---

## Manual Go-Live Gate (not a coded task)

Before Task 2 is deployed, Carl must:

1. Log into the Progressier dashboard.
2. Check for any automatic push permission prompt or auto-subscribe setting.
3. If such a setting exists, disable it.
4. Confirm the setting is off.

The exact setting name is unknown — do not assume it does not exist. This gate is FR-003.

---

## Transition Period Behaviour (after all tasks ship)

| Device state | `progressier.add()` called? | Button shown? | Notification delivery |
|---|---|---|---|
| No registration at all | Yes | Yes | Progressier fallback (silent on iPhone) |
| Progressier-keyed registration | Yes (device has no CallMagnet key) | Yes | Progressier fallback (silent on iPhone) |
| CallMagnet-keyed registration | No | No | VAPID → audible on iPhone ✅ |

After every active client has tapped the button, a follow-up task removes all Progressier fallback code from `send-client-notification`.
