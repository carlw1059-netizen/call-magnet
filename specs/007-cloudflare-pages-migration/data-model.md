# Data Model: Cloudflare Pages Migration

**Feature**: 007-cloudflare-pages-migration

This migration has no database schema changes. The "entities" are the three Cloudflare Pages projects and their configuration.

---

## CF Pages Project Definitions

### Project A — Marketing Site

| Field | Value |
|---|---|
| CF Pages project name | `callmagnet-marketing` (or similar) |
| Source repo | `carlw1059-netizen/call-magnet` |
| Branch | `cf-marketing` (new branch, cut from `main`) |
| Root directory | `/` (repo root of the branch) |
| Build command | _(none — fully static)_ |
| Build output directory | `/` |
| Environment variables | _(none)_ |
| Custom domains | `callmagnet.com.au` |

**Files in `cf-marketing` branch:**
```
index.html          ← callmagnet-website.html renamed
_redirects          ← redirect rules (see contracts/redirects-project-a.md)
```

**All other files from `main` are removed from this branch.**

---

### Project B — Dashboard

| Field | Value |
|---|---|
| CF Pages project name | `callmagnet-dashboard` (or similar) |
| Source repo | `carlw1059-netizen/call-magnet` |
| Branch | `main` |
| Root directory | `/` (repo root) |
| Build command | _(see contracts/build-command-project-b.md)_ |
| Build output directory | `/` |
| Environment variables | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VAPID_PUBLIC_KEY` |
| Custom domains | `app.callmagnet.com.au`, `portal.callmagnet.com.au` |

---

### Project C — Middle Man Pages

| Field | Value |
|---|---|
| CF Pages project name | `callmagnet-middleman` (or similar) |
| Source repo | `carlw1059-netizen/call-magnet` |
| Branch | `main` |
| Root directory | `/cm1site` |
| Build command | _(none)_ |
| Build output directory | `/cm1site` |
| Environment variables | _(none)_ |
| Custom domains | `cm1.au` |

**Files served from `cm1site/`:**
```
b.html              ← Middle Man page (asset URLs updated to app.callmagnet.com.au)
_redirects          ← one rule: /* /b.html 200
```

---

## DNS Records Required

All DNS is managed in Cloudflare. CF Pages custom domain setup creates these records automatically, but the expected state is:

| Subdomain | Type | Target |
|---|---|---|
| `callmagnet.com.au` | CNAME | CF Pages Project A |
| `app.callmagnet.com.au` | CNAME | CF Pages Project B |
| `portal.callmagnet.com.au` | CNAME | CF Pages Project B |
| `cm1.au` | CNAME | CF Pages Project C |

---

## Supabase Auth Config Changes

| Setting | Current value | New value |
|---|---|---|
| Site URL | `https://callmagnet.com.au` | `https://app.callmagnet.com.au` |
| Redirect URLs — add | _(not present)_ | `https://app.callmagnet.com.au/**` |
| Redirect URLs — keep temporarily | `https://callmagnet.com.au/**` | Remove after Phase 2 |

---

## Code Changes — Complete Corrected List

Replaces the cutover checklist in the spec (with corrections from research.md).

| # | File | What changes | Line(s) |
|---|------|-------------|---------|
| 1 | `supabase/functions/create-client/index.ts` | `success_url` → `app.callmagnet.com.au/payment-success` | 362 |
| 2 | `supabase/functions/create-client/index.ts` | `cancel_url` → `app.callmagnet.com.au` | 363 |
| 3 | `supabase/functions/create-client/index.ts` | magic link `redirectTo` and CTA links | multiple |
| 4 | `supabase/functions/activate-client/index.ts` | CTA links and `redirectTo` | multiple |
| 5 | `supabase/functions/stripe-payment-succeeded/index.ts` | CTA links and `redirectTo` | multiple |
| 6 | `supabase/functions/monthly-report/index.ts` | CTA links and `redirectTo` | multiple |
| 7 | `supabase/functions/notify-expiry/index.ts` | CTA button link | multiple |
| 8 | `supabase/functions/request-login-link/index.ts` | magic link `redirectTo` | multiple |
| 9 | `supabase/functions/send-client-notification/index.ts` | push notification `url` field | multiple |
| 10 | `supabase/functions/_shared/weekly-email.ts` | magic link `redirectTo` (3 occurrences) | 240, 242, 244 |
| 11 | `supabase/functions/delete-client/index.ts` | `Access-Control-Allow-Origin` | 8 |
| 12 | `supabase/functions/reset-client-password/index.ts` | `Access-Control-Allow-Origin` | 8 |
| 13 | `supabase/functions/send-test-sms/index.ts` | `Access-Control-Allow-Origin` | 14 |
| 14 | `supabase/functions/twilio-missed-call/index.ts` | `Access-Control-Allow-Origin` | 60 |
| 15 | `assets/js/dashboard.js` | `resetPasswordForEmail` `redirectTo` | 167, 303 |
| 16 | `cm1site/b.html` | asset base URL from `callmagnet.com.au` → `app.callmagnet.com.au` + version bump | 14, 24, + body |
| 17 | Supabase Auth dashboard | Site URL + allowed redirect URLs | (config, not code) |
| 18 | CLAUDE.md | Update absolute URL rule for `cm1site/b.html` | (documentation) |

**Total: 16 code files + 1 config change + 1 doc update**

⚠️ `upload-middle-man-background` was listed in the spec but uses `'*'` CORS — **no change needed**.
