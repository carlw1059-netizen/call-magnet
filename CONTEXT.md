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
