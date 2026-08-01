import { countRows, ClientRow } from './weekly-db.ts';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export interface ClientStats {
  smsSent:          number;
  optOuts:          number;
  linkClicks:       number;
  bookingsLogged:   number;
  conversionRate:   string;
  daysUntilRenewal: number | null;
  overage:          number;
  buttonClicks:     Array<{ intent: string; count: number; peakHours: Array<{ hour: number; count: number }> }>;
  heatmapData:      Array<{ day_of_week: number; hour_of_day: number; call_count: number }>;
}


async function fetchButtonClicksWithHours(clientId: string): Promise<Array<{ intent: string; count: number; peakHours: Array<{ hour: number; count: number }> }>> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const url =
    `${SUPABASE_URL}/rest/v1/link_clicks` +
    `?client_id=eq.${encodeURIComponent(clientId)}` +
    `&clicked_at=gte.${encodeURIComponent(ninetyDaysAgo)}` +
    `&intent=not.is.null` +
    `&select=intent,hour_of_day`;
  const res = await fetch(url, {
    headers: {
      apikey:        SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return [];
  const rows = await res.json() as Array<{ intent: string; hour_of_day: number }>;
  const byIntent: Record<string, Record<number, number>> = {};
  for (const row of rows) {
    if (!byIntent[row.intent]) byIntent[row.intent] = {};
    byIntent[row.intent][row.hour_of_day] = (byIntent[row.intent][row.hour_of_day] ?? 0) + 1;
  }
  return Object.entries(byIntent).map(([intent, hourCounts]) => {
    const total = Object.values(hourCounts).reduce((a, b) => a + b, 0);
    const peakHours = Object.entries(hourCounts)
      .map(([h, c]) => ({ hour: Number(h), count: c }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    return { intent, count: total, peakHours };
  }).sort((a, b) => b.count - a.count);
}

async function fetchHeatmapData(clientId: string): Promise<Array<{ day_of_week: number; hour_of_day: number; call_count: number }>> {
  const url = `${SUPABASE_URL}/rest/v1/rpc/get_heatmap_data`;
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey:        SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_client_id: clientId, p_date_from: ninetyDaysAgo, p_date_to: new Date().toISOString() }),
  });
  if (!res.ok) return [];
  return res.json();
}

export async function calcClientStats(client: ClientRow, weekStart: string, weekEnd: string): Promise<ClientStats> {
  const now         = new Date().toISOString();
  const periodStart = client.last_renewal_date ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [smsSent, optOuts, linkClicks, bookingsLogged, currentPeriodSms, buttonClicks, heatmapData] = await Promise.all([
    countRows('sms_events',  'received_at', client.id, weekStart, weekEnd),
    countRows('opt_outs',    'opted_out_at', client.id, weekStart, weekEnd),
    countRows('link_clicks', 'clicked_at',  client.id, weekStart, weekEnd),
    countRows('bookings',    'booked_at',   client.id, weekStart, weekEnd),
    countRows('sms_events',  'received_at', client.id, periodStart, now),
    fetchButtonClicksWithHours(client.id),
    fetchHeatmapData(client.id),
  ]);
  const conversionRate = smsSent > 0 ? `${(linkClicks / smsSent * 100).toFixed(1)}%` : '0%';
  let daysUntilRenewal: number | null = null;
  if (client.reset_date) {
    const msUntil = new Date(client.reset_date).getTime() - Date.now();
    daysUntilRenewal = msUntil > 0 ? Math.ceil(msUntil / 86_400_000) : 0;
  }
  const overage = Math.max(0, currentPeriodSms - (client.sms_included ?? 0));
  return { smsSent, optOuts, linkClicks, bookingsLogged, conversionRate, daysUntilRenewal, overage, buttonClicks, heatmapData };
}

