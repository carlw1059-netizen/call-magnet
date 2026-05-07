# CallMagnet System Audit

*Generated 2026-05-07. Supabase project: iskvvnhacqdxybpmwuni.*

---

## Architecture Overview

```
                        ┌─────────────────────────────────────────┐
                        │              TWILIO                      │
                        │  Client's forwarding number              │
                        │  → Studio flow (handles call)            │
                        │  → HTTP widget POSTs to edge fn          │
                        └──────────────┬──────────────────────────┘
                                       │ POST (form-encoded)
                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SUPABASE EDGE FUNCTIONS (Deno)                    │
│                                                                      │
│  twilio-missed-call ──→ sms_events INSERT ──→ send-client-          │
│  (ingest)                                      notification          │
│                                                (notify owner)        │
│  stripe-payment-succeeded ──→ clients PATCH (activate)             │
│  stripe-subscription-deleted ──→ clients PATCH (schedule cancel)   │
│  hyper-endpoint ──→ clients PATCH (suspend on payment failure)      │
│                                                                      │
│  send-daily-summary ──→ daily_summary_runs UPSERT + Resend email   │
│  monthly-report ──→ monthly_reports INSERT + Resend email           │
│  SEND-EMAIL-SEQUENCE ──→ Day14/Day30 Resend emails                  │
│  send-pushover-alert ──→ Pushover API                               │
│  save-push-subscription ──→ push_subscriptions UPSERT              │
│  get-booking-url ──→ link_clicks INSERT + redirect                  │
│  rebrandly-webhook ──→ link_clicks INSERT                           │
│  quick-responder ──→ Stripe meter events + cancellation cleanup     │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SUPABASE DATABASE (PostgreSQL 17)                 │
│  clients · sms_events · push_subscriptions · bookings               │
│  daily_summary_runs · monthly_reports · link_clicks                 │
│                                                                      │
│  pg_cron jobs:                                                      │
│    callmagnet-daily-summary  (hourly, gates on 18:00 Melbourne)     │
│    daily-summary-23-melbourne (0 13 UTC daily)                      │
│    monthly-report            (0 22 1st of month UTC)                │
│    warmup-* × 6              (*/5 * * * *)                          │
└─────────────────────────────────────────────────────────────────────┘
                               │
              ┌────────────────┼──────────────────┐
              ▼                ▼                  ▼
           Resend            Pushover          rebrand.ly
         (emails)          (push alerts)    (short links)
```

---

## Edge Functions

### twilio-missed-call
**Purpose:** Entry point for every missed-call event. Receives Twilio Studio's HTTP widget POST after a call goes unanswered.

**Trigger:** Twilio Studio flow HTTP widget (POST, no JWT — URL is the secret).

**Auth:** No JWT validation (`verify_jwt = false`). Twilio doesn't send Bearer tokens; the function URL is the auth layer.

