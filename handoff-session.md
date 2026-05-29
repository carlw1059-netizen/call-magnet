# CallMagnet — Consolidated Session Handoff
**Date:** 2026-05-27  
**Repo:** `C:\Users\car31\call-magnet` / https://github.com/carlw1059-netizen/call-magnet  
**HEAD:** `52aecdc`  
**Branch:** `main` (fully pushed, no uncommitted changes)

---

## Immutable Security Constraints (carry into every session verbatim)

- Do NOT send any real emails
- Do NOT cancel any real Stripe subscriptions
- Do NOT invoke any edge functions manually
- Do NOT break any existing dashboard functionality
- Do NOT change the existing four metric tiles (calls missed, SMS sent, links tapped, revenue recovered)
- Admin-only throughout — `is_admin === true` AND `email === car312@hotmail.com` dual gate (both must pass)
- If anything is ambiguous, STOP and ask
- Read every relevant file before touching anything
- Reliability is paramount — do not rush
- Phone masking: never show full phone numbers — last 4 digits only

---

## What This Project Is

CallMagnet is a missed-call recovery SaaS for Australian small businesses / hospitality. When a customer calls and hangs up, it automatically sends a personalised SMS with a short link to a branded landing page ("Middle Man" page) where the caller can request a callback, book, or send a message. The business owner gets a push notification.

**Tech stack:**
- Frontend: Cloudflare Pages — `index.html` (admin PWA), `b.html` (customer Middle Man page)
- Backend: Supabase (PostgreSQL + Edge Functions/Deno + Storage bucket `middle-man-backgrounds`)
- SMS: Twilio + Twilio Studio
- Push notifications: Progressier (external API) + VAPID (local `push_subscriptions` table)
- Email: Resend
- Link tracking: Rebrandly
- Payments: Stripe

---

## Locked Architectural Decisions (never change without explicit instruction)

| Decision | Reason |
|----------|--------|
| SMS fires ONLY from a missed call — never from form submissions, never as a confirmation | Locked from day 1. `submit-middle-man-form` has a header comment documenting this. |
| Video backgrounds deferred to Phase 1.5 | All video code removed. Edge function returns `400 { error: 'video_not_supported' }`. |
| `process-unsubscribe` edge function is DORMANT until Phase 2 | "Stop these texts" link in `b.html` → `https://callmagnet.com.au` placeholder only. |
| Admin gate is dual-condition | `is_admin === true` AND `email === car312@hotmail.com` — both must pass. |

---

## File Structure (current state, all files)

```
call-magnet/
├── index.html                      # Admin PWA shell — 431 lines, HTML only (no inline CSS/JS)
├── b.html                          # Customer Middle Man page — 77 lines, HTML only
├── assets/
│   ├── css/
│   │   ├── dashboard.css           # All admin dashboard CSS — 1239 lines
│   │   └── middleman.css           # All Middle Man page CSS — 461 lines
│   └── js/
│       ├── dashboard.js            # All admin dashboard JS — 2015 lines
│       └── middleman.js            # All Middle Man page JS — 614 lines (IIFE wrapped)
├── supabase/
│   └── functions/
│       ├── _shared/emailStyles.ts
│       ├── upload-middle-man-background/index.ts
│       ├── submit-middle-man-form/index.ts
│       ├── log-middle-man-tap/index.ts
│       ├── send-client-notification/index.ts
│       ├── send-missed-call-sms/index.ts
│       ├── monthly-report/index.ts
│       ├── send-daily-summary/index.ts
│       └── send-twilio-sms/index.ts
└── README.md
```

**Important:** `admin/middle-man.html` is a redirect stub only. The real admin Middle Man manager lives entirely in `index.html` / `assets/js/dashboard.js`.

---

## What Was Built Across All Sessions

### Session 1 — Reliability, cleanup, and Middle Man foundations

