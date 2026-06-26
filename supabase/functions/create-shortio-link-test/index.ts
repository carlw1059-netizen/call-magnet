// create-shortio-link-test: diagnostic only — DELETE after testing.
// POST { slug: string } with X-Internal-Secret header.
// Calls Short.io API and returns the raw response.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const INTERNAL_SECRET = Deno.env.get('INTERNAL_SECRET');
const SHORTIO_API_KEY = Deno.env.get('SHORTIO_API_KEY');
const SHORTIO_DOMAIN  = 'cm1.au';

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
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
  if (!INTERNAL_SECRET) return json(500, { error: 'INTERNAL_SECRET not configured' });
  if (req.headers.get('X-Internal-Secret') !== INTERNAL_SECRET) return json(401, { error: 'unauthorized' });
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
  console.log(`create-shortio-link-test: slug=${slug} url=${originalURL} key_prefix=${SHORTIO_API_KEY.slice(0, 8)}`);

  try {
    const res = await fetch('https://api.short.io/links', {
      method: 'POST',
      headers: {
        'authorization': SHORTIO_API_KEY,
        'content-type':  'application/json',
      },
      body: JSON.stringify({ domain: SHORTIO_DOMAIN, originalURL, path: slug }),
    });
    const data = await res.json();
    console.log(`create-shortio-link-test: status=${res.status} response=${JSON.stringify(data)}`);
    return json(res.status, data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`create-shortio-link-test: ${msg}`);
    return json(500, { error: msg });
  }
});
