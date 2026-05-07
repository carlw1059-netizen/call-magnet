# CallMagnet Recovery Procedures

*Step-by-step troubleshooting for the most common issues.*

---

## If a Client's Missed Call Didn't Fire an SMS

**Symptom:** Client reports a caller rang and hung up but received no SMS. No `sms_events` row for that caller.

### Step 1 — Confirm the call actually arrived at Twilio

1. Log in to Twilio Console → **Monitor → Calls**.
2. Filter by the client's Twilio number (`To` field) and the approximate time.
3. **If no record in Twilio:** Call forwarding is not set up correctly or the caller hung up before the forward triggered. Check carrier forwarding settings (see `client-onboarding.md`).
4. **If the call IS in Twilio but Studio didn't fire:** The Twilio number isn't attached to the Studio flow. Fix: Phone Numbers → click the number → attach Studio flow.

### Step 2 — Check if twilio-missed-call received the request

1. Supabase Dashboard → **Edge Functions → twilio-missed-call → Logs**.
2. Filter to the relevant time window.
3. **If no log entry:** Studio fired but the HTTP widget URL is misconfigured. Check the Studio flow HTTP widget URL — it should be `https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/twilio-missed-call`.
4. **If log shows a 409:** This call was already recorded (Twilio retry). The original row should exist in `sms_events`. Search by caller number.
5. **If log shows a 404:** The `twilio_number` in the `clients` row doesn't match the `To` value Twilio sent. Check E.164 format — Twilio sends `+61XXXXXXXXX`.

### Step 3 — Check if send-client-notification was called

1. Supabase → Edge Functions → `send-client-notification` → Logs.
2. Look for `client_id` matching the client. If absent: `twilio-missed-call` succeeded but the downstream call to `send-client-notification` failed. Check `twilio-missed-call` logs for a warning.

### Step 4 — Verify sms_events row

```sql
-- Run in Supabase Studio SQL Editor (read-only)
SELECT id, customer_number, client_number, received_at, twilio_call_sid
FROM sms_events
WHERE client_id = '<client-uuid>'
ORDER BY received_at DESC
LIMIT 10;
```

If the row is there, the system worked — the notification may have been blocked by email spam filters or push not enabled.

---

## If a Client's Dashboard Shows Wrong Numbers

**Symptom:** Dashboard count doesn't match what the client reports (too high, too low, or wrong period).

### Possible cause 1: Wrong Melbourne timezone reference

The dashboard uses Melbourne midnight as the "today" boundary. If the client is checking at midnight, they may be comparing against the wrong day.

**Check:** What time is it in Melbourne right now? The reset happens at Melbourne midnight.

### Possible cause 2: Duplicate sms_events rows

```sql
-- Look for duplicate call SIDs (should not exist — UNIQUE index prevents it)
SELECT twilio_call_sid, COUNT(*) as cnt
FROM sms_events
WHERE client_id = '<client-uuid>'
GROUP BY twilio_call_sid
HAVING COUNT(*) > 1;
```

If duplicates exist (should be impossible), investigate whether the UNIQUE index is healthy:
```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'sms_events' AND indexname = 'sms_events_twilio_call_sid_key';
```

### Possible cause 3: Wrong vertical or avg_job_value

Revenue estimates use `vertical` and `avg_job_value`. Check:
```sql
SELECT id, business_name, vertical, avg_job_value FROM clients WHERE id = '<client-uuid>';
```

If wrong: `UPDATE clients SET vertical = 'restaurant', avg_job_value = 75 WHERE id = '<uuid>';` via migration or direct SQL (since this is operational data, not schema).

### Possible cause 4: Link clicks counted differently

The dashboard has separate tiles for missed calls (from `sms_events`) and link taps (from `link_clicks`). Verify which tile is wrong and check the relevant table.

---

## If a Client's Emails Aren't Arriving

**Symptom:** Client isn't receiving notification emails, daily summaries, or monthly reports.

### Step 1 — Verify the client's email in the database

```sql
SELECT id, business_name, email FROM clients WHERE id = '<client-uuid>';
```

If wrong: fix the email address.

### Step 2 — Check Resend delivery logs

1. Log in to Resend Dashboard → **Emails**.
2. Filter by recipient email or date.
3. Look for status: `delivered`, `bounced`, `spam`, `blocked`.
4. **Bounced:** The email address is invalid. Fix it.
5. **Spam:** Client needs to whitelist hello@callmagnet.com.au or check their spam folder.
6. **Blocked:** Domain may be on a suppression list. Contact Resend support.

### Step 3 — Check edge function logs for email errors

