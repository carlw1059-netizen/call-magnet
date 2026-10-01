# Implementation Plan: Desktop Blurred Background

**Branch**: `005-desktop-blurred-background` | **Date**: 2026-09-25 | **Spec**: [spec.md](spec.md)

---

## Summary

On desktop viewports (>480px), the Middle Man page shows the client's video or image sharp inside the 430px card, with the same media blurred full-screen behind the card. On mobile (≤480px), nothing changes. Approach: CSS `filter: blur` on `#bgFixed` provides the blurred wallpaper at zero JS cost; a new `#bgCard` div inside `#app` holds a sharp video clone (or sharp image copy), clipped by `#app`'s existing `overflow: hidden` and `border-radius`; a new `#bgBlur` div provides a dark semi-transparent overlay between the blurred wallpaper and the card.

---

## Technical Context

**Language/Version**: Vanilla JavaScript (ES5-compatible), CSS3 — no transpile, no build step

**Primary Dependencies**: None — no new libraries. Existing `middleman.js` and `middleman.css` extended in place.

**Storage**: N/A

**Testing**: Manual visual verification on desktop browser + real iOS device (Arcane Fairies reference client)

**Target Platform**: Web browsers. Feature activates at >480px; mobile path (≤480px) is untouched.

**Constraints**:
- `play()` MUST only be called inside `canplay` with `{ once: true }` — on every video element including the clone
- `vid.style.display = 'none'` is forbidden on any video element at any time
- Clone created only when `window.innerWidth > 480`
- Both `b.html` and `cm1site/b.html` receive identical changes and version bumps in the same commit
- `service-worker.js` `CACHE_VERSION` must be bumped
- Arcane Fairies confirmed on real device after deploy

---

## Constitution Check

Constitution is a placeholder template — no active principles. No gates.

---

## Architecture

### DOM layout after this feature

```
body
├── #bgFixed       existing · position:fixed · z-index:0 · original video/image
│                  Desktop: CSS adds filter:blur(20px) brightness(0.4) → blurred wallpaper
│                  Mobile: unchanged
├── #bgBlur        NEW · position:fixed · z-index:2 · dark overlay rgba(0,0,0,0.55)
│                  Desktop: display:block · darkens wallpaper, makes card pop
│                  Mobile: display:none
│                  No-bg: hidden (JS adds class to body; CSS hides #bgBlur)
├── #bgOverlay     existing · position:fixed · z-index:3 · gradient fade · unchanged
└── #app           existing · 430px card on desktop · full-screen on mobile
    ├── #bgCard    NEW · position:absolute · inset:0 · z-index:0 · sharp media inside card
    │              Desktop video: JS appends sharp clone here (clipped by #app overflow:hidden)
    │              Desktop image: JS sets background-image directly
    │              Mobile: display:none · never receives content
    ├── #tapCatcher
    ├── #skeleton
    └── #mainPage
```

### Why `#bgFixed` is the blur layer (not a second clone)

`#bgFixed` already holds the original video with the correct `canplay`/`play()` wiring. CSS `filter: blur(20px)` in a media query blurs it at zero JS cost. A second full-screen video clone would double network bandwidth and add an extra autoplay chain.

### Why a clone is still needed for `#bgCard`

`#bgFixed` is a DOM sibling of `#app`. On desktop, `#app` has `overflow: hidden; border-radius: 24px` but this does not clip siblings — only children. The sharp video must be a child of `#app` to be card-clipped. Hence one clone is created and appended to `#bgCard` (inside `#app`).

### Clone safety (CLAUDE.md rules — non-negotiable)

1. Clone is created after all `vid` attributes are set and all listeners are wired, but BEFORE `bgFixed.appendChild(vid)` and `vid.load()`.
2. Clone gets its own `canplay` listener with `{ once: true }` calling `clone.play()`.
3. `clone.load()` is called after both `bgFixed.appendChild(vid)` and `vid.load()`.
4. `clone.style.display` is NEVER set to `'none'`.
5. `cloneNode(true)` inherits all attributes: `muted`, `playsinline`, `webkit-playsinline`, `autoplay`, `loop`, `preload`, `poster`, `source`.

---

## Project Structure

### Source files changed

```
b.html                    add #bgBlur + #bgCard; version bumps for middleman.css and middleman.js
cm1site/b.html            identical changes
assets/css/middleman.css  #bgBlur/#bgCard base styles; desktop media query additions; remove body::before
assets/js/middleman.js    desktop detection; clone for video; background-image for image
service-worker.js         CACHE_VERSION bump
```

---

## Phase 0: Research

All decisions resolved from prior codebase analysis and CLAUDE.md — no external research needed.

