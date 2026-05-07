# CallMagnet Client Onboarding

*Step-by-step guide for adding a new client to the system.*

---

## Pre-Onboarding Checklist

Before starting, collect:

- [ ] Business name (exact trading name)
- [ ] Owner's email address
- [ ] Owner's phone number (for test call)
- [ ] Existing business phone number (the one to forward from)
- [ ] Carrier for that number (Telstra mobile / Optus mobile / NBN VoIP / Landline)
- [ ] Booking URL (their booking page, e.g. Fresha, HotDoc, website)
- [ ] Average job/booking value in AUD (for revenue estimates)
- [ ] Suburb and postcode
- [ ] Industry vertical: `restaurant`, `barber`, `hairdresser`, `tradie`, or `default`
- [ ] ABN (11 digits, optional)

---

## Step 1: Buy a Twilio Number

1. Log in to Twilio Console → **Phone Numbers → Manage → Buy a Number**.
2. Select **Australia (+61)**.
3. Filter by: Local, Voice + SMS capabilities.
4. Choose a number in the client's area code if possible (not required).
5. Purchase the number ($1–$2/month).
6. Note the E.164 format: `+614XXXXXXXX` or `+613XXXXXXXX`.

---

## Step 2: Attach the Number to the Studio Flow

1. In Twilio Console → **Phone Numbers → Manage → Active Numbers**.
2. Click the newly purchased number.
3. Under **Voice & Fax → A Call Comes In**: select **Studio Flow** and choose the CallMagnet flow.
4. Save.

Now any call to this number triggers the Studio flow.

---

## Step 3: Create the clients Row

Run this in Supabase Studio SQL Editor (read-only queries are fine here; this INSERT counts as a schema boundary write but it's operational data, not schema):

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
  'restaurant',             -- or: barber, hairdresser, tradie, default
  'https://booking.example.com',
  75,                       -- avg job value in AUD
  'Fitzroy',
  '3065',
  'Restaurant',
  '12345678901',            -- 11 digits, or NULL
  'active',
  true,
  now()
);
```

After inserting, note the generated `id` (UUID) — you'll need it to verify.

**Important:** Never set `twilio_number` to a value already used by another client row. The Twilio missed-call handler looks up clients by this column.

---

## Step 4: Set Up Call Forwarding on the Client's Number

The client configures their existing business number to forward unanswered calls to the Twilio number.

### Telstra Mobile (proven — standard USSD codes)

Dial these codes from the client's Telstra mobile:

| Condition | Code |
|-----------|------|
| No answer (ring unanswered) | `**61*+614XXXXXXXX#` |
| Busy | `**67*+614XXXXXXXX#` |
| Not reachable (off/no signal) | `**62*+614XXXXXXXX#` |

To set all three at once (recommended):
```
**004*+614XXXXXXXX#
```

To verify forwarding is active:
```
*#61#   (no-answer)
*#67#   (busy)
*#62#   (unreachable)
```

To cancel:
```
##004#
```

**Test:** Call the client's number from another phone and don't answer. Within 15–30 seconds, the call should forward to the Twilio number and the Studio flow should fire.

---

### Optus Mobile (untested — standard USSD syntax, confirm with client)

Optus uses the same GSM supplementary service codes as Telstra. Standard syntax:

```
**61*+614XXXXXXXX**30#   (no answer, 30-second ring time)
**67*+614XXXXXXXX#       (busy)
**62*+614XXXXXXXX#       (not reachable)
```

All three:
```
**004*+614XXXXXXXX**30#
```

Cancel:
```
##004#
```

**Note:** Optus USSD forwarding has not been tested with CallMagnet. If codes don't work, contact Optus Business support and ask to set conditional call forwarding to `+614XXXXXXXX`.

---

### NBN VoIP (most complex — varies by provider)

VoIP forwarding is configured in the VoIP provider's portal, not via phone codes.

**Common providers and where to find the setting:**

| Provider | Where | Setting name |
|----------|-------|-------------|
| Aussie Broadband | My Aussie portal → Phone → Features | Conditional forward / No answer forward |
| Superloop | Account portal → Voice → Call Forwarding | Forward on no answer |
| Tangerine | Account portal → VoIP Settings | Call divert |
| Internode | NodeLine portal | Call forwarding |

**Standard settings to enter:**
- Forward type: **No Answer**
- Forward to: `+614XXXXXXXX` (E.164)
- Ring time before forward: 20–25 seconds

**Test:** VoIP systems can take 5–15 minutes to apply changes. Test by calling the number and waiting.

**Fallback:** If the VoIP portal doesn't support conditional forwarding, ask the provider to enable "Call Divert on No Answer" via a support ticket. Some providers charge extra.

---

### Landline (carrier-dependent)

Landline forwarding in Australia is managed by the carrier, not the customer.

**Telstra landline:**
- Dial `*21*+614XXXXXXXX#` for unconditional forward (all calls — not recommended).
- Dial `*61*+614XXXXXXXX#` for no-answer forward.
- Activation confirmation: brief tone + announcement.

**NBN FTTB / other carriers:**
- Similar USSD codes if the carrier has kept the Telstra stack.
- If codes don't work: contact carrier support.
- Some carriers require calling Business Support to set conditional forwarding (common for older copper lines).

**Important:** Unconditional forwarding means ALL calls go to Twilio (including calls the owner answers). Use conditional (no-answer/busy) forwarding only.

---

## Step 5: Generate Stripe Checkout Link

1. Log in to Stripe Dashboard.
2. Go to **Payment Links** (or create a new one).
3. Select the CallMagnet subscription product.
4. Add the client's email as a prefill if possible.
5. Copy the payment link and send to the client.

When the client pays, Stripe fires `invoice.payment_succeeded` → `stripe-payment-succeeded` edge function → sets `account_status = 'active'` and sends the welcome email automatically.

**Note:** If you've already set `account_status = 'active'` in the INSERT above (manual activation), the Stripe payment will still send the welcome email on first payment — this is fine.

---

## Step 6: Verify End-to-End

1. **Test call:** Call the client's business number from a different phone. Do NOT answer.
2. Wait 20–30 seconds (ring timeout depends on carrier).
3. After the call diverts: check Supabase → Table Editor → `sms_events` for a new row.
4. Check the Twilio Console → Monitor → Calls for the call record.
5. Confirm the dashboard at callmagnet.com.au shows the test event.
6. Confirm the owner's email received a notification (check spam folder first time).
7. Confirm Web Push fired (if push is enabled on owner's device).

---

## First-Week Monitoring Checklist

Check daily for the first 5 business days:

- [ ] `sms_events` is recording rows for real calls
- [ ] Daily summary email arrives each night around 11pm Melbourne
- [ ] No error alerts arriving at car312@hotmail.com
- [ ] Dashboard counts match `sms_events` row count
- [ ] Client confirms they've received the SMS notifications
- [ ] If zero events after day 1 with real call volume: forwarding is not working — re-check setup

---

## Common Setup Mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Twilio number not attached to Studio flow | Call forwards to Twilio but nothing fires | Attach Studio flow to the number in Twilio Console |
| Wrong twilio_number in clients row (typo or wrong format) | sms_events rows show up as orphaned calls | Fix the twilio_number column value |
| Unconditional forward (not conditional) | All calls, including answered ones, go to Twilio | Change to conditional (no-answer) forwarding |
| Forwarding to Twilio number without country code | Some carriers drop the + prefix | Test with and without `+61` prefix |
| Client's email wrong in clients table | No notification emails | UPDATE clients SET email = '...' WHERE id = '...' |
