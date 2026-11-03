# CallMagnet

CallMagnet is a missed-call recovery platform for Australian small businesses. When a customer calls and can't get through, Twilio detects the missed call and automatically sends the caller an SMS within seconds containing a booking link. The link opens the business's branded **Middle Man** page where the customer can book, enquire, or submit a request. The business owner receives a push notification on their PWA and can view all submissions from their dashboard.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Cloudflare Pages (PWA + marketing site + Middle Man pages) |
| Backend | Supabase (PostgreSQL, Edge Functions, Storage) |
| SMS | Twilio (phone numbers, Studio flows, SMS API) |
| Push notifications | Progressier (PWA install + push) |
| Payments | Stripe (subscriptions, webhooks) |
| Email | Resend |

## Environment variables

The following secrets must be set in the Supabase vault before deploying edge functions:

| Variable | Used by |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio SMS functions |
| `TWILIO_AUTH_TOKEN` | Twilio SMS functions |
| `TWILIO_FROM_NUMBER` | `send-twilio-sms` |
| `STRIPE_SECRET_KEY` | Stripe webhook handlers |
| `STRIPE_WEBHOOK_SECRET` | `stripe-payment-succeeded`, `stripe-subscription-deleted` |
| `RESEND_API_KEY` | All email functions |
| `INTERNAL_SECRET` | Cron-triggered internal functions |
| `PROGRESSIER_APP_ID` | `send-client-notification` |
| `PUSHOVER_USER_KEY` | `send-pushover-alert` |
| `PUSHOVER_API_TOKEN` | `send-pushover-alert` |

## Deployment

All changes deploy directly to `main`. Cloudflare Pages rebuilds automatically on push.

Edge functions are deployed via the Supabase CLI:

```bash
supabase functions deploy <function-name>
```

## License

Copyright (c) 2026 Nextpak Pty Ltd (ABN 78 686 984 789). All Rights Reserved.
