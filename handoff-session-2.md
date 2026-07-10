# CALLMAGNET — HANDOFF DOCUMENT (10 July 2026)

## WHO I AM
Carl, solo founder of CallMagnet (callmagnet.com.au), B2B missed-call-to-SMS SaaS for Australian service businesses. Built under Nextpak Pty Ltd ABN 78 686 984 789. No coding background. All code via Claude Code on Windows laptop at C:\Users\car31\call-magnet. Supabase project ref: iskvvnhacqdxybpmwuni. GitHub: carlw1059-netizen/call-magnet. Hosted on Netlify only.

## CRITICAL SYSTEM RULES — NEVER SKIP
- SHOW NOT TELL — paste actual current code before any fix
- ROOT CAUSE — one sentence before any fix
- FIX = one cut-and-paste prompt, one file at a time
- PROVE LIVE before reload
- Claude in chat has NO repo access — never claim to have read files
- Review last 15 messages before any new instruction
- NEVER ask Carl to read or interpret code
- All instructions plain English, short, direct, no fluff
- NEVER tell Carl to sleep, rest, slow down or take breaks
- Every commit must include git push origin main
- Before any new prompt, read CLAUDE.md in repo root
- All Claude Code prompts must be plain text inside a code fence block
- Column is middle_man_slug not slug
- clients table NEVER hard deleted — cancelled only
- SMS never contains callmagnet.com.au
- Number porting permanently off the table
- NEVER delete any file, function, page, or database entry without explaining what it is and asking Carl to confirm first
- NEVER GUESS — always research online before answering questions about third-party services
- Break prompts into parts under 4000 tokens
- Do not give the next prompt until the first mini task is done

## TECH STACK
- Frontend: Netlify (callmagnet.com.au)
- cm1.au: Separate Netlify site named callmag — serves Middle Man pages via _redirects catch-all
- Backend: Supabase (iskvvnhacqdxybpmwuni)
- SMS: Twilio Studio — My first Flow — FW805dc38b748c2abc65632baccc6946ab
- Twilio number 1: +61468083169 (demo clients — ALL testing uses this number)
- Twilio number 2: +61489278544 (Arcane Fairies)
- Telstra burner: +61474047050
- Short links: cm1.au — DNS points to Short.io
- Push notifications: Progressier (Project ID: 9kXZoGF2Dlfeqec880My)
- Payments: Stripe live mode
- Email: Resend (hello@callmagnet.com.au)
- Alerts: Pushover (Carl only)
- Twilio Functions: callmagnet-helpers-3797.twil.io
- Inbound SMS webhook: https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/twilio-inbound-sms
- Admin email: car312@hotmail.com

## STRIPE PRICE IDs (LIVE MODE)
- Hairdresser/Barber setup: price_1TD0jm3MTu8r2rLhkXPpx0AH — $249 one-time
- Hairdresser/Barber monthly: price_1TD12P3MTu8r2rLhJYFPksVx — $99/month
- Restaurant setup: price_1Ti51s3MTu8r2rLhmmtEk3Fb — $499 one-time
- Restaurant monthly: price_1Ti51u3MTu8r2rLhBNxFra0k — $249/month
- SMS overage: price_1TMmTG3MTu8r2rLhYSWnqheS — metered

## VISUAL (LOCKED)
- Background: #0E1419
- Accent: #10b981 emerald
- Burnt orange: #CC5500 (tiny edges only)
- Admin pages: #F5F5F5 bg, white cards, 1px solid #000000 border, emerald headings
- No theme system — hardcoded
- Submit/primary buttons on admin pages: background #10b981, color #000000

## CURRENT CLIENTS
- Demo Barber — is_demo_account=true, active, twilio_number=+61468083169
- Demo Cafe — is_demo_account=true, active, twilio_number=+61468083169
- Demo Restaurant — is_demo_account=true, active, twilio_number=+61468083169
- Bobs — is_test_account=true, middle_man_slug=bobs, active, no Short.io link
- Arcane Fairies — REAL CLIENT, active, free trial EXPIRED (free_period_ends_at=2026-07-06), twilio_number=+61489278544, middle_man_slug=arcane-fairies, shortio_link=https://cm1.au/arcane-fairies, owner=Alex Docherty, email=alex@storyvillemelbourne.com.au, phone=+61421417758

## TWO-NUMBER AUTO-SCHEDULE FEATURE — BUILD STATE

### What this feature does
Clients with two phone lines (e.g. office phone and ops mobile) can configure a per-day schedule so the system automatically knows which Twilio number should be active at any given time. SMS always fires regardless of schedule — the schedule only logs whether the correct line received the call.

