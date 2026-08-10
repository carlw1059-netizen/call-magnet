# CallMagnet — Master Context Document
*Last updated: 2026-08-11*
*Purpose: Enable any developer or AI coding tool to pick up this codebase cold and be fully operational.*

---

## 1. WHAT THIS PRODUCT IS

CallMagnet is a B2B missed-call recovery SaaS for Australian service businesses — restaurants, hairdressers, barbers, cafes. Built under Nextpak Pty Ltd ABN 78 686 984 789.

**The problem it solves:** When a customer calls a business and can't get through, that customer is lost. They hang up and call a competitor. CallMagnet catches them automatically.

**How it works:** The business forwards their phone number to a Twilio number. When a call goes unanswered, Twilio fires a webhook. CallMagnet sends the caller an SMS within seconds containing a link to a branded "Middle Man" page. The caller taps a button (Book a table, Running late, etc.). The business gets a push notification. Nobody needs to call anyone back.

**B2B invisibility rule:** CallMagnet is invisible to end customers. No CallMagnet branding appears in any SMS or on any customer-facing page. The Middle Man page looks like it belongs to the venue.

**How it makes money:** Setup fee (one-time) + monthly subscription + SMS overage. Pricing by vertical:
- Restaurant: $499 setup + $249/month
- Hairdresser/Barber: $249 setup + $99/month
- SMS overage: metered via Stripe

---

## 2. WHO IS INVOLVED

**Carl** — solo founder, admin, only person who operates the system
- Admin email: car312@hotmail.com (is_admin = true in Supabase auth)
- Local machine: Windows, C:\Users\car31\call-magnet
- GitHub: carlw1059-netizen

**Alex Docherty** — owner of Arcane Fairies (restaurant, Melbourne)
- Email: alex@storyvillemelbourne.com.au
- Phone: +61421417758
- middle_man_slug: arcane-fairies
- Twilio number: +61489278544
- Status: Active free trial, not yet converted to paying client

---

## 3. THE TECH STACK

| Service | What it does | Identifier |
|---|---|---|
| Netlify | Hosts frontend (callmagnet.com.au) and Middle Man pages (cm1.au) | Site: jocular-mooncake-c48f5c |
| Netlify (staging) | Staging environment | callmagnet-staging.netlify.app |
| Supabase (production) | PostgreSQL database + edge functions + file storage | Project ref: iskvvnhacqdxybpmwuni |
| Supabase (staging) | Staging database | Project ref: knupnihccvdsnoxnaqwo |
| Twilio | Phone numbers, Studio call flows, SMS API | Account SID in Supabase vault |
| Stripe | Subscriptions, setup fee checkout, overage metering | Live mode |
| Resend | All transactional email | hello@callmagnet.com.au |
| Pushover | Push alerts to Carl's phone only | Admin alerts |
| Progressier | PWA install + push notifications to clients | App ID: 9kXZoGF2Dlfeqec880My |
| GitHub | Source code | carlw1059-netizen/call-magnet |
| ffmpeg | Video processing (Linux x64 static binary in repo) | netlify/functions/ffmpeg |

**Twilio numbers:**
- +61468083169 — demo and test clients only
- +61489278544 — Arcane Fairies (current trial client, not yet paying)
- +61474047050 — Telstra burner for testing, currently forwarding to +61489278544
- Additional numbers will be added here as new clients onboard — one Twilio number per client

**Stripe Price IDs (live mode):**
- Hairdresser setup: price_1TD0jm3MTu8r2rLhkXPpx0AH ($249)
- Hairdresser monthly: price_1TD12P3MTu8r2rLhJYFPksVx ($99/month)
- Restaurant setup: price_1Ti51s3MTu8r2rLhmmtEk3Fb ($499)
- Restaurant monthly: price_1Ti51u3MTu8r2rLhBNxFra0k ($249/month)
- SMS overage: price_1TMmTG3MTu8r2rLhYSWnqheS (metered)

