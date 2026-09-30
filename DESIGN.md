# CallMagnet Design System

Visual rules for every interface in CallMagnet. These are locked. Do not deviate.

---

## Colours

| Token | Value | Usage |
|---|---|---|
| Background | `#0E1419` | Middle Man page, PWA dashboard |
| Accent / Emerald | `#10b981` | Buttons, highlights, headings on admin |
| Burnt orange | `#CC5500` | Tiny edges only — never dominant |
| Admin background | `#F5F5F5` | All admin pages |
| Admin card background | `#FFFFFF` | White |
| Admin card border | `1px solid #000000` | Black border on all admin cards |
| Admin heading | `#10b981` | Emerald |
| Admin body text | `#000000` | Black |
| Admin back button | `#CC0000` | Hover: `#AA0000` |

No theme system. All colours hardcoded directly. No CSS variables, no dark/light toggle.

---

## Typography

- Font: System font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)
- No external font imports unless already in use
- Admin headings: `#10b981` emerald
- Admin body: `#000000` black
- Middle Man page: white text on dark background

---

## Admin Pages

- Background: `#F5F5F5`
- Cards: white background, `box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 2px 0 rgba(6,214,160,0.4)`, `border-radius: 10px`, `border: 1px solid #000000`
- No sidebars — admin pages have no left column or tools panel
- No iframes — no admin page loads inside an iframe
- Single column nav only
- Back buttons: `background: #CC0000`, `hover: #AA0000`, always navigate to `/`

---

## Middle Man Page (cm1.au)

- Dark background — video or image fills full viewport
- Buttons: neon glow animation (`breathing` by default), colour configurable per button
- All assets served from `https://callmagnet.com.au/` — absolute URLs only on `cm1site/b.html`
- SMS sent to customers never contains `callmagnet.com.au` — B2B invisibility is absolute
- Video autoplay: `play()` called only inside `canplay` listener with `{ once: true }` — never anywhere else
- Never call `vid.style.display = 'none'` in error handlers

---

## PWA Dashboard (callmagnet.com.au)

- Background: `#0E1419`
- Accent: `#10b981` emerald
- Tile borders: neon colour per button config
- Done state: `#CC2222` red border on submission cards

---

## Rules — Never Break

- No theme system — hardcoded colours only
- SMS never contains `callmagnet.com.au`
- Burnt orange `#CC5500` is accent only — never the dominant colour on any element
- Admin pages never use sidebars, iframes, or multi-column nav
- Back buttons always go to `/` — never to `/admin/`
- Version strings must be bumped in both `b.html` and `cm1site/b.html` on every JS/CSS change
- Run `grep "staging" b.html cm1site/b.html` before every commit — must return zero output
