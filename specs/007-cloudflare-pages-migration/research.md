# Research: Cloudflare Pages Migration

**Feature**: 007-cloudflare-pages-migration
**Date**: 2026-10-31

---

## Decision 1: Credential injection approach for CF Pages

**Decision**: Replicate the existing `sed` build command from `netlify.toml` verbatim in the CF Pages build settings.

**Rationale**: The current build command is proven in production. CF Pages supports custom build commands with environment variables. The exact command to use in Project B (dashboard) is:

```bash
sed -i 's/\r//' assets/js/clients-admin.js assets/js/dashboard.js assets/js/middle-man-admin.js assets/js/middleman.js assets/js/onboard.js reset-password.html service-worker.js && CLEAN_URL=$(echo -n "$SUPABASE_URL" | tr -d '\n\r') && CLEAN_ANON=$(echo -n "$SUPABASE_ANON_KEY" | tr -d '\n\r') && CLEAN_VAPID=$(echo -n "$VAPID_PUBLIC_KEY" | tr -d '\n\r') && sed -i 's|%%SUPABASE_URL%%|'"$CLEAN_URL"'|g' assets/js/clients-admin.js assets/js/dashboard.js assets/js/middle-man-admin.js assets/js/middleman.js assets/js/onboard.js reset-password.html && sed -i 's|%%SUPABASE_ANON_KEY%%|'"$CLEAN_ANON"'|g' assets/js/clients-admin.js assets/js/dashboard.js assets/js/middle-man-admin.js assets/js/middleman.js assets/js/onboard.js reset-password.html service-worker.js && sed -i 's|%%VAPID_PUBLIC_KEY%%|'"$CLEAN_VAPID"'|g' index.html
```

CF Pages environment variables to set: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VAPID_PUBLIC_KEY`.

**Alternatives considered**: Runtime injection via a config endpoint — rejected as a larger change requiring new infrastructure.

---

## Decision 2: cm1.au Middle Man asset source

**Decision**: Update `cm1site/b.html` to load assets from `app.callmagnet.com.au` instead of `callmagnet.com.au`. Project A (marketing) is fully static with no build command and no credentials.

**Exact lines to change in `cm1site/b.html`**:
- Line 14: `navigator.serviceWorker.register('https://callmagnet.com.au/assets/js/sw.js')` → `https://app.callmagnet.com.au/assets/js/sw.js`
- Line 24: `href="https://callmagnet.com.au/assets/css/middleman.css?v=20261018e"` → `https://app.callmagnet.com.au/assets/css/middleman.css?v=20261018e`
- Additional middleman.js reference further in body (not in first 50 lines) — must also be updated to `app.callmagnet.com.au`
- Version string must be bumped per CLAUDE.md rules when b.html is changed

**Rationale**: Keeps the marketing site static and credential-free. All Middle Man JavaScript/CSS is already served from Project B (the dashboard project), which already runs the build with credentials injected.

---

## Decision 3: CORS functions — corrected list

**Decision**: Update CORS `Access-Control-Allow-Origin` from `callmagnet.com.au` to `app.callmagnet.com.au` in exactly **4** functions (not 5 as originally listed in the spec).

**Confirmed list with exact locations**:
```
delete-client/index.ts:8
reset-client-password/index.ts:8
send-test-sms/index.ts:14
twilio-missed-call/index.ts:60
```

**Correction from spec**: `upload-middle-man-background` uses `'*'` (wildcard) for its CORS header — it does NOT need updating. Item 14 in the spec's Cutover Checklist is incorrect and should be ignored.

All other edge functions use `'*'` and are unaffected.

**Pattern**: Each of the 4 functions has a `const CORS` object at the top of the file. Only the `Access-Control-Allow-Origin` value changes — the other CORS headers (`Access-Control-Allow-Headers`, `Access-Control-Allow-Methods`) stay the same.

---

## Decision 4: dashboard.js password reset — two lines

**Decision**: Update `resetPasswordForEmail` `redirectTo` in `dashboard.js` at **both** line 167 and line 303.

Both lines currently read:
```js
redirectTo: 'https://callmagnet.com.au/reset-password',
```
Both must become:
```js
redirectTo: 'https://app.callmagnet.com.au/reset-password',
```

---

## Decision 5: weekly-email.ts — three lines

**Decision**: Update `_shared/weekly-email.ts` at lines 240, 242, and 244 where the magic link `redirectTo` is built. All three reference `'https://callmagnet.com.au'` and must be updated to `'https://app.callmagnet.com.au'`.

---

## Decision 6: payment-success.html exists

`payment-success.html` exists in the repo root. After migration it will be served at `app.callmagnet.com.au/payment-success` — the Stripe success redirect target. No new file needed.

---

## Decision 7: CF Pages ignore rule

The existing `netlify.toml` has an `ignore` rule that skips builds when only docs/specs/CLAUDE.md/supabase change. The equivalent in CF Pages is set in the project's "Build configuration" as a "Skip builds" pattern. This should be replicated to avoid unnecessary CF Pages builds when only Supabase functions or docs are updated.

---

## Decision 8: og-inject Worker

The og-inject Worker is deployed externally (not in this repo). Its current behaviour: intercepts `cm1.au/*` requests, fetches the Middle Man page HTML from the origin, injects Open Graph meta tags, and returns the modified HTML. After migration it needs to proxy to the new CF Pages origin for cm1.au instead of the old Netlify URL. This update is performed in the Cloudflare Workers dashboard during the cm1.au cutover step.

---

## Corrections to Spec Cutover Checklist

The spec's cutover checklist contains one error:
- **Item 14** (`upload-middle-man-background CORS`) — **REMOVE**. This function uses `'*'` for CORS and does not need updating.
- **Item 15** (`dashboard.js`) — note: **two** lines need changing (167 AND 303), not one.
- **Item 8** (`_shared/weekly-email.ts`) — note: three lines need changing (240, 242, 244).
