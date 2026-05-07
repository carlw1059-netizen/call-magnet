# CallMagnet Failure Modes

*What breaks when things go wrong, and what to do about it.*

---

## If Supabase Goes Down

**What breaks:**
- Missed calls ARE still handled by Twilio Studio (Studio keeps running independently).
- The Studio SMS to the customer still sends (Studio sends it directly, not via edge functions).
- The `twilio-missed-call` edge function will fail with a 5xx — Studio will retry (typically 3 attempts over ~10 minutes).
- No `sms_events` row is created during the outage — those calls are lost from analytics.
- Owner notifications (Web Push and email) do not fire during the outage.
- Dashboard is inaccessible.
- pg_cron jobs fail silently (daily summary, monthly report, warmup pings).

**Impact to client:** Customer still receives the booking SMS. Owner misses the real-time notification for calls during the outage.

**Recovery:**
- Once Supabase recovers, new calls flow normally.
- Twilio Studio logs show all calls during the outage — manually backfill `sms_events` if analytics accuracy matters.
- Check `cron.job_run_details` for failed cron runs; re-trigger daily summary manually if needed.

---

## If Twilio Goes Down

**What breaks:**
- Calls to the client's forwarding number get no answer (or a Twilio error message).
- Studio flows do not fire — no missed-call event generated anywhere.
- No SMS sent to the customer.
- No `sms_events` row created.
- CallMagnet is effectively offline for the client.

**Impact to client:** Missed caller gets no SMS — they may contact a competitor. This is the highest-impact single failure.

**Recovery:**
- Twilio outages are rare and usually short (minutes). Check status.twilio.com.
- Twilio Studio does NOT retry missed-call events after recovery — those calls are permanently lost.
- If an extended outage occurs, the client's forwarding can be temporarily removed so calls ring the business directly instead of going to voicemail.

---

## If Resend Goes Down

**What breaks:**
- All transactional emails fail to send.
- `send-client-notification` logs `resend_email_failed` but continues — Web Push still fires.
- Daily summary cron: email fails, `daily_summary_runs.email_sent` stays `false`.
- Monthly report: status stays `pending` or is set to `failed`.
- Stripe welcome email: not sent.

**Impact to client:** No email notifications, no daily summaries. Web Push still works if the client has push enabled on a device.

**Recovery:**
- Resend outages are extremely rare. Check status.resend.com.
- Daily summary can be manually re-triggered by POSTing to the function with `X-Internal-Secret`.
- Monthly report has `dry_run` and replay support — re-trigger with `{ client_id, period_month }`.

---

## If an Edge Function Errors

**Per-function behaviour on fatal error:**

| Function | On fatal error |
|----------|---------------|
| twilio-missed-call | Returns 5xx; Twilio retries 3× then gives up. Sends alert email to car312@hotmail.com. |
| send-client-notification | Returns 5xx to caller. Caller (twilio-missed-call) logs the error. |
| send-daily-summary | Returns 5xx; cron sees failure. No re-attempt until next day. |
| monthly-report | Sets `monthly_reports.status = 'failed'`; sends run-summary alert email. Can be replayed. |
| stripe-payment-succeeded | Returns 5xx; Stripe retries for 72h. Sends alert email. |
| stripe-subscription-deleted | Returns 5xx; Stripe retries for 72h. Sends alert email. |
| hyper-endpoint | Returns 5xx; Stripe retries for 72h. Sends alert email to car312@hotmail.com. |
| send-pushover-alert | Returns 5xx to caller. Caller logs warning, does not block other operations. |
| rebrandly-webhook | Returns 5xx; rebrand.ly retries. |

**Monitoring gaps:**
- No centralised alerting dashboard — errors surface only through Resend alert emails and Supabase function logs.
- If Resend itself is down when an alert email tries to fire, the alert is silently lost.
- pg_cron failure results are in `cron.job_run_details` (Supabase Dashboard → Database → Cron Jobs).

---

## If Twilio Studio Flow Has a Bug

**What breaks:**
- If the HTTP widget URL is wrong or the widget is disabled: `twilio-missed-call` never receives the event — no `sms_events` row, no owner notification.
- If the Send Message widget is broken: customer doesn't receive the SMS.
- If both break: the call is completely silent — client has no record and customer gets no reply.

**Detection:** Check `sms_events` count in the dashboard. Zero events despite known calls is a red flag.

**Recovery — clone-and-swap pattern:**
1. In Twilio Console, duplicate the active Studio flow.
2. Fix the bug in the duplicate.
3. Test the duplicate with a real call.
4. If test passes: go back to the phone number configuration and change it to point to the fixed flow.
5. Do NOT delete the original flow until you've confirmed the swap worked — it may still be handling in-flight calls.

See `docs/recovery-procedures.md` for the full Studio clone-and-swap procedure.

---

## If the Dashboard Shows Wrong Numbers

**Possible causes:**
1. `sms_events.received_at` timezone drift — queries use UTC comparisons against a Melbourne-timezone reference.
2. Duplicate `sms_events` rows (should not happen due to `twilio_call_sid` UNIQUE index, but check).
3. Stale analytics view cache — views are not materialised, but a long-running query could shadow them.
4. Client `vertical` set incorrectly — revenue estimates use the wrong per-vertical rate.

**Debug steps:** See `docs/recovery-procedures.md` → "If client's dashboard shows wrong numbers".

---

## Monitoring Gaps (Known)

| Gap | Risk | Mitigation |
|-----|------|------------|
| No uptime monitor on edge functions | Silent failure goes unnoticed until a client reports missing notifications | Add UptimeRobot / BetterStack ping to a read-only endpoint |
| Alert emails can be lost if Resend is down | Errors during Resend outage have no secondary channel | Add Pushover as a secondary alert target |
| pg_cron failures not pushed anywhere | Missed daily/monthly runs discovered manually | Check `cron.job_run_details` weekly |
| Twilio Studio has no error webhook | Studio bugs silently stop the whole pipeline | Monitor `sms_events` row count daily |
| No Stripe webhook delivery confirmation | If webhook endpoint is 5xx for 72h, Stripe stops retrying | Check Stripe Dashboard → Webhooks → Recent deliveries |
