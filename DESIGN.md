---
version: 1.0
name: CallMagnet-design-system
description: "The Intercept Terminal — a near-black editorial dashboard aesthetic built on DM Mono, breathing neon buttons, and a single emerald primary. Every interactive surface glows alive by default; silence is the exception, not the animation."

colors:
  primary: "#06D6A0"
  on-primary: "#0E1419"
  canvas: "#0E1419"
  surface-1: "#131C22"
  surface-2: "#1A2530"
  surface-3: "#212F3C"
  ink: "#E8F4F0"
  ink-muted: "#7A9E93"
  ink-subtle: "#4A6B60"
  ink-tertiary: "#2E4840"
  hairline: "#1F3028"
  hairline-bright: "#06D6A040"
  glow-primary: "0 0 8px #06D6A0, 0 0 20px #06D6A040"
  glow-primary-breathe: "0 0 6px #06D6A0, 0 0 14px #06D6A060, 0 0 30px #06D6A020"
  glow-danger: "0 0 8px #FF4B6E, 0 0 20px #FF4B6E40"
  semantic-error: "#FF4B6E"
  semantic-success: "#06D6A0"
  semantic-warning: "#F5A623"
  semantic-info: "#4FC3F7"

rounded:
  xs: 2px
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  pill: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 80px

animation:
  breathe: "neon-breathe 2.8s ease-in-out infinite"
  breathe-fast: "neon-breathe 1.6s ease-in-out infinite"
  breathe-slow: "neon-breathe 4s ease-in-out infinite"
  glow-off: "animation: none"
  transition-standard: "all 0.15s ease"
---

## Aesthetic Soul

**The Intercept Terminal.** A near-black editorial surface that reads like a secure ops dashboard crossed with an investigative news publication. Every interactive element breathes neon by default — the glow is the brand's heartbeat, not a reward state. Silence (glow-off) is the exception.

The canvas is `#0E1419` — not pure black, not dark navy. It sits in the liminal zone between the two: deep enough to make emerald pop, warm enough not to feel cold. Cards step up by lightening exactly one surface level at a time (`surface-1`, `surface-2`, `surface-3`). No drop shadows — depth comes from the surface stack and the glow.

DM Mono carries everything. No serif, no humanist sans. The monospace grid reinforces the terminal metaphor: data-dense, precise, scannable. Letter-spacing is tight on display, neutral on body.

---

## Typography

```
fontFamily: "DM Mono", ui-monospace, monospace
```

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| display-xl | 48px | 500 | 1.05 | -1.5px | Hero headline |
| display-lg | 36px | 500 | 1.08 | -1.0px | Section opener |
| display-md | 28px | 500 | 1.12 | -0.6px | Card headline |
| headline | 22px | 500 | 1.20 | -0.3px | Panel title |
| subhead | 18px | 400 | 1.35 | -0.1px | Sub-label, lead body |
| body | 15px | 400 | 1.55 | 0 | Default body |
| body-sm | 13px | 400 | 1.50 | 0 | Card meta, secondary |
| caption | 11px | 400 | 1.40 | 0.4px | Footnotes, timestamps |
| label | 11px | 500 | 1.30 | 1.2px | ALL-CAPS section labels |
| button | 13px | 500 | 1.20 | 0.6px | Button labels (ALL-CAPS) |
| mono-data | 14px | 400 | 1.45 | 0 | Numeric data, stats |

**Principles:**
- ALL-CAPS on button labels and section eyebrows — the terminal aesthetic demands it.
- Positive letter-spacing on `label` and `button` reinforces the uppercase legibility.
- Negative tracking on display only — body stays neutral.
- Weight 500 = confident, not heavy. Never bold in the traditional sense.

---

## Layout

**Base unit:** 4px. Spacing tokens in front matter.

**Grid:**
- Dashboard: 12-column fluid, 24px gutter, max 1440px.
- Admin panels: single-column, max 720px centered.
- Marketing: 12-column, 32px gutter, max 1280px.

**Section rhythm:** `{spacing.section}` 80px between major sections.

**Card padding:** `{spacing.lg}` 24px standard; `{spacing.md}` 16px for compact data cards.

---

## Components

### Buttons

All buttons have breathing neon glow by **default** — `animation: neon-breathe 2.8s ease-in-out infinite`. Glow-off class stops animation: `.glow-off { animation: none }`. Form-open kill switch: `.form-open .btn { animation: none !important }`.

**button-primary** — Emerald filled CTA.
- Background `{colors.primary}` #06D6A0, text `{colors.on-primary}` #0E1419, type `{typography.button}`, rounded `{rounded.md}`, padding 10px 20px.
- Box-shadow: `{glow-primary-breathe}` by default.

**button-secondary** — Ghost CTA.
- Background transparent, border 1px `{colors.primary}`, text `{colors.primary}`, type `{typography.button}`, rounded `{rounded.md}`, padding 10px 20px.
- Box-shadow: `{glow-primary}` on hover; none at rest.

**button-danger** — Destructive action.
- Background transparent, border 1px `{colors.semantic-error}`, text `{colors.semantic-error}`, box-shadow `{glow-danger}` on hover.

**button-ghost** — Low-emphasis action.
- Background transparent, no border, text `{colors.ink-muted}`. No glow.

### Cards

**data-card** — Primary dashboard tile.
- Background `{colors.surface-1}` #131C22, border 1px `{colors.hairline}`, rounded `{rounded.lg}`, padding `{spacing.lg}`.
- On hover: border-color `{colors.hairline-bright}`, subtle box-shadow `{glow-primary-breathe}` at low opacity.