**Reliability audit (report only, no code changes):**
- Push for `link_tapped` uses Progressier single-call API (no per-device fan-out). Failures not escalated to Pushover — known gap, left as-is.
- Push for `missed_call`/`booking_logged` uses local `push_subscriptions` table with `Promise.allSettled` — all devices covered.
- `INTERNAL_SECRET` missing only logs `console.warn` — no hard failure. Known gap, left as-is.

**Commit `c34ab73` — Comment cleanup:**  
Removed the stale comment from `supabase/functions/submit-middle-man-form/index.ts` that falsely claimed side-effect #3 was "POST to send-twilio-sms (confirmation SMS to caller)". Comment only — no code changed.

**Commit `4af3577` — Warmup cron for send-twilio-sms:**  
Created and applied `supabase/migrations/20260526000002_send_twilio_sms_warmup_cron.sql`. Adds pg_cron job `warmup-send-twilio-sms` at `*/5 * * * *`.

**Commit `6c2cb78` — Three fixes:**

*FIX 1 — Images only (video deferred to Phase 1.5):*
- `supabase/functions/upload-middle-man-background/index.ts` — Removed all video upload code. Video → `400 { error: 'video_not_supported', message: 'Video backgrounds coming soon.' }`.
- `assets/js/dashboard.js` — File picker restricted to `image/jpeg,image/png`. Hint text added below Upload button.
- `assets/js/middleman.js` — Removed `middle_man_background_type` from SELECT. Image-only background render. No `<video>` element creation.
- `assets/css/middleman.css` — Removed all `#bgFixed video { ... }` rules and 5 WebKit media-controls suppression rules.
- `supabase/migrations/20260526000003_middle_man_background_type_cleanup.sql` — Normalises any `'video'` or `NULL` background_type rows to `'image'`.

*FIX 2 — Background position:*  
`#bgFixed background-position: center` → `center top` in both CSS and the JS `onload` handler.

*FIX 3 — Middle Man manager nav desktop-only:*  
Added `desktop-only-nav` class to the two "Middle Man" nav buttons in `index.html`. Added `.desktop-only-nav { display: none !important; }` inside the existing `@media (max-width: 767px)` block in `dashboard.css`.

---

### Session 2 — iOS Safari, close button audit, HTML split, form UX

**Commits e79575a → e8c0184 → df27df5 — iOS Safari background rendering:**

Final canonical CSS pattern for iOS Safari (this is the stable approach — do not change):
```css
html, body { overflow: hidden; }
#bgFixed   { position: fixed; z-index: 0; }
#bgOverlay { position: fixed; z-index: 1; }
#app       { position: fixed; z-index: 2; overflow-y: auto; }  /* scroll container */
```
Body is NOT `position:fixed`. `#app` is the fixed full-screen scroll container. Prevents Safari toolbar resize from shifting layout.

Video autoplay requirements (all 6 required, even though video is currently deferred):
- Both `setAttribute('muted', '')` AND `vid.muted = true`
- Both `setAttribute('playsinline', '')` AND `vid.playsInline = true`
- `setAttribute('webkit-playsinline', '')`
- `vid.controls = false` + `vid.removeAttribute('controls')`
- `vid.load()` before `vid.play()`
- `vid.play()` returns a Promise — `.catch()` fallback to charcoal

Image background uses `new Image()` preload with `onload`/`onerror` — never synchronous assignment.

Cache-busting (commit `df27df5`):
```js
var bgUrl = client.middle_man_background_url
              ? client.middle_man_background_url + '?v=' + Date.now()
              : null;
```
All background URL references use `bgUrl` not `client.middle_man_background_url` directly.

**Commit `82b3808` — Close button audit:**

Three bugs found and fixed in admin dashboard:

| Severity | Function | Bug | Fix |
|----------|----------|-----|-----|
| CRITICAL | `closeMmEdit()` | Never removed `body.panel-open` → scroll locked | Added `document.body.classList.remove('panel-open')` |
| HIGH | `closeResetModal()` | Same scroll lock bug | Added `document.body.classList.remove('panel-open')` |
| MEDIUM | `.admin-panel-overlay` | z-index 9100 sat above reset modal (9000) | Changed to 8900 |

