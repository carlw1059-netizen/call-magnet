import { createClient } from 'npm:@supabase/supabase-js@2';

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
