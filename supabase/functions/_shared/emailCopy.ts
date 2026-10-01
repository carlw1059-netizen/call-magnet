import { createClient } from 'npm:@supabase/supabase-js@2';
import { escapeHtml } from './emailStyles.ts';
import { ui } from './emailUi.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const FALLBACKS: Record<string, { subject: string; body: string; preheader: string }> = {
  welcome_new_user: {
    subject: 'Welcome to CallMagnet — your dashboard is ready',
    body: '<p style="color:#FFFFFF;">Hi {{BUSINESS_NAME}}, your account is ready.</p><p style="color:#FFFFFF;">Email: {{EMAIL}}<br>Password: {{PASSWORD}}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td align="center"><a href="{{DASHBOARD_URL}}" style="display:inline-block;background:#06D6A0;color:#000;padding:14px 32px;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;">Go to my dashboard →</a></td></tr></table>',
    preheader: 'Your CallMagnet dashboard is ready — log in now',
  },
  welcome_existing_user: {
    subject: 'Welcome to CallMagnet — your dashboard is ready',
    body: '<p style="color:#FFFFFF;">Hi {{BUSINESS_NAME}}, your account is ready. Use your existing password to log in.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td align="center"><a href="{{DASHBOARD_URL}}" style="display:inline-block;background:#06D6A0;color:#000;padding:14px 32px;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;">Go to my dashboard →</a></td></tr></table>',
    preheader: 'Your CallMagnet dashboard is ready — log in now',
  },
  payment_received: {
    subject: "Payment received — we're setting up your account",
    body: '<p style="color:#FFFFFF;">Hi {{BUSINESS_NAME}}, payment of ${{AMOUNT}} AUD received. We are setting up your account now.</p>',
    preheader: 'Payment received — we are setting up your account',
  },
  you_are_live: {
    subject: "You're live",
    body: '<p style="color:#FFFFFF;">Hi {{BUSINESS_NAME}}, your CallMagnet system is active.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td align="center"><a href="{{DASHBOARD_URL}}" style="display:inline-block;background:#06D6A0;color:#000;padding:14px 32px;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;">View your dashboard →</a></td></tr></table>',
    preheader: 'Your CallMagnet system is live',
  },
  day_14: {
    subject: 'Two weeks in, {{BUSINESS_NAME}}.',
    body: '<p style="color:#FFFFFF;">Hi {{BUSINESS_NAME}}, two weeks in — {{SMS_COUNT}} missed calls captured.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td align="center"><a href="{{DASHBOARD_URL}}" style="display:inline-block;background:#06D6A0;color:#000;padding:14px 32px;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;">View your dashboard →</a></td></tr></table>',
    preheader: 'Two weeks of CallMagnet',
  },
  day_30: {
    subject: 'Your first month, {{BUSINESS_NAME}}.',
    body: '<p style="color:#FFFFFF;">Hi {{BUSINESS_NAME}}, one month in — {{SMS_COUNT}} missed calls captured.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td align="center"><a href="{{DASHBOARD_URL}}" style="display:inline-block;background:#06D6A0;color:#000;padding:14px 32px;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;">View your dashboard →</a></td></tr></table>',
    preheader: 'Your first month with CallMagnet',
  },
  farewell: {
    subject: 'Thanks for being a CallMagnet client',
    body: '<p style="color:#FFFFFF;">Hi {{BUSINESS_NAME}}, your subscription has ended. Thank you for being with us.</p>',
    preheader: 'Your CallMagnet subscription has ended',
  },
  expiry_warning: {
    subject: 'Your CallMagnet free period ends soon',
    body: '<p style="color:#FFFFFF;">Hi {{BUSINESS_NAME}}, your free period ends on {{END_DATE}}.</p>',
    preheader: 'Your free period is ending soon',
  },
  account_live: {
    subject: 'Your CallMagnet account is now live',
    body: '<p style="color:#FFFFFF;">Hi {{BUSINESS_NAME}}, your account is live.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td align="center"><a href="{{DASHBOARD_URL}}" style="display:inline-block;background:#06D6A0;color:#000;padding:14px 32px;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;">Go to dashboard →</a></td></tr></table>',
    preheader: 'Your CallMagnet account is live',
  },
  login_link: {
    subject: 'Your CallMagnet login link',
    body: '<p style="color:#FFFFFF;">Tap the button below to log in. This link expires in 24 hours.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td align="center"><a href="{{DASHBOARD_URL}}" style="display:inline-block;background:#06D6A0;color:#000;padding:14px 32px;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;">Log in to CallMagnet →</a></td></tr></table>',
    preheader: 'Tap to log in to CallMagnet — link expires in 24 hours',
  },
  error_alert: {
    subject: '⚠️ CallMagnet — {{FUNCTION_NAME}} failed',
    body: '<p style="color:#FFFFFF;"><strong>Function:</strong> {{FUNCTION_NAME}}<br><strong>Error:</strong> {{ERROR_MESSAGE}}<br><strong>Time:</strong> {{TIME}}</p>',
    preheader: '{{FUNCTION_NAME}} errored — check Supabase logs',
  },
  expiry_admin_alert: {
    subject: '[CallMagnet] Free period ending soon — {{BUSINESS_NAME}}',
    body: '<p style="color:#FFFFFF;">{{BUSINESS_NAME}} free period ends on {{END_DATE}}.</p>',
    preheader: '{{BUSINESS_NAME}} free period ends in 3 days',
  },
  sms_usage_alert: {
    subject: '[CallMagnet] SMS usage alert — {{BUSINESS_NAME}}',
    body: '<p style="color:#FFFFFF;">{{BUSINESS_NAME}} has used {{SMS_COUNT}}/{{SMS_INCLUDED}} SMS this month.</p>',
    preheader: '{{BUSINESS_NAME}} approaching SMS limit',
  },
  monthly_report_summary: {
    subject: '[monthly-report] {{PERIOD}}: {{SENT}} sent',
    body: '<p style="color:#FFFFFF;">Monthly report {{PERIOD}}: {{SENT}} sent, {{SKIPPED}} skipped, {{FAILED}} failed.</p>',
    preheader: 'Monthly report complete',
  },
  carl_new_client_alert: {
    subject: 'New client paid — ready to build',
    body: '',
    preheader: 'New client payment received',
  },
};

