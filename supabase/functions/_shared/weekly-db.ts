const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export interface ClientRow {
  id:                string;
  business_name:     string;
  email:             string | null;
  sms_included:      number | null;
  reset_date:        string | null;
  last_renewal_date: string | null;
}

export async function countRows(table: string, tsColumn: string, clientId: string, rangeStart: string, rangeEnd: string): Promise<number> {
  const url =
    `${SUPABASE_URL}/rest/v1/${table}` +
    `?client_id=eq.${encodeURIComponent(clientId)}` +
    `&${tsColumn}=gte.${encodeURIComponent(rangeStart)}` +
    `&${tsColumn}=lte.${encodeURIComponent(rangeEnd)}` +
    `&select=id`;
  const res = await fetch(url, {
    method: 'HEAD',
    headers: {
      apikey:        SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer:        'count=exact',
    },
  });
  if (!res.ok) throw new Error(`count_${table}_failed: ${res.status}`);
  const contentRange = res.headers.get('content-range') || '*/0';
  const slash        = contentRange.lastIndexOf('/');
  const total        = parseInt(slash >= 0 ? contentRange.slice(slash + 1) : '0', 10);
  return Number.isFinite(total) ? total : 0;
}

export async function fetchActiveClients(): Promise<ClientRow[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/clients` +
    `?account_status=eq.active` +
    `&is_test_account=not.is.true` +
    `&select=id,business_name,email,sms_included,reset_date,last_renewal_date`,
    {
      headers: {
        apikey:        SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!res.ok) throw new Error(`clients_fetch_failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<ClientRow[]>;
}
