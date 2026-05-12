# CallMagnet — Live Client Onboarding Runbook

*Read from phone during a live signing session. 35 minutes door-to-handshake. Read top-to-bottom, don't skip.*

---

## 1. PRE-MEETING PREP

Do all of this **before walking in**. 5 minutes at home or in the car.

- [ ] Confirm vertical: **restaurant**, **barber**, or **hairdresser** (not "default")
- [ ] ABN lookup tab open: https://abr.business.gov.au (search by business name to grab their 11-digit ABN)
- [ ] Twilio Console logged in: https://console.twilio.com
- [ ] Supabase Dashboard logged in: https://supabase.com/dashboard/project/iskvvnhacqdxybpmwuni
- [ ] Stripe Dashboard logged in (or have the right Payment Link copied to clipboard for their vertical)
- [ ] Phone charged + tethered laptop ready
- [ ] Test phone with you (for the live test call — needs to be different from the client's phone)

**Don't proceed until all 7 boxes ticked.** If any portal is logged out, fix that in the car, not in front of the client.

---

## 2. IN-MEETING — DISCOVERY (5 min)

You're not selling yet. You're collecting data to set them up correctly.

Ask these in this order:

1. **"How many calls do you miss in a typical week?"**
   - Their answer × `avg_job_value` × 0.62 = the revenue number you'll show on the dashboard
   - Any answer over 5/week justifies CallMagnet outright

2. **"What's your average customer spend per visit or booking?"**
   - Australian dollars
   - Write it down — this is `avg_job_value` in the clients row

3. **"Where do you want missed callers sent?"**
   - Restaurant: OpenTable / Now Book It / SevenRooms / their own reservations page
   - Barber/Hairdresser: Fresha / Booksy / their own website
   - Anyone: Linktree / Cal.com / direct booking page
   - One URL. They pick one. Write it down — this is `booking_url`.

4. **"Show me your phone. Let's check your current call forwarding setup."**
   - You'll need their phone to dial the USSD codes in Step 3
   - If they hesitate, explain you need to point their phone at a CallMagnet number — takes 30 seconds, fully reversible with one code

---

## 3. IN-MEETING — SETUP (15 min)

### 3a. Buy their Twilio number (~3 min)

1. Twilio Console → **Phone Numbers → Buy a Number**
2. Country: **Australia**
3. Filter: **Local**, capabilities **Voice + SMS**
4. Click **Buy** on any AU number — costs ~$6.50/month
5. Note the number in E.164 format: `+614XXXXXXXX` — write it down or screenshot

### 3b. Attach Studio flow to the new number (~1 min)

1. Twilio Console → **Phone Numbers → Active Numbers → click the new one**
2. **Voice & Fax → A Call Comes In** → set to **Studio Flow** → pick **CallMagnet**
3. **Save**

### 3c. Create the clients row in Supabase (~3 min)

1. Supabase Dashboard → **SQL Editor**
2. Paste this template, replace placeholders, run:

```sql
INSERT INTO public.clients (
  business_name, email, twilio_number, vertical,
  booking_url, avg_job_value, suburb, postcode,
  industry, abn, account_status, terms_accepted, subscription_start
) VALUES (
  'Their Business Name',
  'owner@their-email.com',
  '+614XXXXXXXX',         -- Twilio number from 3a
  'restaurant',            -- or 'barber' or 'hairdresser'
  'https://their-booking-link.com',
  75,                      -- their answered avg spend in AUD
  'Suburb',
  '3000',
  'Restaurant',            -- text label, e.g. 'Restaurant' 'Barber' 'Hair Salon'
  '12345678901',           -- their 11-digit ABN from the ABR lookup
  'active', true, now()
);
```

3. Note the returned `id` UUID — you'll need it for the test verification step

### 3d. Create the rebrand.ly short link (~2 min)

1. Open rebrand.ly dashboard
2. **Create new link** → destination = the `booking_url` from discovery
3. Slug = something short + branded (e.g. their business name shortened)
4. Save → copy the short URL
5. Update the clients row in Supabase:

```sql
UPDATE clients SET rebrandly_url = 'https://rebrand.ly/their-slug'
 WHERE id = '<UUID from 3c>';
```

### 3e. Configure their phone forwarding (~5 min)

**Three codes — all three are non-negotiable.** Dial each from THEIR phone:

| What | Code (substitute their new Twilio number) |
|---|---|
| **No Reply** (rings out) | `**61*[TWILIO]*11*30#` — 30s timeout |
| **Busy** (on another call) | `**67*[TWILIO]#` |
| **Not Reachable** (off / flat / out of range) | `**62*[TWILIO]#` |

After each dial, wait for the carrier confirmation tone or message before dialling the next.

To verify: dial `*#61#` / `*#67#` / `*#62#` — each should report the Twilio number as the forwarding target.

**If they have a landline:** open `docs/client-onboarding.md` → "Landline" section → configure their carrier's portal (Belong / iiNet / TPG / Aussie Broadband / Superloop / Tangerine / Internode / copper / PBX).

### 3f. (Hand-checks before testing)

- [ ] Twilio number bought + Studio flow attached
- [ ] `clients` row inserted with `twilio_number` matching
- [ ] `rebrandly_url` set on the clients row
- [ ] All three mobile forwarding codes dialled and confirmed
- [ ] Landline configured if applicable

---

## 4. IN-MEETING — TEST (5 min)

This is the moment of truth. Do not skip.

1. **Turn the client's phone OFF completely.** Power off, not silent mode — must be unreachable.
2. **Call their normal business number** from your phone (the test phone you brought).
3. Within ~10 seconds, your phone receives an SMS with their booking link.
4. **Tap the link.** Confirm it goes to their booking destination (OpenTable / Fresha / wherever).
5. **Your iPhone (Carl) buzzes** within 3 seconds — Pushover alert "📲 Link tap — [Their Business] — link tap from [your test number]".
6. **Open the CallMagnet dashboard** on the client's phone (or yours, signed in as them): https://callmagnet.com.au → show them the SMS count + Link tap count both ticked up by 1.

If any step fails, stop and debug before taking payment. Most common failure: only one of three forwarding codes worked. Re-dial the missing one(s) and retest.

---

## 5. IN-MEETING — PAYMENT (5 min)

Per-vertical pricing (locked):

| Vertical | Setup | Monthly |
|---|---|---|
| **Restaurant** | **$499** | **$249** |
| **Barber** | $0 | **$99** |
| **Hairdresser** | $0 | **$99** |

1. Open the right Stripe Payment Link for their vertical
2. Pre-fill their email if the link supports it
3. Send the link via SMS or email to their phone (so they can pay then-and-there)
4. Wait while they pay — watch Stripe Dashboard for the payment to land
5. Once confirmed, copy their `cus_xxx` Stripe customer ID
6. Back in Supabase SQL Editor:

```sql
UPDATE clients SET stripe_customer_id = 'cus_xxx'
 WHERE id = '<UUID from 3c>';
```

**Do not leave the meeting without payment received.** A "we'll do it later" never gets done.

---

## 6. HAND-OVER (2 min)

1. Send them the dashboard URL: **https://callmagnet.com.au**
2. Their login = the email they gave you in 3c. Walk them through password reset if needed.
3. Show them the **Daily summary email** lands ~11pm Melbourne each night
4. Show them the **+ Log a booking** button — explain logging real bookings tightens the revenue estimate
5. Give them your phone number — "if anything looks weird, call me"
6. **Schedule a 7-day check-in** — put it in the calendar now, not later

---

## 7. POST-MEETING (back home, same day)

Do all of this within 4 hours of leaving the meeting:

1. **Verify in Supabase** their clients row has:
   - [ ] `is_test_account = false` (only the test client has this true)
   - [ ] `account_status = 'active'`
   - [ ] `stripe_customer_id` populated
   - [ ] `vertical` correct
   - [ ] `twilio_number` matches what's in Twilio Console
2. **Add to client tracking spreadsheet** — name, vertical, signup date, monthly value, location
3. **Save the test loop video** — the call → SMS → tap → Pushover demo recording is your single most powerful sales artefact. Cut to 30 seconds, post as content (Adrian Portelli "show the product working" framework — no narration needed, the buzz speaks for itself).
4. **Set a reminder for day 3 check-in** — open dashboard, confirm sms_events have rows, no error alerts in your inbox
5. **If rebrand.ly was on free tier**: upgrade to Professional ($32 USD/month) before client #1's first real call volume hits — Pro tier enables webhook events that replace the polling path

---

## Quick Reference — During the Meeting

- Twilio Console: https://console.twilio.com
- Supabase SQL Editor: https://supabase.com/dashboard/project/iskvvnhacqdxybpmwuni/sql/new
- ABR lookup: https://abr.business.gov.au
- Rebrand.ly: https://app.rebrandly.com
- Dashboard: https://callmagnet.com.au
- Test client UUID (don't use for live clients): `d508dde9-8f10-464b-b41b-7d84b0eaa907`

## If Something Breaks

1. SMS doesn't arrive after test call → forwarding not set → re-dial the three codes
2. Tap doesn't fire Pushover → check Supabase Edge Functions logs for `send-pushover-alert` and `get-booking-url`
3. Dashboard shows 0 → confirm `twilio_number` in clients row matches what Twilio sent the call to (E.164 with `+`)
4. Stripe payment didn't activate account → check `stripe_customer_id` is set on the row; if not, copy it from Stripe Dashboard

Detailed troubleshooting + per-carrier landline config: `docs/client-onboarding.md`
