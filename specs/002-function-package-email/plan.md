# Implementation Plan: Button Info Pack

**Branch**: `002-function-package-email` | **Date**: 2026-09-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-function-package-email/spec.md`

## Summary

Any Middle Man button can carry an optional `infopack_url`. When set, the success screen after form submission shows a "View Info Pack →" link that opens the document in a new tab. The venue configures this per button in the admin panel. A DB migration adds `email TEXT` to `middle_man_form_submissions` and the `submit-middle-man-form` edge function is updated to store it.

---

## Technical Context

**Language/Version**: JavaScript (ES5-compatible vanilla), TypeScript (Supabase edge functions)

**Primary Dependencies**: Supabase JS client (already loaded), Netlify (hosting)

**Storage**: PostgreSQL via Supabase. `clients.middle_man_buttons` JSONB (no migration needed). `middle_man_form_submissions.email` column (migration required).

**Testing**: Manual — admin Save buttons test + live page E2E on Arcane Fairies

**Target Platform**: Netlify-hosted static frontend + Supabase edge functions

**Project Type**: SaaS web application

**Performance Goals**: No change — purely additive UI

**Constraints**: No new libraries. No new edge functions. No changes to SMS/Twilio/Stripe flows.

**Scale/Scope**: Affects all Middle Man clients; gated on `infopack_url` being truthy — zero impact on clients without it.

---

## Constitution Check

Constitution template is unfilled — no project-level gates apply. User-supplied build rules apply in their place (see Rules section at bottom).

---

## ⚠️ Risk Register

| # | Risk | Impact | Likelihood | Mitigation |
|---|------|--------|------------|------------|
| **R1** | `saveButtons()` writes `"undefined"` into `infopack_url` for existing buttons — corrupts Arcane Fairies data | HIGH | HIGH | Always `btn.infopack_url \|\| ''` in `buildBtnRowHtml`. Test Save on Arcane Fairies before any other test. |
| **R2** | 2s auto-close kills the info pack link before customer can click | HIGH | CERTAIN (if not addressed) | Suppress `closeForm()` setTimeout in `handleSuccess` when `infopackUrl` is truthy. |
| **R3** | `buildFormHtml` / `attachFormListeners` signature change breaks call sites | MEDIUM | LOW | Only 2 call sites (middleman.js lines 815 and 817). Update atomically in one edit. |
| **R4** | Email field regression on function-type buttons without `infopack_url` (Arcane Fairies) | HIGH | CERTAIN (if not guarded) | Keep `formType === 'function'` condition. Add `\|\| (btnData && btnData.infopack_url)` as additive OR — never replace the existing condition. |
| **R5** | Email sent to edge function but never stored (no column) | MEDIUM | CERTAIN (without migration) | Migration adds `email TEXT`. Edge function reads and stores it. Deploy together. |
| **R6** | Version string desync between `b.html` and `cm1site/b.html` | HIGH | LOW | Single commit bumps both. Run `grep staging b.html cm1site/b.html` before push. |
| **R7** | cm1site/b.html uses relative path for middleman.js | HIGH | LOW | Verify absolute URL in cm1site/b.html after edit. |
| **R8** | Admin button row HTML becomes too wide | LOW | MEDIUM | Add infopack input on a new line below existing row controls. |
| **R9** | Info pack link missing `target="_blank"` — navigates away from page | MEDIUM | MEDIUM | Use `<a href="…" target="_blank" rel="noopener">` — required. |

---

## Build Order (do not reorder)

### Step 1: Admin panel — add infopack_url to each button row

**File**: `assets/js/middle-man-admin.js`

**Read entire file first.**

#### 1a. `buildBtnRowHtml(btn, idx)` — line 998
Add after the existing `effect` select:

```html
<input type="url" class="mma-btn-infopack"
  value="[btn.infopack_url || '']"
  placeholder="Info pack URL (optional)…" />
