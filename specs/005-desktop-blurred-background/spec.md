# Feature Specification: Desktop Blurred Background

**Feature Branch**: `005-desktop-blurred-background`

**Created**: 2026-09-25

**Status**: Draft

**Input**: User description: "Feature: Desktop blurred video/image background on Middle Man page. When the Middle Man page is opened on a screen wider than 480px (desktop/laptop), the client's video or background image should appear sharp inside the 430px card, and a blurred copy of the same video/image fills the full screen behind the card. On mobile (480px and below), nothing changes."

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Desktop visitor sees immersive blurred background (Priority: P1)

A visitor opens a client's Middle Man page link on a desktop or laptop browser. The page displays as a 430px phone-shaped card centred on screen. Inside the card the client's video (or image) plays sharp and clear, clipped to the card shape. Behind the card, the same video (or image) fills the entire screen, blurred and darkened, giving an immersive, branded backdrop. The visitor can tap buttons, submit forms, and use all features exactly as before — the visual change is cosmetic only.

**Why this priority**: This is the primary deliverable. Every other story depends on the card + background split being correct first.

**Independent Test**: Open any client Middle Man URL in a browser window wider than 480px. The card appears sharp, the surrounding area is blurred. Can be tested independently with a static image client before video is verified.

**Acceptance Scenarios**:

1. **Given** a desktop browser (>480px wide) and a client with a video background, **When** the page loads, **Then** the video plays sharp inside the 430px card AND a blurred, darkened version of the same video fills the area outside the card.
2. **Given** a desktop browser (>480px wide) and a client with an image background, **When** the page loads, **Then** the image appears sharp inside the card AND blurred behind it.
3. **Given** a desktop browser (>480px wide) and a client with NO background (no-bg mode), **When** the page loads, **Then** the dark solid colour fills the card and the background — no blur layer is shown.
4. **Given** a desktop browser (>480px wide), **When** a visitor opens the page, **Then** the emerald glow placeholder behind the card (from the initial desktop containment commit) is no longer visible — it is replaced by the real blurred media.

---

### User Story 2 — Mobile visitor is completely unaffected (Priority: P1)

A visitor opens the same Middle Man page on a phone. The full-screen video or image background fills the entire viewport exactly as it does today. No blurred layer appears. No extra resources are loaded. The page feels and behaves identically to its pre-feature state.

**Why this priority**: Equal priority to P1 — breaking mobile is unacceptable. The mobile path must be untouched.

**Independent Test**: Open any Middle Man URL on an iPhone or Android phone (or a browser window ≤480px). Compare before/after screenshots — they must be pixel-identical.

**Acceptance Scenarios**:

1. **Given** a mobile device (≤480px viewport), **When** the page loads, **Then** the full-screen video or image background plays as before with no blurred layer or layout change.
2. **Given** a mobile device with an iOS browser, **When** the page loads, **Then** the video autoplays without requiring any user gesture or tap.
3. **Given** a mobile device, **When** the page loads, **Then** no additional network requests are made compared to before this feature was implemented.

---

### User Story 3 — Video autoplays on desktop without user interaction (Priority: P2)

A desktop visitor loads a client with a video background. Both the sharp card video and the blurred background video begin playing automatically without any interaction. The page does not show a play button or ask the user to click to start.

**Why this priority**: Autoplay is critical to the branded experience. A page that shows a static frame or requires interaction fails the client's expectation.

**Independent Test**: Open a video-background Middle Man page in Chrome on Windows or Mac. Both the card and the blurred background should be playing within 5 seconds of page load.

**Acceptance Scenarios**:

1. **Given** a desktop browser and a video-background client, **When** the page finishes loading, **Then** both the card video and the blurred background video are playing within 5 seconds.
2. **Given** a desktop browser, **When** both videos are playing, **Then** they play roughly in sync (exact frame sync is not required).
3. **Given** a desktop browser where autoplay is blocked by browser policy, **When** the video fails to play, **Then** the poster frame or dark background is shown — the page does not show a broken UI state.