Current clean z-index stack:
```
8900  .admin-panel-overlay
9000  .modal-overlay (reset modal)
9001  .modal
9200  .admin-panel
9250  .tool-panel-overlay
9300  .tool-panel
9350  .mm-edit-overlay
9400  .mm-edit-panel   ← topmost
9999  #splashScreen (hidden after load)
```

**Commit `b2ff80b` — HTML split:**

Pure mechanical split — zero logic changes:

| File | Before | After |
|------|--------|-------|
| `index.html` | 3,678 lines | 431 lines |
| `b.html` | 1,139 lines | 77 lines |
| `assets/css/dashboard.css` | — | 1,239 lines |
| `assets/js/dashboard.js` | — | 2,015 lines |
| `assets/css/middleman.css` | — | 461 lines |
| `assets/js/middleman.js` | — | 614 lines |

Links added: `<link rel="stylesheet" href="/assets/css/dashboard.css">` and `<script src="/assets/js/dashboard.js" defer></script>` in `index.html`. Same pattern in `b.html`. Cloudflare Pages serves from root — no config change needed.

Also in this commit: `console.error` top-level catch added to `monthly-report/index.ts` (only edge function that lacked one). `README.md` created.

**Commit `52aecdc` — Form UX improvements:**

*FIX 1 — Close button + tap-outside overlay on inline forms:*
- `closeForm()` added to `middleman.js` — collapses form, clears `gOpenFormKey`, hides `#formOverlay`
- `#formOverlay` div added to `b.html` inside `#app`
- `handleTap()` calls `closeForm()` for all close paths; calls `overlay.classList.add('visible')` on open
- Close button wired in `attachFormListeners()` via `formWrap.querySelector('.form-close-btn')`
- Overlay click wired once in `render()` after DOM ready

