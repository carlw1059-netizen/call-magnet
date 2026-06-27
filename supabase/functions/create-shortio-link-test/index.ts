// create-shortio-link-test: diagnostic only — DELETE after testing.
// No auth — verify_jwt = false in config.toml. Admin page access is enough gate.
// POST { slug: string } → calls Short.io API → saves shortio_link_id to clients → returns raw response.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SHORTIO_API_KEY           = Deno.env.get('SHORTIO_API_KEY');
const SHORTIO_DOMAIN            = 'cm1.au';
const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
  if (!SHORTIO_API_KEY) return json(500, { error: 'SHORTIO_API_KEY not configured' });

  let slug: string;
  try {
    const body = await req.json() as { slug?: string };
    slug = (body.slug || '').trim();
    if (!slug) return json(400, { error: 'slug is required' });
  } catch {
    return json(400, { error: 'invalid JSON body' });
  }

  const originalURL = `https://callmagnet.com.au/b/${slug}`;
  console.log(`create-shortio-link-test: slug=${slug} url=${originalURL}`);

  try {
    const res = await fetch('https://api.short.io/links', {
      method: 'POST',
      headers: { 'authorization': SHORTIO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ domain: SHORTIO_DOMAIN, originalURL, path: slug }),
    });
    const data = await res.json();
    console.log(`create-shortio-link-test: status=${res.status} response=${JSON.stringify(data)}`);

    if (res.ok && data.id) {
      const dbRes = await fetch(
        `${SUPABASE_URL}/rest/v1/clients?middle_man_slug=eq.${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: {
            apikey:          SUPABASE_SERVICE_ROLE_KEY,
            Authorization:   `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type':  'application/json',
            Prefer:          'return=minimal',
          },
          body: JSON.stringify({ shortio_link_id: String(data.id) }),
        }
      );
      if (!dbRes.ok) {
        const detail = await dbRes.text().catch(() => String(dbRes.status));
        console.error(`create-shortio-link-test: failed to save shortio_link_id: ${detail}`);
      } else {
        console.log(`create-shortio-link-test: saved shortio_link_id=${data.id} for slug=${slug}`);
      }
    }

    return json(res.status, data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(500, { error: msg });
  }
});
