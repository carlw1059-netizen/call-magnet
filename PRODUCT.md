# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Local service business owners in Australia — restaurants, hair salons, trades. They log into the dashboard regularly to check how many customers they've won back and to respond to new re-contact events. Push notifications make the product ambient; the dashboard makes it actionable.

## Product Purpose

CallMagnet captures the moment a past customer tries to re-contact a business. A branded "Middle Man" page at the client's URL intercepts that intent — call, booking request, or enquiry — logs it, and pushes an instant notification to the business owner. The dashboard shows recovery stats over time. The core promise: every customer who tried to come back gets logged, and the owner knows about it.

## Positioning

The Middle Man page. A competitor could build a notification system; they cannot truthfully claim they capture re-contact intent at the exact moment the customer acts. The page lives at the client's own URL (via cm1.au redirect), making it feel native to the business rather than a third-party tool. The owner gets the signal before the customer gives up.

## Operating Context

- Business owners check the dashboard from their phone, often between jobs or at end of day.
- The Middle Man page runs on the client's existing domain via Cloudflare redirect — zero customer-facing friction.
- Push notifications (via Progressier / VAPID) deliver re-contact alerts to the owner's phone in real time.
- Onboarding involves setting up the Middle Man page, uploading a background video or image, and configuring contact buttons (call, book, enquire).
- Pricing tiers: restaurant, hairdresser, free_trial.
- Stripe handles subscriptions; Supabase handles auth, database, and edge functions.

## Capabilities and Constraints

- PWA with full iOS/Android home-screen install support including splash screens.
- Three surfaces: owner dashboard (callmagnet.com.au), client Middle Man page (cm1.au/[slug] and callmagnet.com.au/b.html), and public marketing site (callmagnet.com.au home).
- Middle Man page has a locked baseline (tag: baseline-working-20260824) — visual changes require version string bumps in both b.html and cm1site/b.html.
- All deployments go directly to main (no staging branch).
- Email system uses a locked template shell (renderEmailShell) and copy from the email_copy database table — no hard-coded wording in functions.
- Push notification changes require reading docs/push-notifications.md first.
- No dollar figures or revenue estimates in any email or notification.
- cm1site/b.html must always use absolute URLs (https://callmagnet.com.au/…).

## Brand Commitments

- Name: CallMagnet
- Tagline: "Pull every customer back."
- Wordmark: "★ CallMagnet" (star glyph, not emoji)
- Voice: direct, confident, terse — no fluff
- Primary colour: emerald #06D6A0
- Background: near-black #0E1419
- Font: DM Mono (dashboard/app); marketing site uses its own type stack
- Admin pages follow a locked standard: background #F5F5F5, cards white, headings #10b981, back button #CC0000

## Evidence on Hand

- Live product at callmagnet.com.au and cm1.au
- Confirmed working client: Arcane Fairies (cm1.au/arcane-fairies)
- No published testimonials or case studies to reference in design

## Product Principles

1. **Capture the moment** — the product's value is real-time; latency kills it.
2. **Owner first** — every UX decision optimises for the business owner's time and confidence, not the end customer's experience.
3. **Invisible infrastructure** — the Middle Man page must feel like the client's own brand; CallMagnet stays in the background.
4. **Precision over features** — fewer, sharper capabilities beat a wide feature set.
5. **Mobile reality** — the owner is on a phone in a busy environment; the dashboard must work at a glance.

## Accessibility & Inclusion

No specific accessibility standard mandated. PWA install experience must work correctly on iOS Safari (the primary owner device).
