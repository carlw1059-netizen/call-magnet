# CallMagnet Email Inventory

Sample data for all previews: business "Test Business", email test@example.com, temp password TempPass123, link https://callmagnet.com.au

| # | Function | Email name | Subject | Recipient | Trigger | Preview file |
|---|----------|-----------|---------|-----------|---------|-------------|
| 01 | create-client | Welcome — new user | Welcome to CallMagnet — your dashboard is ready | client | Admin creates new client | 01-create-client-welcome-new.html |
| 02 | create-client | Welcome — existing user (re-onboarded) | Welcome to CallMagnet — your dashboard is ready | client | Admin re-onboards existing user (no credential block) | 02-create-client-welcome-existing.html |
| 03 | request-login-link | Magic login link | Your CallMagnet login link | client | Client taps "send login link" on login page | 03-request-login-link.html |
| 04 | activate-client | Account live | Your CallMagnet account is now live | client | Admin manually activates account | 04-activate-client-live.html *(Resend template — no local HTML)* |
| 05 | stripe-payment-succeeded | Payment received | Payment received — we're setting up your account | client | Stripe payment.succeeded webhook | 05-stripe-payment-received-client.html |
| 06 | stripe-payment-succeeded | You're live | You're live, Test Business. | client | Stripe checkout.session.completed (payment + auto-activate path) | 06-stripe-payment-youre-live-client.html |
| 07 | stripe-payment-succeeded | New client alert | New client paid — ready to build | Carl (internal) | Stripe payment.succeeded webhook | 07-stripe-payment-new-client-carl.html |
| 08 | stripe-payment-succeeded | Payment error alert | ⚠️ ALERT: stripe-payment-succeeded failed — check client account status | Carl (internal) | Error in payment webhook handler | 08-stripe-payment-error-carl.html |
| 09 | stripe-subscription-deleted | Subscription ended | Your CallMagnet subscription has ended — thanks for being with us | client | Stripe subscription.deleted webhook | 09-stripe-subscription-deleted-client.html |
| 10 | stripe-subscription-deleted | Deletion error alert | ⚠️ CallMagnet — stripe-subscription-deleted failed | Carl (internal) | Error in subscription deletion webhook | 10-stripe-subscription-deleted-error-carl.html |
| 11 | notify-expiry | Free period ending (client) | Your CallMagnet free period ends in 3 days — Test Business | client | Cron: 3 days before free period ends | 11-notify-expiry-client.html |
| 12 | notify-expiry | Free period ending (admin) | [CallMagnet] Free period ending soon — Test Business | Carl (internal) | Cron: 3 days before free period ends | 12-notify-expiry-admin.html |
| 13 | notify-expiry | SMS usage alert (admin) | [CallMagnet] SMS usage alert — Test Business (400/500 this month) | Carl (internal) | Cron: SMS usage >= 80% of monthly quota | 13-notify-expiry-sms-usage-admin.html |
| 14 | SEND-EMAIL-SEQUENCE | Day-14 milestone | Two weeks in, Test Business. | client | 14 days after account created | 14-email-sequence-day14.html |
| 15 | SEND-EMAIL-SEQUENCE | Day-30 milestone | Your first month, Test Business. | client | 30 days after account created | 15-email-sequence-day30.html |
| 16 | SEND-EMAIL-SEQUENCE | Sequence error alert | ⚠️ CallMagnet — send-email-sequence failed | Carl (internal) | Error during sequence cron run | 16-email-sequence-error-carl.html |
| 17 | send-daily-summary | Daily recap — active day | Test Business — 5 missed calls recovered today | client | Daily cron (when missed calls > 0) | 17-daily-summary-active.html |
| 18 | send-daily-summary | Daily recap — quiet day | Test Business — quiet day today | client | Daily cron (when missed calls = 0) | 18-daily-summary-quiet.html |
| 19 | weekly-summary | Weekly summary (client) | CallMagnet Weekly Summary | client | Weekly cron | 19-weekly-summary-client.html |
| 20 | weekly-summary | Weekly digest (Carl) | CallMagnet Weekly — 22 Sep – 29 Sep 2026 | Carl (internal) | Weekly cron | 20-weekly-summary-carl.html |
| 21 | monthly-report | Monthly recap (client) | Your September 2026 CallMagnet recap | client | Monthly cron | 21-monthly-report-client.html |
| 22 | monthly-report | Monthly run alert | [monthly-report] September 2026: 12 sent, 0 skipped, 0 failed | Carl (internal) | After monthly report cron run | 22-monthly-report-alert-carl.html |
| 23 | send-client-notification | Push email fallback | Missed call from ...123 | client | Missed call — push delivery failed, email fallback fires | 23-send-client-notification-push-fallback.html |
| 24 | twilio-missed-call | Missed-call error alert | ⚠️ CallMagnet — twilio-missed-call failed | Carl (internal) | Error in missed-call Twilio webhook handler | 24-twilio-missed-call-error-carl.html |
| 25 | get-booking-url | Booking URL error alert | ⚠️ CallMagnet — get-booking-url failed | Carl (internal) | Error generating booking URL during missed-call flow | 25-get-booking-url-error-carl.html |
| 26 | quick-responder | SMS overage error alert | ⚠️ CallMagnet — sms-overage failed | Carl (internal) | Error in quick-responder overage check | 26-quick-responder-error-carl.html |
| 27 | hyper-endpoint | Payment failed alert | ⚠️ CallMagnet — stripe-payment-failed failed | Carl (internal) | Stripe payment_intent.payment_failed webhook error | 27-hyper-endpoint-payment-failed-carl.html |

**Total: 27 emails**

Note: #04 (activate-client) uses a Resend template ID (74b89ec4-2850-4b22-bc50-346a15687b30) — no inline HTML exists in the codebase. Preview file is a placeholder only.