For `send-client-notification`:
- Supabase → Edge Functions → `send-client-notification` → Logs → look for `resend_email_failed` or `resend_email_exception`.

For `send-daily-summary`:
- Check `daily_summary_runs` table: `SELECT * FROM daily_summary_runs WHERE client_id = '<uuid>' ORDER BY summary_date DESC LIMIT 5;`
- `email_sent = false` means Resend call failed.

### Step 4 — Manually re-trigger a daily summary (if needed)

```bash
# From terminal with Supabase CLI and INTERNAL_SECRET
curl -X POST https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/send-daily-summary \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: <INTERNAL_SECRET_VALUE>" \
  -d '{}'
```

### Step 5 — Manually re-trigger a monthly report (dry run first)

```bash
# Dry run — returns HTML preview, no email sent
curl -X POST https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/monthly-report \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -d '{"client_id": "<uuid>", "period_month": "2026-04-01", "dry_run": true}'

# Real send (after confirming dry run looks correct)
curl -X POST https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/monthly-report \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -d '{"client_id": "<uuid>", "period_month": "2026-04-01"}'
```

---

## If Twilio Studio Flow Is Broken — Clone-and-Swap Pattern

**Symptom:** Studio flow has a bug (HTTP widget failing, SMS widget broken, wrong call routing). You need to fix it without taking all clients offline.

**Why clone-and-swap:** Each Twilio phone number points to a specific Studio flow version. You can deploy a fixed flow to a new version without affecting in-flight calls.

### Procedure

**Step 1 — Identify the bug**
1. Twilio Console → **Studio → Flows** → open the active flow.
2. Check **Monitor → Flow Executions** for recent failures.
3. Identify which widget is failing.

**Step 2 — Create a new flow version**
1. In the Studio flow editor: click the flow name → **Duplicate** (or click the three-dot menu → Duplicate).
2. Name it `CallMagnet - Fix [date]`.

**Step 3 — Fix the bug in the duplicate**
1. Open the duplicated flow.
2. Fix the broken widget.
3. Click **Publish**.

**Step 4 — Test the fix**
1. Temporarily point ONE test phone number at the new flow (pick a number not assigned to any real client).
2. Make a test call and don't answer.
3. Verify: new `sms_events` row appears, notification fires, SMS delivered.

**Step 5 — Swap all client numbers**
For each client phone number in Twilio Console:
1. Phone Numbers → Active Numbers → click number.
2. Under **Voice & Fax → A Call Comes In**: change Studio Flow to the new (fixed) flow.
3. Save.

**Important:** There is no bulk-swap tool in Twilio Console. If you have many numbers, use the Twilio API:
```bash
# Twilio CLI: update all numbers pointing to old flow SID to new flow SID
twilio api:core:incoming-phone-numbers:list --voice-url="<old-flow-url>" \
  | xargs -I{} twilio api:core:incoming-phone-numbers:update --sid={} --voice-url="<new-flow-url>"
```

**Step 6 — Monitor for 24 hours**
- Check `sms_events` is receiving rows normally.
- Check for any `twilio-missed-call` error logs.

**Step 7 — Archive the old flow**
Once confident the fix is working:
1. Open the old flow → **Properties** → change status to **Inactive**.
2. Keep it for 30 days in case you need to reference it.

---

## If the Warmup Cron Isn't Running

**Symptom:** Cold-start delays noticed on real missed-call events (function takes 2–5 seconds to respond instead of <500ms).

**Check cron status:**
```sql
-- Run in Supabase Studio SQL Editor
SELECT jobid, jobname, schedule, active, last_run_at, next_run_at
FROM cron.job
WHERE jobname LIKE 'warmup-%';
```

**Check recent run results:**
```sql
SELECT jobid, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'warmup-%')
ORDER BY start_time DESC
LIMIT 20;
```

If `active = false`: re-run the warmup migration or manually activate:
```sql
UPDATE cron.job SET active = true WHERE jobname LIKE 'warmup-%';
```

---

## Emergency: Reset a Client's Account Status

**Only use if Stripe webhook failed and account is stuck in wrong state.**

```sql
-- Check current state first
SELECT id, business_name, account_status, cancellation_scheduled, cancelled_at
FROM clients
WHERE id = '<client-uuid>';

-- Reactivate (after confirming payment exists in Stripe)
UPDATE clients
SET account_status = 'active', cancellation_scheduled = false, cancelled_at = NULL
WHERE id = '<client-uuid>';
```

**Always verify in Stripe first** that the subscription is genuinely active before setting `account_status = 'active'`. Setting active without a valid Stripe subscription means the client gets free service.
