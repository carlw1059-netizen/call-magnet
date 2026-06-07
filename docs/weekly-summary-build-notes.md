# Weekly summary edge function — build notes

## Status
Tasks 1–8 complete. Tasks 9 and 10 still to be written and assembled.

## Task 9 — still needed
Send the email via Resend for each client. Loop through active clients, call calcClientStats, call buildWeeklyEmailHtml, POST to Resend API. Log success/failure per client. Return summary JSON.

## Task 10 — still needed  
Assemble all tasks into the final index.ts file and deploy. Also create the pg_cron migration file to schedule the function every Sunday at 23:00 UTC.

## Files created so far
- supabase/functions/weekly-summary/index.ts (shell only — tasks 1–8 are functions, not yet assembled)
- All helper functions written but not yet combined into the final file

## Key decisions locked
- From: hello@callmagnet.com.au
- Subject: "CallMagnet Weekly Summary"
- No reply-to
- Skip is_test_account and non-active clients
- Schedule: 0 23 * * 0 (Sunday 23:00 UTC = Monday 9am AEST)
- ClientRow needs last_renewal_date added to interface and fetchActiveClients select
