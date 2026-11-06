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

### How to work with Carl

- Carl has no coding background. Explain every step in plain English.
- Never ask Carl to manually edit files, find/replace text, or navigate menus.
- Always provide complete bash code blocks ready to copy, or tell Carl to ask Claude Code to do it.
- Never delete any file, function, page, or database entry without explaining what it is and asking Carl to confirm first.
- Never assume Carl can verify what is in a file. Claude reads, diagnoses, and writes. Carl makes decisions.

### Current build priority

Fix these before onboarding the next client:
1. Password reset bug — onAuthStateChange fires PASSWORD_RECOVERY with no token check (dashboard.js line 998)
2. Schedule pg_cron for Day 14 and Day 30 onboarding emails
3. Fix booking tap push notifications — log-middle-man-tap not passing push_title/push_message
4. Test must_change_password flow end to end with a real client
5. Test activate-client Resend template end to end
