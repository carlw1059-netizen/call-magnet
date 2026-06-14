// create-client: admin-only edge function. Onboards a new CallMagnet client.
// Called by /admin/onboard.html now; future public /signup page will call the
// same function (after adding a public-signup-vs-admin code path).
//
// Steps:
//   1. Verify caller JWT and that caller.app_metadata.is_admin === true
//   2. Validate inputs (E.164 phone, ABN, email, URL)
//   3. Look up vertical config from verticals table — reject if unknown/inactive
//   4. Create auth.users row (email + phone + temp password) or reuse if exists
//      New users: must_change_password = true (forced change on first login)
//      Reused users: password reset link sent instead of temp password
//   5. INSERT clients row referencing same email
//   6. SMS brief onboarding notice to owner_phone via send-twilio-sms helper
//   7. Send welcome email via Resend (includes temp password for new users)
//   8. Return { success, client_id, sms_sent, sms_error?, welcome_email_sent }
//
// Always returns clear plain-English error messages. No stack traces leak.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET           = Deno.env.get('INTERNAL_SECRET');
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY');
const SHORTIO_API_KEY           = Deno.env.get('SHORTIO_API_KEY');
const SHORTIO_DOMAIN            = 'callmagnet.s.gy';

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
    if ((userData.user.email ?? '').toLowerCase() !== 'car312@hotmail.com') {
      return json(403, { error: 'forbidden', detail: 'admin email mismatch' });
    }

    // ── 2. Parse + validate body ───────────────────────────────────────────
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json(400, { error: 'invalid_body', detail: 'JSON body required' });

    const business_name = String(body.business_name ?? '').trim();
    const owner_name    = typeof body.owner_name === 'string' ? body.owner_name.trim() : null;
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
    const send_sms         = body.send_sms !== false; // default true
    const initial_password = typeof body.initial_password === 'string' ? body.initial_password : '';
    const free_period_days = typeof body.free_period_days === 'number' && body.free_period_days > 0
      ? Math.floor(body.free_period_days)
      : 0;

    if (!initial_password || initial_password.length < 8) {
      return json(400, { error: 'invalid_field', field: 'initial_password', detail: 'initial_password must be at least 8 characters' });
    }

    // ── Middle Man fields ──────────────────────────────────────────────────
    // Slug: use whatever the form sent, or auto-generate from business_name.
    // Generation mirrors the frontend generateSlug() function.
    const middle_man_slug_raw = typeof body.middle_man_slug === 'string'
      ? body.middle_man_slug.trim().toLowerCase()
      : null;
    const slug = (middle_man_slug_raw && middle_man_slug_raw.length > 0)
      ? middle_man_slug_raw
      : business_name
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 50);

    // middle_man_enabled: default true (every new client starts with Middle Man ON).
    // Form toggle can override by sending middle_man_enabled: false.
    const middle_man_enabled = body.middle_man_enabled !== false;

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
    if (slug && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug)) {
      return json(400, { error: 'invalid_slug', detail: 'Generated slug must be lowercase letters, digits, and hyphens only (no leading/trailing hyphens). Check the business name.' });
    }
    if (slug && slug.length > 50) {
      return json(400, { error: 'invalid_slug', detail: 'Generated slug must be 50 characters or fewer. Shorten the business name.' });
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
    // body + tail ≤ 160 chars.
    //
    // [LINK] is stored as a literal placeholder. fetch-client-vertical.js
    // substitutes the correct Short.io link (or Middle Man URL) at call time.
    // Baking the booking URL in here would bypass the Short.io fallback chain.
    const STOP_TAIL = ' Reply STOP to opt out';
    const MAX_TOTAL = 160;
    const MAX_BODY  = MAX_TOTAL - STOP_TAIL.length;

    const customer_sms_template = customer_sms_template_input.length > 0
      ? customer_sms_template_input
      : String(verticalRows[0].default_customer_sms ?? '').trim();

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
    // Use the admin-supplied initial_password (validated above). For existing
    // users the password is NOT changed — they already have credentials.

    let authUserId: string | null = null;
    let isNewUser = false;
    const { data: existingList } = await supa.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = existingList?.users?.find((u) => (u.email ?? '').toLowerCase() === owner_email);
    if (existing) {
      authUserId = existing.id;
      isNewUser  = false;
    } else {
      const { data: createRes, error: createErr } = await supa.auth.admin.createUser({
        email:         owner_email,
        phone:         owner_phone,
        password:      initial_password,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { business_name },
      });
      if (createErr) {
        return json(500, { error: 'auth_user_create_failed', detail: createErr.message });
      }
      authUserId = createRes.user?.id ?? null;
      isNewUser  = true;
    }

    // ── 5. Insert clients row ──────────────────────────────────────────────
    const clientInsertPayload: Record<string, unknown> = {
      business_name,
      email:                  owner_email,
      owner_name:             owner_name || null,
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
      must_change_password:   isNewUser,
      middle_man_enabled:     middle_man_enabled,
      middle_man_slug:        slug,
    };

    const { data: insertedClient, error: insertErr } = await supa
      .from('clients')
      .insert(clientInsertPayload)
      .select('id')
      .single();
    if (insertErr) {
      // Unique constraint on middle_man_slug → return a clear 409 not a 500
      if (insertErr.code === '23505' && insertErr.message.includes('middle_man_slug')) {
        return json(409, { error: 'slug_taken', detail: `The Middle Man slug "${slug}" is already in use. Use a different business name or contact support.` });
      }
      return json(500, { error: 'client_insert_failed', detail: insertErr.message });
    }
    const client_id = insertedClient.id;

    // ── 5b. Create Stripe customer (best-effort — never blocks onboarding) ──
    let stripe_customer_id:          string | null = null;
    let stripe_subscription_id:      string | null = null;
    let stripe_error:                string | null = null;
    let setup_fee_payment_intent_id: string | null = null;
    let setup_fee_error:             string | null = null;
    try {
      // Fetch Stripe secret key from Vault via public RPC (SECURITY DEFINER)
      const { data: stripeKey, error: vaultErr } = await supa
        .rpc('get_vault_secret', { secret_name: 'stripe_secret_key' });
      if (vaultErr || !stripeKey) {
        throw new Error(`Vault fetch failed: ${vaultErr?.message ?? 'key not found'}`);
      }

      // Create Stripe customer
      const stripeBody = new URLSearchParams({
        email:                  owner_email,
        name:                   business_name,
        'metadata[client_id]':  client_id,
        'metadata[vertical]':   vertical,
      });
      const stripeRes = await fetch('https://api.stripe.com/v1/customers', {
        method:  'POST',
        headers: {
          'Authorization': `Basic ${btoa(stripeKey + ':')}`,
          'Content-Type':  'application/x-www-form-urlencoded',
        },
        body: stripeBody.toString(),
      });
      const stripeData = await stripeRes.json() as Record<string, unknown>;
      if (!stripeRes.ok) {
        throw new Error(`Stripe API ${stripeRes.status}: ${JSON.stringify(stripeData)}`);
      }
      stripe_customer_id = stripeData.id as string;
      console.log(`create-client: Stripe customer created — ${stripe_customer_id}`);

      // Update clients row with stripe_customer_id
      const { error: stripeUpdateErr } = await supa
        .from('clients')
        .update({ stripe_customer_id })
        .eq('id', client_id);
      if (stripeUpdateErr) {
        console.warn(`create-client: stripe_customer_id UPDATE failed — ${stripeUpdateErr.message}`);
      }

      // Create Stripe subscription
      const isRestaurant   = vertical === 'restaurant';
      const monthlyPriceId = isRestaurant
        ? 'price_1Ti51u3MTu8r2rLhBNxFra0k'   // Restaurant $249/month
        : 'price_1TD12P3MTu8r2rLhJYFPksVx';  // Bronze $99/month
      const setupPriceId   = isRestaurant
        ? 'price_1Ti51s3MTu8r2rLhmmtEk3Fb'   // Restaurant setup $499
        : 'price_1TD0jm3MTu8r2rLhkXPpx0AH';  // Bronze setup $249
      const overagePriceId = 'price_1TMmTG3MTu8r2rLhYSWnqheS'; // SMS overage (all verticals)

      const subParams = new URLSearchParams({
        customer:             stripe_customer_id,
        'items[0][price]':    monthlyPriceId,
        'items[1][price]':    overagePriceId,
        collection_method:    'send_invoice',
        days_until_due:       '30',
      });
      if (free_period_days > 0) {
        subParams.set('trial_period_days', String(free_period_days));
      }

      const subRes = await fetch('https://api.stripe.com/v1/subscriptions', {
        method:  'POST',
        headers: {
          'Authorization': `Basic ${btoa(stripeKey + ':')}`,
          'Content-Type':  'application/x-www-form-urlencoded',
        },
        body: subParams.toString(),
      });
      const subData = await subRes.json() as Record<string, unknown>;
      if (!subRes.ok) {
        throw new Error(`Stripe subscription ${subRes.status}: ${JSON.stringify(subData)}`);
      }
      stripe_subscription_id = subData.id as string;
      console.log(`create-client: Stripe subscription created — ${stripe_subscription_id}`);

      // Update clients row with stripe_subscription_id
      const { error: subUpdateErr } = await supa
        .from('clients')
        .update({ stripe_subscription_id })
        .eq('id', client_id);
      if (subUpdateErr) {
        console.warn(`create-client: stripe_subscription_id UPDATE failed — ${subUpdateErr.message}`);
      }
    } catch (e) {
      stripe_error = (e as Error)?.message ?? String(e);
      console.warn(`create-client: Stripe customer/subscription failed (non-fatal) — ${stripe_error}`);
    }

    // ── 5c. Setup fee payment intent (best-effort — never blocks onboarding) ─
    if (stripe_customer_id) {
      try {
        // Fetch Stripe key from Vault via public RPC
        const { data: stripeKey2, error: vaultErr2 } = await supa
          .rpc('get_vault_secret', { secret_name: 'stripe_secret_key' });
        if (vaultErr2 || !stripeKey2) {
          throw new Error(`Vault fetch failed: ${vaultErr2?.message ?? 'key not found'}`);
        }

        const setupAmount = vertical === 'restaurant' ? 49900 : 24900;
        const piParams = new URLSearchParams({
          amount:                    String(setupAmount),
          currency:                  'aud',
          customer:                  stripe_customer_id,
          confirm:                   'true',
          'payment_method_types[0]': 'card',
          'metadata[client_id]':     client_id,
          'metadata[type]':          'setup_fee',
        });
        const piRes = await fetch('https://api.stripe.com/v1/payment_intents', {
          method:  'POST',
          headers: {
            'Authorization': `Basic ${btoa(stripeKey2 + ':')}`,
            'Content-Type':  'application/x-www-form-urlencoded',
          },
          body: piParams.toString(),
        });
        const piData = await piRes.json() as Record<string, unknown>;
        if (!piRes.ok) {
          throw new Error(`Stripe payment_intent ${piRes.status}: ${JSON.stringify(piData)}`);
        }
        setup_fee_payment_intent_id = piData.id as string;
        console.log(`create-client: setup fee payment intent created — ${setup_fee_payment_intent_id} (${setupAmount} AUD cents)`);
      } catch (e) {
        setup_fee_error = (e as Error)?.message ?? String(e);
        console.warn(`create-client: setup fee payment intent failed (non-fatal) — ${setup_fee_error}`);
      }
    }

    // ── 5d. Create Short.io link (best-effort — never blocks onboarding) ───
    // slug is always set (auto-generated if not supplied). On any failure: log and continue.
    if (SHORTIO_API_KEY) {
      try {
        console.log(`create-client: Short.io request — domain: ${SHORTIO_DOMAIN}, path: ${slug}, url: https://callmagnet.com.au/b/${slug}, key present: ${!!SHORTIO_API_KEY}, key prefix: ${SHORTIO_API_KEY?.slice(0,8)}`);
        const shortioRes = await fetch('https://api.short.io/links', {
          method:  'POST',
          headers: {
            'authorization': SHORTIO_API_KEY,
            'content-type':  'application/json',
          },
          body: JSON.stringify({
            domain:       SHORTIO_DOMAIN,
            originalURL:  `https://callmagnet.com.au/b/${slug}`,
            path:         slug,
          }),
        });
        if (shortioRes.ok) {
          const shortioData = await shortioRes.json() as Record<string, unknown>;
          const shortUrl = typeof shortioData.shortURL === 'string' ? shortioData.shortURL : null;
          if (shortUrl) {
            const { error: shortioUpdateErr } = await supa
              .from('clients')
              .update({ shortio_link: shortUrl })
              .eq('id', client_id);
            if (shortioUpdateErr) {
              console.warn(`create-client: shortio_link UPDATE failed for client ${client_id}: ${shortioUpdateErr.message}`);
            } else {
              console.log(`create-client: Short.io link created — ${shortUrl}`);
            }
          } else {
            console.warn(`create-client: Short.io response OK but shortURL missing — ${JSON.stringify(shortioData)}`);
          }
        } else {
          const errText = await shortioRes.text();
          console.warn(`create-client: Short.io API returned ${shortioRes.status} — ${errText}`);
        }
      } catch (e) {
        console.warn(`create-client: Short.io exception — ${(e as Error)?.message ?? e}`);
      }
    } else {
      console.warn('create-client: SHORTIO_API_KEY not configured — Short.io link skipped');
    }

    // ── 6. Send onboarding SMS (brief notice — no login URL needed) ────────
    // Clients now log in with email + password. The welcome email includes the
    // temp password. SMS just signals that the account is ready.
    let sms_sent  = false;
    let sms_error: string | null = null;
    if (send_sms && INTERNAL_SECRET) {
      try {
        const smsBody = `Welcome to CallMagnet, ${business_name}. Your account is ready — check your email for login details.`;

        // Insert sms_events row before sending so delivery can be tracked via
        // twilio-sms-status StatusCallback. Best-effort: SMS send continues if
        // the insert fails (non-fatal).
        let sms_event_id: string | null = null;
        try {
          const { data: smsEventRow, error: smsEventErr } = await supa
            .from('sms_events')
            .insert({
              client_id:       client_id,
              customer_number: owner_phone,
              client_number:   twilio_number,
              message_body:    smsBody,
            })
            .select('id')
            .single();
          if (smsEventErr) {
            console.warn(`create-client: sms_events insert failed — ${smsEventErr.message}`);
          } else {
            sms_event_id = smsEventRow?.id ?? null;
          }
        } catch (e) {
          console.warn(`create-client: sms_events insert exception — ${(e as Error)?.message ?? e}`);
        }

        const smsRes = await fetch(`${SUPABASE_URL}/functions/v1/send-twilio-sms`, {
          method:  'POST',
          headers: {
            'Content-Type':      'application/json',
            'X-Internal-Secret': INTERNAL_SECRET,
            Authorization:       `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            to:      owner_phone,
            message: smsBody,
            ...(sms_event_id ? { sms_event_id } : {}),
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

    // ── 7. Send branded onboarding welcome email via Resend (best-effort) ──
    // For new users: includes temp password and magic-link button.
    // For re-onboarded users: no password change — direct to login page.
    let welcome_email_sent = false;
    let welcome_email_error: string | null = null;

    // Generate magic link for new users (best-effort — fall back to homepage)
    let loginButtonUrl = 'https://callmagnet.com.au';
    if (isNewUser) {
      try {
        const { data: linkData } = await supa.auth.admin.generateLink({
          type: 'magiclink',
          email: owner_email,
          options: { redirectTo: 'https://callmagnet.com.au' },
        });
        const actionLink = (linkData as Record<string, unknown> | null)?.properties
          ? ((linkData as Record<string, unknown>).properties as Record<string, unknown>)?.action_link
          : null;
        if (typeof actionLink === 'string' && actionLink.startsWith('http')) {
          loginButtonUrl = actionLink;
        }
      } catch (e) {
        console.warn(`create-client: magic link generation failed — ${(e as Error)?.message ?? e}`);
      }
    }

    if (RESEND_API_KEY) {
      try {
        const escapedBiz = business_name.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
        const loginPageUrl = loginButtonUrl;

        // Credential block: always show for new users
        const credentialBlock = isNewUser
          ? `<div style="margin:0 0 24px;padding:18px;background:rgba(6,214,160,0.06);border:1px solid rgba(6,214,160,0.28);border-radius:10px;">
          <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#06D6A0;font-weight:700;margin-bottom:10px;">Your login details</div>
          <table style="width:100%;font-size:14px;line-height:1.6;color:rgba(255,255,255,0.85);border-collapse:collapse;">
            <tr><td style="padding:2px 0;color:rgba(255,255,255,0.55);width:130px;">Business</td><td style="padding:2px 0;font-weight:700;">${escapedBiz}</td></tr>
            <tr><td style="padding:2px 0;color:rgba(255,255,255,0.55);">Email</td><td style="padding:2px 0;font-family:ui-monospace,monospace;font-weight:700;">${owner_email}</td></tr>
            <tr><td style="padding:2px 0;color:rgba(255,255,255,0.55);">Temporary password</td><td style="padding:2px 0;font-family:ui-monospace,monospace;font-weight:700;letter-spacing:0.08em;">${initial_password}</td></tr>
          </table>
          <p style="margin:10px 0 0;font-size:12px;color:rgba(255,255,255,0.5);">Save your password — you'll need it if you log out and come back.</p>
        </div>`
          : `<p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:rgba(255,255,255,0.65);">Use your existing email and password to sign in. If you've forgotten your password, tap "Forgot password?" on the login page.</p>`;

        const credentialText = isNewUser
          ? `Your login details:\n  Business: ${business_name}\n  Email:    ${owner_email}\n  Temporary password: ${initial_password}\n\nSave your password — you'll need it if you log out and come back.\n\n`
          : `Use your existing password to sign in. If you've forgotten it, use "Forgot password?" on the login page.\n\n`;

        const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light"><title>Welcome to CallMagnet</title></head>
<body style="margin:0;padding:0;background:#0E1419;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:rgba(255,255,255,0.92);-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:transparent;">Your CallMagnet dashboard is ready.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0E1419;">
  <tr><td align="center" style="padding:32px 16px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:rgba(255,255,255,0.04);border:1px solid rgba(6,214,160,0.22);border-radius:14px;">
      <tr><td style="padding:36px 30px 32px;color:rgba(255,255,255,0.92);">
        <div style="font-size:14px;letter-spacing:0.16em;color:#06D6A0;text-transform:uppercase;font-weight:700;margin-bottom:28px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">★ CallMagnet</div>
        <h1 style="margin:0 0 12px;font-size:24px;font-weight:600;color:rgba(255,255,255,0.92);letter-spacing:-0.01em;">Welcome, ${escapedBiz}.</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:rgba(255,255,255,0.78);">Your CallMagnet account is set up. Log in to see your dashboard and watch SMS replies fire to customers in real time once your phone forwarding is configured.</p>
        ${credentialBlock}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:0 0 24px;">
          <a href="${loginPageUrl}" style="display:inline-block;background:#06D6A0;color:#0a1110;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;letter-spacing:0.01em;">Go to my dashboard</a>
        </td></tr></table>
        <div style="margin:0 0 24px;padding:18px 18px;background:rgba(6,214,160,0.06);border:1px solid rgba(6,214,160,0.18);border-radius:10px;">
          <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#06D6A0;font-weight:700;margin-bottom:10px;">Next steps</div>
          <ol style="margin:0;padding:0 0 0 20px;font-size:14px;line-height:1.55;color:rgba(255,255,255,0.85);">
            <li style="margin-bottom:6px;">Log in at callmagnet.com.au with the details above</li>
            <li style="margin-bottom:6px;">Walk through the dashboard tiles</li>
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
          `Your CallMagnet account is set up. Log in at ${loginPageUrl} to see your dashboard.\n\n` +
          credentialText +
          `Next steps:\n` +
          `1. Log in at callmagnet.com.au\n` +
          `2. Walk through the dashboard tiles\n` +
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
      success:             true,
      client_id,
      sms_sent,
      sms_error,
      welcome_email_sent,
      welcome_email_error,
      auth_user_id:        authUserId,
      is_new_user:         isNewUser,
      middle_man_slug:     slug,
      middle_man_enabled,
      stripe_customer_id,
      stripe_subscription_id,
      stripe_error,
      setup_fee_payment_intent_id,
      setup_fee_error,
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