```

Use `_e(btn.infopack_url || '')` — NEVER `_e(btn.infopack_url)` alone.

#### 1b. `saveButtons()` — line 1218
Add to button object inside `rows.forEach`:

```js
infopack_url: (row.querySelector('.mma-btn-infopack') || { value: '' }).value.trim(),
```

#### Critical test after Step 1 (must pass before continuing):
1. Open admin edit view for **Arcane Fairies**
2. All existing buttons render with empty infopack input
3. Click "Save buttons" without any changes → `✓ Saved` appears
4. Reload edit view — all button data unchanged
5. Verify `infopack_url` is `""` in Supabase DB for Arcane Fairies buttons

No middleman.js change in this step — do NOT bump version strings yet.

---

### Step 2: Middle Man page — success screen info pack link

**Files**: `assets/js/middleman.js`, `b.html`, `cm1site/b.html`

**Read middleman.js in full before touching.**

#### 2a. `buildFormHtml(formType, businessName, btnData)` — line 178
Add optional `btnData` parameter. Change email field condition:

```js
// BEFORE (existing — do not remove this line):
} else if (formType === 'function') {
  inner = … + emailFieldOpt;

// CHANGE TO (additive OR):
if (formType === 'function' || (btnData && btnData.infopack_url)) {
  // show email field in inner
  // use existing label for function type; generic label for other types
}
```

Also move the email payload capture outside the `formType === 'function'` block in `attachFormListeners` so it applies when `btnData.infopack_url` is set on any form type.

#### 2b. `attachFormListeners(…, btnData)` — line 311
Add optional `btnData`. Thread to `handleSuccess`:

```js
.then(function() {
  handleSuccess(formWrap, name, formType, businessName,
    (btnData && btnData.infopack_url) || '');
})
.catch(function() {
  handleSuccess(formWrap, name, formType, businessName,
    (btnData && btnData.infopack_url) || '');
});
```

#### 2c. `handleSuccess(formWrap, name, formType, businessName, infopackUrl)` — line 431
Add optional `infopackUrl`. When truthy:

```js
if (infopackUrl) {
  successEl.innerHTML +=
    '<a class="infopack-link" href="' + esc(infopackUrl) + '"'
    + ' target="_blank" rel="noopener">View Info Pack →</a>';
}

// Suppress 2s auto-close only when info pack is present:
if (!infopackUrl) {
  setTimeout(function() {
    closeForm();
    /* existing cleanup */
  }, 2000);
}
```

#### 2d. `render()` — lines 815 and 817
Pass `btn` as third argument to both calls:

```js
formWrap.innerHTML = buildFormHtml(formType, businessName, btn);
attachFormListeners(formWrap, formType, businessName, display, btnDestUrl, btn);
```

#### 2e. Version string bump
In **both** `b.html` and `cm1site/b.html`, bump `?v=` on the middleman.js script tag.
`cm1site/b.html` — confirm absolute URL for middleman.js (not relative).
Run before committing: `grep "staging" b.html cm1site/b.html` → zero output required.

---

### Step 3: DB migration + edge function

**Files**: new SQL migration, local placeholder, `supabase/functions/submit-middle-man-form/index.ts`

**Read `submit-middle-man-form/index.ts` in full before touching.**

#### 3a. Migration
New file: `supabase/migrations/20260922000001_add_email_to_mmfs.sql`

```sql
-- Add optional email capture to Middle Man form submissions.
-- Written by submit-middle-man-form edge function when customer enters email.
ALTER TABLE public.middle_man_form_submissions
  ADD COLUMN IF NOT EXISTS email TEXT;
```

Create matching local placeholder file (per project convention).

#### 3b. Edge function (`submit-middle-man-form/index.ts`)
After the `companyName` parse (line ~112):

```typescript
const email = typeof body.email === 'string' ? body.email.trim().slice(0, 200) : '';
```

In `insertPayload` block:

```typescript
if (email) insertPayload.email = email;
```

#### 3c. Deploy
Apply migration. Deploy edge function: `supabase functions deploy submit-middle-man-form`.

---

### Step 4: End-to-end test on Arcane Fairies

**All must pass before marking complete:**

1. **Arcane Fairies regression — no info pack configured**
   - Open `cm1.au/arcane-fairies` on a real device
   - Logo visible, all buttons on screen, layout unchanged
   - Open any form, submit → success screen auto-closes after 2 seconds
   - No "View Info Pack" link appears

2. **Admin Save buttons regression**
   - Open admin for Arcane Fairies, click "Save buttons" without changes
   - `✓ Saved` appears; reload — all data unchanged

3. **Info pack round-trip (test client)**
   - Admin: paste a URL in infopack_url for one button, Save
   - Reload admin — URL persists
   - Open live page, submit that button's form
   - Success screen shows "View Info Pack →" link
   - Link opens in new tab
   - Form does NOT auto-close after 2 seconds
   - X button closes form

4. **Staging grep check** — zero output required:
   ```bash
   grep "staging" b.html cm1site/b.html
   ```

---

## Project Structure

### Documentation

```text
specs/002-function-package-email/
├── plan.md         ← this file
├── research.md     ← Phase 0 decisions
├── data-model.md   ← Entity shapes
├── contracts/
│   ├── save-buttons.md
│   └── submit-form.md
├── quickstart.md   ← E2E validation guide
└── tasks.md        ← created by /speckit-tasks (this command)
```

### Source files that change

```text
assets/js/
├── middle-man-admin.js   Step 1
└── middleman.js          Step 2

b.html                    Step 2e (version bump)
cm1site/b.html            Step 2e (version bump, absolute URL)

supabase/
├── migrations/
│   └── 20260922000001_add_email_to_mmfs.sql   Step 3a
└── functions/
    └── submit-middle-man-form/index.ts         Step 3b
```

---

## Rules (enforced on every edit)

- Read every file before touching it
- `saveButtons()` is critical — test it after every change to button row HTML
- middleman.js success screen changes are purely additive — if `infopack_url` not set, behaviour identical to today
- JSONB button objects — new fields optional; absence handled gracefully everywhere
- No changes to SMS flow, Twilio, Stripe, missed call flow, or any unrelated edge functions
- After every migration — create matching local placeholder file
- Version strings bumped in both `b.html` and `cm1site/b.html` on every JS or CSS change
- `grep staging` check must pass before every commit
- No Short.io
- Column is `middle_man_slug` — never `slug`

---

## Complexity Tracking

No constitution violations. No unrequested abstractions. All four edits are gated behind `infopack_url` being truthy — zero change to existing flows when absent.
