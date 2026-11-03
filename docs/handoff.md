# Handoff Document — Call Magnet / Middle Man
**Date:** 2026-05-27  
**Branch:** `main` (fully pushed — `git log --oneline -4` shows last 4 commits below)  
**Project root:** `C:\Users\car31\call-magnet`

---

## Recent commits (this session)

| SHA | Message |
|-----|---------|
| `6c2cb78` | fix(middle-man): images only, screen fill, desktop only nav, new tab live page |
| `4af3577` | fix(reliability): add missing warmup cron for send-twilio-sms |
| `c34ab73` | docs: remove stale SMS comment from submit-middle-man-form |

All three commits are pushed to `origin/main`. No uncommitted changes.

---

## Project overview

Call Magnet is a SaaS for Australian hospitality businesses. Core flows:

1. **Missed call → SMS auto-reply** — Twilio webhook → `twilio-missed-call` edge function → `send-twilio-sms` sends a configurable SMS back to the caller.
2. **Middle Man landing page** — Public page at `/b/<slug>` (served by `b.html` + `assets/js/middleman.js`). Customers tap a button, fill a form, submit to `submit-middle-man-form`. Business owner gets a push notification.
3. **Dashboard** — Authenticated SPA at `index.html`. Business owners manage their settings, Middle Man config, etc.

**Stack:** Supabase (Postgres + Edge Functions/Deno + Storage + Auth + pg_cron), Twilio, Progressier (push), Resend (email), Stripe.

---

## Architectural constraints (LOCKED — do not change)

- **SMS can ONLY fire from a missed call.** Never from form submissions, never as a confirmation. This is locked. See `supabase/functions/submit-middle-man-form/index.ts` header comment.
- **Video backgrounds are deferred to Phase 1.5.** The upload edge function, dashboard UI, and landing page are all image-only. Any video upload returns `400 { error: 'video_not_supported' }`.
- **`process-unsubscribe` edge function is DORMANT until Phase 2.** The "Stop these texts" link in `b.html` currently points to `https://callmagnet.com.au` as a placeholder. Do not activate or wire up until Phase 2 is scoped.

---

## What was done this session

### Task 1 — Reliability audit (report only, no code changes)
Full end-to-end audit of the Middle Man system. Findings summarised:
- Push for `link_tapped` uses Progressier single-call API (no per-device fan-out in this codebase); failures are not escalated to Pushover.
- Push for `missed_call`/`booking_logged` uses local `push_subscriptions` table with `Promise.allSettled` — all devices covered.
- `INTERNAL_SECRET` missing only logs `console.warn` — no hard failure.
- `process-unsubscribe` confirmed intentionally dormant.

### Task 2 — Comment cleanup (`c34ab73`)
Removed the stale comment from `supabase/functions/submit-middle-man-form/index.ts` that falsely claimed side-effect #3 was "POST to send-twilio-sms (confirmation SMS to caller)". No code was changed, comment only.

### Task 3 — Warmup cron for send-twilio-sms (`4af3577`)
Created and applied `supabase/migrations/20260526000002_send_twilio_sms_warmup_cron.sql`.  
Adds pg_cron job `warmup-send-twilio-sms` at `*/5 * * * *` — pings the function's `?warmup=1` endpoint so it stays warm.

### Task 4 — Three fixes (`6c2cb78`)

#### FIX 1 — Images only (video deferred to Phase 1.5)
- **`supabase/functions/upload-middle-man-background/index.ts`** — Removed `ALLOWED_VIDEO_TYPES`, `MAX_VIDEO_BYTES`, entire video upload block, `urls.video` reference. Video uploads now return `400 { error: 'video_not_supported', message: 'Video backgrounds coming soon. Please upload a JPG or PNG image.' }`. All image processing (imagescript, 3-variant JPEG pipeline) unchanged.
- **`assets/js/dashboard.js`** — File picker restricted to `image/jpeg,image/png,.jpg,.jpeg,.png`. Added hint text "Upload a portrait photo for best results. Video backgrounds coming soon." below the Upload button. Removed `resp.urls.video` fallback in upload success handler.
- **`assets/js/middleman.js`** — Removed `middle_man_background_type` from Supabase REST SELECT query. Replaced the video/image branch background render block with image-only code (no `<video>` element creation). Simplified "See what's on" condition from `if (bgUrl && client.middle_man_background_type !== 'video')` to `if (bgUrl)`.
- **`assets/css/middleman.css`** — Removed all `#bgFixed video { ... }` rules and 5 WebKit media controls suppression rules.
- **`supabase/migrations/20260526000003_middle_man_background_type_cleanup.sql`** — Applied. Normalises any `middle_man_background_type = 'video'` or `NULL` rows to `'image'`.

#### FIX 2 — Background fills phone screen correctly
- **`assets/css/middleman.css`** — `#bgFixed`: `background-position: center` → `background-position: center top`.
- **`assets/js/middleman.js`** — Image `onload` handler: `backgroundPosition = 'center'` → `'center top'`.

