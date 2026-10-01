// Standard building blocks for every CallMagnet email.
// Every email = renderEmailShell(...) + these pieces only. No inline one-off styles.
import { BRAND, escapeHtml } from './emailStyles.ts';

const MONO = "ui-monospace, SFMono-Regular, 'DM Mono', monospace";
const F = BRAND.fontStack;

export const ui = {
  h1: (text: string) =>
    `<h1 class="em-heading" style="font-family:${F};font-size:24px;font-weight:700;color:${BRAND.primaryText};margin:0 0 8px;letter-spacing:-0.02em;line-height:1.25;">${text}</h1>`,

  sub: (text: string) =>
    `<p style="font-family:${F};font-size:14px;color:${BRAND.secondaryText};margin:0 0 24px;line-height:1.5;">${text}</p>`,

  p: (text: string) =>
    `<p style="font-family:${F};font-size:15px;color:${BRAND.primaryText};line-height:1.6;margin:0 0 16px;">${text}</p>`,

  small: (text: string) =>
    `<p style="font-family:${F};font-size:13px;color:${BRAND.secondaryText};line-height:1.5;margin:0 0 8px;">${text}</p>`,

  label: (text: string) =>
    `<div style="font-family:${MONO};font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.accent};margin:0 0 14px;">${text}</div>`,

  panel: (inner: string) =>
    `<div style="background:${BRAND.pageBackground};border:1px solid ${BRAND.borderColor};border-radius:10px;padding:20px 24px;margin:0 0 24px;">${inner}</div>`,

  bigStat: (value: string | number, caption: string) =>
    `<div style="text-align:center;padding:4px 0;"><div class="em-bigstat" style="font-family:${F};font-size:44px;font-weight:300;color:${BRAND.accent};letter-spacing:-0.02em;line-height:1;">${value}</div><div style="font-family:${F};font-size:13px;color:${BRAND.secondaryText};margin-top:8px;">${caption}</div></div>`,

  rows: (items: Array<[string, string | number]>) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items.map(([l, v], i) => {
      const top = i === 0 ? '' : `border-top:1px solid ${BRAND.borderColor};`;
      return `<tr><td style="${top}padding:12px 0;font-family:${F};font-size:14px;color:${BRAND.secondaryText};">${l}</td><td style="${top}padding:12px 0;font-family:${F};font-size:15px;font-weight:700;color:${BRAND.accent};text-align:right;">${v}</td></tr>`;
    }).join('')}</table>`,

  steps: (items: string[]) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items.map((s, i) =>
      `<tr><td style="padding:8px 0;vertical-align:top;width:24px;font-family:${F};font-size:14px;font-weight:700;color:${BRAND.accent};">${i + 1}.</td><td style="padding:8px 0;font-family:${F};font-size:14px;color:${BRAND.primaryText};line-height:1.5;">${s}</td></tr>`).join('')}</table>`,

  button: (url: string, text: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px;"><tr><td align="center"><a href="${url}" style="display:inline-block;background:${BRAND.accent};color:${BRAND.pageBackground};padding:14px 32px;border-radius:8px;font-family:${F};font-weight:700;font-size:15px;text-decoration:none;letter-spacing:0.02em;">${text}</a></td></tr></table>`,

  outlineButton: (url: string, text: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px;"><tr><td align="center"><a href="${url}" style="display:inline-block;background:transparent;color:${BRAND.accent};border:1px solid ${BRAND.accent};padding:13px 31px;border-radius:8px;font-family:${F};font-weight:700;font-size:15px;text-decoration:none;letter-spacing:0.02em;">${text}</a></td></tr></table>`,

  contact: () =>
    `<p style="font-family:${F};font-size:13px;color:${BRAND.secondaryText};margin:0;">Questions? Reply to this email or contact <a href="mailto:hello@callmagnet.com.au" style="color:${BRAND.accent};text-decoration:none;">hello@callmagnet.com.au</a></p>`,

  // Internal alerts to Carl — same shell, same pieces.
  alert: (fn: string, summary: string, err: string, nextStep: string) =>
    ui.h1(`⚠️ ${escapeHtml(fn)} failed`) +
    ui.sub(summary) +
    ui.panel(ui.rows([['Function', escapeHtml(fn)], ['Error', escapeHtml(err)], ['Time', new Date().toISOString()]])) +
    ui.small(nextStep),
};