**stat-tile** — Single metric display.
- Background `{colors.surface-2}`, border 1px `{colors.hairline}`, rounded `{rounded.md}`, padding `{spacing.md}`.
- Metric value: `{typography.display-md}`, color `{colors.primary}`.
- Label: `{typography.label}` ALL-CAPS, color `{colors.ink-muted}`.

**panel** — Full-height side panel.
- Background `{colors.surface-1}`, border-left 1px `{colors.hairline}`, no rounded on panel edges.

**alert-card** — Inline alert / notification.
- Left border 3px `{colors.semantic-error|warning|success}`, background `{colors.surface-2}`, rounded `{rounded.md}`, padding `{spacing.md}`.

### Inputs

**text-input** — Standard form field.
- Background `{colors.surface-2}`, border 1px `{colors.hairline}`, text `{colors.ink}`, type `{typography.body}`, rounded `{rounded.md}`, padding 10px 14px.
- Focus: border-color `{colors.primary}`, box-shadow `0 0 0 2px #06D6A030`.

**text-input-error:**
- Border-color `{colors.semantic-error}`, box-shadow `0 0 0 2px #FF4B6E20`.

### Navigation

**top-nav:**
- Background `{colors.canvas}`, border-bottom 1px `{colors.hairline}`, height 56px.
- Logo: DM Mono 500 14px, `{colors.primary}` green, ALL-CAPS `CALLMAGNET`.
- Links: `{typography.label}`, `{colors.ink-muted}`, active state `{colors.primary}`.

**sidebar:**
- Background `{colors.surface-1}`, border-right 1px `{colors.hairline}`, width 220px.
- Nav items: `{typography.body-sm}`, icon + label, active = `{colors.primary}` text + left 2px `{colors.primary}` border.

### Tables

**data-table:**
- Background `{colors.canvas}`, header row `{colors.surface-2}`.
- Header labels: `{typography.label}` ALL-CAPS `{colors.ink-muted}`.
- Cell text: `{typography.body-sm}` `{colors.ink}`.
- Row hover: background `{colors.surface-1}`.
- Row border-bottom: 1px `{colors.hairline}`.

### Status Badges

Pill badges — rounded `{rounded.pill}`, padding 3px 8px, `{typography.caption}` ALL-CAPS.
- Active: background `#06D6A020`, text `{colors.primary}`, border 1px `{colors.primary}`.
- Error: background `#FF4B6E20`, text `{colors.semantic-error}`, border 1px `{colors.semantic-error}`.
- Warning: background `#F5A62320`, text `{colors.semantic-warning}`, border 1px `{colors.semantic-warning}`.
- Muted: background `{colors.surface-2}`, text `{colors.ink-muted}`, border 1px `{colors.hairline}`.

---

## Motion & Animation

### Breathing Neon (core brand motion)

```css
@keyframes neon-breathe {
  0%, 100% {
    box-shadow: 0 0 6px #06D6A0, 0 0 14px #06D6A060, 0 0 30px #06D6A020;
    opacity: 1;
  }
  50% {
    box-shadow: 0 0 10px #06D6A0, 0 0 24px #06D6A080, 0 0 50px #06D6A030;
    opacity: 0.92;
  }
}
```

All `.tap-btn` and `.btn-primary` elements run `neon-breathe 2.8s ease-in-out infinite` by default.

**Kill switches (must always exist, in this order of specificity):**
1. `.tap-btn.glow-off { animation: none }` — per-button opt-out.
2. `.btn-unit.form-open .tap-btn { animation: none !important }` — form-open global kill.

Never remove these kill switches. Never add new animation variants without a matching kill switch.

### Transition Standards

| Interaction | Duration | Easing | Property |
|---|---|---|---|
| Button hover | 150ms | ease | color, border-color, box-shadow |
| Panel slide-in | 220ms | ease-out | transform, opacity |
| Card hover | 150ms | ease | border-color, box-shadow |
| Form focus ring | 100ms | ease | box-shadow |
| Fade in | 200ms | ease | opacity |
| Page cross-fade | 300ms | ease-in-out | opacity |

### Reduced Motion

Always respect `prefers-reduced-motion: reduce`. When active: stop `neon-breathe`, replace transitions with instant swaps.

```css
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
```

---

## Do / Don't

### Do
- Run neon breathing animation on all interactive buttons by default.
- Use `{colors.canvas}` #0E1419 as the system ground — never swap it for pure black or any lighter surface.
- Step depth with the surface stack (`surface-1` → `surface-2` → `surface-3`) not with shadows.
- ALL-CAPS on button labels and section eyebrows.
- DM Mono for every text element — no fallback to a humanist sans.
- Use `{colors.primary}` #06D6A0 as the single accent — no secondary palette colors on chrome.
- Keep glow kill switches in place at all times.

### Don't
- Don't add drop shadows to cards — depth is surface-stack only.
- Don't use white or cream as the page background.
- Don't introduce a second typeface.
- Don't use the semantic colors (error/warning/info) as decorative accents.
- Don't animate glow-off buttons — no breathing on `.glow-off` states.
- Don't use `overflow: hidden` on `.mm-section` or `.mm-grid` — clips tile tops (known bug).
- Don't call `vid.play()` anywhere except inside the `canplay` event listener.
- Don't recreate `admin/index.html` or link to `/admin/`.

---

## Email System Colors

Email templates use a strict subset of the design system. These tokens are locked — do not change without updating `_shared/emailStyles.ts`.

- Background: `#0E1419`
- Card background: `#131C22`
- Left accent strip: `#F5A623` (orange — not emerald)
- Accent / CTA button: `#06D6A0` with `#0E1419` text
- Body text: `#E8F4F0`
- Muted text: `#7A9E93`
- Header wordmark: `★ CallMagnet`
- Footer tagline: `CallMagnet — Pull every customer back.`

Never use `#10b981` in emails. Never use estimated revenue figures in any email.
