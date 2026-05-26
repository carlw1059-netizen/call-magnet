# CallMagnet — System Architecture

## What it does

CallMagnet is a missed-call recovery SaaS for Australian small businesses. When a customer calls a business number and can't get through, Twilio detects the missed call and automatically sends the caller an SMS within seconds containing a booking link. The link opens the business's branded Middle Man page where the customer can book, enquire, or submit a request without the business needing to call back. The business owner receives a push notification on their PWA and can view all submissions in a slide-out panel on their dashboard.

## Tech stack

- **Frontend:** Cloudflare Pages (index.html = admin/client PWA, b.html = customer Middle Man page, admin/ = admin tool pages)
- **Backend:** Supabase (PostgreSQL + Edge Functions + Storage)
- **SMS:** Twilio (phone numbers + Studio flows + SMS API)
- **Push notifications:** Progressier (PWA install + push)
- **Link tracking:** Rebrandly (short link redirect to Middle Man page)
- **Payments:** Stripe (subscriptions, webhooks)
- **Email:** Resend (welcome, monthly report, alerts)

## Data flow — missed call to recovery

```
Missed call
  → Twilio Studio flow
  → twilio-missed-call edge fn           (logs to sms_events, triggers send-missed-call-sms)
  → send-missed-call-sms edge fn         (calls send-twilio-sms, writes sms_events row)
  → send-twilio-sms edge fn              (Twilio SMS API → caller's phone)
  → Rebrandly short link
  → callmagnet.com.au/b/<slug>           (Middle Man page — b.html)
  → Button tap → log-middle-man-tap edge fn → link_clicks table
  → Form submit → submit-middle-man-form edge fn → middle_man_form_submissions table
  → send-client-notification edge fn     (Progressier push → all owner devices)
  → Owner opens PWA (index.html)
  → Neon tiles show counts
  → Slide-out panel → submission cards
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
| `upload-middle-man-background` | Handles image/video background uploads to Supabase Storage | **true** |
| `create-rebrandly-link` | Creates a new Rebrandly short link for a client Middle Man page | false |
| `update-rebrandly-destination` | Updates Rebrandly destination URL when slug changes | **true** |
| `rebrandly-webhook` | Receives Rebrandly click events (not actively used) | false |
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

## Security model

- **Admin dual gate:** All admin edge functions check both `app_metadata.is_admin === true` AND `email === car312@hotmail.com` — either check failing returns 403.
- **Internal secret:** Cron-triggered functions (`send-daily-summary`, `monthly-report`, `quick-responder`, `send-pushover-alert`) require `X-Internal-Secret` header matching the `INTERNAL_SECRET` vault secret.
- **Stripe webhook signatures:** `stripe-payment-succeeded` and `stripe-subscription-deleted` verify Stripe HMAC signatures and reject replays older than 5 minutes.
- **RLS:** Clients can only read and write their own rows via anon-key queries. Service role key is used only inside edge functions.
- **Service role:** Edge functions use the `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS for writes. This key is never exposed to the client.
- **Magic links blocked:** `request-login-link` refuses to send magic links to the admin email address — admin must use password login.
- **upload-middle-man-background:** `verify_jwt = true` so the gateway rejects missing or invalid JWTs before the function runs. The function then performs a two-tier ownership check (client owns the slug OR caller is admin).

## Known deferred items (Phase 1.5)

- Multi-device admin support (currently hard-coded to single admin email)
- Per-client SMS overage billing automation (currently manual Stripe invoice)
- Automated onboarding email sequence trigger after Stripe payment confirmed
- Stripe subscription pause (vs cancel) for temporary business closures
- Client-facing cancellation reason analytics in admin dashboard
- Rebrandly webhook click deduplication and attribution reporting