export interface EmailCopy {
  subject: string;
  body: string;
  preheader: string;
  required_placeholders: string[];
  body_in_code: boolean;
  from_fallback: boolean;
}

export async function getEmailCopy(key: string): Promise<EmailCopy> {
  try {
    const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supa
      .from('email_copy')
      .select('subject, body, preheader, required_placeholders, body_in_code')
      .eq('email_key', key)
      .single();

    if (error || !data) {
      console.error(`getEmailCopy: DB fetch failed for key=${key} — using fallback. Error: ${error?.message}`);
      const fallback = FALLBACKS[key] ?? FALLBACKS['error_alert'];
      return { ...fallback, required_placeholders: [], body_in_code: false, from_fallback: true };
    }

    return {
      subject:               data.subject,
      body:                  data.body,
      preheader:             data.preheader,
      required_placeholders: data.required_placeholders ?? [],
      body_in_code:          data.body_in_code ?? false,
      from_fallback:         false,
    };
  } catch (err) {
    console.error(`getEmailCopy: Exception for key=${key} — using fallback. ${err}`);
    const fallback = FALLBACKS[key] ?? FALLBACKS['error_alert'];
    return { ...fallback, required_placeholders: [], body_in_code: false, from_fallback: true };
  }
}

export function applyPlaceholders(
  template: string,
  vars: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

export async function validatePlaceholders(
  rendered: string,
  required: string[],
  emailKey: string,
): Promise<{ valid: boolean; missing: string[] }> {
  const missing = required.filter(p => rendered.includes(`{{${p}}}`));
  const unreplaced = [...rendered.matchAll(/\{\{[A-Z_]+\}\}/g)].map(m => m[0]);

  if (missing.length > 0 || unreplaced.length > 0) {
    const msg = [
      missing.length > 0 ? `Required missing: ${missing.join(', ')}` : null,
      unreplaced.length > 0 ? `Unreplaced tokens: ${[...new Set(unreplaced)].join(', ')}` : null,
    ].filter(Boolean).join(' | ');
    console.error(`validatePlaceholders: key=${emailKey} — ${msg}`);
    const internalSecret = Deno.env.get('INTERNAL_SECRET');
    if (internalSecret) {
      fetch(`${SUPABASE_URL}/functions/v1/send-pushover-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': internalSecret },
        body: JSON.stringify({ title: '⚠️ Email copy issue', message: `key=${emailKey} — ${msg}` }),
      }).catch(() => {});
    }
  }
  return { valid: missing.length === 0, missing };
}

// ── Plain-word email copy (added 1 Oct 2026) ────────────────────────────────
// Carl edits heading / subheading / body_text / button_label / footnote in the
// email_copy table. The look is locked in code (emailUi.ts). Values filled into
// {{PLACEHOLDERS}} are HTML-escaped; Carl's words are HTML-escaped too, so a
// typo in the table can never break the email layout.

type PlainCopy = {
  subject: string; preheader: string; heading: string; subheading: string;
  body_text: string; button_label: string; footnote: string;
};

const PLAIN_FALLBACKS: Record<string, PlainCopy> = {
  welcome_new_user: { subject: 'Welcome to CallMagnet — your dashboard is ready', preheader: 'Your CallMagnet dashboard is ready — log in now', heading: 'Welcome to CallMagnet, {{BUSINESS_NAME}}.', subheading: 'Your missed-call SMS system is set up and ready to go.', body_text: 'Your Middle Man page is live. When a customer calls and you miss it, they automatically receive an SMS with a link to your page.\n\nLog in to your dashboard to see your activity, customise your buttons, and track every missed call.', button_label: 'Go to my dashboard →', footnote: '' },
  welcome_existing_user: { subject: 'Welcome to CallMagnet — your dashboard is ready', preheader: 'Your CallMagnet dashboard is ready — log in now', heading: 'Welcome to CallMagnet, {{BUSINESS_NAME}}.', subheading: 'Your missed-call SMS system is set up and ready to go.', body_text: 'Your Middle Man page is live. When a customer calls and you miss it, they automatically receive an SMS with a link to your page.\n\nLog in to your dashboard to see your activity, customise your buttons, and track every missed call.\n\nUse your existing email and password to sign in. If you\'ve forgotten your password, tap "Forgot password?" on the login page.', button_label: 'Go to my dashboard →', footnote: '' },
  login_link: { subject: 'Your CallMagnet login link', preheader: 'Tap to log in to CallMagnet. Link expires in 1 hour.', heading: 'Your login link', subheading: 'This link expires in 1 hour for security.', body_text: 'Tap the button below to log in to your CallMagnet dashboard.', button_label: 'Log in to CallMagnet →', footnote: 'If you didn\'t request this link, you can ignore this email.' },
  account_live: { subject: 'Your CallMagnet account is now live', preheader: 'Your CallMagnet account is now live', heading: 'Your account is live, {{BUSINESS_NAME}}.', subheading: 'Your CallMagnet system is active and ready.', body_text: 'Log in to your dashboard to see your activity.', button_label: 'Go to my dashboard →', footnote: '' },
  payment_received: { subject: 'Payment received — we\'re setting up your account', preheader: 'Payment received — we are setting up your account', heading: 'Payment confirmed. We\'re on it.', subheading: '{{BUSINESS_NAME}} — Setup fee', body_text: 'We\'re now setting up your Middle Man page and getting everything ready. We\'ll be in touch shortly with your login details and next steps.', button_label: '', footnote: '' },
  you_are_live: { subject: 'You\'re live, {{BUSINESS_NAME}}.', preheader: 'Your CallMagnet system is live', heading: 'You\'re live, {{BUSINESS_NAME}}.', subheading: 'Your CallMagnet system is active.', body_text: 'From this moment, every missed call to your number triggers an automatic SMS to the caller. Your Middle Man page is live and your dashboard is ready.', button_label: 'View your dashboard →', footnote: '' },
  carl_new_client_alert: { subject: 'New client paid — ready to build', preheader: '{{BUSINESS_NAME}} paid their setup fee', heading: 'New client paid.', subheading: 'Setup fee received — ready to build.', body_text: '', button_label: 'Open admin →', footnote: '' },
  farewell: { subject: 'Your CallMagnet subscription has ended — thanks for being with us', preheader: 'Thanks for being a CallMagnet client, {{BUSINESS_NAME}}.', heading: 'Thanks for trying CallMagnet, {{BUSINESS_NAME}}.', subheading: 'Your subscription has ended. Here\'s a look back at what CallMagnet did for you.', body_text: 'If there\'s anything we could have done better, or if you\'d like to come back, we\'d love to hear from you.', button_label: 'Send us feedback →', footnote: 'Wishing you and {{BUSINESS_NAME}} all the best. 🙏' },
  expiry_warning: { subject: 'Your CallMagnet free period ends in 3 days — {{BUSINESS_NAME}}', preheader: 'Your CallMagnet free period ends on {{END_DATE}}', heading: 'Your free period ends soon, {{BUSINESS_NAME}}', subheading: '3 days to go.', body_text: 'Your CallMagnet free period ends on {{END_DATE}}. After this date your subscription will continue automatically.', button_label: 'View your dashboard →', footnote: '' },
  expiry_admin_alert: { subject: '[CallMagnet] Free period ending soon — {{BUSINESS_NAME}}', preheader: '{{BUSINESS_NAME}} free period ends in 3 days', heading: 'Free period ending — {{BUSINESS_NAME}}', subheading: '3 days from now.', body_text: '', button_label: '', footnote: 'Consider reaching out to confirm their subscription continues.' },
  sms_usage_alert: { subject: '[CallMagnet] SMS usage alert — {{BUSINESS_NAME}} ({{SMS_COUNT}}/{{SMS_INCLUDED}} this month)', preheader: '{{BUSINESS_NAME}} has used {{SMS_COUNT}}/{{SMS_INCLUDED}} SMS this month', heading: 'SMS usage alert — {{BUSINESS_NAME}}', subheading: 'Approaching or at their monthly limit.', body_text: '', button_label: '', footnote: '' },
  weekly_summary: { subject: 'CallMagnet Weekly Summary', preheader: 'Your CallMagnet weekly summary — {{WEEK_LABEL}}', heading: '{{MISSED_CALLS}} people tried to reach {{BUSINESS_NAME}} last week', subheading: 'Week of {{WEEK_LABEL}}', body_text: '', button_label: 'View your dashboard →', footnote: '' },
  weekly_digest: { subject: 'CallMagnet Weekly — {{DATE_RANGE}}', preheader: 'CallMagnet weekly totals', heading: 'CallMagnet Weekly', subheading: '{{DATE_RANGE}}', body_text: '', button_label: '', footnote: '' },
  monthly_recap: { subject: 'Your {{MONTH}} CallMagnet recap', preheader: 'Your {{MONTH}} CallMagnet recap', heading: 'Hi {{BUSINESS_NAME}},', subheading: 'Here\'s how {{MONTH}} went.', body_text: '', button_label: 'View your dashboard →', footnote: '' },
  monthly_report_summary: { subject: '[monthly-report] {{PERIOD}}: {{SENT}} sent, {{SKIPPED}} skipped, {{FAILED}} failed', preheader: 'Monthly report {{PERIOD}}: {{SENT}} sent / {{SKIPPED}} skipped / {{FAILED}} failed', heading: 'Monthly report run — {{PERIOD}}', subheading: '{{SENT}} sent · {{SKIPPED}} skipped · {{FAILED}} failed', body_text: '', button_label: '', footnote: '' },
  error_alert: { subject: '⚠️ CallMagnet — {{FUNCTION_NAME}} failed', preheader: '{{FUNCTION_NAME}} failed', heading: '⚠️ {{FUNCTION_NAME}} failed', subheading: '', body_text: '', button_label: '', footnote: '' },
};

export interface EmailParts {
  subject: string;       // plain text, placeholders filled
  preheader: string;     // plain text, placeholders filled
  top: string;           // HTML: heading + subheading + body paragraphs, in the locked style
  buttonLabel: string;   // plain text; '' means the email has no button
  footnoteHtml: string;  // HTML; '' means none
  fromFallback: boolean; // true if the database could not be read
}

const LEFTOVER = /\{\{[A-Z0-9_]+\}\}/g;

function fillPlain(t: string, vars: Record<string, string>): string {
  let r = t ?? '';
  for (const [k, v] of Object.entries(vars)) r = r.replaceAll(`{{${k}}}`, String(v ?? ''));
  return r;
}

function fillHtml(t: string, vars: Record<string, string>): string {
  let r = escapeHtml(t ?? '');
  for (const [k, v] of Object.entries(vars)) r = r.replaceAll(`{{${k}}}`, escapeHtml(String(v ?? '')));
  return r;
}

export async function getEmailParts(key: string, vars: Record<string, string>): Promise<EmailParts> {
  let row: PlainCopy | null = null;
  let fromFallback = false;
  try {
    const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supa
      .from('email_copy')
      .select('subject, preheader, heading, subheading, body_text, button_label, footnote, in_use')
      .eq('email_key', key)
      .single();
    if (error || !data) throw new Error(error?.message ?? 'no row');
    if (!data.heading || !data.subject) throw new Error('row has empty heading or subject');
    row = data as PlainCopy;
  } catch (err) {
    console.error(`getEmailParts: key=${key} — using fallback copy. ${err}`);
    row = PLAIN_FALLBACKS[key] ?? null;
    fromFallback = true;
  }
  if (!row) throw new Error(`getEmailParts: no copy and no fallback for key=${key}`);

  const paragraphs = (row.body_text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map(s => s.trim())
    .filter(Boolean);

  let subject      = fillPlain(row.subject, vars);
  let preheader    = fillPlain(row.preheader, vars);
  let top =
    ui.h1(fillHtml(row.heading, vars)) +
    (row.subheading ? ui.sub(fillHtml(row.subheading, vars)) : '') +
    paragraphs.map(p => ui.p(fillHtml(p, vars).replace(/\n/g, '<br>'))).join('');
  let buttonLabel  = fillPlain(row.button_label, vars);
  let footnoteHtml = row.footnote ? ui.small(fillHtml(row.footnote, vars)) : '';

  // Any {{TOKEN}} left over = a typo in the table. Alert Carl, then strip it so
  // the client never sees raw braces.
  const all = [subject, preheader, top, buttonLabel, footnoteHtml].join(' ');
  if (LEFTOVER.test(all)) {
    LEFTOVER.lastIndex = 0;
    await validatePlaceholders(all, [], key);
    subject      = subject.replace(LEFTOVER, '');
    preheader    = preheader.replace(LEFTOVER, '');
    top          = top.replace(LEFTOVER, '');
    buttonLabel  = buttonLabel.replace(LEFTOVER, '');
    footnoteHtml = footnoteHtml.replace(LEFTOVER, '');
  }
  LEFTOVER.lastIndex = 0;

  return { subject, preheader, top, buttonLabel, footnoteHtml, fromFallback };
}
