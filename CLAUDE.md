# CallMagnet — CLAUDE.md

## Output style
Write in plain English. Short sentences. One idea per sentence. Active voice.
No jargon. No filler. Stop when the answer is complete.

---

## Debugging rules
1. Never guess. Get runtime logs before fixing.
2. Never declare a fix done without proof or user confirmation.
3. Circuit breaker: if a fix fails twice, stop, revert, ask for real logs.

## Code rules
- Minimum code that solves the problem. Nothing extra.
- Touch only the file and function specified. No adjacent changes.
- Match existing style.
- Every changed line must trace to the user's request.
- Before any multi-step task: state the plan and what success looks like.

## Diagnosing a failed flow — do these first, in order
1. Query the clients row: pricing_package, is_test_account, account_status, stripe_customer_id, created_at.
2. Pull edge function logs for that exact timestamp.
3. Compare event time against git commit times — was the fix live when the test ran?
4. Fetch the live JS from app.callmagnet.com.au and confirm expected code is in it.
Only after all four: state root cause.

---

## Stack
- Frontend: Cloudflare Pages — callmagnet.com.au, app.callmagnet.com.au, cm1.au
- Backend: Supabase production ref iskvvnhacqdxybpmwuni
- SMS/calls: Twilio | Payments: Stripe live | Email: Resend hello@callmagnet.com.au
- GitHub: carlw1059-netizen/call-magnet — main = production

---

## Architecture rules — never break
- Column is middle_man_slug, not slug.
- Never hard delete from clients table. Set account_status = 'cancelled' only.
- Unique constraints on clients must exclude cancelled rows (WHERE account_status != 'cancelled').
- SMS must never contain "callmagnet.com.au". B2B invisibility is absolute.
- iOS video must autoplay via canplay listener. Never call vid.play() outside canplay listener.
- All changes go to main. Include git push origin main in every commit.
- Before any merge to main: grep "staging" b.html cm1site/b.html — zero output required.
- cm1site/b.html must always use absolute URLs.
- Bump ?v= version string on every JS and CSS file that changed, in every HTML file that loads it.
- Bump middleman.js version in BOTH b.html AND cm1site/b.html on every change.
- Admin (car312@hotmail.com) has no client row. loadDashboard must return true for admin without querying clients table.
- onAuthStateChange: check email against REAL_ADMIN_EMAIL before app_metadata. Email check first.
- Only the Activate button is green (emerald). Other action buttons: black. Suspend: red. Edit Client: blue.
- All admin back buttons go to / (main dashboard). Admin never redirects to a specific admin page on login.
- schedule-test.html must have an auth gate — same pattern as clients.html.
- is_test_account = true skips Stripe entirely, sets account_status = active. Turn it OFF to test Stripe flow.
- DeepSeek must never be used as the Claude Code backend.

---

## Working with Carl
- Carl has no coding background. Plain English only.
- Never ask Carl to manually edit files or navigate menus.
- Always provide complete bash blocks ready to copy, or tell Carl to ask Claude Code.
- Never delete any file, function, or database entry without explaining it and asking Carl to confirm.
- Never assume Carl can verify file contents. Claude reads, diagnoses, writes. Carl decides.
