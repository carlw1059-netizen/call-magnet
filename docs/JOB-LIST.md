# CallMagnet — Job List
*Last updated: 2026-11-07*

## About this project

CallMagnet is a B2B missed-call-to-SMS SaaS for Australian service businesses. When a customer calls and can't get through, Twilio fires a webhook, an edge function sends an automatic SMS with a short link, and the caller lands on a branded Middle Man page to book or enquire. The stack is Supabase edge functions (Deno) + PostgreSQL, Netlify frontend, Twilio, Stripe (live mode), and Resend email. GitHub repo: `carlw1059-netizen/call-magnet`. All changes go directly to main — no PRs, no staging branch.

## Always read first

Before starting any job: read CLAUDE.md. One file at a time. Include `git push origin main` in every commit.

---

## Jobs — ordered easiest to hardest

---

### JOB 1 — Add SEND-EMAIL-SEQUENCE and weekly-summary to config.toml
**Status:** READY | **Time:** 2 min

**Background:** Neither `SEND-EMAIL-SEQUENCE` nor `weekly-summary` has an entry in `supabase/config.toml`. Without an entry, Supabase defaults to `verify_jwt = true` on the next redeploy. Both functions are called by pg_cron, which sends only `X-Internal-Secret` — no JWT. The gateway will return 401 and both functions will silently stop working. This must be done before Job 8 (scheduling Day 14/Day 30 cron jobs) or those cron jobs will fail on day one.

**File:** `supabase/config.toml`

**Prompt:**
```
Read CLAUDE.md first. Open supabase/config.toml. Add verify_jwt = false entries for SEND-EMAIL-SEQUENCE and weekly-summary — matching the pattern of the other cron-triggered functions already in the file. Show me the two new lines before committing. Commit with message 'fix: add missing config.toml entries for SEND-EMAIL-SEQUENCE and weekly-summary' and push.
```

**Done when:** both `[functions.SEND-EMAIL-SEQUENCE]` and `[functions.weekly-summary]` with `verify_jwt = false` appear in config.toml and the commit is pushed.

---

### JOB 2 — Decide: keep or delete callmagnet_overview.pdf and its .py generator
**Status:** READY | **Time:** 2 min

**Background:** Both `callmagnet_overview.pdf` and its `.py` generator script are in the repo root. This is Carl's decision only — no code change until confirmed. If kept: they may be a shareable sales asset. If deleted: clean up the repo root.

**Prompt:** Not needed — Carl decides. Then ask Claude Code to delete both files and commit with message `'chore: remove callmagnet_overview.pdf and generator script'` and push.

**Done when:** Carl makes the call.

---

### JOB 3 — Fix Arcane Fairies middle_man_background_url
**Status:** READY | **Time:** 10 min

**Background:** Arcane Fairies has a valid `mux_asset_id` but `middle_man_background_url` is null. The Middle Man page has no background. Upload a video through the client dashboard to trigger the mux-webhook end-to-end and confirm the URL gets written to the clients table. Commercial priority — must resolve before converting Arcane Fairies to a paying client.

**Prompt:** Not needed — this is a dashboard action, not a code change. Log in to the admin dashboard, open Arcane Fairies, upload a background video, then confirm `middle_man_background_url` is populated in Supabase.

**Done when:** `middle_man_background_url` is populated in the `clients` table for Arcane Fairies and the Middle Man page shows the background.

---

### JOB 4 — Confirm and delete orphaned check-mux-stuck function
**Status:** READY | **Time:** 10 min

**Background:** `supabase/functions/check-mux-stuck/index.ts` queries `video_processing_status` and `mux_asset_id` on the clients table. Mux is not in the current stack — video upload is now direct to Supabase Storage. This function appears to be dead code left over from a previous Mux integration. Carl must confirm before deletion.

**File:** `supabase/functions/check-mux-stuck/index.ts`

**Prompt:**
```
Read CLAUDE.md first. Read supabase/functions/check-mux-stuck/index.ts in full. Confirm whether this function serves any purpose in the current stack (Supabase Storage video upload — not Mux). Report only — do not delete anything until Carl confirms. If Carl confirms deletion: delete the function directory and remove any associated pg_cron entry. Commit with message 'chore: remove orphaned check-mux-stuck function' and push.
```

**Done when:** Carl confirms, function directory is deleted, any cron entry is removed, and commit is pushed.

---

### JOB 5 — Disable staging pg_cron calling production
**Status:** READY | **Time:** 5 min

**Background:** The staging Supabase project (ref: `knupnihccvdsnoxnaqwo`, region: ap-south-1) has a pg_cron job that calls the production `weekly-summary` function every Sunday. It gets 401 every time. This creates noise in production logs and is easy to fix.