### Architecture
- schedule_enabled=false → single number mode, twilio_number_2 completely ignored
- schedule_enabled=true → dual number mode, per-day schedule in client_schedules table
- Day/time resolution done entirely in Postgres via get_melbourne_day_and_time() RPC — zero Deno timezone risk
- Fallback: if no schedule row for today, default to Line 1 (twilio_number)
- Midnight-spanning windows handled in inWindow() helper in edge function
- Studio flow unchanged — passes {{trigger.call.To}} as client_twilio_number

### Database
New table: public.client_schedules
- id uuid PK
- client_id uuid FK → clients(id) ON DELETE CASCADE
- day_of_week text CHECK (monday/tuesday/wednesday/thursday/friday/saturday/sunday)
- line1_start time nullable
- line1_end time nullable
- line2_start time nullable
- line2_end time nullable
- is_active boolean default true
- created_at/updated_at timestamptz
- UNIQUE (client_id, day_of_week)
- CHECK line1_end > line1_start, line2_end > line2_start
- RLS enabled — service_role + admin_full_access policies live

New columns on clients table:
- twilio_number_2 text nullable — unique partial index
- schedule_enabled boolean default false
- active_hours_start time nullable — DEPRECATED, no longer used by edge function, to be dropped
- active_hours_end time nullable — DEPRECATED, no longer used by edge function, to be dropped

New Postgres RPC: public.get_melbourne_day_and_time()
- Returns {day_name: 'monday', time_mins: 1308}
- day_name is lowercase full day name in Melbourne timezone
- time_mins is minutes since midnight in Melbourne timezone
- Used by edge function and test file

### Edge function: twilio-missed-call (version 27, deployed)
- When schedule_enabled=false: lookup by twilio_number only
- When schedule_enabled=true: lookup by twilio_number OR twilio_number_2, then query client_schedules for today
- Calls get_melbourne_day_and_time() RPC for timezone-safe day/time
- Logs schedule_check: with expectedLine, onLine1, onLine2, expected
- SMS always fires — schedule check is logging only, never blocking

### Admin UI
- Middle Man edit view has Call Schedule section (rebuilt)
- Seven-day grid — Monday to Sunday
- Each day: Line 1 from/until, Line 2 from/until, active checkbox
- Secondary Twilio Number field (saves to clients.twilio_number_2)
- Enable Schedule toggle (saves to clients.schedule_enabled)
- Save button upserts all 7 days to client_schedules table
- E.164 validation on secondary number
- End time > start time validation per day
- JS version: ?v=20260710a

### Test file
- admin/schedule-test.html — IN PROGRESS, not yet committed
- Five sections: Melbourne time, client schedule viewer, simulate webhook, expected result checker, cleanup
- Uses anon key — requires admin login first (same as other admin pages)
- Needs anon key filled in before it will work

## WHAT IS OUTSTANDING

### Immediate — do first
1. Complete admin/schedule-test.html — needs real anon key inserted, then test and commit
2. Run Section 4 review after schedule-test.html is complete
3. Drop deprecated columns: active_hours_start, active_hours_end from clients table
4. Convert Arcane Fairies to paying client — free period expired 6 July

### Builds not started
- Admin numbers page
- MP4 faststart upload guard

### Cleanup
- weekly_summaries RLS disabled — needs policy added
- is_test_account guard on stripe-payment-succeeded and stripe-subscription-deleted
- Drop accent_preference, bg_preference columns (if not already done)

## MIGRATION STATE
- 95 local migration files, all timestamps match remote exactly — drift resolved 10 July 2026
- supabase db push returns "Remote database is up to date"
- Future migrations: use apply_migration MCP tool, then create a placeholder .sql file locally with timestamp matching what remote recorded

## KEY LEARNINGS — NEVER REPEAT THESE MISTAKES
- DeepSeek was briefly used via API as Claude Code backend — it edited files correctly but refused to deploy, injecting fake "output token limit" text before every deploy action. All deploys must go through real Claude Code only.
- apply_migration MCP assigns its own timestamp — always check remote timestamp after applying and create local placeholder file with timestamp matching what remote recorded immediately
- twilio-missed-call edge function must be deployed via CLI: npx supabase functions deploy twilio-missed-call --project-ref iskvvnhacqdxybpmwuni --no-verify-jwt
- deploy_edge_function MCP tool cannot resolve ../_shared/emailStyles.ts — use CLI instead
- get_melbourne_day_and_time() RPC must exist before deploying edge function — it is a dependency
- schedule_check in edge function logs only, never blocks SMS
- Supabase MCP execute_sql only returns last query result when batching — run queries individually

## TWILIO STUDIO FLOW — CONFIRMED
- http_2 widget body: {"customer_number": "{{trigger.call.From}}", "client_twilio_number": "{{trigger.call.To}}", ...}
- {{trigger.call.To}} confirmed — SMS fires FROM whichever Twilio number received the call
- Studio flow does not need to change for the two-number feature
