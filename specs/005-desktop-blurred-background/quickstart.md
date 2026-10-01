# Quickstart Validation Guide: Desktop Blurred Background

## Prerequisites

- Changes deployed to production (all commits pushed to `main`, Netlify deploy green)
- Service worker cache cleared on test devices (CACHE_VERSION bump forces iOS refresh)

## Validation Scenarios

### Scenario 1 — Desktop, video background client

1. Open a client with a video background (e.g., Arcane Fairies) in Chrome/Firefox/Safari on a desktop or laptop.
2. Browser window must be wider than 480px.

**Expected**:
- The 430px phone-shaped card is centred on screen.
- Inside the card: the video plays clearly, sharp, clipped to the card's rounded corners.
- Behind the card: the same video plays, blurred and darkened, filling the entire screen.
- The emerald glow placeholder is gone — replaced by real blurred video.
- Both videos play automatically within 5 seconds, without any click or tap.
- All buttons and forms work normally.

---

### Scenario 2 — Desktop, image background client

1. Open a client with a static image background in a desktop browser wider than 480px.

**Expected**:
- Inside the card: image is sharp, clipped to card shape.
- Behind the card: same image blurred and darkened.
- No video clone — only one image request (confirm via DevTools Network tab).

---

### Scenario 3 — Desktop, no-bg client

1. Open a client with no background set in a desktop browser.

**Expected**:
- Dark background fills card and screen.
- No blurred layer or dark overlay behind the card.
- Card content (business name, buttons) displays normally.

---

### Scenario 4 — Mobile regression check

1. Open any Middle Man URL on a physical iPhone (Safari) or Android (Chrome), or narrow browser to ≤480px.

**Expected**:
- Full-screen video/image background exactly as before this feature.
- `#bgCard` and `#bgBlur` receive no content (confirm via DevTools Elements).
- Video autoplays without tap.
- Zero additional network requests.

---

### Scenario 5 — Arcane Fairies reference check (required post-deploy)

Per CLAUDE.md: after every deploy touching middleman files, confirm on a real device:

1. Open `cm1.au/arcane-fairies` on a physical iPhone.
2. Logo fully visible, all 6 buttons on screen, layout unchanged.
3. Video autoplays without tap.
4. Open same URL on desktop Safari — sharp card + blurred background visible.

---

## Debugging Checklist

| Symptom | Likely cause | Check |
|---------|-------------|-------|
| Video not blurred on desktop | CSS not deployed / SW cache stale | Hard-refresh; check middleman.css version in Network tab |
| Card video not playing on desktop | Clone `play()` wiring issue | Check console `[video]` logs; confirm `canplay` fires on clone |
| Mobile layout broken | Base styles leaking to mobile | Both `#bgCard` and `#bgBlur` must be `display:none` in base CSS |
| Emerald glow still visible | `body::before` not removed from media query | Check deployed middleman.css |
| Autoplay broken on iOS | Unrelated to this feature if it worked before — see CLAUDE.md iOS section |
