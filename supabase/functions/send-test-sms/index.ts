// THIS IS A TEST-ONLY FUNCTION — NOT PART OF PRODUCTION SMS FLOW
// DELETE after onboarding testing is complete.
// Sends a single SMS via Twilio and logs to public.test_sms_log.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TWILIO_ACCOUNT_SID      = Deno.env.get('TWILIO_ACCOUNT_SID')!;
const TWILIO_AUTH_TOKEN        = Deno.env.get('TWILIO_AUTH_TOKEN')!;
const SUPABASE_URL             = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const FROM_NUMBER = '+61468083169';

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return json(500, { ok: false, error: 'Twilio credentials not configured' });
  }

  let to: string, message: string, slug: string;
  try {
    const body = await req.json() as { to?: string; message?: string; slug?: string };
    to      = (body.to      || '').trim();
    message = (body.message || '').trim();
    slug    = (body.slug    || '').trim();
    if (!to)      return json(400, { ok: false, error: 'to is required' });
    if (!message) return json(400, { ok: false, error: 'message is required' });
    if (!slug)    return json(400, { ok: false, error: 'slug is required' });
  } catch {
    return json(400, { ok: false, error: 'invalid JSON body' });
  }

  // Normalise AU mobile: 04xx → +614xx
  const toNormalised = to.replace(/\s+/g, '').replace(/^0/, '+61');
  console.log(`send-test-sms: to=${toNormalised} slug=${slug} len=${message.length}`);

  // Send via Twilio REST API
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const params = new URLSearchParams({ To: toNormalised, From: FROM_NUMBER, Body: message });
  const twilioRes = await fetch(twilioUrl, {
    method:  'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const twilioData = await twilioRes.json() as Record<string, unknown>;
  console.log(`send-test-sms: twilio status=${twilioRes.status} sid=${twilioData.sid}`);

  if (!twilioRes.ok) {
    return json(twilioRes.status, {
      ok:    false,
      error: (twilioData.message as string) || 'Twilio error',
    });
  }

  const sid = twilioData.sid as string;

  // Log to test_sms_log (best-effort — non-fatal)
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/test_sms_log`, {
      method:  'POST',
      headers: {
        apikey:         SUPABASE_SERVICE_ROLE_KEY,
        Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer:         'return=minimal',
      },
      body: JSON.stringify({
        client_slug:  slug,
        to_number:    toNormalised,
        message_body: message,
        twilio_sid:   sid,
        cost:         0.10,
      }),
    });
  } catch (logErr) {
    console.warn(`send-test-sms: log insert failed (non-fatal): ${logErr instanceof Error ? logErr.message : String(logErr)}`);
  }

  return json(200, { ok: true, sid });
});
