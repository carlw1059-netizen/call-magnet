// request-login-link: public edge function. Sends a magic-link to an existing
// user via the channel matching their input (email → email link via Resend,
// phone → SMS link via Twilio helper).
//
// Body (application/json):
//   identifier  string  required  email address OR Australian mobile number
//                                  (04xxxxxxxx, +614xxxxxxxx, or 614xxxxxxxx)
//
// Always returns a generic success message — never leaks whether an account
// exists for the identifier. Specific failure modes logged server-side only.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET           = Deno.env.get('INTERNAL_SECRET');
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GENERIC_OK = { ok: true, message: 'If that account exists, a login link has been sent.' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (new URL(req.url).searchParams.get('warmup') === '1') {
    return new Response(JSON.stringify({ warmup: 'ok' }), {
      status:  200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const body       = await req.json().catch(() => null) as { identifier?: unknown } | null;
    const identifier = typeof body?.identifier === 'string' ? body.identifier.trim() : '';
    if (!identifier) {
      return json(400, { error: 'missing_identifier', detail: 'identifier required' });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const isEmail = identifier.includes('@');
    let email: string | null = null;
    let phone: string | null = null;
    let channel: 'email' | 'sms'   = 'email';

    if (isEmail) {
      email   = identifier.toLowerCase();
      channel = 'email';
    } else {
      // Normalize to E.164 +61
      const digits = identifier.replace(/\D/g, '');
      if (digits.startsWith('61') && digits.length >= 10)            phone = '+' + digits;
      else if (digits.startsWith('04') && digits.length === 10)      phone = '+61' + digits.slice(1);
      else if (digits.startsWith('4')  && digits.length === 9)       phone = '+61' + digits;
      else return json(400, { error: 'invalid_phone_format', detail: 'enter Australian mobile starting 04 or +61' });

      channel = 'sms';

      // Find email by phone. Two paths:
      //   1. clients.owner_phone — populated for clients created via admin form
      //   2. auth.users.phone — fallback for any auth user with phone set
      //      (e.g. Carl's own founder account, pre-clients-row users)
      const { data: clientByPhone } = await supa
        .from('clients')
        .select('email')
        .eq('owner_phone', phone)
        .limit(1);
      if (clientByPhone && clientByPhone.length > 0 && clientByPhone[0].email) {
        email = clientByPhone[0].email;
      } else {
        // Fallback — listUsers and match by auth.users.phone
        const { data: usersList } = await supa.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const match = usersList?.users?.find((u) => u.phone === phone.replace(/^\+/, '') || u.phone === phone);
        if (match?.email) {
          email = match.email;
        } else {
          console.warn(`request-login-link: no client or auth user found for phone=${phone}`);
          return json(200, GENERIC_OK);
        }
      }
    }

    if (!email) return json(200, GENERIC_OK);

    // Generate magic link server-side. Pin redirectTo to HTTPS + trailing slash
    // so the URL falls inside the PWA scope ("/" per manifest.json) and the
    // installed PWA is eligible to handle it on platforms that auto-launch
    // matching links (Android). iOS Safari does not auto-launch PWAs from
    // links — fallback is the browser rendering the full dashboard.
    const { data: linkData, error: linkErr } = await supa.auth.admin.generateLink({
      type:  'magiclink',
      email,
      options: {
        redirectTo: 'https://callmagnet.com.au/',
      },
    });
    if (linkErr || !linkData?.properties?.action_link) {
      console.warn(`request-login-link: generateLink failed for email=${email}: ${linkErr?.message}`);
      return json(200, GENERIC_OK);
    }
    const login_url = linkData.properties.action_link;

    // Dispatch via the right channel
    if (channel === 'email') {
      if (!RESEND_API_KEY) {
        console.warn('request-login-link: RESEND_API_KEY missing — cannot send email');
        return json(200, GENERIC_OK);
      }
      try {
        // Branded dark-palette magic-link email — mirrors supabase/templates/magic_link.html
        // with the action URL inlined directly (Resend send bypasses Supabase Auth
        // template flow, so {{ .ConfirmationURL }} substitution doesn't happen here).
        const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>Your CallMagnet login link</title></head>
<body style="margin:0;padding:0;background:#0E1419;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:rgba(255,255,255,0.92);-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:transparent;">Tap to log in to CallMagnet. Link expires in 1 hour.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0E1419;">
  <tr><td align="center" style="padding:32px 16px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:rgba(255,255,255,0.04);border:1px solid rgba(6,214,160,0.22);border-radius:14px;">
      <tr><td style="padding:36px 30px 32px;color:rgba(255,255,255,0.92);">
        <div style="font-size:14px;letter-spacing:0.16em;color:#06D6A0;text-transform:uppercase;font-weight:700;margin-bottom:28px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">★ CallMagnet</div>
        <h1 style="margin:0 0 12px;font-size:22px;font-weight:600;color:rgba(255,255,255,0.92);letter-spacing:-0.01em;">Your login link</h1>
        <p style="margin:0 0 28px;font-size:15px;line-height:1.55;color:rgba(255,255,255,0.78);">Tap the button below to log in to your CallMagnet dashboard. This link expires in 1 hour for security.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:0 0 20px;">
          <a href="${login_url}" style="display:inline-block;background:#06D6A0;color:#0a1110;text-decoration:none;font-weight:700;font-size:15px;padding:14px 30px;border-radius:10px;letter-spacing:0.01em;">Log in to CallMagnet</a>
        </td></tr></table>
        <p style="margin:18px 0 0;font-size:12px;line-height:1.55;color:rgba(255,255,255,0.55);word-break:break-all;">Button not working? Copy and paste this URL into your browser:<br><span style="color:rgba(255,255,255,0.7);">${login_url}</span></p>
        <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:rgba(255,255,255,0.45);">If you didn't request this link, you can ignore this email.</p>
      </td></tr>
    </table>
    <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:18px;letter-spacing:0.06em;">CallMagnet</div>
  </td></tr>
</table>
</body></html>`;
        const text = `Log in to CallMagnet: ${login_url}\n\nLink expires in 1 hour. If you didn't request this, ignore this email.`;
        const resendRes = await fetch('https://api.resend.com/emails', {
          method:  'POST',
          headers: {
            Authorization:  `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from:    'CallMagnet <hello@callmagnet.com.au>',
            to:      email,
            subject: 'Your CallMagnet login link',
            html,
            text,
          }),
        });
        if (!resendRes.ok) {
          const errBody = await resendRes.text();
          console.warn(`resend failed (${resendRes.status}): ${errBody}`);
        }
      } catch (e) {
        console.warn(`resend exception: ${(e as Error)?.message ?? e}`);
      }
    } else {
      // SMS channel
      if (!INTERNAL_SECRET) {
        console.warn('request-login-link: INTERNAL_SECRET missing — cannot call send-twilio-sms');
        return json(200, GENERIC_OK);
      }
      try {
        const smsRes = await fetch(`${SUPABASE_URL}/functions/v1/send-twilio-sms`, {
          method:  'POST',
          headers: {
            'Content-Type':      'application/json',
            'X-Internal-Secret': INTERNAL_SECRET,
            Authorization:       `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            to:      phone,
            message: `CallMagnet login: ${login_url} (expires in 1 hour)`,
          }),
        });
        if (!smsRes.ok) {
          const errBody = await smsRes.text();
          console.warn(`twilio send failed (${smsRes.status}): ${errBody}`);
        }
      } catch (e) {
        console.warn(`twilio exception: ${(e as Error)?.message ?? e}`);
      }
    }

    return json(200, GENERIC_OK);

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`request-login-link fatal: ${errMsg}`);
    // Always generic response — never leak internals
    return json(200, GENERIC_OK);
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
