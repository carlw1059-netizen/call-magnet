# Research: Button Info Pack

**Phase 0 output for `/speckit-plan`**

---

## Decision 1: Where does infopack_url live?

**Decision**: Stored inside the existing `clients.middle_man_buttons` JSONB array, as an optional field on each button object.

**Rationale**: No new DB column needed. The button array is already schema-free JSONB. Adding `infopack_url` to a button object is the same pattern as `url`, `emoji`, `color`, `animate`, `sparkles`, `effect`. Absence of the field is already handled gracefully everywhere (callers use `btn.infopack_url || ''`).

**Alternatives considered**: Separate `middle_man_button_infopacks` table (overkill; JSONB already owns button metadata), separate `infopack_url` column on `clients` (not per-button; doesn't support multiple buttons having different info packs).

---

## Decision 2: Where does the info pack button appear — form or success screen?

**Decision**: On the **success screen**, after the customer submits the form. If the tapped button has `infopack_url` set, the success screen shows a "View Info Pack →" link alongside the confirmation message.

**Rationale**: The plan instruction specifies "success screen if infopack_url is set". This is simpler than in-form email-gating, avoids the activate/deactivate logic, and the customer has already identified themselves by submitting.

**Implication for auto-close**: `handleSuccess` currently auto-closes after 2 seconds. When `infopack_url` is present the auto-close must be suppressed so the customer can click the link. The customer closes manually (form close button already exists).

---

## Decision 3: Email field — when to show it?

**Decision**: Email field appears when `formType === 'function'` (existing behaviour, unchanged) OR when the button has `infopack_url` set (new behaviour, additive).

**Rationale**: The `function` form currently shows the email field unconditionally. Removing that condition would be a regression for Arcane Fairies (live client with a function enquiry button that has no `infopack_url` set). Adding a second path (`btn.infopack_url`) is purely additive.

**Label**: Keep existing "Email (receive our functions package)" label for function-type buttons. For other form types where `infopack_url` is set, use "Your email (optional)".

---

## Decision 4: Email storage — migration required?

**Decision**: Yes. A DB migration and edge function update are both required.

**Current state** (confirmed by reading source):
- `middleman.js` line 404: `if (email) payload.email = email;` — email IS sent to the edge function
- `submit-middle-man-form/index.ts` lines 104–112: `email` is NOT read from the body — silently ignored
- `middle_man_form_submissions` table: no `email` column

**Change**: Add `email TEXT` column; read and store email in the edge function when present.

---

## Decision 5: saveButtons preserves infopack_url on existing buttons?

**Decision**: Yes. When `infopack_url` input is empty (for existing buttons), it saves as `''`. Frontend checks `if (btn.infopack_url)` which is falsy. No data is corrupted.

**Critical guard**: Must use `btn.infopack_url || ''` in `buildBtnRowHtml`. Without it, `_e(undefined)` returns the string `"undefined"`, which would be saved as a non-empty value on the next admin save — corrupting existing button data for Arcane Fairies.

---

## Decision 6: Function signature changes in middleman.js

**Decision**: Add optional `btnData` parameter to `buildFormHtml`, `attachFormListeners`, and thread `infopack_url` through as a closure variable to `handleSuccess`.

**Call sites to update** (both in `render()` function, lines 815 and 817):
```
formWrap.innerHTML = buildFormHtml(formType, businessName);       // → add btn
attachFormListeners(formWrap, formType, businessName, display, btnDestUrl); // → add btn
```

---

## Decision 7: No new edge functions, no new libraries, no new services

All changes stay within the existing stack. Only the existing `submit-middle-man-form` edge function is modified.

---

## Files that will change

| File | Change |
|------|--------|
| `assets/js/middle-man-admin.js` | Add infopack_url input to button rows; read in saveButtons |
| `assets/js/middleman.js` | Thread btnData through form chain; success screen info pack link; suppress 2s auto-close when infopack present |
| `b.html` | Bump middleman.js version string |
| `cm1site/b.html` | Bump middleman.js version string (absolute URL) |
| `supabase/migrations/YYYYMMDD_add_email_to_mmfs.sql` | `ADD COLUMN email TEXT` on middle_man_form_submissions |
| Local placeholder file (TBD) | Created alongside migration per project rules |
| `supabase/functions/submit-middle-man-form/index.ts` | Read + store email field |
