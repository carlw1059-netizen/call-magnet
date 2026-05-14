// create-rebrandly-link: helper edge function. POSTs a long destination URL
// to Rebrandly's /v1/links API and returns the short URL. Used by
// request-login-link to shorten the Supabase magic-link URL before SMSing
// it to the user.
//
// Auth: shared-secret via X-Internal-Secret header. Same pattern as
// send-twilio-sms / send-pushover-alert.
//
// Body (application/json):
//   destination  string  required  the long URL to shorten (must include scheme)
//   title        string  optional  internal label shown in Rebrandly dashboard
//   domain       string  optional  custom short domain (defaults to rebrand.ly)
//
// Vault prereqs:
//   REBRANDLY_API_KEY  Rebrandly account API key (from rebrandly.com → Account → API Keys)
//   INTERNAL_SECRET    shared secret for caller auth
//
// Returns on success:
//   { ok: true, short_url: 'https://rebrand.ly/abc123', link_id: 'xxx' }
//
// Returns on Rebrandly API failure (4xx/5xx):
//   { ok: false, error: 'rebrandly_api_failed', status, detail }
//   Callers should fall back to the long URL — never block the user flow.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const REBRANDLY_API_KEY = Deno.env.get('REBRANDLY_API_KEY');
const INTERNAL_SECRET   = Deno.env.get('INTERNAL_SECRET');

Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get('warmup') === '1') {
    return new Response(JSON.stringify({ warmup: 'ok' }), {
      status:  200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    if (!INTERNAL_SECRET) {
      console.error('create-rebrandly-link: INTERNAL_SECRET missing from Vault');
      return json(500, { ok: false, error: 'config_error', detail: 'INTERNAL_SECRET not configured' });
    }
    if (req.headers.get('X-Internal-Secret') !== INTERNAL_SECRET) {
      return json(401, { ok: false, error: 'unauthorized' });
    }

    if (!REBRANDLY_API_KEY) {
      console.warn('create-rebrandly-link: REBRANDLY_API_KEY missing from Vault — cannot shorten');
      return json(500, { ok: false, error: 'rebrandly_api_key_missing', detail: 'REBRANDLY_API_KEY not configured in Vault' });
    }

    const body = await req.json().catch(() => null) as { destination?: unknown; title?: unknown; domain?: unknown } | null;
    if (!body || typeof body !== 'object') {
      return json(400, { ok: false, error: 'invalid_body', detail: 'JSON body required' });
    }
    const destination = typeof body.destination === 'string' ? body.destination.trim() : '';
    const title       = typeof body.title       === 'string' ? body.title.trim()       : '';
    const domain      = typeof body.domain      === 'string' ? body.domain.trim()      : '';

    if (!destination) {
      return json(400, { ok: false, error: 'missing_required_field', detail: 'destination is required' });
    }
    if (!/^https?:\/\//.test(destination)) {
      return json(400, { ok: false, error: 'invalid_destination', detail: 'destination must start with http:// or https://' });
    }

    const reqBody: Record<string, unknown> = { destination };
    if (title)  reqBody.title  = title;
    if (domain) reqBody.domain = { fullName: domain };

    const rebrandlyRes = await fetch('https://api.rebrandly.com/v1/links', {
      method:  'POST',
      headers: {
        apikey:         REBRANDLY_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(reqBody),
    });

    if (!rebrandlyRes.ok) {
      const errBody = await rebrandlyRes.text();
      console.error(`rebrandly_api_failed: status=${rebrandlyRes.status} body=${errBody}`);
      return json(200, { ok: false, error: 'rebrandly_api_failed', status: rebrandlyRes.status, detail: errBody });
    }

    const data = await rebrandlyRes.json();
    // Rebrandly returns { id, shortUrl, ... }. shortUrl already includes scheme.
    const short_url = typeof data?.shortUrl === 'string'
      ? (data.shortUrl.startsWith('http') ? data.shortUrl : `https://${data.shortUrl}`)
      : null;
    const link_id = typeof data?.id === 'string' ? data.id : null;

    if (!short_url) {
      console.error(`rebrandly_api_no_short_url: response=${JSON.stringify(data)}`);
      return json(200, { ok: false, error: 'rebrandly_api_no_short_url', detail: 'Rebrandly response missing shortUrl field' });
    }

    console.log(`create-rebrandly-link: ${destination.slice(0, 40)}... → ${short_url} (id=${link_id})`);
    return json(200, { ok: true, short_url, link_id });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`create-rebrandly-link fatal: ${msg}`);
    return json(500, { ok: false, error: 'internal_error', detail: msg });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
