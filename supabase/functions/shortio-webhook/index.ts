// shortio-webhook: receives click event webhooks from Short.io.
//
// Short.io POST body (application/json):
//   originalURL  — the destination URL
//   shortURL     — the short link that was clicked (e.g. https://cm1.au/slug)
//   browser      — browser name (e.g. "Chrome")
//   os           — operating system (e.g. "iOS")
//   country      — ISO country code
//   city         — city name
//   referrer     — referrer URL
//   timestamp    — ISO 8601 click timestamp
//
// On each event:
//   1. Look up client_id by matching clients.shortio_link against shortURL
//   2. Insert a row into link_clicks
//
// Auth: verify_jwt = false — Short.io carries no Bearer token.
// Always returns 200 — Short.io retries on non-2xx.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return ok();
  }

  try {
    const payload = await req.json().catch(() => null) as {
      originalURL?: unknown;
      shortURL?:    unknown;
      browser?:     unknown;
      os?:          unknown;
      country?:     unknown;
      city?:        unknown;
      referrer?:    unknown;
      timestamp?:   unknown;
    } | null;

    if (!payload) {
      console.warn('shortio-webhook: invalid or empty JSON body — ignoring');
      return ok();
    }

    const shortURL  = typeof payload.shortURL  === 'string' ? payload.shortURL.trim()  : null;
    const browser   = typeof payload.browser   === 'string' ? payload.browser.trim()   : null;
    const os        = typeof payload.os        === 'string' ? payload.os.trim()        : null;
    const country   = typeof payload.country   === 'string' ? payload.country.trim()   : null;
    const city      = typeof payload.city      === 'string' ? payload.city.trim()      : null;
    const referrer  = typeof payload.referrer  === 'string' ? payload.referrer.trim()  : null;
    const clickedAt = typeof payload.timestamp === 'string' ? payload.timestamp        : new Date().toISOString();

    if (!shortURL) {
      console.warn('shortio-webhook: missing shortURL — ignoring');
      return ok();
    }

    // Look up client by shortio_link
    const clientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients` +
      `?shortio_link=eq.${encodeURIComponent(shortURL)}` +
      `&is_test_account=eq.false&account_status=eq.active` +
      `&select=id&limit=1`,
      {
        headers: {
          apikey:        SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );

    if (!clientRes.ok) {
      console.warn(`shortio-webhook: client lookup failed ${clientRes.status} — ignoring`);
      return ok();
    }

    const clients = await clientRes.json() as { id: string }[];

    if (clients.length === 0) {
      console.warn(`shortio-webhook: no active client found for shortURL=${shortURL} — ignoring`);
      return ok();
    }

    const clientId = clients[0].id;

    // Insert into link_clicks.
    // Column mapping: rebrand_id → shortURL, user_agent → browser, device_type → os
    const insertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/link_clicks`,
      {
        method: 'POST',
        headers: {
          apikey:         SUPABASE_SERVICE_ROLE_KEY,
          Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer:         'return=minimal',
        },
        body: JSON.stringify({
          client_id:   clientId,
          clicked_at:  clickedAt,
          rebrand_id:  shortURL,
          user_agent:  browser,
          device_type: os,
          country,
          city,
          referrer,
          raw_payload: payload,
        }),
      },
    );

    if (!insertRes.ok) {
      const detail = await insertRes.text();
      console.error(`shortio-webhook: link_clicks insert failed ${insertRes.status}: ${detail}`);
    } else {
      console.log(`shortio-webhook: click recorded client_id=${clientId} shortURL=${shortURL} country=${country ?? '—'}`);
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`shortio-webhook fatal: ${errMsg}`);
  }

  return ok();
});

function ok(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status:  200,
    headers: { 'Content-Type': 'application/json' },
  });
}
