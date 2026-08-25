## PROTECTED BASELINE — NEVER OVERWRITE

Tag: baseline-working-20260824
Confirmed working: 24 August 2026 — Arcane Fairies correct, zero staging URLs.

Revert command (restores all four Middle Man files to confirmed working state):
git checkout baseline-working-20260824 -- assets/css/middleman.css assets/js/middleman.js b.html cm1site/b.html

After any revert:
1. Bump middleman.css version string in both b.html and cm1site/b.html
2. Run: grep "staging" b.html cm1site/b.html — zero output required
3. Commit and push
4. Confirm live on cm1.au/arcane-fairies on a real device before proceeding

RULES — NEVER BREAK:
- Never make changes to middleman.css, middleman.js, b.html or cm1site/b.html without bumping version strings in both HTML files in the same commit
- Never commit without running: grep "staging" b.html cm1site/b.html — zero output required
- After every change to middleman.css or middleman.js: visually confirm cm1.au/arcane-fairies on a real device — logo fully visible, all 6 buttons on screen, layout unchanged
- If anything looks wrong on Arcane Fairies: stop, run revert command above, confirm live, then get diagnostic data before trying again
- One file per commit — never CSS and JS together

## BASELINE 2 — BREATHING GLOW (confirmed working 24 Aug 2026)

Tag: baseline-breathing-glow-20260824
Commit: 4de90d8
CSS version: v=20260824e

Feature: Breathing glow on all Middle Man buttons.
- All buttons breathe by default — the static neon glow is now animated
- Glow on/off toggle (btn.animate === false) correctly stops the breathing animation via .tap-btn.glow-off { animation: none }
- Form-open kill switch prevents animation from creating a line at the top of the open form via .btn-unit.form-open .tap-btn { animation: none !important }
- No JS changes — CSS only feature

Revert command (restores to breathing glow confirmed working state):
git checkout baseline-breathing-glow-20260824 -- assets/css/middleman.css b.html cm1site/b.html

---

# CallMagnet — System Architecture
*Last updated: 2026-08-11*

## What it does

CallMagnet is a missed-call recovery SaaS for Australian small businesses. When a customer calls a business number and can't get through, Twilio detects the missed call and automatically sends the caller an SMS within seconds containing a booking link. The link opens the business's branded Middle Man page where the customer can book, enquire, or submit a request without the business needing to call back. The business owner receives a push notification on their PWA and can view all submissions in a slide-out panel on their dashboard.

## Tech stack

- **Frontend:** Netlify — two sites: callmagnet.com.au (admin/client PWA) and callmag (cm1.au — customer Middle Man pages)
- **Backend:** Supabase (PostgreSQL + Edge Functions + Storage)
- **SMS:** Twilio (phone numbers + Studio flows + SMS API)
- **Push notifications:** Progressier (PWA install + push)
- **Link tracking:** Netlify (callmag site) — cm1.au serves b.html via catch-all _redirects. Click tracking via log-click Supabase edge function writing to link_clicks table.
- **Payments:** Stripe (subscriptions, webhooks)
- **Email:** Resend (welcome, monthly report, alerts)
- **Video processing:** Netlify serverless function (process-video) with static Linux x64 ffmpeg binary — re-encodes uploaded MP4s with faststart, strips audio, overwrites in Supabase Storage

## Data flow — missed call to recovery

```
Missed call
→ Twilio Studio flow
→ twilio-missed-call edge fn (logs to sms_events, triggers send-missed-call-sms)
→ send-missed-call-sms edge fn (calls send-twilio-sms, writes sms_events row)
→ send-twilio-sms edge fn (Twilio SMS API → caller's phone)
→ cm1.au short link
→ callmagnet.com.au/b/<slug> (Middle Man page — b.html)
→ Button tap → log-middle-man-tap edge fn → link_clicks table
→ Form submit → submit-middle-man-form edge fn → middle_man_form_submissions table
→ send-client-notification edge fn (Progressier push → all owner devices)
→ Owner opens PWA (index.html)
→ Neon tiles show counts
→ Slide-out panel → submission cards
```

## Video upload flow

```
Admin selects MP4 in admin panel
→ Raw file uploaded direct to Supabase Storage (middle-man-backgrounds bucket)
→ POST to /.netlify/functions/process-video with { client_id, storage_path }
→ Netlify function downloads file from Storage
→ ffmpeg re-encodes: -movflags faststart -an -vcodec copy
→ Overwrites same storage_path with processed file
→ Public URL returned → persisted to clients.middle_man_background_url
→ Live preview updates in admin panel
→ Middle Man page plays video on iOS without user gesture
```

## Database tables (public schema)

