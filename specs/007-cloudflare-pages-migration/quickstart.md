# Quickstart: Cloudflare Pages Migration Testing Plan

**Feature**: 007-cloudflare-pages-migration

This guide covers how to validate the migration before and after each DNS flip. Follow steps in order. Do not move to the next DNS flip until the current one is fully verified.

---

## Prerequisites

- All 16 code changes from `data-model.md` are deployed (edge functions redeployed via Supabase CLI or dashboard)
- Supabase Auth Site URL and redirect URLs updated (data-model.md item 17)
- Three CF Pages projects created in Cloudflare dashboard
- `cf-marketing` branch created and pushed
- `cm1site/_redirects` file committed to `main`
- All three projects connected to the repo and showing a successful build

---

## Step 1: Pre-cutover testing on pages.dev (Project B only)

**Goal**: Confirm the dashboard builds correctly and login works before any DNS is touched.

### 1a — Get the Project B pages.dev URL
In the Cloudflare Pages dashboard, find Project B (dashboard). Its preview URL looks like: `callmagnet-dashboard.pages.dev` (or similar).

### 1b — Add pages.dev URL to Supabase Auth temporarily
In Supabase → Authentication → URL Configuration → Redirect URLs, add:
```
https://callmagnet-dashboard.pages.dev/**
```
(Use the actual pages.dev URL shown in your CF Pages dashboard.)

### 1c — Test login on pages.dev
1. Open `https://callmagnet-dashboard.pages.dev` in a browser
2. Confirm the login screen loads with no browser security warnings
3. Log in with your password
4. Confirm you land on the dashboard and client data loads
5. Open browser DevTools → Console — confirm zero errors
6. Navigate to at least one admin area (e.g. client list)

### 1d — Remove pages.dev URL from Supabase Auth
Remove `https://callmagnet-dashboard.pages.dev/**` from Supabase redirect URLs before proceeding.

---

## Step 2: Flip cm1.au DNS (Project C)

**Goal**: Middle Man pages serve from CF Pages. SMS links continue to work.

### 2a — Update og-inject Worker
In Cloudflare Workers dashboard, update the og-inject Worker to fetch from the new CF Pages origin for cm1.au (instead of the old Netlify URL). The Worker must proxy to the CF Pages project URL.

### 2b — Flip DNS
In Cloudflare DNS, point `cm1.au` to Project C (CF Pages will guide you through adding the custom domain).

### 2c — Verify on a real device
Open a known Middle Man link (e.g. `cm1.au/arcane-fairies`) on a **real mobile phone**:
- [ ] Page loads with correct content and buttons
- [ ] All 6 buttons visible, layout correct
- [ ] No broken images or missing styles
- [ ] Tap a button — form appears
- [ ] Submit a test form — confirm push notification arrives

**Do not touch any other DNS until this passes.**

---

## Step 3: Flip app.callmagnet.com.au DNS (Project B)

**Goal**: Dashboard accessible at its new permanent address.

### 3a — Add custom domain to Project B
In CF Pages, add `app.callmagnet.com.au` as a custom domain on Project B. CF Pages will update DNS automatically (DNS is already in Cloudflare).

Also add `portal.callmagnet.com.au` as a second custom domain on Project B.

### 3b — Verify dashboard
Open `https://app.callmagnet.com.au`:
- [ ] Login screen loads with valid SSL (green padlock, no warnings)
- [ ] Log in with password — lands on dashboard
- [ ] Client list loads
- [ ] Open browser DevTools → Console — zero CORS errors
- [ ] Test one admin action: delete a test client OR reset a test client password OR send a test SMS
- [ ] Open `https://app.callmagnet.com.au/reset-password` directly — confirm reset-password page loads

**Do not touch callmagnet.com.au DNS until this passes.**

---

## Step 4: Flip callmagnet.com.au DNS (Project A)

**Goal**: Marketing site live at root domain. All redirect rules working.

### 4a — Add custom domain to Project A
In CF Pages, add `callmagnet.com.au` as a custom domain on Project A.

### 4b — Verify marketing site
Open `https://callmagnet.com.au`:
- [ ] Marketing site loads ("Never miss a booking again" headline visible)
- [ ] Valid SSL certificate, no browser warnings
- [ ] "Go to dashboard" link is visible and links to `app.callmagnet.com.au`
- [ ] Click the dashboard link — lands on `app.callmagnet.com.au` login screen

### 4c — Verify redirects
- [ ] `callmagnet.com.au/b/arcane-fairies` → redirects to `cm1.au/arcane-fairies`
- [ ] `callmagnet.com.au/reset-password` → redirects to `app.callmagnet.com.au/reset-password`
- [ ] `portal.callmagnet.com.au` → loads the dashboard (same as `app.callmagnet.com.au`)

---

## Step 5: Post-cutover monitoring (14 days)

- Netlify deployment remains live and untouched for 14 days
- If any issue is found: revert DNS to Netlify (all three records) and investigate
- After 14 days with no issues: delete the Netlify project

---

## Failure criteria — stop and revert if any of these occur

- Middle Man page fails to load or submit a form after cm1.au DNS flip
- Dashboard login fails after app.callmagnet.com.au DNS flip
- Any CORS error in the browser console after login
- SSL certificate error on any of the three domains
- Push notification stops arriving after Middle Man form submit
