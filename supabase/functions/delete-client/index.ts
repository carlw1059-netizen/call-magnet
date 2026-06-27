import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin':  'https://callmagnet.com.au',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  let client_id: string;
  try {
    const body = await req.json() as { client_id?: string };
    client_id = (body.client_id || '').trim();
    if (!client_id) return json(400, { error: 'client_id is required' });
    if (!/^[0-9a-f-]{36}$/i.test(client_id)) return json(400, { error: 'client_id must be a valid UUID' });
  } catch {
    return json(400, { error: 'invalid JSON body' });
  }

  try {
    // delete_client_cascade sets app.allow_client_delete and deletes all child
    // rows + the client row in a single DB session, so the GUC persists across
    // all deletes and the prevent_client_delete trigger is satisfied.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_client_cascade`, {
      method: 'POST',
      headers: {
        apikey:         SUPABASE_SERVICE_ROLE_KEY,
        Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_client_id: client_id }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => String(res.status));
      throw new Error(`RPC delete_client_cascade failed (${res.status}): ${detail}`);
    }

    console.log(`delete-client: deleted client_id=${client_id}`);
    return json(200, { success: true });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`delete-client: ${msg}`);
    return json(500, { error: msg });
  }
});