| Table | Description |
|---|---|
| `clients` | One row per paying client — business name, contact, Stripe IDs, Middle Man config, account status |
| `sms_events` | One row per missed-call SMS sent — caller number, timestamp, Twilio SID |
| `link_clicks` | One row per Middle Man page button tap — slug, intent label, timestamp |
| `middle_man_form_submissions` | One row per form submitted on the Middle Man page — form type, caller details, request payload |
| `push_subscriptions` | PWA push notification endpoint registrations per client device |
| `opt_outs` | Phone numbers that have opted out of SMS |
| `unsubscribe_events` | Audit trail of opt-out actions — who unsubscribed, when, from which link |
| `unsubscribe_tokens` | One-time tokens embedded in SMS unsubscribe links |
| `cancellation_reasons` | Reason records for each client cancellation (self-service or admin) |
| `monthly_reports` | Idempotency lock + status tracking for monthly recap emails per client per period |

## Edge functions

| Function | Description | verify_jwt |
|---|---|---|
| `twilio-missed-call` | Receives Twilio Studio webhook, logs missed call, queues SMS send | false |
| `send-missed-call-sms` | Builds SMS payload, calls send-twilio-sms, updates sms_events | false |
| `send-twilio-sms` | Low-level Twilio SMS API wrapper | false |
| `twilio-sms-status` | Receives Twilio delivery status callbacks, updates sms_events | false |
| `submit-middle-man-form` | Saves customer form submissions, fires send-client-notification | false |
| `log-middle-man-tap` | Records button taps on Middle Man page to link_clicks | false |
| `send-client-notification` | Sends Progressier push to all owner devices for a client | false |
| `get-booking-url` | Returns booking URL for a given slug (used by SMS link redirect) | false |
| `quick-responder` | Cron-triggered fast follow-up SMS for unanswered missed calls | false |
| `save-push-subscription` | Registers a PWA push endpoint for a client device | false |
| `upload-middle-man-background` | Handles image background uploads to Supabase Storage | **true** |
| `process-unsubscribe` | Validates one-time token and records opt-out | false |
| `create-client` | Admin-only: creates a new client row with Stripe customer | false |
| `admin-cancel-client` | Admin-only: cancels a client's Stripe subscription at period end | false |
| `submit-cancellation` | Client self-service cancellation with reason capture | false |
| `stripe-payment-succeeded` | Stripe webhook: reactivates account on successful payment, sends welcome email | false |
| `stripe-subscription-deleted` | Stripe webhook: suspends account when subscription is deleted | false |
| `send-daily-summary` | Cron: sends daily missed-call summary email to Carl | false |
| `monthly-report` | Cron: sends monthly recap email to each active client | false |
| `send-pushover-alert` | Internal: sends Pushover push notification to Carl | false |
| `request-login-link` | Sends magic-link email for client login (blocks admin email) | false |
| `send-test-notification` | Admin testing: sends a test push notification to a client | false |
| `hyper-endpoint` | Misc internal utility endpoint | false |
| `SEND-EMAIL-SEQUENCE` | Sends onboarding email sequences to new clients | false |

## Netlify functions

| Function | Description |
|---|---|
| `process-video` | Accepts { client_id, storage_path } — downloads raw MP4 from Supabase Storage, runs ffmpeg faststart re-encode, strips audio, overwrites file, returns public URL |

## Security model