function escapeHtml(str: string): string {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildHeatmapTable(heatmapData: Array<{ day_of_week: number; hour_of_day: number; call_count: number }>): string {
  if (heatmapData.length === 0) return '';
  const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const HOUR_LABELS = ['12am','1am','2am','3am','4am','5am','6am','7am','8am','9am','10am','11am','12pm','1pm','2pm','3pm','4pm','5pm','6pm','7pm','8pm','9pm','10pm','11pm'];
  const DAYS  = [0,1,2,3,4,5,6];
  const SHOW_HOURS = [8,9,10,11,12,13,14,15,16,17,18,19,20,21];
  const lookup: Record<string, number> = {};
  let maxCount = 0;
  for (const row of heatmapData) {
    lookup[`${row.day_of_week}-${row.hour_of_day}`] = row.call_count;
    if (row.call_count > maxCount) maxCount = row.call_count;
  }
  let peakDay = 0; let peakHour = 0;
  for (const row of heatmapData) {
    if (row.call_count === maxCount) { peakDay = row.day_of_week; peakHour = row.hour_of_day; }
  }
  function cellBg(count: number): string {
    if (count === 0 || maxCount === 0) return '#f5f5f5';
    const intensity = count / maxCount;
    if (intensity < 0.25) return '#d1fae5';
    if (intensity < 0.5)  return '#6ee7b7';
    if (intensity < 0.75) return '#10b981';
    return '#047857';
  }
  function cellColor(count: number): string {
    if (count === 0 || maxCount === 0) return '#cccccc';
    const intensity = count / maxCount;
    return intensity >= 0.5 ? '#ffffff' : '#000000';
  }
  const headerCells = SHOW_HOURS.map(h => `<td style="padding:3px 4px;font-size:10px;color:#888888;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${HOUR_LABELS[h]}</td>`).join('');
  const bodyRows = DAYS.map(d => {
    const cells = SHOW_HOURS.map(h => {
      const count = lookup[`${d}-${h}`] ?? 0;
      const bg    = cellBg(count);
      const color = cellColor(count);
      const text  = count > 0 ? String(count) : '';
      return `<td style="padding:4px 2px;background:${bg};text-align:center;font-size:10px;font-weight:700;color:${color};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;border-radius:2px;">${text}</td>`;
    }).join('');
    return `<tr><td style="padding:4px 6px 4px 0;font-size:11px;color:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;white-space:nowrap;">${DAY_LABELS[d]}</td>${cells}</tr>`;
  }).join('');
  const peakSentence = `Peak: ${DAY_LABELS[peakDay]} ${HOUR_LABELS[peakHour]} (${maxCount} missed call${maxCount === 1 ? '' : 's'})`;
  return `<p style="margin:24px 0 12px;font-size:13px;font-weight:700;color:#10b981;letter-spacing:0.04em;text-transform:uppercase;">When they called <span style="font-weight:400;color:#888888;font-size:11px;text-transform:none;">(last 90 days, 8am–10pm)</span></p><div style="overflow-x:auto;"><table role="presentation" cellpadding="0" cellspacing="2" border="0" style="min-width:320px;"><tr><td></td>${headerCells}</tr>${bodyRows}</table></div><p style="margin:8px 0 0;font-size:12px;color:#888888;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${escapeHtml(peakSentence)}</p>`;
}

function buildStatsRows(stats: ClientStats): string {
  const rows = [
    { label: 'Missed callers who got your message', value: String(stats.smsSent) },
    ...(stats.optOuts > 0 ? [{ label: 'Opt-Outs', value: String(stats.optOuts) }] : []),
    { label: 'People who opened your page',         value: String(stats.linkClicks) },
    { label: 'Bookings logged via your page',       value: String(stats.bookingsLogged) },
    { label: 'Page open rate',                      value: stats.conversionRate },
    { label: 'Days until renewal',                  value: stats.daysUntilRenewal !== null ? String(stats.daysUntilRenewal) : '—' },
    { label: 'Overage',                             value: stats.overage > 0 ? `+${stats.overage}` : '0' },
  ];
  const rowsHtml = rows.map((row, i) => {
    const top = i === 0 ? '' : 'border-top:1px solid #000000;';
    return `<tr><td style="${top}padding:14px 0;font-size:14px;color:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${escapeHtml(row.label)}</td><td style="${top}padding:14px 0;font-size:16px;font-weight:700;color:#10b981;text-align:right;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${escapeHtml(row.value)}</td></tr>`;
  }).join('\n');
  let buttonSection = '';
  if (stats.buttonClicks.length > 0) {
    const HOUR_LABELS = ['12am','1am','2am','3am','4am','5am','6am','7am','8am','9am','10am','11am','12pm','1pm','2pm','3pm','4pm','5pm','6pm','7pm','8pm','9pm','10pm','11pm'];
    const buttonRows = stats.buttonClicks.map(b => {
      const peakStr = b.peakHours.length > 0
        ? '↳ Peak: ' + b.peakHours.map(p => `${HOUR_LABELS[p.hour]} (${p.count})`).join(', ')
        : '';
      const peakRow = peakStr
        ? `<tr><td colspan="2" style="padding:0 0 10px 0;font-size:11px;color:#888888;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${escapeHtml(peakStr)}</td></tr>`
        : '';
      return `<tr><td style="border-top:1px solid #eeeeee;padding:10px 0 4px 0;font-size:13px;color:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${escapeHtml(b.intent)}</td><td style="border-top:1px solid #eeeeee;padding:10px 0 4px 0;font-size:14px;font-weight:700;color:#10b981;text-align:right;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${b.count}</td></tr>${peakRow}`;
    }).join('\n');
    buttonSection = `<p style="margin:24px 0 12px;font-size:13px;font-weight:700;color:#10b981;letter-spacing:0.04em;text-transform:uppercase;">Button clicks</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${buttonRows}</table>`;
  }
  const heatmapSection = buildHeatmapTable(stats.heatmapData);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}</table>${buttonSection}${heatmapSection}`;
}

function buildFooter(): string {
  return `<tr><td align="center" style="background:#F5F5F5;border:1px solid #000000;border-top:none;border-radius:0 0 8px 8px;padding:20px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#888888;line-height:1.6;">You&rsquo;re receiving this because you&rsquo;re a CallMagnet client.<br><a href="mailto:hello@callmagnet.com.au" style="color:#10b981;text-decoration:none;">Contact us</a></td></tr>`;
}

export function buildWeeklyEmailHtml(client: ClientRow, stats: ClientStats, monLabel: string, sunLabel: string): string {
  const weekLabel = escapeHtml(`Week of ${monLabel} — ${sunLabel}`);
  const preheader = escapeHtml(`Your CallMagnet weekly summary — ${monLabel} to ${sunLabel}`);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CallMagnet Weekly Summary</title></head><body style="margin:0;padding:0;background:#F5F5F5;"><div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:transparent;">${preheader}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F5;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;"><tr><td style="background:#F5F5F5;border:1px solid #000000;border-bottom:2px solid #10b981;border-radius:8px 8px 0 0;padding:20px 28px;"><span style="font-family:ui-monospace,monospace;font-size:14px;font-weight:700;letter-spacing:0.16em;color:#10b981;text-transform:uppercase;">★ CallMagnet</span></td></tr><tr><td style="background:#FFFFFF;border:1px solid #000000;border-top:none;border-radius:0 0 8px 8px;padding:28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><p style="margin:0 0 16px;font-size:22px;font-weight:700;color:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${stats.smsSent} people tried to reach ${escapeHtml(client.business_name)} last week</p><p style="margin:0 0 24px;font-size:13px;color:#888888;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${weekLabel}</p>${buildStatsRows(stats)}</td></tr>${buildFooter()}</table></td></tr></table></body></html>`;
}