#### FIX 3 — Middle Man manager nav desktop-only
- **`index.html`** — Added `desktop-only-nav` class to the "Middle Man" button in the admin sidebar (line ~174) and in the gear/admin panel (line ~320).
- **`assets/css/dashboard.css`** — Added `.desktop-only-nav { display: none !important; }` inside the existing `@media (max-width: 767px)` block alongside `.admin-panel-testing`.

---

## Current code state (key files)

### Edge functions
| Function | Auth | Notes |
|----------|------|-------|
| `submit-middle-man-form` | `verify_jwt=false` (public) | Always returns 200. Side-effects: (1) INSERT middle_man_form_submissions, (2) fire-and-forget send-client-notification (link_tapped). No SMS. |
| `upload-middle-man-background` | `verify_jwt=true` + ownership/admin check | Images only. 3-variant JPEG pipeline via imagescript. Video → 400. |
| `send-twilio-sms` | internal | Has warmup handler + pg_cron (`warmup-send-twilio-sms` `*/5 * * * *`). |
| `send-client-notification` | `X-Internal-Secret` header | Handles `missed_call`, `booking_logged` (VAPID push + Resend email), `link_tapped` (Progressier only). Has warmup + cron. |
| `log-middle-man-tap` | `verify_jwt=false` (public) | Inserts link_clicks, fires send-client-notification (link_tapped). |
| `process-unsubscribe` | — | **DORMANT until Phase 2.** No warmup, no cron — intentional. |

### Frontend
| File | Purpose |
|------|---------|
| `b.html` | Middle Man public landing page shell. Footer "Stop these texts" → `https://callmagnet.com.au` (placeholder, Phase 2). |
| `assets/js/middleman.js` | Middle Man IIFE module. Fetches client by slug, renders buttons, forms, background. Image-only. |
| `assets/css/middleman.css` | Middle Man styles. `#bgFixed background-position: center top`. No video CSS. |
| `index.html` | Dashboard SPA shell. Middle Man nav buttons have `desktop-only-nav` class. |
| `assets/js/dashboard.js` | Dashboard logic. Middle Man manager in `buildMmMgrCard` / `_renderMmEditBody` / `mmEditUploadBg`. |
| `assets/css/dashboard.css` | Dashboard styles. `.desktop-only-nav { display:none !important }` at ≤767px. |

### DB schema (Middle Man relevant columns on `clients` table)
```
middle_man_enabled          boolean
middle_man_slug             text (unique)
middle_man_background_url   text   -- portrait.jpg public URL
middle_man_background_type  text   -- always 'image' after migration 20260526000003
middle_man_promo_text       text
middle_man_buttons          jsonb
middle_man_show_whats_on    boolean
middle_man_updated_at       timestamptz
```

Table `middle_man_form_submissions`:
```
id, client_id, form_type (change_cancel|function|late_arrival|lost_found|something_else),
caller_name, caller_phone, original_booking_time, requested_change, note,
submitted_at, ip_hash, user_agent
```

### Warmup crons (all `*/5 * * * *`)
- `warmup-send-client-notification`
- `warmup-send-twilio-sms` ← added this session
- `warmup-submit-middle-man-form`
- `warmup-log-middle-man-tap`
- (others for non-Middle-Man functions)

---

## Known gaps / next work

These were identified but explicitly NOT fixed (out of scope or deferred):

1. **Phase 1.5 — Video backgrounds.** All code stubs removed. When this ships: re-add `ALLOWED_VIDEO_TYPES` to the edge function, restore video render branch in middleman.js, add video CSS, add file picker accept for video.

2. **Phase 2 — Unsubscribe flow.** `process-unsubscribe` edge function exists but is dormant. `b.html` "Stop these texts" link points to homepage. When Phase 2 ships: wire up the link to the edge function, add warmup cron, activate the function.

3. **Progressier failures not escalated.** For `link_tapped` events, if the Progressier API call fails, no Pushover alert fires (unlike `missed_call` / VAPID key missing which do fire Pushover). Not fixed — logged as a known gap.

4. **`INTERNAL_SECRET` missing is silent.** If `INTERNAL_SECRET` env var is not set, `submit-middle-man-form` logs `console.warn` and skips all notifications (no hard error, no alert). Not fixed.

5. **`middle_man_background_type` column.** After migration `20260526000003` all rows are `'image'`. The column is arguably redundant now (only one type exists). Could be dropped when video is shipped and the type distinction matters again — or kept as a no-op. No decision made.

---

## Suggested skills for next session

- **`diagnose`** — if investigating any edge function failures or push notification gaps
- **`verify`** — to manually confirm Middle Man landing page background rendering after the `center top` fix
- **`code-review`** — if reviewing any new Middle Man or Phase 1.5 work before merging

---

## How to orient quickly

```bash
# See all Middle Man edge functions
ls supabase/functions/ | grep -i middle

# See all Middle Man migrations
ls supabase/migrations/ | grep -i middle

# Check warmup crons in prod
supabase db query --linked -o table "SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;"

# Deploy a function
supabase functions deploy <function-name>

# Push migrations
supabase db push
```

Supabase project ref: `iskvvnhacqdxybpmwuni`  
Dashboard: https://supabase.com/dashboard/project/iskvvnhacqdxybpmwuni