| Question | Decision | Rationale |
|----------|----------|-----------|
| How to blur the background? | CSS `filter: blur(20px) brightness(0.4)` on `#bgFixed` via desktop media query | Zero JS, zero extra clone, zero extra bandwidth |
| How to get sharp video inside card? | Clone `vid`, append to `#bgCard` (child of `#app`) | `#bgFixed` is a sibling — only a child can be clipped by `overflow:hidden` |
| When to clone? | After all `vid` attrs set and listeners wired; before `bgFixed.appendChild` and `vid.load()` | CLAUDE.md autoplay sequence — clone must be ready before original loads |
| How to call `play()` on clone? | Inside its own `canplay` listener with `{ once: true }` | CLAUDE.md mandatory rule |
| Does `#bgBlur` hold a video? | No — dark overlay div only (`background: rgba(0,0,0,0.55)`) | Separates concerns: CSS handles blur, overlay div handles darkness |
| Image backgrounds on desktop? | JS sets `bgCard.style.backgroundImage/Size/Position` directly from `bgUrl` | No clone needed — image via CSS property |
| No-bg on desktop? | JS adds class to body; CSS hides `#bgBlur` for that class | No blur/overlay should show when client has no background |
| Replace `body::before` glow? | Remove from desktop media query (FR-008) | Real blurred media replaces the placeholder glow |
| Cache busting? | Bump `CACHE_VERSION` in `service-worker.js`; bump middleman.css + middleman.js version strings in both HTML files | iOS SW caches aggressively (documented in CLAUDE.md) |

---

## Phase 1: Design

### CSS changes — `assets/css/middleman.css`

**Base styles (mobile-first, apply on all viewports):**

```
#bgBlur:
  display: none (hidden on mobile)

#bgCard:
  display: none (hidden on mobile)
  position: absolute
  inset: 0
  z-index: 0
  background-size: cover
  background-position: center top
  overflow: hidden
```

**Desktop media query additions (`@media (min-width: 481px)`):**

```
Remove:  body::before { ... }    ← the emerald glow placeholder (FR-008)

Add:
  #bgFixed:
    filter: blur(20px) brightness(0.4)

  #bgBlur:
    display: block
    position: fixed
    inset: 0
    z-index: 2
    background: rgba(0,0,0,0.55)
    pointer-events: none

  #bgCard:
    display: block

  #bgCard video:
    position: absolute
    inset: 0
    width: 100%
    height: 100%
    object-fit: cover
```

**No-bg suppression:**
```
  body.no-bg-desktop #bgBlur:
    display: none
```

### JS changes — `assets/js/middleman.js`

**Desktop detection variable** (set once at start of `render()` or at the top of the background block):
```
var isDesktop = window.innerWidth > 480;
var bgCard = document.getElementById('bgCard');
```

**Video branch additions** (after all `vid` attributes set, listeners wired, BEFORE `bgFixed.appendChild(vid)`):
```
If isDesktop:
  1. clone = vid.cloneNode(true)
  2. Wire clone's own canplay listener with { once: true } → clone.play().catch(...)
  3. Do NOT set clone.style.display = 'none' ever
  4. bgFixed.appendChild(vid); vid.load()  ← existing lines unchanged
  5. bgCard.appendChild(clone); clone.load()
```

**Image branch additions** (inside the `img.onload` callback, after bgFixed.style.backgroundImage is set):
```
If isDesktop:
  bgCard.style.backgroundImage = bgFixed.style.backgroundImage
  bgCard.style.backgroundSize = 'cover'
  bgCard.style.backgroundPosition = 'center top'
```

**No-bg branch additions**:
```
document.body.classList.add('no-bg-desktop')
```
(Only on desktop: wrap in `if (isDesktop)`)

### HTML changes — `b.html` and `cm1site/b.html`

**Before `#bgFixed`** (after the notch cover div):
```html
<div id="bgBlur"></div>
```

**First child of `#app`** (before `#tapCatcher`):
```html
<div id="bgCard"></div>
```

**Version bumps**: `middleman.css?v=` and `middleman.js?v=` both incremented in both files.

### `service-worker.js`

Increment `CACHE_VERSION` constant by 1.

---

## Commit sequence

1. **CSS commit**: `assets/css/middleman.css` only — add base styles for `#bgBlur` and `#bgCard`, add desktop media query additions, remove `body::before`. Bump middleman.css version in both HTML files. Commit: `"feat: add #bgCard and #bgBlur CSS for desktop blurred background"`.

2. **JS commit**: `assets/js/middleman.js` only — desktop detection, video clone, image branch, no-bg class. Bump middleman.js version in both HTML files. Commit: `"feat: create sharp video clone and image fallback for desktop card background"`.

3. **HTML + SW commit**: `b.html`, `cm1site/b.html` (add divs), `service-worker.js` (CACHE_VERSION bump). Commit: `"feat: add #bgBlur and #bgCard DOM elements; bump SW cache version"`.

> Note: Per CLAUDE.md — never CSS and JS in the same commit. Version strings in both HTML files must be bumped in the same commit as the file they reference.
