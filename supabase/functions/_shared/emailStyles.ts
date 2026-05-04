// Shared email styling — single source of truth for CallMagnet brand colours
// across every Resend-sending edge function. Match the login screen palette
// (#3ECF8E accent on #F7F7F5 page bg) so emails feel like the same product
// the client logs into.
//
// Future colour changes are one-file edits here; callers should never
// hardcode brand hex values.

export const BRAND = {
  accent:         '#3ECF8E',                                                   // login green
  accentHover:    '#2EB87A',                                                   // darker shade for borders/hover
  pageBackground: '#F7F7F5',                                                   // login page background
  cardBackground: '#FFFFFF',                                                   // login card background
  primaryText:    '#111111',
  secondaryText:  '#666666',
  mutedText:      '#888888',
  borderColor:    '#DDDDDD',
  successBg:      '#F0F4FF',                                                   // success message bg from login
  errorBg:        '#FFF0F0',
  errorText:      '#CC0000',
  errorBorder:    '#FF4D4D',
  fontStack:      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
} as const;

// Wraps body content in a CallMagnet-branded HTML email shell. Mobile-
// responsive table layout (Outlook needs tables; mobile shrinks padding via
// the @media block in <style>). All styles are inline on the table cells
// because Gmail strips <style> blocks above the body in some clients —
// the <style> here only carries the @media query, which most clients honour.
//
// Verified renderable in Gmail web (Chrome) and Apple Mail iOS at the time
// of writing. Outlook desktop would also render but isn't part of the test
// matrix today.
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
<body style="margin:0;padding:0;background:${BRAND.pageBackground};">
  ${preheaderBlock}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.pageBackground};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${BRAND.cardBackground};border:1px solid ${BRAND.borderColor};border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
          <tr>
            <td class="em-card" style="padding:40px 36px;font-family:${BRAND.fontStack};color:${BRAND.primaryText};">
              <div style="font-family:'DM Mono', ui-monospace, SFMono-Regular, monospace;font-size:18px;letter-spacing:0.15em;color:${BRAND.accent};text-transform:uppercase;font-weight:700;margin-bottom:32px;">
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
