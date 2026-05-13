// Shared email styling — single source of truth for CallMagnet brand colours
// across every Resend-sending edge function. Matches the locked PWA palette
// (#0E1419 charcoal + #06D6A0 emerald) so emails feel like the same product
// the client logs into.
//
// LOCKED PALETTE — ONLY 7 colours used anywhere in emails:
//   #0E1419  background (charcoal-navy)
//   #06D6A0  accent (jewel emerald)
//   #CC5500  edge highlight (burnt orange — tiny edges/borders only, never fills)
//   #FFFFFF  primary text on dark bg
//   #B0B8C1  secondary text
//   #6B7480  tertiary/muted text
//   #161D24  card/tile bg (one shade lighter than main bg, for depth)
//   rgba(6, 214, 160, 0.15)  faint emerald-glow border
//
// Do NOT add new hex values. Future colour changes are one-file edits here.

export const BRAND = {
  accent:         '#06D6A0',                                                   // emerald accent — buttons, links, headings
  accentHover:    '#06D6A0',                                                   // same colour, no separate hover hue
  pageBackground: '#0E1419',                                                   // outer body background
  cardBackground: '#161D24',                                                   // inner card background
  primaryText:    '#FFFFFF',                                                   // body text on dark
  secondaryText:  '#B0B8C1',                                                   // softer body text
  mutedText:      '#6B7480',                                                   // footer / fine print
  borderColor:    'rgba(6, 214, 160, 0.15)',                                   // faint emerald border
  edge:           '#CC5500',                                                   // burnt orange edge (errors, warnings — tiny borders only)
  successBg:      '#161D24',                                                   // card-shade panel for highlighted content
  errorBg:        '#161D24',                                                   // same card shade; differentiation via border colour
  errorText:      '#FFFFFF',                                                   // white text on dark
  errorBorder:    '#CC5500',                                                   // burnt orange border on error blocks
  fontStack:      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
} as const;

// Wraps body content in a CallMagnet-branded HTML email shell. Mobile-
// responsive table layout (Outlook needs tables; mobile shrinks padding via
// the @media block in <style>). All styles are inline on the table cells
// because Gmail strips <style> blocks above the body in some clients —
// the <style> here only carries the @media query, which most clients honour.
//
// content   — HTML string for the body (caller's responsibility to build)
// preheader — optional ~80-char inbox preview text shown next to the subject
//             in most inbox lists. Hidden in the rendered email.
export function renderEmailShell(content: string, preheader?: string): string {
  const preheaderBlock = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:transparent;">${escapeHtml(preheader)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>CallMagnet</title>
  <style>
    @media only screen and (max-width: 480px) {
      .em-card { padding: 28px 22px !important; }
      .em-heading { font-size: 22px !important; }
      .em-bigstat { font-size: 40px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${BRAND.pageBackground};-webkit-text-size-adjust:100%;">
  ${preheaderBlock}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.pageBackground};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${BRAND.cardBackground};border:1px solid ${BRAND.borderColor};border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.35);">
          <tr>
            <td class="em-card" style="padding:40px 36px;font-family:${BRAND.fontStack};color:${BRAND.primaryText};">
              <div style="font-family:ui-monospace, SFMono-Regular, 'DM Mono', monospace;font-size:14px;letter-spacing:0.16em;color:${BRAND.accent};text-transform:uppercase;font-weight:700;margin-bottom:28px;">
                ★ CallMagnet
              </div>
              ${content}
              <div style="margin-top:40px;padding-top:24px;border-top:1px solid ${BRAND.borderColor};font-size:12px;color:${BRAND.mutedText};text-align:center;font-family:${BRAND.fontStack};">
                <a href="https://callmagnet.com.au" style="color:${BRAND.mutedText};text-decoration:none;">callmagnet.com.au</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// HTML-escape a string for safe interpolation into the email body.
// Use this for any value that could come from the database (business name,
// customer name, error messages, etc.).
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