**Prompt:** Not a Claude Code task. Go to the Supabase staging dashboard → SQL editor. First run `SELECT * FROM cron.job;` to confirm the job name. Then run `SELECT cron.unschedule('<job-name>');` to remove it.

**Done when:** No pg_cron job pointing at the production `weekly-summary` URL exists in the staging project.

---

### JOB 6 — Fix security.yml — make CI fire on push to main
**Status:** READY | **Time:** 15 min

**Background:** `.github/workflows/security.yml` triggers only on `pull_request`. No PRs are ever raised — all changes go directly to main. This workflow has never run once since it was created. It needs a `push: branches: [main]` trigger added.

**File:** `.github/workflows/security.yml`

**Prompt:**
```
Read CLAUDE.md first. Read .github/workflows/security.yml in full. Rewrite it as a two-job workflow: Job 1 runs native checks (grep -r 'staging' b.html cm1site/b.html — fail if found; check that if middleman.css or middleman.js changed, both b.html and cm1site/b.html also changed). Job 2 runs the existing claude-code-security-review action with continue-on-error: true. Add push: branches: [main] to the trigger alongside pull_request. Show me the full YAML before committing. Commit with message 'ci: fix security.yml trigger — add push to main, add native checks' and push.
```

**Done when:** workflow triggers on `push: branches: [main]`, two jobs exist, commit is pushed, and the action runs successfully on the next push to main.

---

### JOB 7 — Confirm or close the password reset bug
**Status:** READY | **Time:** 20 min

**Background:** CLAUDE.md lists this as a build blocker: "onAuthStateChange fires PASSWORD_RECOVERY with no token check." However, `assets/js/dashboard.js` line 951 already sets `window._isPasswordRecoveryFlow = window.location.hash.includes('type=recovery')`, and line 1003 guards `showRecovery()` behind that flag. The described bug appears to already be fixed. What has not been tested: what happens when a user opens the dashboard with an **expired** `type=recovery` hash in the URL — does the recovery form still show, and does it error gracefully on submit?

**File:** `assets/js/dashboard.js` lines 940–1020

**Prompt:**
```
Read CLAUDE.md first. Read assets/js/dashboard.js lines 940–1020. Tell me exactly what the PASSWORD_RECOVERY handler does and whether it guards against spurious fires. Then answer: what happens if a user opens the dashboard with an expired type=recovery hash in the URL? Do not change any code. Report only. If the behaviour is acceptable (form shows, Supabase rejects the submit with an error message), update the CLAUDE.md current build priority entry to reflect that this bug is resolved or describe what still needs fixing. Commit any CLAUDE.md change with message 'docs: update password reset bug status in CLAUDE.md' and push.
```

**Done when:** behaviour is confirmed, CLAUDE.md is updated to reflect actual status, and commit is pushed if a change was made.

---

### JOB 8 — Schedule Day 14 / Day 30 onboarding email pg_cron jobs
**Status:** BLOCKED by Job 1 | **Time:** 20 min

**Background:** These emails have never fired for any client since launch. SEND-EMAIL-SEQUENCE code is complete — the comment in the file says explicitly it is dead code until a dispatch migration is added. Must do Job 1 (config.toml) first or the cron will silently 401.

**File:** `supabase/functions/SEND-EMAIL-SEQUENCE/index.ts`, `supabase/config.toml`, new migration in `supabase/migrations/`

**Prompt:**
```
Read CLAUDE.md first. Read supabase/functions/SEND-EMAIL-SEQUENCE/index.ts in full. Read supabase/config.toml and confirm SEND-EMAIL-SEQUENCE has verify_jwt = false before proceeding. Create a new migration in supabase/migrations/ that adds pg_cron jobs to dispatch Day 14 and Day 30 emails using X-Internal-Secret. Show me the migration SQL before applying it. Commit with message 'feat: schedule Day 14 and Day 30 onboarding email cron jobs' and push.
```

**Done when:** migration is applied and a manual test confirms a row is written on dispatch.

---

### JOB 9 — Fix booking button taps not firing push notifications
**Status:** READY | **Time:** 30 min

**Background:** `log-middle-man-tap` does not pass `push_title` or `push_message` to `send-client-notification`. Business owners never get alerted when a caller taps their booking button. Core product action — must fix before Arcane Fairies converts to paying.

**Files:** `supabase/functions/log-middle-man-tap/index.ts`, `supabase/functions/send-client-notification/index.ts`

**Prompt:**
```
Read CLAUDE.md first. Read supabase/functions/log-middle-man-tap/index.ts and supabase/functions/send-client-notification/index.ts in full. Find where log-middle-man-tap calls send-client-notification and show me exactly what payload it sends. Confirm whether push_title and push_message are included. If not, fix log-middle-man-tap to pass them. Show me the fix before committing. Commit with message 'fix: pass push_title and push_message in log-middle-man-tap' and push.
```

