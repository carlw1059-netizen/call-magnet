# Output Style: ASD-STE100 Simplified Technical English

Write all responses in ASD-STE100 Simplified Technical English (Issue 9).

## Core rules

**Words**
- One word. One meaning. Always.
- Do not use the same word with two different meanings.
- Do not use jargon, idioms, or slang.
- Use the same term every time you name the same thing. No synonyms.

**Sentences**
- Short sentences. Maximum 20 words per instruction. Maximum 25 words per description.
- One idea per sentence.
- Active voice. Do not use passive voice unless the agent is unknown.
- Simple tenses only: present, past, or future with "will".

**Instructions**
- Start each step with an imperative verb.
- One action per step.
- State the condition before the action.

**Descriptions**
- Use simple present tense.
- Maximum 6 sentences per paragraph.

**Responses**
- Do not add filler sentences.
- Do not repeat what the user said.
- Do not add a closing summary if the answer is already clear.
- Stop when the answer is complete.

## Word replacements

| Do not use | Use |
|---|---|
| utilise | use |
| in order to | to |
| ensure | make sure |
| it is recommended | do this |
| it should be noted | note: |
| commence | start |
| terminate | stop |
| approximately | about |
| prior to | before |
| subsequent to | after |
| leverage | use |
| facilitate | help |
| implement | do / apply / install |
| endeavour | try |
| essentially | (delete) |
| basically | (delete) |
| it is worth noting | note: |

## Numbers

- Below 10: write as words (one, two, nine).
- 10 and above: write as digits (10, 25, 100).

## Project: CallMagnet

CallMagnet is a B2B missed-call-to-SMS SaaS for Australian service businesses.
Owner: Carl (solo founder, no coding background). Company: Nextpak Pty Ltd.

### Stack

- Frontend: Cloudflare Pages — callmagnet.com.au (marketing), app.callmagnet.com.au (dashboard), cm1.au (Middle Man)
- Backend: Supabase production ref iskvvnhacqdxybpmwuni
- SMS/calls: Twilio
- Payments: Stripe (live mode)
- Email: Resend (hello@callmagnet.com.au)
- Short links: cm1.au
- GitHub: carlw1059-netizen/call-magnet — main = production

### Architecture rules — never break these

- Column name is middle_man_slug, not slug.
- Never hard delete from the clients table. Set account_status = 'cancelled' only.
- SMS messages must never contain "callmagnet.com.au". B2B invisibility is absolute.
- iOS video must autoplay via the canplay listener pattern. Never call vid.play() outside the canplay listener.
- DeepSeek must never be used as the Claude Code backend.
- All changes go directly to main. Include git push origin main in every commit.
- Before any merge to main: run grep "staging" b.html cm1site/b.html — output must be zero.
- cm1site/b.html must always use absolute URLs.
- Bump middleman.js version strings in BOTH b.html AND cm1site/b.html on every change.
- Bump the ?v= version string on EVERY JS and CSS file that changed, in EVERY HTML file that loads it. Old version strings cause browsers to serve cached old code. This has caused hours of wasted debugging.
- Admin user (car312@hotmail.com) has NO client row and never will. loadDashboard must return true for admin without querying the clients table.
- onAuthStateChange must check email against REAL_ADMIN_EMAIL before checking app_metadata. Email check takes priority.
- Unique constraints on the clients table must exclude cancelled rows (WHERE account_status != 'cancelled'). Cancelled rows must never block new clients.
- schedule-test.html must have an auth gate — same pattern as clients.html.
- Only the Activate button on client cards is green (emerald). All other action buttons are black, except Suspend (red) and Edit Client (blue).
- All admin page back buttons go to / (the main dashboard with admin sidebar). Admin never redirects to a specific admin page on login.

### How to work with Carl

- Carl has no coding background. Explain every step in plain English.
- Never ask Carl to manually edit files, find/replace text, or navigate menus.
- Always provide complete bash code blocks ready to copy, or tell Carl to ask Claude Code to do it.
- Never delete any file, function, page, or database entry without explaining what it is and asking Carl to confirm first.
- Never assume Carl can verify what is in a file. Claude reads, diagnoses, and writes. Carl makes decisions.

### Current build priority

Fix these before onboarding the next client:
1. Schedule pg_cron for Day 14 and Day 30 onboarding emails
2. Fix booking tap push notifications — log-middle-man-tap not passing push_title/push_message
3. Test must_change_password flow end to end with a real client
4. Test activate-client Resend template end to end
5. BUG 4: clients.html and middle-man.html don't include admin-nav.js (no gear FAB on those pages)
6. BUG 6: acceptTerms() reads currentClient.id without null check (not reachable for admin but fragile)
7. BUG 7: Misleading comment at dashboard.js line ~600 says admin "must NOT see admin UI" — opposite of reality

## Setup Fee Discount (added 2026-11-08)

The onboard form has a "Setup fee discount ($)" field (ID: setupFeeDiscountInput).

Three paths in create-client:
- 0 → full setup fee, normal Stripe checkout
- > 0 but < full fee → one-time Stripe coupon created for the discount amount, applied to checkout session
- >= full fee (249 for hairdresser, 499 for restaurant) → checkout skipped entirely, account_status set to pending_setup, Pushover fired to Carl

Full fee amounts:
- hairdresser/barber: $249
- restaurant: $499

Commits: dd79c23 (feature), deployed to Supabase same session.

## Diagnosing a failed flow — MANDATORY ORDER
Before forming any theory (cache, deploy, browser), do these first:
1. Query the clients row for the test client: pricing_package, is_test_account, account_status, stripe_customer_id, created_at.
2. Pull the edge function logs for that exact timestamp (create-client logs every Stripe step: customer, coupon, checkout session, "Stripe skipped").
3. Compare the event time against git commit times — was the fix live when the test ran?
4. Fetch the live JS file from app.callmagnet.com.au and confirm the expected code is in it.
Only after all four, state the root cause. Never guess.

## Test account toggle
is_test_account = true forces free_trial in create-client: Stripe is skipped entirely, account_status = active. To test the Stripe flow, the toggle MUST be OFF.
