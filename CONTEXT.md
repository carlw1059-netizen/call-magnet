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