**Done when:** a test tap fires a push notification to Carl's device.

---

### JOB 10 — Test must_change_password flow end-to-end
**Status:** BLOCKED by Job 7 | **Time:** 30 min

**Background:** New clients are created with `must_change_password = true`. This flow has never been tested end-to-end. The `clear-must-change-password` function exists on disk but has no config.toml entry — check its `verify_jwt` requirement before testing.

**Files:** `supabase/functions/clear-must-change-password/index.ts`, `supabase/config.toml`

**Prompt:**
```
Read CLAUDE.md first. Read supabase/functions/clear-must-change-password/index.ts and check supabase/config.toml for its entry. Then describe exactly what should happen when a new client logs in with must_change_password = true: what screen shows, what edge function clears the flag, and what the client sees after. Do not change anything — confirm the full flow in writing first.
```

**Done when:** flow is confirmed working end-to-end with a test client account.

---

### JOB 11 — Write tests for top 3 critical functions
**Status:** READY | **Time:** 2–3 hrs

**Background:** Zero automated tests across 42 edge functions. Priority: (1) `twilio-missed-call` — entry point; (2) `send-missed-call-sms` — core product action, [LINK] substitution must work; (3) `stripe-payment-succeeded` — revenue gate, `account_status` must flip to `active`. Silent failure in any of these = product down or leaking money with no alert.

**Files:** `supabase/functions/twilio-missed-call/index.ts`, `supabase/functions/send-missed-call-sms/index.ts`, `supabase/functions/stripe-payment-succeeded/index.ts`

**Prompt:**
```
Read CLAUDE.md first. Read supabase/functions/twilio-missed-call/index.ts, send-missed-call-sms/index.ts, and stripe-payment-succeeded/index.ts in full. Write tests for all three. For twilio-missed-call: Twilio payload → sms_events row written + send-missed-call-sms called. For send-missed-call-sms: SMS sent to correct number with [LINK] substituted, not literal placeholder. For stripe-payment-succeeded: webhook → account_status = 'active' + welcome email sent. Show me each test before writing it to disk.
```

**Done when:** all 3 tests pass.

---

### JOB 12 — Consolidate _shared/ utilities
**Status:** BLOCKED by Job 14 | **Time:** 2–3 hrs

**Background:** JSON response helper duplicated in 41 files, CORS headers in 23, Supabase admin client init in 21, Resend send block in 14. Do after Job 14 (`verifyAdmin`) establishes the shared helper pattern.

**Files:** `supabase/functions/_shared/`

**Prompt:**
```
Read CLAUDE.md first. Read supabase/functions/_shared/ in full. Then read one example function that uses inline JSON response, CORS headers, and Supabase admin client init. Create shared helpers for each in _shared/: jsonResponse.ts, corsHeaders.ts, supabaseAdmin.ts, resendEmail.ts. Show me each helper before touching any function file.
```

**Done when:** all 4 helpers exist in `_shared/` and are imported across all relevant functions.

---

### JOB 13 — CI/CD lint + deploy pipeline
**Status:** BLOCKED by Jobs 11 + 12 | **Time:** 1–2 hrs

**Background:** No automated deploy pipeline. Only add after test coverage (Job 11) and shared utilities (Job 12) are done — otherwise nothing meaningful to run.

**File:** `.github/workflows/deploy.yml` (new)

**Prompt:**
```
Read CLAUDE.md first. Create .github/workflows/deploy.yml. Trigger on push to main. Run lint on edge functions. Deploy edge functions to Supabase production. Show me the full YAML before committing.
```

**Done when:** pipeline runs successfully on push to main.

---

### JOB 14 — ⚠️ HIGH RISK — Create verifyAdmin() and refactor 41 functions
**Status:** READY — dedicated session required, nothing else open | **Time:** 3–5 hrs

**Background:** Every admin edge function duplicates JWT extraction + `app_metadata.is_admin` + email check inline. No `verifyAdmin.ts` exists in `_shared/`. A bug in that inline block is a bug in 41 places simultaneously. This unblocks Job 12.

**Rule:** Show Carl the helper before touching any function file. Run in a fresh session with nothing else open.

**File:** `supabase/functions/_shared/verifyAdmin.ts` (new), then all 41 admin functions

**Prompt:**
```
Read CLAUDE.md first. Create a verifyAdmin(req) helper in supabase/functions/_shared/verifyAdmin.ts. It must: extract JWT from Authorization header, look up the user via Supabase admin client, check app_metadata.is_admin is true. Return the user object on success, return a 401 Response on failure. Show me the complete helper file before touching any other file.
```

**Done when:** `verifyAdmin.ts` exists in `_shared/` and all 41 functions import and use it.