---

### Edge Cases

- What happens when the viewport is resized from desktop to mobile mid-session? Assume: the blur layer remains visible until page reload — no live resize handling required.
- What happens when a video fails to load on desktop? The blurred background layer falls back to the poster image or dark colour; the card shows the same fallback.
- What happens when the client has no background at all (no-bg mode)? No blur layer is added; the dark body background fills the screen.
- What happens on a 481px-wide viewport? The blur feature activates at 481px+.
- Does the blurred video loop? Yes — same looping behaviour as the original.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On viewports wider than 480px, a blurred, darkened version of the client's background media (video or image) MUST fill the full screen behind the phone-shaped card.
- **FR-002**: On viewports wider than 480px with a video background, the blurred full-screen layer MUST be a live playing video (not a static frame or screenshot).
- **FR-003**: On viewports wider than 480px, the sharp version of the client's media MUST display inside the 430px card, visually clipped to the card's rounded corners.
- **FR-004**: On viewports 480px wide or narrower, the feature MUST be completely inactive — no additional elements, no additional network requests, no change to layout or behaviour.
- **FR-005**: The blurred background video MUST autoplay without requiring any user gesture on all major desktop browsers (Chrome, Firefox, Safari, Edge).
- **FR-006**: The existing video autoplay behaviour on iOS mobile MUST be preserved exactly — play() must only be called inside a canplay event listener with { once: true }. This rule applies to every video element created by this feature.
- **FR-007**: No video element created by this feature may have its display property set to none at any time.
- **FR-008**: The current emerald glow placeholder (body::before pseudo-element) MUST be removed from the desktop media query, replaced by the real blurred media layer.
- **FR-009**: When the client has no background (no-bg mode), no blur layer is displayed on desktop and the dark background colour fills the screen.
- **FR-010**: The blurred background layer MUST have a dark overlay applied so the card is clearly distinguished from the background.

### Key Entities

- **Sharp media layer**: The client's video or image displayed at full quality, visually confined to the 430px card on desktop.
- **Blurred media layer**: A duplicate of the client's video or image, blurred and darkened, positioned to fill the full desktop viewport behind the card.
- **Desktop breakpoint**: Viewport widths strictly greater than 480px.
- **No-bg mode**: A client configuration where no background media is set; the page uses a plain dark background.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a desktop browser, a visitor can see both the sharp card and the blurred background within 5 seconds of the page URL loading, with no manual interaction.
- **SC-002**: On a mobile device (iOS or Android), the page appearance and behaviour is visually identical to its state before this feature — no visual, functional, or network difference.
- **SC-003**: The blurred background video is playing (not a static image) on desktop within 5 seconds of page load on Chrome, Firefox, and Safari desktop.
- **SC-004**: The feature introduces zero regressions on the Arcane Fairies reference client — logo visible, all buttons on screen, layout unchanged — confirmed on a real device after deploy.
- **SC-005**: On desktop, the card's rounded corners are respected — the sharp media is visually clipped to the card shape with no overflow visible outside the card boundary.

---

## Assumptions

- The desktop breakpoint of 481px matches the existing desktop containment media query and will not be changed by this feature.
- "Blurred" means CSS blur filter and "darkened" means a dark overlay or brightness reduction — exact values are implementation decisions to be tuned in the plan.
- The blurred background video does not need to be frame-perfectly synchronised with the card video — a few seconds of offset is visually acceptable.
- The feature is scoped to the Middle Man page only. No other pages are affected.
- The `#bgFixed` element is a sibling of `#app` in the HTML, not a child. On desktop, `#app`'s overflow clipping does not affect `#bgFixed`. How the sharp-inside-card vs blurred-outside separation is achieved architecturally is a plan-level decision.
- Service worker cache must be bumped alongside the CSS and JS changes to ensure iOS devices receive updated files.
- Image backgrounds do not require a cloned element — a CSS-driven approach using the same URL is sufficient.
