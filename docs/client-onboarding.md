# CallMagnet Client Onboarding

*Step-by-step guide for adding a new client. Hand this to Carl during the session — every step is non-skippable.*

---

## Pre-Onboarding Checklist

Collect from the client before starting:

- [ ] Business name (exact trading name)
- [ ] Owner's email address
- [ ] Owner's mobile number (for verification call later)
- [ ] Existing business phone number (the one customers currently dial)
- [ ] Carrier for that number (Telstra mobile / Optus mobile / NBN VoIP provider name / copper landline / office PBX)
- [ ] Booking URL — Fresha, HotDoc, OpenTable, Linktree, website, whatever (one URL — the SMS sends this only)
- [ ] Average job/booking value in AUD (drives revenue estimates on the dashboard)
- [ ] Suburb + postcode (for suburb benchmark analytics)
- [ ] Industry vertical — one of:
  - `restaurant` — cafes, restaurants, takeaway, anywhere reservations matter
  - `barber` — male grooming, walk-in friendly, shorter appointments
  - `hairdresser` — salons, longer appointments, different demographic copy tone
  - `default` — edge cases that don't fit any of the above
  - (`tradie` is NOT supported yet — use `default` if you must onboard one)
- [ ] ABN — 11 digits (Australian Business Number — verifies legitimacy; nullable but should be collected)

---

## Step 1: Buy a Twilio Number

1. Twilio Console → **Phone Numbers → Manage → Buy a Number**
2. Country: **Australia (+61)**
3. Type: **Local**, Capabilities: **Voice + SMS**
4. Pick a number — area code matching client's region is nice but not required
5. Buy it (~$6.50/month total cost — number rental + SMS bundle for AU local Voice+SMS capable)
6. Record the E.164 format: `+614XXXXXXXX` (mobile-style numbers are most reliable; +613 also works)

---

## Step 2: Attach the Number to the Studio Flow

1. Twilio Console → **Phone Numbers → Manage → Active Numbers**
2. Click the new number
3. Under **Voice & Fax → A Call Comes In**: set to **Studio Flow** and pick the **CallMagnet** flow
4. Save

Any call to this number now triggers the CallMagnet flow (which captures the missed call and SMSes the caller).

### Multi-Client Studio Architecture

**One Studio flow handles every client.** Do NOT duplicate the flow per signing.

The flow's first step is a Twilio Function call to `fetch_client` which queries Supabase by the inbound `To` number (the Twilio number that received the diverted call) and returns that client's `business_name`, `vertical`, `rebrandly_url`, and template variables. The flow then sends the vertical-appropriate SMS body to the original caller (the `From` number).

What this means operationally — per new client, only these per-client steps exist:
1. Buy AU Twilio number (~$6.50/month, Step 1 above)
2. Voice Config → A Call Comes In → Studio Flow → **CallMagnet** (Step 2 above)
3. UPDATE/INSERT `clients.twilio_number` so `fetch_client` can match (Step 3 below)
4. Configure the client's phone forwarding to the new Twilio number (Step 4 below)

The Studio flow itself is touched zero times after the initial build.

---

## Step 3: Create the clients Row

In Supabase Studio → SQL Editor:

```sql
INSERT INTO public.clients (
  business_name,
  email,
  twilio_number,
  vertical,
  booking_url,
  avg_job_value,
  suburb,
  postcode,
  industry,
  abn,
  account_status,
  terms_accepted,
  subscription_start
) VALUES (
  'Business Name Here',
  'owner@example.com',
  '+61412345678',           -- E.164 Twilio number from Step 1
  'restaurant',             -- 'restaurant' | 'barber' | 'hairdresser' | 'default'
                            --   restaurant   → delivery/reservation framing
                            --   barber       → walk-in / shorter slots, masculine tone
                            --   hairdresser  → longer appointments, demographic-tuned tone
                            --   default      → fallback for edge cases (clinics etc)
  'https://booking.example.com',
  75,                       -- avg job value AUD
  'Fitzroy',
  '3065',
  'Restaurant',
  '12345678901',            -- 11 digits, or NULL if not collected
  'active',
  true,
  now()
);
```

Note the generated `id` (UUID). You'll need it for the verification call later.

