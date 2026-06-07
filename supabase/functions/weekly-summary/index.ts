// weekly-summary: fired every Sunday 23:00 UTC (= Monday 9am AEST / Monday 9am AEDT).
// Sends one HTML email per active client showing their previous 7-day stats.
// Auth: X-Internal-Secret header — same pattern as send-daily-summary / monthly-report.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET           = Deno.env.get('INTERNAL_SECRET');
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY');

const BRAND = {
  pageBackground: '#F5F5F5',
  cardBackground: '#FFFFFF',
  borderColor:    '#000000',
  accent:         '#10b981',
  primaryText:    '#000000',
  mutedText:      '#888888',
};

function escapeHtml(str: string): string {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function tzOffsetMillis(date: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get   = (t: string) => parseInt(parts.find(p => p.type === t)?.value || '0', 10);
  let hour    = get('hour');
  if (hour === 24) hour = 0;
  const tzMs  = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return tzMs - date.getTime();
}

function melbourneLocalToUtc(year: number, month: number, day: number, hh = 0, mm = 0, ss = 0, ms = 0): Date {
  const naive  = new Date(Date.UTC(year, month - 1, day, hh, mm, ss, ms));
  const offset = tzOffsetMillis(naive, 'Australia/Melbourne');
  return new Date(naive.getTime() - offset);
}

function getPreviousWeekRange(): { weekStart: string; weekEnd: string; monLabel: string; sunLabel: string; } {
  const now    = new Date();
  const offset = tzOffsetMillis(now, 'Australia/Melbourne');
  const melb   = new Date(now.getTime() + offset);
  const dow    = melb.getUTCDay();
  const daysSinceMon = dow === 0 ? 6 : dow - 1;
  const prevMonDay   = melb.getUTCDate() - daysSinceMon - 7;
  const prevSunDay   = prevMonDay + 6;
  const weekStartUtc = melbourneLocalToUtc(melb.getUTCFullYear(), melb.getUTCMonth() + 1, prevMonDay, 0, 0, 0, 0);
  const weekEndUtc   = melbourneLocalToUtc(melb.getUTCFullYear(), melb.getUTCMonth() + 1, prevSunDay, 23, 59, 59, 999);
  const fmt = (d: Date) => d.toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short' });
  return { weekStart: weekStartUtc.toISOString(), weekEnd: weekEndUtc.toISOString(), monLabel: fmt(weekStartUtc), sunLabel: fmt(weekEndUtc) };
}

async function countRows(table: string, tsColumn: string, clientId: string, rangeStart: string, rangeEnd: string): Promise<number> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?client_id=eq.${encodeURIComponent(clientId)}&${tsColumn}=gte.${encodeURIComponent(rangeStart)}&${tsColumn}=lte.${encodeURIComponent(rangeEnd)}&select=id`;
  const res = await fetch(url, { method: 'HEAD', headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Prefer: 'count=exact' } });
  if (!res.ok) throw new Error(`count_${table}_failed: ${res.status}`);
  const contentRange = res.headers.get('content-range') || '*/0';
  const slash = contentRange.lastIndexOf('/');
  const total = parseInt(slash >= 0 ? contentRange.slice(slash + 1) : '0', 10);
  return Number.isFinite(total) ? total : 0;
}

interface ClientRow {
  id: string;
  business_name: string;
  email: string | null;
  sms_included: number | null;
  reset_date: string | null;
  last_renewal_date: string | null;
}

async function fetchActiveClients(): Promise<ClientRow[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/clients?account_status=eq.active&is_test_account=not.is.true&select=id,business_name,email,sms_included,reset_date,last_renewal_date`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  if (!res.ok) throw new Error(`clients_fetch_failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<ClientRow[]>;
}
