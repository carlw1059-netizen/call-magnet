# Implementation Plan: Cloudflare Pages Migration

**Branch**: `007-cloudflare-pages-migration` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-cloudflare-pages-migration/spec.md`

## Summary

Migrate the CallMagnet frontend from Netlify to three Cloudflare Pages projects, restructure URLs so the marketing site lives at `callmagnet.com.au`, the dashboard moves to `app.callmagnet.com.au`, and Middle Man pages are served directly from `cm1.au`. Eighteen code changes must be deployed before any DNS is touched. Netlify stays live for 14 days as a rollback target.

## Technical Context

**Language/Version**: HTML/CSS/JavaScript (frontend); TypeScript/Deno (Supabase edge functions)

**Primary Dependencies**: Cloudflare Pages (3 projects), Supabase edge functions (deployed via Supabase CLI), sed (build-time credential injection), Stripe, Resend, Twilio Studio, Cloudflare Workers (og-inject, external)

**Storage**: Supabase PostgreSQL — unchanged, not in scope

**Testing**: Manual browser testing on `*.pages.dev` preview URLs; live smoke test immediately after each DNS flip

**Target Platform**: Cloudflare Pages CDN (global edge); Supabase Deno runtime (edge functions unchanged)

**Project Type**: Infrastructure migration — configuration changes and targeted code edits across three systems (Cloudflare, Supabase edge functions, frontend JS)

**Performance Goals**: No degradation in Middle Man page load or form submission success rate vs. Netlify baseline

**Constraints**:
- `cm1.au/<slug>` links in already-sent SMS messages must never break
- All 18 cutover code changes must be deployed and edge functions redeployed before any DNS flip
- Each of the three DNS flips must be tested before the next is attempted
- Netlify must remain live for 14 days post-cutover as rollback target

**Scale/Scope**: 3 CF Pages projects; 18 file-level changes at cutover; 1 external Cloudflare Worker update (og-inject); 2 Supabase Auth config changes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution is not yet populated with project-specific principles. No gate violations identified. All changes are additive or targeted substitutions; no schema migrations, no data loss risk, no new dependencies introduced.

## Project Structure

### Documentation (this feature)

```text
specs/007-cloudflare-pages-migration/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output (CF Pages project configs)
├── quickstart.md        ← Phase 1 output (testing plan)
├── checklists/
│   └── requirements.md
└── tasks.md             ← Phase 2 output (/speckit-tasks — not yet created)
```

### Source Code (repository root)

This migration touches files across the existing repo structure — no new directories are created in the main codebase:

```text
[repo root]
├── callmagnet-website.html        → renamed index.html in cf-marketing branch
├── cm1site/
│   ├── b.html                     → asset base URL updated (one line)
│   └── _redirects                 → new file: /* /b.html 200
├── assets/js/
│   └── dashboard.js               → resetPasswordForEmail redirectTo updated
└── supabase/functions/
    ├── _shared/
    │   └── weekly-email.ts        → magic link redirectTo updated
    ├── create-client/index.ts     → success_url, cancel_url, CTA, redirectTo
    ├── activate-client/index.ts   → CTA + redirectTo
    ├── stripe-payment-succeeded/index.ts → CTA + redirectTo
    ├── monthly-report/index.ts    → CTA + redirectTo
    ├── notify-expiry/index.ts     → CTA
    ├── request-login-link/index.ts → redirectTo
    ├── send-client-notification/index.ts → push url field
    ├── delete-client/index.ts     → CORS Allow-Origin
    ├── reset-client-password/index.ts → CORS Allow-Origin
    ├── send-test-sms/index.ts     → CORS Allow-Origin
    ├── twilio-missed-call/index.ts → CORS Allow-Origin
    └── upload-middle-man-background/index.ts → CORS Allow-Origin
```

**New branch for marketing site:**
```text
cf-marketing branch (cut from main, stripped to marketing files):
├── index.html                     ← callmagnet-website.html renamed
└── _redirects                     ← new redirect rules file
```

## Complexity Tracking

No constitution violations. No complexity justification required.
