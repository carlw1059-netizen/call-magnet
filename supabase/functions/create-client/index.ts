// create-client: admin-only edge function. Onboards a new CallMagnet client.
// Called by /admin/onboard.html now; future public /signup page will call the
// same function (after adding a public-signup-vs-admin code path).
//
// Steps:
//   1. Verify caller JWT and that caller.app_metadata.is_admin === true
//   2. Validate inputs (E.164 phone, ABN, email, URL)
//   3. Look up vertical config from verticals table — reject if unknown/inactive
//   4. Create auth.users row (email + phone confirmed) or reuse if exists
//   5. INSERT clients row referencing same email
//   6. Generate magic-link via supa.auth.admin.generateLink
//   7. SMS the magic-link to owner_phone via send-twilio-sms helper
//   8. Return { success, client_id, login_url, sms_sent, sms_error? }
//
// Always returns clear plain-English error messages. No stack traces leak.

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
    // ── 1. Verify caller is an admin ───────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const userJwt    = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!userJwt) {
      return json(401, { error: 'missing_authorization', detail: 'Authorization: Bearer <jwt> header required' });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userErr } = await supa.auth.getUser(userJwt);
    if (userErr || !userData?.user) {
      return json(401, { error: 'invalid_token', detail: userErr?.message ?? 'token did not resolve to a user' });
    }
    const isAdmin = (userData.user.app_metadata as Record<string, unknown> | undefined)?.is_admin === true;
    if (!isAdmin) {
      return json(403, { error: 'not_admin', detail: 'caller does not have is_admin flag in app_metadata' });
    }

    // ── 2. Parse + validate body ───────────────────────────────────────────
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json(400, { error: 'invalid_body', detail: 'JSON body required' });

    const business_name = String(body.business_name ?? '').trim();
    const vertical      = String(body.vertical      ?? '').trim();
    const twilio_number = String(body.twilio_number ?? '').trim();
    const owner_phone   = String(body.owner_phone   ?? '').trim();
    const owner_email   = String(body.owner_email   ?? '').trim().toLowerCase();
    const abn_raw       = String(body.abn           ?? '').trim();
    const abn           = abn_raw.length > 0 ? abn_raw : null;
    const rebrandly_url = String(body.rebrandly_url ?? '').trim();
    const avg_input     = body.avg_job_value;
    const customer_sms_template_input = typeof body.customer_sms_template === 'string'
      ? body.customer_sms_template.trim()
      : '';
    const send_sms      = body.send_sms !== false; // default true

    if (!business_name) return json(400, { error: 'missing_field', field: 'business_name' });
    if (!vertical)      return json(400, { error: 'missing_field', field: 'vertical' });
    if (!twilio_number) return json(400, { error: 'missing_field', field: 'twilio_number' });
    if (!owner_phone)   return json(400, { error: 'missing_field', field: 'owner_phone' });
    if (!owner_email)   return json(400, { error: 'missing_field', field: 'owner_email' });
    if (!rebrandly_url) return json(400, { error: 'missing_field', field: 'rebrandly_url' });

    if (!/^\+614\d{8}$/.test(twilio_number)) {
      return json(400, { error: 'invalid_phone', field: 'twilio_number', detail: 'must be E.164 +614XXXXXXXX' });
    }
    if (!/^\+61\d{8,11}$/.test(owner_phone)) {
      return json(400, { error: 'invalid_phone', field: 'owner_phone', detail: 'must be E.164 starting +61' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner_email)) {
      return json(400, { error: 'invalid_email', field: 'owner_email' });
    }
    if (abn && !/^\d{11}$/.test(abn)) {
      return json(400, { error: 'invalid_abn', detail: 'ABN must be 11 digits' });
    }
    if (!/^https?:\/\//.test(rebrandly_url)) {
      return json(400, { error: 'invalid_url', field: 'rebrandly_url', detail: 'must start with http:// or https://' });
    }

    // ── 3. Look up vertical config ─────────────────────────────────────────
    const { data: verticalRows, error: verticalErr } = await supa
      .from('verticals')
      .select('vertical_key, default_avg_job_value, active, default_customer_sms')
      .eq('vertical_key', vertical)
      .limit(1);
    if (verticalErr) {
      return json(500, { error: 'vertical_lookup_failed', detail: verticalErr.message });
    }
    if (!verticalRows || verticalRows.length === 0) {
      return json(400, { error: 'unknown_vertical', detail: `vertical "${vertical}" is not in the verticals table` });
    }
    if (!verticalRows[0].active) {
      return json(400, { error: 'inactive_vertical', detail: `vertical "${vertical}" is marked inactive` });
    }
    const defaultAvg = Number(verticalRows[0].default_avg_job_value);
    const avg_job_value = (typeof avg_input === 'number' && avg_input > 0) ? avg_input : defaultAvg;

    // ── Validate + finalize customer SMS template ───────────────────────────
    // Use the input if supplied, else fall back to the vertical's default.
    // The fixed tail " Reply STOP to opt out" (22 chars) is appended at send
    // time by Twilio Studio, NOT stored — but we validate the body length so
    // body + tail ≤ 160 chars. Replace [LINK] with the actual rebrandly URL
    // in the stored row so Studio's Liquid template stays trivial.
    const STOP_TAIL = ' Reply STOP to opt out';
    const MAX_TOTAL = 160;
    const MAX_BODY  = MAX_TOTAL - STOP_TAIL.length;

    let customer_sms_template = customer_sms_template_input.length > 0
      ? customer_sms_template_input
      : String(verticalRows[0].default_customer_sms ?? '').trim();

    // Substitute [LINK] with the client's actual rebrandly URL
    customer_sms_template = customer_sms_template.replace(/\[LINK\]/g, rebrandly_url);

    // Validate
    if (!customer_sms_template) {
      return json(400, { error: 'missing_field', field: 'customer_sms_template' });
    }
    if (!/^Hi\b/i.test(customer_sms_template)) {
      return json(400, { error: 'invalid_sms_template', detail: 'customer_sms_template must start with "Hi"' });
    }
    if (/callmagnet\.com\.au/i.test(customer_sms_template)) {
      return json(400, { error: 'invalid_sms_template', detail: 'customer_sms_template must not contain callmagnet.com.au (customer-facing message; brand stays invisible)' });
    }
    if (customer_sms_template.length > MAX_BODY) {
      return json(400, { error: 'sms_template_too_long', detail: `body must be ≤ ${MAX_BODY} chars to fit within 160-char single SMS segment after appending "${STOP_TAIL}"`, current_length: customer_sms_template.length });
    }

    // ── 4. Create (or reuse) auth user ─────────────────────────────────────
    let authUserId: string | null = null;
    const { data: existingList } = await supa.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = existingList?.users?.find((u) => (u.email ?? '').toLowerCase() === owner_email);
    if (existing) {
      authUserId = existing.id;
    } else {
      const { data: createRes, error: createErr } = await supa.auth.admin.createUser({
        email:         owner_email,
        phone:         owner_phone,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { business_name },
      });
      if (createErr) {
        return json(500, { error: 'auth_user_create_failed', detail: createErr.message });
      }
      authUserId = createRes.user?.id ?? null;
    }

    // ── 5. Insert clients row ──────────────────────────────────────────────
    const { data: insertedClient, error: insertErr } = await supa
      .from('clients')
      .insert({
        business_name,
        email:                  owner_email,
        owner_phone,
        twilio_number,
        vertical,
        booking_url:            rebrandly_url,
        avg_job_value,
        abn,
        customer_sms_template,
        account_status:         'active',
        terms_accepted:         true,
        subscription_start:     new Date().toISOString(),
      })
      .select('id')
      .single();
    if (insertErr) {
      return json(500, { error: 'client_insert_failed', detail: insertErr.message });
    }
    const client_id = insertedClient.id;

    // ── 6. Generate magic link ─────────────────────────────────────────────
    const { data: linkData, error: linkErr } = await supa.auth.admin.generateLink({
      type:  'magiclink',
      email: owner_email,
      options: {
        redirectTo: 'https://callmagnet.com.au/',
      },
    });
    if (linkErr) {
      // Don't fail the whole onboarding — client row exists, just no auto-login link
      console.warn(`generateLink failed: ${linkErr.message}`);
    }
    const login_url = linkData?.properties?.action_link ?? 'https://callmagnet.com.au';

    // ── 7. Send SMS via helper (if requested) ──────────────────────────────
    let sms_sent  = false;
    let sms_error: string | null = null;
    if (send_sms && INTERNAL_SECRET) {
      try {
        const smsRes = await fetch(`${SUPABASE_URL}/functions/v1/send-twilio-sms`, {
          method:  'POST',
          headers: {
            'Content-Type':     'application/json',
            'X-Internal-Secret': INTERNAL_SECRET,
            Authorization:      `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            to:      owner_phone,
            message: `Welcome to CallMagnet, ${business_name}. Tap to log in: ${login_url}`,
          }),
        });
        sms_sent = smsRes.ok;
        if (!smsRes.ok) {
          const errBody = await smsRes.text();
          sms_error = `twilio send failed (${smsRes.status}): ${errBody}`;
          console.warn(sms_error);
        }
      } catch (e) {
        sms_error = `sms_exception: ${(e as Error)?.message ?? e}`;
        console.warn(sms_error);
      }
    } else if (send_sms && !INTERNAL_SECRET) {
      sms_error = 'INTERNAL_SECRET not configured — cannot call send-twilio-sms';
    }

    // ── 8. Send branded onboarding welcome email via Resend (best-effort) ──
    let welcome_email_sent = false;
    let welcome_email_error: string | null = null;
    if (RESEND_API_KEY) {
      try {
        const escapedBiz = business_name.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
        const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light"><title>Welcome to CallMagnet</title></head>
<body style="margin:0;padding:0;background:#0E1419;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:rgba(255,255,255,0.92);-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:transparent;">Your CallMagnet dashboard is ready. Tap to log in.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0E1419;">
  <tr><td align="center" style="padding:32px 16px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:rgba(255,255,255,0.04);border:1px solid rgba(6,214,160,0.22);border-radius:14px;">
      <tr><td style="padding:36px 30px 32px;color:rgba(255,255,255,0.92);">
        <div style="font-size:14px;letter-spacing:0.16em;color:#06D6A0;text-transform:uppercase;font-weight:700;margin-bottom:28px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">★ CallMagnet</div>
        <h1 style="margin:0 0 12px;font-size:24px;font-weight:600;color:rgba(255,255,255,0.92);letter-spacing:-0.01em;">Welcome, ${escapedBiz}.</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:rgba(255,255,255,0.78);">Your CallMagnet account is set up. Tap below to log in and see your dashboard. You'll see SMS replies fire to customers in real time as soon as your phone forwarding is configured.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:0 0 24px;">
          <a href="${login_url}" style="display:inline-block;background:#06D6A0;color:#0a1110;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;letter-spacing:0.01em;">Log in to CallMagnet</a>
        </td></tr></table>
        <div style="margin:0 0 24px;padding:18px 18px;background:rgba(6,214,160,0.06);border:1px solid rgba(6,214,160,0.18);border-radius:10px;">
          <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#06D6A0;font-weight:700;margin-bottom:10px;">Next steps</div>
          <ol style="margin:0;padding:0 0 0 20px;font-size:14px;line-height:1.55;color:rgba(255,255,255,0.85);">
            <li style="margin-bottom:6px;">Log in with the button above</li>
            <li style="margin-bottom:6px;">Open your dashboard and walk through the tiles</li>
            <li>Reply to this email or text Carl if anything looks wrong</li>
          </ol>
        </div>
      </td></tr>
    </table>
    <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:18px;letter-spacing:0.06em;">CallMagnet</div>
  </td></tr>
</table>
</body></html>`;
        const text =
          `Welcome, ${business_name}.\n\n` +
          `Your CallMagnet account is set up. Tap the link below to log in and see your dashboard. You'll see SMS replies fire to customers in real time as soon as your phone forwarding is configured.\n\n` +
          `Log in: ${login_url}\n\n` +
          `Next steps:\n` +
          `1. Log in with the link above\n` +
          `2. Open your dashboard and walk through the tiles\n` +
          `3. Reply to this email or text Carl if anything looks wrong\n\n` +
          `CallMagnet — callmagnet.com.au\n`;
        const resendRes = await fetch('https://api.resend.com/emails', {
          method:  'POST',
          headers: {
            Authorization:  `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from:    'CallMagnet <hello@callmagnet.com.au>',
            to:      owner_email,
            subject: 'Welcome to CallMagnet — your dashboard is ready',
            html,
            text,
          }),
        });
        welcome_email_sent = resendRes.ok;
        if (!resendRes.ok) {
          welcome_email_error = `resend failed (${resendRes.status}): ${await resendRes.text()}`;
          console.warn(welcome_email_error);
        }
      } catch (e) {
        welcome_email_error = `welcome_email_exception: ${(e as Error)?.message ?? e}`;
        console.warn(welcome_email_error);
      }
    } else {
      welcome_email_error = 'RESEND_API_KEY not configured';
    }

    return json(200, {
      success:    true,
      client_id,
      login_url,
      sms_sent,
      sms_error,
      welcome_email_sent,
      welcome_email_error,
      auth_user_id: authUserId,
    });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`create-client fatal: ${errMsg}`);
    return json(500, { error: 'internal_error', detail: errMsg });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
