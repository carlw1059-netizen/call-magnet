import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getPreviousWeekRange } from '../_shared/weekly-utils.ts';
import { fetchActiveClients, ClientRow } from '../_shared/weekly-db.ts';
import { calcClientStats, buildWeeklyEmailHtml, ClientStats } from '../_shared/weekly-email.ts';

const INTERNAL_SECRET           = Deno.env.get('INTERNAL_SECRET');
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function countRest(table: string, filter: string): Promise<number> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?${filter}&select=id`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Prefer: 'count=exact', Range: '0-0' } },
    );
    if (!res.ok) return 0;
    const m = (res.headers.get('content-range') ?? '').match(/\/(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  }
}

async function sendCarlSummary(): Promise<void> {
  if (!RESEND_API_KEY) { console.warn('weekly-summary: RESEND_API_KEY missing — skipping carl summary'); return; }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [activeClients, missedCalls, smsSent, linkClicks] = await Promise.all([
    countRest('clients', 'account_status=eq.active&is_demo_account=eq.false&is_test_account=eq.false'),
    countRest('sms_events', `received_at=gte.${sevenDaysAgo}`),
    countRest('sms_events', `received_at=gte.${sevenDaysAgo}&twilio_message_sid=not.is.null`),
    countRest('link_clicks', `clicked_at=gte.${sevenDaysAgo}`),
  ]);

  const fmt = (d: Date) => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  const now     = new Date();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const dateRange = `${fmt(weekAgo)} – ${fmt(now)}`;

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    'CallMagnet <hello@callmagnet.com.au>',
      to:      'hello@callmagnet.com.au',
      subject: `CallMagnet Weekly — ${dateRange}`,
      text: [
        `CallMagnet Weekly — ${dateRange}`,
        '',
        `Active clients:      ${activeClients}`,
        `Missed calls caught: ${missedCalls}`,
        `SMS sent:            ${smsSent}`,
        `Link clicks:         ${linkClicks}`,
      ].join('\n'),
    }),
  });
  if (!res.ok) {
    console.error(`weekly-summary: carl summary email failed: ${res.status} ${await res.text()}`);
  } else {
    console.log(`weekly-summary: carl summary sent (${dateRange}) — clients=${activeClients} calls=${missedCalls} sms=${smsSent} clicks=${linkClicks}`);
  }
}

async function sendWeeklySummaries(): Promise<{ sent: number; skipped: number; failed: number }> {
  const { weekStart, weekEnd, monLabel, sunLabel } = getPreviousWeekRange();
  const clients = await fetchActiveClients();
  let sent = 0, skipped = 0, failed = 0;
  for (const client of clients) {
    if (!client.email) { skipped++; continue; }
    try {
      const stats = await calcClientStats(client, weekStart, weekEnd);
      const html  = buildWeeklyEmailHtml(client, stats, monLabel, sunLabel);
      const res   = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'CallMagnet <hello@callmagnet.com.au>', to: [client.email], subject: 'CallMagnet Weekly Summary', html }),
      });
      if (!res.ok) { console.error(`weekly-summary: failed for ${client.id}: ${res.status} ${await res.text()}`); failed++; }
      else { console.log(`weekly-summary: sent to ${client.id}`); sent++; }
    } catch (err) {
      console.error(`weekly-summary: error for ${client.id}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }
  return { sent, skipped, failed };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get('warmup') === '1') return json(200, { warmup: 'ok' });
  if (url.searchParams.get('test') === '1') {
    const { monLabel, sunLabel, weekStart, weekEnd } = getPreviousWeekRange();
    const testClient: ClientRow = { id: 'test', business_name: 'Test Business', email: 'hello@callmagnet.com.au', sms_included: 500, reset_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), last_renewal_date: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString() };
    const testStats: ClientStats = { smsSent: 47, linkClicks: 23, bookingsLogged: 8, conversionRate: '48.9%', daysUntilRenewal: 14, overage: 0, buttonClicks: [{ intent: '🍽️ Book a table', count: 12 }, { intent: '✏️ Change or cancel my booking', count: 5 }, { intent: '🎁 Function enquiry', count: 3 }] };
    const html = buildWeeklyEmailHtml(testClient, testStats, monLabel, sunLabel);
    const res  = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'CallMagnet <hello@callmagnet.com.au>', to: ['hello@callmagnet.com.au'], subject: 'CallMagnet Weekly Summary — TEST', html }),
    });
    return json(res.ok ? 200 : 500, await res.json());
  }
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!INTERNAL_SECRET) return json(500, { error: 'config_error' });
  if (req.headers.get('X-Internal-Secret') !== INTERNAL_SECRET) return json(401, { error: 'unauthorized' });
  if (!RESEND_API_KEY) return json(500, { error: 'config_error' });
  try {
    const [result] = await Promise.all([
      sendWeeklySummaries(),
      sendCarlSummary(),
    ]);
    console.log(`weekly-summary complete: ${JSON.stringify(result)}`);
    return json(200, { ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`weekly-summary fatal: ${msg}`);
    return json(500, { error: 'internal_error', detail: msg });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
