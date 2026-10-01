# Data Model: Desktop Blurred Background

No new data entities. No database changes. No new Supabase tables, columns, or edge functions.

## New DOM Elements

| Element | Tag | Parent | Role |
|---------|-----|--------|------|
| `#bgBlur` | `<div>` | `<body>` (before `#bgFixed`) | Dark semi-transparent overlay on desktop. No content. Hidden on mobile. |
| `#bgCard` | `<div>` | `#app` (first child) | Sharp media container inside the card. Receives video clone or background-image on desktop. Hidden on mobile. |

## Existing DOM Elements — Desktop Behaviour Change

| Element | Existing role | Desktop change |
|---------|--------------|----------------|
| `#bgFixed` | Full-screen video/image background | Gains `filter: blur(20px) brightness(0.4)` on desktop — becomes blurred wallpaper |
| `#app` | App shell | No structural change — existing `overflow:hidden` and `border-radius:24px` clip `#bgCard` contents |

## Runtime State (JS)

| Variable | Type | Scope | Purpose |
|----------|------|-------|---------|
| `isDesktop` | boolean | `render()` | `window.innerWidth > 480` — gates all desktop-only code paths |
| `bgCard` | HTMLElement | `render()` | Reference to `#bgCard` for appending clone or setting background-image |
| `clone` | HTMLVideoElement | video branch only | Cloned from `vid` after full configuration; appended to `#bgCard` on desktop |
