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

      // Find email associated with this phone via clients.owner_phone
      const { data: clientByPhone } = await supa
        .from('clients')
        .select('email')
        .eq('owner_phone', phone)
        .limit(1);
      if (!clientByPhone || clientByPhone.length === 0 || !clientByPhone[0].email) {
        console.warn(`request-login-link: no client found with owner_phone=${phone}`);
        return json(200, GENERIC_OK);
      }
      email = clientByPhone[0].email;
    }

    if (!email) return json(200, GENERIC_OK);

    // Generate magic link server-side
    const { data: linkData, error: linkErr } = await supa.auth.admin.generateLink({
      type:  'magiclink',
      email,
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
            html:    `<p>Tap to log in: <a href="${login_url}" style="color:#06D6A0;">${login_url}</a></p><p>Link expires in 1 hour.</p>`,
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