**Hard rule:** every `twilio_number` value must be unique across the table. Twilio missed-call handler looks up clients by this column — duplicates cause silent cross-routing.

---

## Step 4: Set Up Conditional Call Forwarding

**This is the non-negotiable core of the product.** Without all three forwarding conditions set, missed calls don't reach the Twilio number and the SMS pipeline never fires. Walk through all three with the client live.

### Mobile (Telstra / Optus / Vodafone) — Three USSD Codes

Dial each from the client's mobile. Substitute their Twilio number (E.164) for `[TWILIO_NUMBER]`.

Worked example with test number `+61468083169`:

| Condition | What it covers | USSD code | Test example |
|---|---|---|---|
| **CFNRy** (No Reply) | Phone rings out, owner doesn't answer | `**61*[TWILIO_NUMBER]*11*30#` | `**61*+61468083169*11*30#` |
| **CFB** (Busy) | Owner already on a call | `**67*[TWILIO_NUMBER]#` | `**67*+61468083169#` |
| **CFNRc** (Not Reachable) | Phone off, flat battery, out of range, airplane mode | `**62*[TWILIO_NUMBER]#` | `**62*+61468083169#` |

The `*11*30` at the end of CFNRy = 30-second timeout before forward (long enough to actually pick up if the owner is near the phone, short enough that customer doesn't give up first).

After each dial, the carrier announces "Forwarding registered" or similar — wait for confirmation before dialling the next one.

### Verify Mobile Forwarding

To confirm registration:
```
*#61#   (no-answer status)
*#67#   (busy status)
*#62#   (unreachable status)
```

Each should report the Twilio number as the forwarding target.

**Live test:** turn the client's phone OFF completely, then call it from another phone. Within ~10 seconds, the call diverts to Twilio → Studio flow fires → SMS lands on the calling phone. If no SMS within 30s, forwarding isn't set correctly — re-dial the CFNRc code.

To cancel all three (if needed later): `##004#`

---

### Landline (Carrier-Specific — Each Different)

Landlines do NOT support USSD codes. Forwarding is configured per carrier. Every restaurant, clinic, or salon being onboarded needs landline coverage checked alongside mobile.

**NBN VoIP carriers (most common):** configured in the carrier's account portal.

| Carrier | Portal location | Setting name |
|---|---|---|
| Belong | Belong portal → Phone → Call features | Forward on no answer / forward when busy |
| iiNet | Toolbox portal → Phone → Call diversions | Call diversion (conditional) |
| TPG | My Account → Phone services → Call forwarding | Diversion on busy / no answer |
| Aussie Broadband | My Aussie portal → Phone → Features | Conditional forward / no-answer forward |
| Superloop | Account portal → Voice → Call Forwarding | Forward on no answer |
| Tangerine | Account portal → VoIP Settings | Call divert |
| Internode | NodeLine portal | Call forwarding |

Standard settings to apply in each portal:
- Forward type: **No Answer** (NOT unconditional — owner still wants to answer when they can)
- Forward type: **Busy** as well if portal supports separately
- Forward to: `+614XXXXXXXX` (E.164)
- Ring time before forward: 20–25 seconds

VoIP portals can take 5–15 minutes to apply changes. Test by calling and waiting.

**Traditional copper landline (Telstra ULL or legacy carrier):**
- Some support `*61*+614XXXXXXXX#` (no-answer) and `*67*+614XXXXXXXX#` (busy) dialled from the handset
- If codes don't work: call the carrier's business support, ask for "conditional call forwarding on no answer + busy" set to the Twilio number. May incur a one-off setup fee.

**Office PBX systems (Cisco / Aastra / 3CX / Avaya):**
- Forwarding is configured inside the PBX, not at the phone or with the carrier
- Owner or their IT contact does this — admin UI varies by vendor
- Settings: forward on no answer + forward on busy, target = Twilio E.164, 20–25s timeout

**Live test for landline:** call the landline from a mobile, let it ring out (20+ seconds), confirm the call diverts to Twilio and SMS lands. Repeat with the landline picked up + busy if testing CFB.

---

## SMS Template Rules (Locked)

The Twilio Studio flow generates the outbound SMS body using the client's vertical template. The template format is non-negotiable:

- **Opens** with "Hi —" or "Hi," (no other greeting variants — keeps brand voice consistent)
- **Contains the rebrand.ly short link** introduced by either "Book:" or "Click:" (not "Reserve:", "Tap here:", or freeform copy)
- **Ends** with "Reply STOP to opt out" (Australian SPAM Act compliance — mandatory)
- **Max length 160 characters** — single SMS segment, no concatenation, no segment-cost spike
- **NEVER contains `callmagnet.com.au`** — the SMS is client-facing; the customer should perceive it as coming from the business, not from a third-party SaaS

Owners do not customise their SMS body. The vertical (`restaurant` / `barber` / `hairdresser` / `default`) determines the template; the business name + booking link are interpolated.

---

## Rebrand.ly Link Tier

CallMagnet uses rebrand.ly to shorten and track booking links sent in SMS. Each client gets a unique short link pointing at their `booking_url`.

**Current tier: Free** — sufficient through pre-launch and test client only. No webhook events, no Pro features.

**Upgrade trigger: client #1 signed.** Switch the rebrand.ly account to **Professional ($32 USD/month flat)** at the moment the first paying client onboards. Pro tier unlocks:
- Click webhook events into Supabase (replaces the current `get-booking-url` polling path)
- Custom domain (optional brand polish)
- Higher rate limits as client count grows

Don't pre-upgrade — flat $32/month burns cash before revenue exists. The dormant `rebrandly-webhook` edge function (with secret stub `REBRANDLY_WEBHOOK_SECRET=PENDING_UPGRADE`) goes live the same hour the Pro tier activates.

---

## Revenue Math (Dashboard Hero Tile)

The dashboard's "revenue recovered" headline number is computed at view time, not stored. Formula per client:

```
revenue_recovered = link_clicks × avg_job_value × 0.62
```

Where:
- `link_clicks` = count of `link_clicks` rows for the selected period (today / week / month)
- `clients.avg_job_value` = the per-client column you collected during onboarding (AUD)
- `0.62` = Lead Connect 2025 industry research conversion rate (62% of unanswered callers contact a competitor when their first call goes unanswered → 62% of recovered tap-throughs become real bookings)

If the client also logs real bookings via "+ Log a booking" on the dashboard, the formula switches to use observed conversion rate instead of 62%:
```
revenue_recovered = link_clicks × avg_job_value × (bookings ÷ link_clicks)
```

This gives the client a self-tightening estimate that improves as they log more real bookings.

**Setting `avg_job_value` correctly matters.** Too low → revenue tile underwhelms, churn risk. Too high → looks fake, trust damage. Ask the client directly during onboarding ("what's your average customer spend per visit/booking?") and use their number.

---

## Step 5: Stripe Pricing + Payment Link by Vertical

### Pricing by Vertical (Locked)

| Vertical | Setup fee | Monthly | Notes |
|---|---|---|---|
| **Restaurant** | **$499** | **$249** | Higher ticket — owner is busy, has high churn exposure on missed reservations, can absorb setup |
| **Barber** | $0 | **$99** | No setup — barbers price-sensitive, walk-in heavy, faster signup decisions |
| **Hairdresser** | $0 | **$99** | No setup — same logic as barber; conversion easier without upfront friction |
| Default | TBD | TBD | Custom pricing — discuss in advance |

Choose the right Stripe Payment Link for the client's vertical.

1. Stripe Dashboard → **Payment Links**
2. Pick the link matching their vertical (restaurant-setup-plus-monthly / barber-monthly / hairdresser-monthly)
3. Pre-fill client's email if the link supports it
4. Send the link to the client; they pay

When payment succeeds:
- `stripe-payment-succeeded` webhook fires → sets `account_status = 'active'` on the matching `stripe_customer_id` row
- Welcome email auto-sends via Resend (one-shot, gated on `emails_sent` array)

If you've already set `account_status = 'active'` manually in the Step 3 INSERT, the Stripe webhook still sends the welcome email on first payment. Fine.

**Linking Stripe customer to clients row:** after the client pays, copy their Stripe customer ID (cus_xxx) from the Stripe Dashboard → Customers, then:
```sql
UPDATE clients
   SET stripe_customer_id = 'cus_xxxxx'
 WHERE id = '<the UUID from Step 3>';
```
Without this link, `stripe-payment-succeeded` and `stripe-subscription-deleted` can't find the client when webhooks fire.

---

## Step 6: End-to-End Verification

1. Call the client's business number from a different phone.
2. **Do not answer.** Let it ring out (~25 seconds for mobile, ~30 seconds for landline).
3. After the divert, your calling phone should receive an SMS within 10 seconds with the booking link.
4. Studio SQL: `SELECT * FROM sms_events WHERE client_id = '<UUID>' ORDER BY received_at DESC LIMIT 1;` → confirm new row.
5. Tap the link in the SMS → should land on the client's booking URL (Fresha / OpenTable / etc).
6. Owner's Pushover/Progressier device (if configured) buzzes with "Customer activity".
7. Owner's email receives notification (check spam first time).
8. Dashboard at https://callmagnet.com.au shows the test event.

Run the test sequence with all three conditions: rang-out, busy (owner on another call), and phone off. All three must produce an SMS within 10 seconds.

---

## Notes — What's NOT Asked During Onboarding

- **No theme preference.** CallMagnet uses a single hardcoded charcoal-navy + emerald aesthetic. The legacy theme picker was removed; do not offer "pick a colour" to clients.
- **No tradie vertical.** Currently unsupported in templates. Set tradies as `vertical = 'default'` if you must onboard one before the vertical is added.
- **No custom SMS copy.** Vertical determines template; owner doesn't write their own SMS body.

### Three live verticals (each has its own template)

Restaurant, barber, and hairdresser each get a distinct template — these are **not aliased**. Pick the one that matches the client's real-world workflow:

- **Restaurant** — delivery-basket / reservation framing. Used for cafes, restaurants, takeaway. Daily/weekly revenue email tiles for missed-call recovery rely on this vertical's stats logic.
- **Barber** — appointment framing, walk-in heavy. Shorter booking windows in the copy. Masculine tone. Hairdresser-style salons should NOT be set to `barber`.
- **Hairdresser** — appointment framing, longer booking windows. Different demographic-aware copy tone. Hairdresser dashboard uses the same 5-tile layout (SMS sent, Link clicks, Bookings, Conversion, Link taps) that respects `clients.reset_date` for counter resets.
- **Default** — fallback only. Use sparingly — verticals exist because the copy difference matters for conversion.

---

## First-Week Monitoring

Daily check for 5 business days after onboarding:

- [ ] `sms_events` recording rows for real call activity (count > 0)
- [ ] Daily summary email arrives ~11pm Melbourne
- [ ] No error alerts at `car312@hotmail.com`
- [ ] Client's dashboard counts match actual missed-call frequency
- [ ] Client confirms they're receiving owner-side notifications (Pushover/Progressier/email)
- [ ] Zero events after day 1 with known call volume = forwarding broken — re-test all three conditions

---

## Common Mistakes (Most → Least Frequent)

| Mistake | Symptom | Fix |
|---|---|---|
| Only one of three forwarding conditions set on mobile (usually CFNRy only) | Some missed calls fire SMS, others don't (silent when busy or phone off) | Re-dial CFB + CFNRc codes |
| Twilio number not attached to Studio flow | Call forwards to Twilio, nothing happens after | Attach Studio flow in Twilio Console |
| Wrong `twilio_number` in clients row (typo or missing `+`) | `sms_events` rows appear as orphaned calls (no client match) | Fix the column value, must be E.164 |
| Unconditional forward used (`**21*` instead of `**61*`) | Every call diverts, owner never answers anything | Cancel with `##004#`, redo with three conditional codes |
| Landline left unforwarded after mobile is done | Landline-side calls still ring out without SMS | Configure landline carrier portal or PBX |
| Wrong email in clients row | No notification emails arrive | `UPDATE clients SET email = '...' WHERE id = '...';` |
| `stripe_customer_id` not linked after payment | Welcome email never sends, account stays at default status | Copy `cus_xxx` from Stripe → UPDATE clients row |
| VoIP portal ring time too short (under 15s) | Calls divert before owner has chance to answer | Increase to 20–25s in portal |