- **Admin dual gate:** All admin edge functions check both `app_metadata.is_admin === true` AND `email === car312@hotmail.com` — either check failing returns 403.
- **Internal secret:** Cron-triggered functions (`send-daily-summary`, `monthly-report`, `quick-responder`, `send-pushover-alert`) require `X-Internal-Secret` header matching the `INTERNAL_SECRET` vault secret.
- **Stripe webhook signatures:** `stripe-payment-succeeded` and `stripe-subscription-deleted` verify Stripe HMAC signatures and reject replays older than 5 minutes.
- **RLS:** Clients can only read and write their own rows via anon-key queries. Service role key is used only inside edge functions.
- **Service role:** Edge functions use the `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS for writes. This key is never exposed to the client.
- **Magic links blocked:** `request-login-link` refuses to send magic links to the admin email address — admin must use password login.
- **upload-middle-man-background:** `verify_jwt = true` so the gateway rejects missing or invalid JWTs before the function runs. The function then performs a two-tier ownership check (client owns the slug OR caller is admin).
- **process-video:** Requires Authorization header with valid Supabase JWT. POST only.

## Architecture rules — never break

- Column is `middle_man_slug` not `slug`
- `clients` table never hard deleted — cancelled only via `account_status = 'cancelled'`
- SMS never contains callmagnet.com.au
- Number porting permanently off the table
- iOS background video must autoplay without user gesture — never add touch-to-play
- Videos must be H.264, faststart-encoded, audio stripped, max 15MB
- `cm1site/b.html` and root `b.html` must always be kept in sync
- Never change `middleman.js`, `b.html`, or `service-worker.js` to fix iOS autoplay
- Every middleman.js change must bump version string in both b.html files
- Short.io cancelled and gone — never re-add
- Rebrandly cancelled and gone — never re-add

## Recent changes (August 2026)

- Video upload system fully operational — raw MP4 uploads to Supabase Storage, Netlify process-video function runs ffmpeg faststart re-encode, URL persisted to clients table, Middle Man page plays video on iOS
- netlify.toml rewritten cleanly — correct TOML syntax, no conflicting blocks
- ffmpeg static Linux x64 binary committed to netlify/functions/ffmpeg (75MB, mode 100755)
- RLS enabled on `weekly_summaries` table — admin and service_role only
- Fabricated estimated revenue stat removed from monthly report email — replaced with real `sms_count`
- `BLOCKED_CLIENT_IDS` enforced in `twilio-missed-call` — emergency SMS block works end to end
- Button ID system built — stable IDs on `middle_man_buttons`, logged as `intent`, matched in dashboard
- `client_audit_log` table and trigger built — every UPDATE on `clients` is automatically snapshotted
- All 100 migrations confirmed in sync between local repo and remote DB

## Outstanding

- Convert Arcane Fairies to paying client — highest commercial priority
- Build public marketing landing page at callmagnet.com.au
- Schedule Day 14 and Day 30 onboarding email crons
- Migrate welcome email HTML to Resend template editor
- Build admin numbers page
- Add weekly_summaries RLS policy
- Delete shortio-lookup-tmp edge function
- UptimeRobot — add cm1.au/arcane-fairies monitor
- All changes go directly to main — staging branch is not used

## CRITICAL INCIDENT — 22-23 August 2026

### What Broke
1. `cm1site/b.html` and `b.html` loaded CSS from `callmagnet-staging.netlify.app` instead of `callmagnet.com.au` — caused by staging work being merged to main without checking URLs
2. Logo `max-height` changed from `90px` to `160px` directly on main — broke Arcane Fairies layout
3. Page stopped scrolling correctly on mobile for all clients

### Root Cause
Staging branch work (button auto-sizing, button effects, breathing glow, sparkles) was merged to production. The merge brought a staging CSS URL into production files. Additionally logo changes were made directly on main bypassing staging.

### Fix
Force reset main to last known good commit `d10087a`:

### Rules — Never Break
- NEVER make untested changes to `middleman.js`, `b.html`, `cm1site/b.html`, or `middleman.css`
- NEVER merge staging to main without checking every URL in `b.html` and `cm1site/b.html` — staging URLs must never appear in production files
- `cm1site/b.html` must ALWAYS load CSS and JS from `callmagnet.com.au` — never from staging
- NEVER attempt to fix a broken production page by making more changes — revert first, diagnose second
- Emergency fix procedure: `git reset --hard <last-good-commit>` then `git push origin main --force`
- Logo `max-height` is `90px` — never change without testing on a client with no logo AND Arcane Fairies simultaneously
- Before every commit: run `grep "staging" b.html cm1site/b.html` — if any output appears, fix before committing

## INCIDENT — 25 August 2026 — White Flash on Form Close

### What happened
A faint white ghost of the form fields appeared for a split second when closing any Middle Man form. Happened on all accounts, all devices.

### Root cause
`.form-wrap` uses `max-height: 0` transition over 350ms to collapse. During those 350ms the form content (name, phone, booking fields) remained fully visible in the DOM while the container shrank. The content ghosted through the background image as a faint white overlay until max-height reached zero.

### What did NOT cause it
- backdrop-filter on .tap-btn or .btn-unit.form-open
- border-radius transition on .tap-btn
- border-color on .tap-btn
- GPU compositor layer release
- Any animation or breathing glow code

### What caused it
.form-wrap had no opacity — content was fully visible during the 350ms max-height collapse.

### Fix
Added opacity: 0 to .form-wrap (closed state) and opacity: 1 to .form-wrap.open, with transition: opacity 0.1s ease. Content fades out in 100ms — before the 350ms height collapse completes. Ghost disappears instantly.

### How it was diagnosed
A photo of the screen during the flash showed the form fields circled in red — immediately identifying the correct element. Console logs on CSS properties were on the wrong element and wasted hours.

### Rule added
For any visual bug — get a photo or screenshot of the exact visual artifact FIRST before touching any code. Never diagnose a visual bug from CSS property values alone.