**Two Netlify sites:**
1. callmagnet.com.au — main site, admin panel, client dashboard (PWA)
2. cm1.au — Middle Man pages only, catch-all redirect to b.html via _redirects

---

## 4. ENVIRONMENT VARIABLES

**Supabase Vault secrets (accessed via get_vault_secret RPC):**
- stripe_secret_key — Stripe live secret key
- TWILIO_ACCOUNT_SID — Twilio account SID
- TWILIO_AUTH_TOKEN — Twilio auth token
- INTERNAL_SECRET — shared secret for cron-to-function calls
- RESEND_API_KEY — Resend API key
- STRIPE_WEBHOOK_SECRET_SUCCEEDED — Stripe webhook signing secret for payment-succeeded
- STRIPE_WEBHOOK_SECRET_DELETED — Stripe webhook signing secret for subscription-deleted
- PUSHOVER_USER_KEY — Pushover user key for Carl
- PUSHOVER_APP_TOKEN — Pushover app token

**Netlify environment variables:**
- SUPABASE_URL — https://iskvvnhacqdxybpmwuni.supabase.co (NOT marked as secret)
- SUPABASE_SERVICE_ROLE_KEY — Supabase service role key (secret)
- SECRETS_SCAN_SMART_DETECTION_ENABLED — false (prevents false positive secret scan failures)

---

## 5. THE CORE PRODUCT FLOW

1. Customer calls a business number (e.g. Arcane Fairies restaurant)
2. Call goes unanswered — business has call forwarding to their Twilio number
3. Twilio Studio flow detects the missed call and fires a webhook to the twilio-missed-call edge function
4. twilio-missed-call logs the event to the sms_events table and returns the sms_event_id to Studio
5. Twilio Studio calls send-missed-call-sms with the caller number, client Twilio number, and SMS template
6. send-missed-call-sms checks if the caller has opted out — if so, suppresses SMS
7. send-missed-call-sms checks the monthly SMS cap — if reached, suppresses SMS
8. send-missed-call-sms generates an unsubscribe token and builds the final SMS with the Middle Man link
9. SMS fires to the caller FROM the client's own Twilio number (not a CallMagnet number)
10. Caller taps the cm1.au link and lands on the Middle Man page (b.html)
11. Caller taps an intent button (Book a table, Running late, etc.)
12. log-middle-man-tap records the tap in link_clicks table
13. send-client-notification fires a Progressier push notification to the business owner's devices
14. Business owner opens their PWA dashboard and sees the submission

---

## 6. THE PAYMENT AND ONBOARDING FLOW

**Step 1 — Carl onboards the client:**
- Go to callmagnet.com.au/admin/onboard.html
- Fill in business name, owner details, Twilio number, vertical, pricing package
- Submit calls create-client edge function
- create-client creates auth user, clients row, Stripe customer, Stripe checkout session
- Welcome email sent to client with temp password and checkout link
- Client account_status = pending_payment

**Step 2 — Client pays setup fee:**
- Client clicks checkout link in email
- Stripe checkout charges setup fee, saves card for future billing
- stripe-payment-succeeded webhook fires
- account_status set to pending_setup
- Carl gets Pushover alert and email

**Step 3 — Carl activates:**
- Carl goes to admin panel, finds client, clicks Activate
- Fills in pricing_package (restaurant or hairdresser)
- activate-client edge function creates Stripe subscription (monthly + SMS overage)
- account_status set to active
- "Your account is live" email sent to client

**Step 4 — Cancellation:**
- Either Carl cancels via admin-cancel-client, or client cancels via submit-cancellation
- Stripe subscription cancelled at period end
- stripe-subscription-deleted webhook fires
- account_status set to cancelled (NEVER deleted from database)

---

## 7. EVERY EDGE FUNCTION