Stacking (within `#app`'s stacking context):
```
z-index: 10  .form-overlay (position: fixed, inset: 0) — dims buttons/header
z-index: 15  .form-wrap.open (position: relative) — form floats above overlay
z-index: 10  .form-close-btn (position: absolute within .inline-form)
```
`.inline-form` has `position: relative` so the close button anchors correctly.

*FIX 2 — Note/message textarea: 200 → 500 characters:*
- `noteFieldOpt` (shared by change_cancel, function, lost_found forms): `maxlength="500"`, counter `/500`
- `something_else` message textarea: `maxlength="500"`, counter `/500`

*FIX 3 — Company name optional field in function enquiry form:*

New optional `<input data-field="company_name">` after Name, before Phone in the function form.

Payload building:
```js
var companyName = getField('company_name');
var noteBase    = 'Guests: ' + guests + (note ? '. ' + note : '');
payload.note    = companyName ? 'Company: ' + companyName + '\n' + noteBase : noteBase;
if (companyName) payload.company_name = companyName;
```

---

## Current Code State

### Edge functions

| Function | Auth | Notes |
|----------|------|-------|
| `submit-middle-man-form` | public (verify_jwt=false) | Always returns 200. Inserts middle_man_form_submissions, fires send-client-notification (link_tapped). No SMS. |
| `upload-middle-man-background` | verify_jwt=true + ownership/admin | Images only. 3-variant JPEG via imagescript. Video → 400. |
| `send-twilio-sms` | internal | Warmup handler + pg_cron `*/5 * * * *`. |
| `send-client-notification` | X-Internal-Secret | missed_call/booking_logged → VAPID push + Resend email. link_tapped → Progressier only. Warmup + cron. |
| `log-middle-man-tap` | public | Inserts link_clicks, fires send-client-notification (link_tapped). |
| `process-unsubscribe` | — | DORMANT until Phase 2. No warmup, no cron — intentional. |

### Admin dashboard key functions (`assets/js/dashboard.js`)

| Function | Purpose |
|----------|---------|
| `openMmMgrPanel()` | Opens tool panel showing all clients' MM configs |
| `mmEditOpen(clientId)` | Opens second-level edit panel for one client |
| `mmEditUploadBg()` | File input → XHR to `upload-middle-man-background` |
| `mmEditRemoveBg()` | NULLs `middle_man_background_url` + `middle_man_background_type` in DB |
| `closeMmEdit()` | Closes edit panel (correctly removes `body.panel-open`) |

### Middle Man page key functions (`assets/js/middleman.js`)

All code is IIFE-wrapped. No globals exposed.

| Function | Purpose |
|----------|---------|
| `boot()` | Extracts slug, calls fetchClient(), render() |
| `fetchClient(slug)` | Supabase REST anon key, returns client row |
| `render(client, slug)` | Sets background, builds buttons+forms, wires events |
| `buildFormHtml(type)` | Returns HTML string for inline form |
| `attachFormListeners()` | Wires counters, change/cancel select, submit, close btn |
| `handleTap()` | Toggle form open/close, log booking taps, show overlay |
| `closeForm()` | Collapse form, clear gOpenFormKey, hide overlay |
| `handleSuccess()` | Show success state (⚠️ does NOT call closeForm — see known bugs) |
| `classifyLabel(label)` | Maps button label → form type |

Form types: `change_cancel`, `function`, `late_arrival`, `lost_found`, `something_else`, `booking` (booking = redirect only, no inline form).

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
- `warmup-send-twilio-sms`
- `warmup-submit-middle-man-form`
- `warmup-log-middle-man-tap`

---

## Known Bugs / Deferred Items

| Priority | Item | Location | Detail |
|----------|------|----------|--------|
| HIGH | Push notification doesn't include company name for function enquiries | `supabase/functions/submit-middle-man-form/index.ts` | Frontend sends `payload.company_name`. Edge function needs to read it and build notification as `"🎉 [Business] — [caller_name] from [company_name] has a function enquiry"` conditionally. |
| MEDIUM | `closeForm()` not called on successful form submit | `assets/js/middleman.js` → `handleSuccess()` | After submitting, overlay stays visible and `gOpenFormKey` is not cleared. Minor UX issue. One-line fix. |
| PHASE 1.5 | Video backgrounds | Multiple files | All stubs removed. When re-adding: restore `ALLOWED_VIDEO_TYPES` in edge function, video render branch in middleman.js, video CSS, file picker accepts for video, all 6 Safari autoplay attributes. |
| PHASE 2 | Unsubscribe flow | `b.html`, `process-unsubscribe/` | Wire `process-unsubscribe`, update "Stop these texts" link, add warmup cron. |
| KNOWN GAP | Progressier failures not escalated | `send-client-notification/index.ts` | For `link_tapped` events, Progressier API failure fires no Pushover alert (unlike `missed_call` / VAPID which do). Not fixed — logged only. |
| KNOWN GAP | `INTERNAL_SECRET` missing is silent | `submit-middle-man-form/index.ts` | If env var missing, logs `console.warn` and skips all notifications. No hard error. Not fixed. |

Note: `middle_man_background_type` being absent from the SELECT in `fetchClient()` is intentional — video is fully deferred and the column is a no-op until Phase 1.5.

---

## Quick Orient Commands

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

---

## Suggested First Tasks for Next Session

1. **Fix `submit-middle-man-form` for company_name in push notifications (HIGH)** — Read `supabase/functions/submit-middle-man-form/index.ts`, find where the Progressier notification body is built, add conditional `from [company_name]` when `payload.company_name` is present.

2. **Fix `handleSuccess()` to call `closeForm()` (MEDIUM)** — One-line fix in `assets/js/middleman.js`. After the success state is shown, call `closeForm()` so the overlay and `gOpenFormKey` are cleared.

3. **Test full flow on a real iPhone** — Video autoplay (when Phase 1.5 ships), image loading with cache-bust, form close button, tap-outside, 500-char note counter, company name field.

---

## Suggested Skills for Next Session

- `/diagnose` — for any edge function failures or push notification gaps
- `/verify` — to confirm fixes work in the running app before committing
- `/code-review` — before merging any new Middle Man or Phase 1.5 work
