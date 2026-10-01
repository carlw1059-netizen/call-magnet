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
import { escapeHtml, renderEmailShell } from '../_shared/emailStyles.ts';
import { ui } from '../_shared/emailUi.ts';
import { getEmailParts } from '../_shared/emailCopy.ts';

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

  // Debug mode — caller passes X-Internal-Secret matching the Vault entry.
  // Real errors returned instead of generic OK. Lets admin diagnose the flow
  // end-to-end without relying on inbox/SMS arrival as the only signal.
  const debug = req.headers.get('X-Internal-Secret') === INTERNAL_SECRET;
  const debugFail = (status: number, payload: Record<string, unknown>) =>
    debug ? json(status, { debug: true, ...payload }) : json(200, GENERIC_OK);

  try {
    const body       = await req.json().catch(() => null) as { identifier?: unknown } | null;
    const identifier = typeof body?.identifier === 'string' ? body.identifier.trim() : '';
    if (!identifier) {
      return json(400, { error: 'missing_identifier', detail: 'identifier required' });
    }
    console.log(`request-login-link: identifier=${identifier} debug=${debug}`);

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const isEmail = identifier.includes('@');
    let email: string | null = null;
    let phone: string | null = null;
    let channel: 'email' | 'sms'   = 'email';
    // Populated on the phone path when a clients row is found — used for
    // sms_events tracking and rate limiting.
    let smsClientId: string | null = null;
    let smsClientTwilioNumber: string | null = null;

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
        .select('email, id, twilio_number')
        .eq('owner_phone', phone)
        .limit(1);
      if (clientByPhone && clientByPhone.length > 0 && clientByPhone[0].email) {
        email                 = clientByPhone[0].email;
        smsClientId           = clientByPhone[0].id           ?? null;
        smsClientTwilioNumber = clientByPhone[0].twilio_number ?? null;
        console.log(`request-login-link: matched email=${email} via clients.owner_phone`);
      } else {
        // Fallback — listUsers and match by auth.users.phone
        const { data: usersList, error: listErr } = await supa.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (listErr) {
          console.error(`request-login-link: listUsers failed: ${listErr.message}`);
        }
        const phoneNoPlus = phone.replace(/^\+/, '');
        const match = usersList?.users?.find((u) => u.phone === phoneNoPlus || u.phone === phone);
        if (match?.email) {
          email = match.email;
          console.log(`request-login-link: matched email=${email} via auth.users.phone fallback (user id=${match.id})`);
        } else {
          const totalUsers = usersList?.users?.length ?? 0;
          const samplePhones = (usersList?.users ?? []).slice(0, 5).map((u) => u.phone).join(',');
          console.warn(`request-login-link: no match for phone=${phone}. listUsers returned ${totalUsers} users. sample phones: ${samplePhones}`);
          return debugFail(404, { error: 'phone_not_found', phone, total_users: totalUsers, sample_phones: samplePhones });
        }
      }
    }

    if (!email) return json(200, GENERIC_OK);

    // Block magic links for the admin account — admin must authenticate via
    // password only. Magic-link tokens sitting in an email inbox are an account
    // takeover vector. Return GENERIC_OK (identical to the "no account found"
    // response) so an attacker cannot tell from the response whether the admin
    // email is blocked or simply doesn't exist.
    if (email === 'car312@hotmail.com') {
      console.log('request-login-link: blocked magic link attempt for admin email');
      return json(200, GENERIC_OK);
    }

    // Rate-limit login-link SMS: max 3 per phone per hour.
    // Prevents magic-link spam for any known owner phone. Always returns the
    // generic success response so the caller can't tell it was blocked.
    if (channel === 'sms' && phone) {
      const { count: recentCount } = await supa
        .from('sms_events')
        .select('id', { count: 'exact', head: true })
        .eq('customer_number', phone)
        .gte('received_at', new Date(Date.now() - 3600_000).toISOString());
      if ((recentCount ?? 0) >= 3) {
        console.warn(`request-login-link: rate limit hit — phone=${phone} had ${recentCount ?? 0} SMS in last hour`);
        return json(200, GENERIC_OK);
      }
    }

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
      return debugFail(500, { error: 'generate_link_failed', detail: linkErr?.message });
    }
    const login_url = linkData.properties.action_link;
    console.log(`request-login-link: generated link for ${email}, url_length=${login_url.length}`);

    // Dispatch via the right channel
    if (channel === 'email') {
      if (!RESEND_API_KEY) {
        console.warn('request-login-link: RESEND_API_KEY missing — cannot send email');
        return json(200, GENERIC_OK);
      }
      try {
        // Words come from the email_copy table (Carl edits them in Supabase); look is locked in emailUi.ts
        const copy = await getEmailParts('login_link', {});
        const html = renderEmailShell(
          copy.top +
          (copy.buttonLabel ? ui.button(login_url, escapeHtml(copy.buttonLabel)) : '') +
          copy.footnoteHtml,
          copy.preheader,
        );
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
            subject: copy.subject,
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

      // Login URL sent directly — no URL shortener.
      const sms_url = login_url;

      // Vary SMS body slightly on each send. Identical content repeated to the
      // same number is flagged as spam by AU carriers (Telstra/Optus). A short
      // timestamp suffix makes each message unique without changing meaning.
      const nowMin = new Date().toISOString().slice(0, 16).replace('T', ' '); // "2026-05-15 03:42"
      const smsBody = `CallMagnet login: ${sms_url}\nSent ${nowMin} AEST. Tap to access your dashboard.`;

      console.log(`request-login-link: sms channel — phone=${phone} url_len=${sms_url.length} body_len=${smsBody.length}`);

      // Insert sms_events row before sending so:
      //   1. The row exists for the rate-limit counter before delivery completes.
      //   2. twilio-sms-status can update delivery_status via sms_event_id.
      // Only inserted when we have a clients row (smsClientId non-null).
      // Best-effort: SMS send continues even if the insert fails.
      let sms_event_id: string | null = null;
      if (smsClientId && smsClientTwilioNumber) {
        try {
          const { data: smsEvtRow, error: smsEvtErr } = await supa
            .from('sms_events')
            .insert({
              client_id:       smsClientId,
              customer_number: phone,
              client_number:   smsClientTwilioNumber,
              message_body:    smsBody,
            })
            .select('id')
            .single();
          if (smsEvtErr) {
            console.warn(`request-login-link: sms_events insert failed — ${smsEvtErr.message}`);
          } else {
            sms_event_id = smsEvtRow?.id ?? null;
          }
        } catch (e) {
          console.warn(`request-login-link: sms_events insert exception — ${(e as Error)?.message ?? e}`);
        }
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
            message: smsBody,
            ...(sms_event_id ? { sms_event_id } : {}),
          }),
        });
        const smsRespBody = await smsRes.text();
        if (!smsRes.ok) {
          console.warn(`twilio send failed (${smsRes.status}): ${smsRespBody}`);
          return debugFail(500, { error: 'twilio_send_failed', status: smsRes.status, body: smsRespBody });
        }
        console.log(`request-login-link: sms dispatched ok, twilio_response=${smsRespBody.slice(0, 200)}`);
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        console.warn(`twilio exception: ${msg}`);
        return debugFail(500, { error: 'twilio_exception', detail: msg });
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