**twilio-missed-call** — verify_jwt: false
- Triggered by: Twilio Studio HTTP widget after missed call
- Does: Parses Twilio form POST, looks up client by Twilio number, checks BLOCKED_CLIENT_IDS env var, inserts row to sms_events table
- Returns: sms_event_id to Twilio Studio
- Can fail: If client not found for the called number (orphaned call), logs warning and returns 200

**send-missed-call-sms** — verify_jwt: false
- Triggered by: Twilio Studio HTTP widget (after twilio-missed-call)
- Does: Checks opt_outs table, checks monthly SMS cap, generates unsubscribe token, substitutes [LINK] placeholder with cm1.au URL, sends SMS via Twilio Messages API FROM client's own number
- Returns: Twilio MessageSid
- Can fail: Twilio Lookup may flag landlines and suppress SMS (non-fatal)

**send-twilio-sms** — verify_jwt: false
- Triggered by: Internal calls from other edge functions (requires X-Internal-Secret header)
- Does: Low-level Twilio SMS wrapper, sends FROM a fixed number
- Used for: Onboarding SMS, not missed-call replies

**twilio-sms-status** — verify_jwt: false
- Triggered by: Twilio StatusCallback on each SMS
- Does: Updates sms_events row with delivery status and MessageSid

**submit-middle-man-form** — verify_jwt: false
- Triggered by: Middle Man page form submission
- Does: Saves to middle_man_form_submissions table, calls send-client-notification

**log-middle-man-tap** — verify_jwt: false
- Triggered by: Middle Man page button tap
- Does: Writes to link_clicks table with intent label and slug

**send-client-notification** — verify_jwt: false
- Triggered by: submit-middle-man-form and log-middle-man-tap
- Does: Sends Progressier push notification to all owner devices for a client

**create-client** — verify_jwt: true (admin only)
- Triggered by: /admin/onboard.html form submission
- Does: Validates all inputs, creates Supabase auth user, inserts clients row, creates Stripe customer and checkout session, sends welcome email via Resend, sends onboarding SMS
- Guards: Requires is_admin=true AND email=car312@hotmail.com

**activate-client** — verify_jwt: true (admin only)
- Triggered by: Admin panel Activate button
- Does: Creates Stripe subscription (monthly + SMS overage), sets account_status=active, sends live email to client
- Guards: Requires is_admin=true AND email=car312@hotmail.com

**admin-cancel-client** — verify_jwt: true (admin only)
- Triggered by: Admin panel Cancel button
- Does: Cancels Stripe subscription at period end, sets account_status=cancelled

**stripe-payment-succeeded** — verify_jwt: false
- Triggered by: Stripe webhook (checkout.session.completed and invoice.payment_succeeded)
- Does: Verifies Stripe HMAC signature, rejects replays older than 5 minutes, sets account_status=pending_setup on checkout, sends confirmation emails, Pushover to Carl
- Guards: is_test_account check, account_status=pending_payment check

**stripe-subscription-deleted** — verify_jwt: false
- Triggered by: Stripe webhook (customer.subscription.deleted)
- Does: Sets account_status=cancelled, sends farewell email with lifetime stats to client

**send-daily-summary** — verify_jwt: false
- Triggered by: Cron job (requires X-Internal-Secret header)
- Does: Sends daily missed-call count email to Carl

**weekly-summary** — verify_jwt: false
- Triggered by: Cron job (requires X-Internal-Secret header)
- Does: Sends weekly summary email to each active client (SMS count, link clicks, heatmap, button breakdown) + internal summary to Carl
- Test endpoint: POST https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/weekly-summary?test=1

**monthly-report** — verify_jwt: false
- Triggered by: Cron job (requires X-Internal-Secret header)
- Does: Sends monthly recap email to each active client

**request-login-link** — verify_jwt: false
- Triggered by: Login page
- Does: Sends magic link email to client. Blocks admin email (car312@hotmail.com) — admin must use password login

**save-push-subscription** — verify_jwt: false
- Triggered by: PWA install / push permission grant
- Does: Registers push endpoint in push_subscriptions table

