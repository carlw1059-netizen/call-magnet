# Tasks: Desktop Blurred Background

**Input**: Design documents from `specs/005-desktop-blurred-background/`

**Organization**: Grouped by user story. No tests requested — implementation tasks only.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- Every commit ends with `git push origin main`
- Version string bumps travel with the file they reference, in the same commit

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add new DOM elements to both HTML files before CSS or JS can target them.

- [ ] T001 Add `<div id="bgBlur"></div>` immediately before `<div id="bgFixed">` in `b.html` and `cm1site/b.html`. Add `<div id="bgCard"></div>` as the first child of `<div id="app">` (before `<div id="tapCatcher">`) in both files. Do not bump any version strings in this commit. Commit message: `"feat: add #bgBlur and #bgCard DOM elements"`. Run: `git add -f b.html cm1site/b.html && git commit && git push origin main`.

**Checkpoint**: Both HTML files have `#bgBlur` (before `#bgFixed`) and `#bgCard` (first child of `#app`). Page still works identically — both new divs are unstyled and invisible.

---

## Phase 3: User Story 1 — Desktop visitor sees immersive blurred background (P1)

**Goal**: CSS lays the full desktop split. Blurred wallpaper behind the card, dark overlay above it, sharp container inside the card. Mobile gets `display:none` on both new elements, simultaneously satisfying US2.

**Independent Test**: Open any Middle Man client in a desktop browser >480px. `#bgFixed` shows blurred full-screen background. `#bgCard` is positioned inside the card but empty. Emerald `body::before` glow is gone. Mobile at ≤480px: identical to before.

### Implementation

- [ ] T002 [US1] Edit `assets/css/middleman.css`:

  **Base styles** (add before the `@media (min-width: 481px)` block):
  - `#bgBlur { display: none; }` — hidden on mobile
  - `#bgCard { display: none; position: absolute; inset: 0; z-index: 0; background-size: cover; background-position: center top; overflow: hidden; }` — hidden on mobile

  **Inside the existing `@media (min-width: 481px)` block**:
  - Remove the entire `body::before { ... }` rule block (the emerald glow placeholder — FR-008)
  - Add to `#bgFixed`: `filter: blur(20px) brightness(0.4);`
  - Add: `#bgBlur { display: block; position: fixed; inset: 0; z-index: 2; background: rgba(0,0,0,0.55); pointer-events: none; }`
  - Add: `#bgCard { display: block; }`
  - Add: `#bgCard video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }`
  - Add: `body.no-bg-desktop #bgBlur { display: none; }` — suppresses overlay when client has no background

  **Bump `middleman.css` version string** in both `b.html` and `cm1site/b.html` (increment the `?v=` suffix by one letter).

  Commit: `"feat: add #bgCard and #bgBlur CSS, blur #bgFixed on desktop, remove body::before glow"`. Run: `git add -f assets/css/middleman.css b.html cm1site/b.html && git commit && git push origin main`.

**Checkpoint**: Desktop shows blurred wallpaper + dark overlay. `#bgCard` inside card is empty but positioned. Mobile is pixel-identical to before. `body::before` glow is gone.

---

## Phase 4: User Story 3 — Video autoplays on desktop without user interaction (P2)

**Goal**: JS creates the sharp video clone inside `#bgCard`, handles image and no-bg cases on desktop. Completes US1 (sharp card content visible). Delivers US3 (desktop autoplay).

**Independent Test**: Desktop video client — sharp card video plays in `#bgCard`, blurred wallpaper plays in `#bgFixed`, both within 5 seconds, no click needed. Desktop image client — sharp image in card, blurred behind. Mobile — `#bgCard` empty, no extra network requests.

### Implementation

- [ ] T003 [US3] Edit `assets/js/middleman.js` — in the `render()` function, in the background setup block (around line 588, after `var bgFixed = document.getElementById('bgFixed')`):

  **Add at top of background setup block**:
  - `var isDesktop = window.innerWidth > 480;`
  - `var bgCard = document.getElementById('bgCard');`

  **In the video branch** (`if (bgUrl && bgType === 'video')`), after all diagnostic listeners AND after the canonical `canplay` play listener with `{ once: true }` (the one at line 674–685) — but BEFORE `bgFixed.appendChild(vid)` and `vid.load()`:

  Add a desktop-only block:
  ```
  if (isDesktop) {
    var clone = vid.cloneNode(true);
    clone.addEventListener('canplay', function() {
      clone.play().catch(function(err) {
        console.warn('[clone] play() blocked after canplay:', err.name);
      });
    }, { once: true });
    // Do NOT set clone.style.display to anything
  }
  ```

  Then the existing lines unchanged:
  - `bgFixed.appendChild(vid); vid.load();`

  After those, add:
  ```
  if (isDesktop) {
    bgCard.appendChild(clone);
    clone.load();
  }
  ```

  **In the image branch** (`else if (bgUrl)`), inside `img.onload`, after `bgFixed.style.backgroundImage` is set:
  ```
  if (isDesktop) {
    bgCard.style.backgroundImage = bgFixed.style.backgroundImage;
    bgCard.style.backgroundSize = 'cover';
    bgCard.style.backgroundPosition = 'center top';
  }
  ```

  **In the no-background branch** (`else`), after existing lines:
  ```
  if (isDesktop) { document.body.classList.add('no-bg-desktop'); }
  ```

  **Bump `middleman.js` version string** in both `b.html` and `cm1site/b.html` (increment the `?v=` suffix by one letter).

  Commit: `"feat: desktop video clone and image background for #bgCard sharp layer"`. Run: `git add -f assets/js/middleman.js b.html cm1site/b.html && git commit && git push origin main`.

**Checkpoint**: Desktop video client — sharp card video in `#bgCard`, blurred wallpaper in `#bgFixed`, both autoplay. Desktop image client — sharp image in card. Mobile iPhone — video autoplays exactly as before, `#bgCard` is empty, no new requests.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T004 Increment `CACHE_VERSION` by 1 in `service-worker.js`. Commit: `"fix: bump SW cache version for desktop blur feature"`. Run: `git add service-worker.js && git commit && git push origin main`.

- [ ] T005 Visual validation per `quickstart.md` — open Arcane Fairies on a real iPhone: logo visible, all 6 buttons on screen, video autoplays without tap. Open same URL on a desktop browser: sharp card + blurred dragon background visible. Confirm both pass before marking feature complete.

---

## Dependencies & Execution Order

```
T001 (HTML structure)
  └─→ T002 (CSS — depends on #bgBlur and #bgCard existing in DOM)
        └─→ T003 (JS — depends on CSS base styles hiding elements on mobile)
              └─→ T004 (SW cache bust)
                    └─→ T005 (visual validation)
```

All tasks are strictly sequential.

### User story coverage

- **US1** (desktop blurred view): T002 delivers blurred wallpaper; T003 completes it with sharp card content.
- **US2** (mobile unaffected): Fully covered by T002 — `display:none` base styles ensure zero mobile impact.
- **US3** (video autoplays on desktop): Fully covered by T003 — clone's `canplay { once: true }` listener.

---

## Critical constraints (never deviate)

- `play()` only inside `canplay { once: true }` — applies to both `vid` and `clone`
- `clone.style.display = 'none'` is forbidden at all times
- `b.html` and `cm1site/b.html` always change together in the same commit
- Version string bumps travel with their file's commit — never in a separate commit
- Every commit ends with `git push origin main`
- After T004 deploy, wait ~60s for Netlify propagation before testing on iPhone