**Data flow:**
1. Parse Twilio form fields: `From` (caller), `To` (client's Twilio number), `CallSid`, `Body`.
2. Look up `clients` by `twilio_number = To`.
3. Orphaned call (no matching client) → log warning, return 200 OK (stops Twilio retrying).
4. Insert row into `sms_events`. On duplicate `twilio_call_sid` (Twilio retry) → 409 caught → return 200 OK.
5. Call `send-client-notification` with `event='missed_call'`.
6. On any fatal error: send alert email to `car312@hotmail.com` via Resend.

**Key constraint:** `sms_events.twilio_call_sid` has a partial UNIQUE index — idempotent on Twilio retries.

---

### send-client-notification
**Purpose:** Dual-channel notification dispatcher. Sends Web Push to all of the client's subscribed devices AND a Resend email.

**Trigger:** Called by `twilio-missed-call` (after sms_events insert) and by the dashboard JS (after booking logged).

**Auth:** `X-Internal-Secret` header validated against `INTERNAL_SECRET` Vault secret.

**Data flow:**
1. Look up client (vertical, business_name, email, avg_job_value).
2. Build push title/body from vertical-aware template (barber/restaurant/default).
3. Fan out Web Push to all `push_subscriptions` rows for this client (parallel, failures isolated).
4. Prune 404/410 expired subscriptions (fire-and-forget).
5. Refresh `last_used_at` on successful subscriptions (fire-and-forget).
6. Send Resend email:
   - **restaurant + missed_call**: fetches today's count (since Melbourne midnight) and week's count (since last Monday 17:00 Melbourne) from `sms_events`, computes estimated revenue at `avg_job_value × 0.62`, sends rich stats email with 2-tile grid + CTA button + Lead Connect 2025 footer.
   - **all other verticals/events**: simple title + body + dashboard link.

---

### send-daily-summary
**Purpose:** Daily email report per active client. Missed calls today / 7d / 30d, estimated bookings and revenue, link taps.

**Trigger:** pg_cron `daily-summary-23-melbourne` (0 13 UTC, ≈ 23:00 Melbourne). Invoked via `dispatch_daily_summary()` PLPGSQL function which reads `INTERNAL_SECRET` from Postgres Vault.

**Auth:** `X-Internal-Secret` header.

**Data flow:**
1. Fetch all `clients` where `account_status = 'active'`.
2. Per client: parallel count queries on `sms_events` (today/7d/30d) and `link_clicks` (today).
3. Compute `estRevenue = count × CONVERSION_RATE(0.62) × verticalRate`.
4. UPSERT `daily_summary_runs` (today's row only; 7d/30d not persisted).
5. Send branded Resend email.

---

### monthly-report
**Purpose:** Monthly recap email per eligible client. Previous calendar month's missed-call count, estimated revenue, day-of-week heatmap, suburb benchmark.

**Trigger:** pg_cron `monthly-report` (0 22 UTC on 1st of month). Uses Vault-stored `service_role_key` for auth.

**Auth:** `X-Internal-Secret` header (INTERNAL_SECRET + legacy PUSHOVER_INTERNAL_SECRET fallback).

**Data flow:**
1. Determine previous Melbourne month period.
2. Skip clients with < 14 days of data, cancelled, or in `BLOCKED_CLIENT_IDS`.
3. Lock via `monthly_reports` INSERT (UNIQUE client_id + period_month prevents double-send).
4. Query `sms_events` for the month; compute per-day heatmap, suburb comparison via `v_suburb_benchmarks` view.
5. Send multi-section recap email (hero stat, 2×2 card grid, day-of-week bar chart text).
6. Update `monthly_reports` row status to `sent`.
7. Send run-summary alert to `hello@callmagnet.com.au`.

Supports `dry_run=true` (returns preview HTML, no DB writes, no email send) and `client_id` / `period_month` overrides for replay.

---

### SEND-EMAIL-SEQUENCE
**Purpose:** Day 14 and Day 30 onboarding email sequence for new clients.

**Trigger:** pg_cron (nightly, `0 0 * * *` UTC). No auth header — runs as cron, not called externally.

**Data flow:**
1. Fetch all `clients` where `account_status = 'active'`.
2. Per client: compute `daysSinceStart` from `subscription_start` or `created_at`.
3. Day 14: send "two weeks in" email with SMS count, link taps, estimated revenue recovered. Mark `emails_sent += 'day14'`.
4. Day 30: send month-one summary email with full count breakdown. Mark `emails_sent += 'day30'`.
5. `emails_sent` array prevents re-sending (idempotent).

---

### stripe-payment-succeeded
**Purpose:** Stripe webhook for successful payments (invoice paid). Reactivates suspended accounts and sends a welcome email on first payment.

**Trigger:** Stripe `invoice.payment_succeeded` webhook. Auth: HMAC-SHA256 signature verification with `STRIPE_WEBHOOK_SECRET_SUCCEEDED`.

**Data flow:**
1. Verify Stripe signature.
2. Look up client by `stripe_customer_id`.
3. PATCH `clients.account_status = 'active'`.
4. If `emails_sent` doesn't include `'welcome'`: send welcome email via Resend, then append `'welcome'` to `emails_sent`.

---

### stripe-subscription-deleted
**Purpose:** Stripe webhook for subscription cancellation.

**Trigger:** Stripe `customer.subscription.deleted` webhook. Auth: HMAC-SHA256 with `STRIPE_WEBHOOK_SECRET_CANCELLED`.

**Data flow:**
1. Verify Stripe signature.
2. Look up client by `stripe_customer_id`.
3. PATCH `clients.cancellation_scheduled = true`, `cancelled_at = now()`.
4. `quick-responder` cron finalises the cancellation 30 days later.

---

### hyper-endpoint (stripe-payment-failed)
**Purpose:** Stripe webhook for failed payments. Suspends the client account.

**Trigger:** Stripe `invoice.payment_failed` webhook. Auth: HMAC-SHA256 with `STRIPE_WEBHOOK_SECRET`.

**Data flow:**
1. Verify Stripe signature.
2. PATCH `clients.account_status = 'suspended'`.
3. On error: alert email to `car312@hotmail.com`.

---

### quick-responder
**Purpose:** Two nightly batch jobs — SMS overage billing and cancellation finalisation.

**Trigger:** pg_cron (nightly, `0 0 * * *` UTC).

**Job 1 — SMS overage:**
1. Fetch active clients with `stripe_customer_id`.
2. Count 30-day SMS events. If `count > sms_included` (default 50): POST `billing.meter_event` to Stripe.
3. Set `last_overage_reported = today` to prevent duplicate billing.

**Job 2 — Cancellation finaliser:**
1. Fetch clients with `cancellation_scheduled = true` and `account_status = 'active'`.
2. If `cancelled_at` is 30+ days ago: PATCH `account_status = 'cancelled'`.

---

### send-pushover-alert
**Purpose:** Internal helper — sends a Pushover push notification to Carl's phone.

**Trigger:** Called by other edge functions and by `fire_daily_summary()` pg_cron function.

**Auth:** `X-Internal-Secret` header. Secret stored in BOTH Edge Functions Vault AND Postgres Vault — must update both on rotation.

**Data flow:** POST to `https://api.pushover.net/1/messages.json` with Pushover user key and app token.

---

### save-push-subscription
**Purpose:** Stores a Web Push subscription from the PWA dashboard.

**Trigger:** Dashboard JS calls this after the user grants push permission.

**Auth:** `X-Internal-Secret` header.

**Data flow:**
1. Validate `client_id` exists in `clients`.
2. UPSERT into `push_subscriptions` on conflict `(client_id, endpoint)` — refreshes `last_used_at`.

---

### get-booking-url
**Purpose:** Logs a link tap to `link_clicks` and returns the client's booking URL.

**Trigger:** SMS recipient taps the booking link (`?id=<client_id>`). CORS-enabled.

**Data flow:**
1. Read `client_id` from query string.
2. Fetch `clients.booking_url`.
3. INSERT into `link_clicks` with Melbourne-timezone day/hour metadata.
4. Return `{ booking_url }`.

---

### rebrandly-webhook
**Purpose:** Receives rebrand.ly click webhooks and logs to `link_clicks`.

**Trigger:** rebrand.ly Pro webhook (POST). Currently dormant — free tier doesn't fire webhooks; `REBRANDLY_WEBHOOK_SECRET = 'PENDING_UPGRADE'` fails auth for all real traffic.

**Auth:** Shared secret on `Authorization` header. Upgrade to Pro and rotate secret via `supabase secrets set REBRANDLY_WEBHOOK_SECRET=<value>`.

**Data flow:**
1. Validate `Authorization` header.
2. Look up client by `rebrandly_link_id`.
3. INSERT into `link_clicks`.

---

## Database Tables

### clients
Core table. One row per business subscribed to CallMagnet.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | Primary key |
| business_name | text | Display name |
| email | text | Owner email (receives all system emails) |
| twilio_number | text | The E.164 number Twilio bought for this client |
| vertical | text | Industry vertical: `barber`, `restaurant`, `hairdresser`, `tradie`, `default` |
| industry | text | Free-text industry (used in suburb benchmarks) |
| suburb | text | Client suburb (used in suburb benchmark emails) |
| postcode | text | Client postcode |
| account_status | text | `active`, `suspended`, `cancelled` |
| cancellation_scheduled | boolean | True once Stripe fires subscription.deleted |
| cancelled_at | timestamptz | When cancellation was scheduled |
| terms_accepted | boolean | Has accepted terms |
| subscription_start | timestamptz | When subscription began (Day 14/30 sequence base) |
| avg_job_value | numeric | Average $ per booking (used in revenue estimates) |
| abn | text | Australian Business Number, 11 digits, nullable |
| stripe_customer_id | text | Stripe customer ID for webhook matching |
| booking_url | text | URL sent in missed-call SMS |
| rebrandly_link_id | text | rebrand.ly link ID for webhook matching |
| sms_included | int | SMS quota per billing period (default 50) |
| last_overage_reported | date | Prevents duplicate overage billing |
| emails_sent | text[] | Tracks which sequence emails have been sent |
| palette_v2_reset | boolean | UI palette migration flag |
| theme_preference | text | Dashboard theme preference |

### sms_events
One row per missed call captured by the system.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | Primary key |
| client_id | uuid FK | Which client's number was called |
| customer_number | text | Caller's E.164 number |
| client_number | text | The Twilio number that was called |
| message_body | text | SMS body sent (NULL on missed-call path — Twilio Studio sends the SMS) |
| received_at | timestamptz | When the call came in |
| twilio_call_sid | text | Twilio's unique call ID (partial UNIQUE index for idempotency) |

### push_subscriptions
One row per device per client. Web Push subscription data.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | Primary key |
| client_id | uuid FK | Which client this device belongs to |
| endpoint | text | Push service URL |
| p256dh | text | ECDH public key |
| auth | text | Auth secret |
| user_agent | text | Browser/device identifier |
| created_at | timestamptz | When subscription was saved |
| last_used_at | timestamptz | Last successful push (refreshed by send-client-notification) |

UNIQUE(client_id, endpoint). RLS enabled, no policies — service_role only.

### bookings
Manual bookings logged by the client from the dashboard.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | Primary key |
| client_id | uuid FK | Which client logged the booking |
| customer_name | text | Customer name |
| booked_at | timestamptz | Booking timestamp |
| (other columns TBC) | | |

Trigger: `notify_first_booking` fires AFTER INSERT — sends Pushover alert on first booking of the Melbourne calendar day.

### link_clicks
Tracks when a recipient taps the booking link.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | Primary key |
| client_id | uuid FK | Which client's link was tapped |
| clicked_at | timestamptz | Click timestamp |
| rebrand_id | text | rebrand.ly link ID (populated by rebrandly-webhook) |
| device_type | text | mobile / desktop / tablet |
| country | text | Country of click |
| city | text | City of click |
| referrer | text | Referrer URL |
| user_agent | text | Browser UA string |
| raw_payload | jsonb | Full rebrand.ly payload |

### daily_summary_runs
Idempotency log for daily email sends. One row per client per Melbourne calendar day.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | Primary key |
| client_id | uuid FK | Client |
| summary_date | date | Melbourne calendar date (UNIQUE with client_id) |
| missed_calls_count | int | Today's missed call count |
| sms_sent_count | int | Today's SMS sent count (currently equals missed_calls_count) |
| estimated_bookings_low/high | int | Booking range estimate |
| estimated_revenue_low/high | numeric | Revenue range estimate |
| email_sent | boolean | Whether Resend email succeeded |
| sent_at | timestamptz | When email was sent |

RLS enabled, no policies — service_role only.

### monthly_reports
Idempotency log for monthly email sends. One row per client per period_month.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | Primary key |
| client_id | uuid FK | Client |
| period_month | date | First day of the report month (UNIQUE with client_id) |
| status | text | `pending`, `sent`, `failed` |
| generated_at | timestamptz | When generation started |
| sent_at | timestamptz | When Resend succeeded |
| resend_message_id | text | Resend's message ID for delivery tracking |
| error_message | text | Error if status = failed |
| payload | jsonb | Full report data for debugging |

---

## pg_cron Jobs

| Job name | Schedule (UTC) | What it does |
|----------|---------------|-------------|
| `callmagnet-daily-summary` | `0 * * * *` (hourly) | Calls `fire_daily_summary()` which self-gates on Melbourne hour = 18 (6pm). Sends Pushover daily stats to Carl. |
| `daily-summary-23-melbourne` | `0 13 * * *` | Calls `dispatch_daily_summary()` → POSTs to `send-daily-summary`. Sends per-client daily email at ≈23:00 Melbourne. |
| `monthly-report` | `0 22 1 * *` | POSTs to `monthly-report` edge function. Sends monthly recap emails on the 1st. |
| `warmup-twilio-missed-call` | `*/5 * * * *` | GET `twilio-missed-call?warmup=1` — keeps function warm |
| `warmup-send-client-notification` | `*/5 * * * *` | GET `send-client-notification?warmup=1` — keeps function warm |
| `warmup-send-daily-summary` | `*/5 * * * *` | GET `send-daily-summary?warmup=1` — keeps function warm |
| `warmup-monthly-report` | `*/5 * * * *` | GET `monthly-report?warmup=1` — keeps function warm |
| `warmup-rebrandly-webhook` | `*/5 * * * *` | GET `rebrandly-webhook?warmup=1` — keeps function warm |
| `warmup-send-pushover-alert` | `*/5 * * * *` | GET `send-pushover-alert?warmup=1` — keeps function warm |

**Note:** SEND-EMAIL-SEQUENCE and quick-responder are also cron-fired but their schedules are configured separately (not via Supabase migrations — check Supabase Dashboard → Database → Cron Jobs for their current schedule).

---

## Twilio Studio Flow

The Studio flow handles the call lifecycle when someone dials a client's Twilio number:

1. **Gather widget** — attempts to connect the call to the client's real number (via a Say/Connect widget or call forwarding logic).
2. **Branch on call outcome** — if the call goes unanswered (no-answer, busy, failed):
3. **HTTP widget (`http_1`)** — POST to `twilio-missed-call` edge function with `From`, `To`, `CallSid`.
4. **Send Message widget** — Twilio Studio sends the SMS directly to the caller using the client's booking URL.

The Studio flow is the component that actually sends the SMS to the missed caller. `twilio-missed-call` only records the event in the database and triggers owner notifications.

---

## Twilio Function: callmagnet-helpers / fetch-client-vertical

A Twilio Serverless Function deployed at the Twilio console level (not Supabase).

**Purpose:** Lets Twilio Studio look up a client's vertical, business name, and booking URL based on the called Twilio number. Used to personalise the SMS template (restaurant vs generic).

**Auth:** Uses Supabase `ANON_KEY` + a `SECURITY DEFINER` RPC function (`get_client_vertical`) that bypasses RLS and exposes only 3 safe fields. This avoids putting `SUPABASE_SERVICE_ROLE_KEY` in Twilio's environment.

**Environment variables required in Twilio:**
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

---

## Stripe Webhook Chain

```
Stripe event ──→ Stripe Dashboard webhook endpoint ──→ Edge function
                                                          │
invoice.payment_succeeded ──→ stripe-payment-succeeded ──→ activate + welcome email
customer.subscription.deleted ──→ stripe-subscription-deleted ──→ schedule cancellation
invoice.payment_failed ──→ hyper-endpoint ──→ suspend account
```

Each function verifies the Stripe HMAC-SHA256 signature before acting. Secrets:
- `STRIPE_WEBHOOK_SECRET_SUCCEEDED`
- `STRIPE_WEBHOOK_SECRET_CANCELLED`
- `STRIPE_WEBHOOK_SECRET` (payment failed)

---

## Push Notification Chain

```
Dashboard JS (PWA) ──→ save-push-subscription ──→ push_subscriptions table
                                                          │
twilio-missed-call ──→ send-client-notification ──→ web-push fan-out
dashboard JS (booking logged) ──┘                         │
                                                  Pushover (for Carl)
                                                  ← send-pushover-alert
                                                    ← fire_daily_summary (cron)
                                                    ← notify_first_booking (trigger)
```

---

## Email Chain

| Email | Sent by | Trigger | Via |
|-------|---------|---------|-----|
| Missed call / booking notification | send-client-notification | Real-time event | Resend |
| Welcome email | stripe-payment-succeeded | First payment | Resend |
| Daily summary | send-daily-summary | Cron 23:00 Melbourne | Resend |
| Monthly recap | monthly-report | Cron 1st of month | Resend |
| Day 14 onboarding | SEND-EMAIL-SEQUENCE | Cron nightly | Resend |
| Day 30 onboarding | SEND-EMAIL-SEQUENCE | Cron nightly | Resend |
| Fatal error alerts | various functions | On exception | Resend → car312@hotmail.com |

All emails use the shared `_shared/emailStyles.ts` brand tokens. Sender: `CallMagnet <hello@callmagnet.com.au>`.

---

## External Services

| Service | What it does | Key config |
|---------|-------------|------------|
| **Resend** | Transactional email delivery | `RESEND_API_KEY` in Vault. Sender domain: callmagnet.com.au |
| **Pushover** | Push alerts to Carl's phone | `PUSHOVER_USER_KEY`, `PUSHOVER_APP_TOKEN` in Vault |
| **rebrand.ly** | Short link tracking for booking URLs | `REBRANDLY_WEBHOOK_SECRET` in Vault (currently `'PENDING_UPGRADE'` — dormant) |
| **Stripe** | Subscription billing | Multiple webhook secrets in Vault |
| **Twilio** | Phone numbers, Studio flows, SMS | Account managed in Twilio Console |

---

## Analytics Views

| View | Purpose |
|------|---------|
| `v_repeat_callers` | Callers who called more than once |
| `v_call_patterns_hourly` | Missed calls grouped by hour of day |
| `v_call_patterns_daily` | Missed calls grouped by day of week |
| `v_tap_rate` | Link tap rate per client |
| `v_suburb_benchmarks` | Suburb-level benchmarks for monthly report comparisons |

---

## Vault Secrets

| Secret name | Used by | Notes |
|-------------|---------|-------|
| `INTERNAL_SECRET` | send-client-notification, send-daily-summary, save-push-subscription, send-pushover-alert, monthly-report | Lives in BOTH Edge Functions Vault AND Postgres Vault — update both on rotation |
| `PUSHOVER_INTERNAL_SECRET` | Legacy fallback (transitional) | Being phased out in favour of INTERNAL_SECRET |
| `VAPID_PUBLIC_KEY` | send-client-notification | Web Push identity — Edge Functions Vault only |
| `VAPID_PRIVATE_KEY` | send-client-notification | Web Push identity — Edge Functions Vault only |
| `VAPID_SUBJECT` | send-client-notification | Usually `mailto:hello@callmagnet.com.au` |
| `RESEND_API_KEY` | All email-sending functions | Edge Functions Vault |
| `PUSHOVER_USER_KEY` | send-pushover-alert | Edge Functions Vault |
| `PUSHOVER_APP_TOKEN` | send-pushover-alert | Edge Functions Vault |
| `REBRANDLY_WEBHOOK_SECRET` | rebrandly-webhook | Currently `'PENDING_UPGRADE'` |
| `service_role_key` | monthly-report cron | Postgres Vault only |
| `STRIPE_WEBHOOK_SECRET_SUCCEEDED` | stripe-payment-succeeded | Edge Functions Vault |
| `STRIPE_WEBHOOK_SECRET_CANCELLED` | stripe-subscription-deleted | Edge Functions Vault |
| `STRIPE_WEBHOOK_SECRET` | hyper-endpoint | Edge Functions Vault |