**process-unsubscribe** — verify_jwt: false
- Triggered by: Caller taps "Stop these texts" on Middle Man page
- Does: Validates one-time token from unsubscribe_tokens table, inserts to opt_outs table

**upload-middle-man-background** — verify_jwt: true
- Triggered by: Admin panel photo upload (images only, NOT video)
- Does: Uploads image to Supabase Storage middle-man-backgrounds bucket, updates clients.middle_man_background_url

**quick-responder** — verify_jwt: false
- Triggered by: Cron job
- Does: Sends follow-up SMS to unanswered missed calls

---

## 8. EVERY NETLIFY FUNCTION

**process-video** — POST only
- Location: netlify/functions/process-video.js
- Triggered by: Admin panel video upload (middle-man-admin.js)
- Flow: Admin JS uploads raw MP4 directly to Supabase Storage, then calls this function with { client_id, storage_path }
- Does: Downloads raw MP4 from Supabase Storage, runs ffmpeg faststart re-encode (-movflags faststart -an -vcodec copy), overwrites same storage_path, returns public URL
- ffmpeg binary: netlify/functions/ffmpeg (75MB Linux x64 static binary, mode 100755)
- Result: Faststart-encoded MP4 that autoplays on iOS Safari without user gesture
- After success: Admin JS calls mmaSb.from('clients').update({ middle_man_background_url, middle_man_background_type: 'video' })
- Requires: Authorization header with valid Supabase JWT

---

## 9. THE MIDDLE MAN PAGE

The Middle Man page (b.html / cm1site/b.html) is the customer-facing page callers land on after tapping the SMS link. It is the centrepiece of the product.

**What it shows:**
- Business logo at top
- Background video or photo (uploaded by admin)
- Coloured neon-bordered buttons for each intent (Book a table, Running late, etc.)
- "Powered by CallMagnet" footer (tiny, can be removed for white-label)
- "Stop these texts" opt-out link

**How it works:**
- URL: cm1.au/<middle_man_slug> (e.g. cm1.au/arcane-fairies)
- cm1.au is a separate Netlify site (callmag) with catch-all _redirects to b.html
- b.html loads middleman.js which fetches client config from Supabase and renders the page
- Button taps call log-middle-man-tap edge function

**iOS video autoplay rules — CRITICAL:**
- Video must be H.264, faststart-encoded (moov atom at START of file), audio stripped, max 15MB
- vid.play() must ONLY be called inside the canplay event listener with { once: true }
- canplay listener must be wired BEFORE bgFixed.appendChild(vid) and BEFORE vid.load()
- NEVER call play() in loadedmetadata, immediately after load(), or at top level
- NEVER add touch-to-play or tap-to-play — if autoplay fails, investigate root cause only
- Low Power Mode on iOS blocks autoplay at OS level — cannot be overridden in code

**File sync rule:**
- root/b.html and cm1site/b.html must ALWAYS be identical
- Every change to middleman.js must bump the version string in BOTH b.html files
- Never deploy a middleman.js change without confirming both files reference the same version

---

## 10. THE STAGING ENVIRONMENT

**Purpose:** Test all changes before they hit the live system with real clients.

**Staging details:**
- URL: https://callmagnet-staging.netlify.app
- Netlify site: callmagnet-staging
- GitHub branch: staging
- Supabase project: knupnihccvdsnoxnaqwo (separate database, separate storage)

**Workflow — always follow this:**
1. git checkout staging
2. Make changes and commit
3. git push origin staging — Netlify auto-deploys to staging URL
4. Test on staging
5. git checkout main && git merge staging && git push origin main
6. For edge functions: deploy to staging ref first (knupnihccvdsnoxnaqwo), test, then production ref (iskvvnhacqdxybpmwuni)
7. For migrations: apply to staging Supabase first, test, then production

**Golden rule:** Nothing goes to production without being tested on staging first. Never use production Supabase ref iskvvnhacqdxybpmwuni in a test prompt.
