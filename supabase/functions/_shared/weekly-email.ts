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
  buttonClicks:     Array<{ intent: string; count: number }>;
}

async function fetchButtonClicks(clientId: string, weekStart: string, weekEnd: string): Promise<Array<{ intent: string; count: number }>> {
  const url =
    `${SUPABASE_URL}/rest/v1/link_clicks` +
    `?client_id=eq.${encodeURIComponent(clientId)}` +
    `&clicked_at=gte.${encodeURIComponent(weekStart)}` +
    `&clicked_at=lte.${encodeURIComponent(weekEnd)}` +
    `&intent=not.is.null` +
    `&select=intent`;
  const res = await fetch(url, {
    headers: {
      apikey:        SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return [];
  const rows = await res.json() as Array<{ intent: string }>;
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.intent] = (counts[row.intent] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count);
}

export async function calcClientStats(client: ClientRow, weekStart: string, weekEnd: string): Promise<ClientStats> {
  const now         = new Date().toISOString();
  const periodStart = client.last_renewal_date ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [smsSent, optOuts, linkClicks, bookingsLogged, currentPeriodSms, buttonClicks] = await Promise.all([
    countRows('sms_events',  'received_at', client.id, weekStart, weekEnd),
    countRows('opt_outs',    'opted_out_at', client.id, weekStart, weekEnd),
    countRows('link_clicks', 'clicked_at',  client.id, weekStart, weekEnd),
    countRows('bookings',    'booked_at',   client.id, weekStart, weekEnd),
    countRows('sms_events',  'received_at', client.id, periodStart, now),
    fetchButtonClicks(client.id, weekStart, weekEnd),
  ]);
  const conversionRate = smsSent > 0 ? `${(linkClicks / smsSent * 100).toFixed(1)}%` : '0%';
  let daysUntilRenewal: number | null = null;
  if (client.reset_date) {
    const msUntil = new Date(client.reset_date).getTime() - Date.now();
    daysUntilRenewal = msUntil > 0 ? Math.ceil(msUntil / 86_400_000) : 0;
  }
  const overage = Math.max(0, currentPeriodSms - (client.sms_included ?? 0));
  return { smsSent, optOuts, linkClicks, bookingsLogged, conversionRate, daysUntilRenewal, overage, buttonClicks };
}

function escapeHtml(str: string): string {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildStatsRows(stats: ClientStats): string {
  const rows = [
    { label: 'SMS Sent',           value: String(stats.smsSent) },
    ...(stats.optOuts > 0 ? [{ label: 'Opt-Outs', value: String(stats.optOuts) }] : []),
    { label: 'Link Clicks',        value: String(stats.linkClicks) },
    { label: 'Bookings Logged',    value: String(stats.bookingsLogged) },
    { label: 'Conversion Rate',    value: stats.conversionRate },
    { label: 'Days Until Renewal', value: stats.daysUntilRenewal !== null ? String(stats.daysUntilRenewal) : '—' },
    { label: 'Overage',            value: stats.overage > 0 ? `+${stats.overage}` : '0' },
  ];
  const rowsHtml = rows.map((row, i) => {
    const top = i === 0 ? '' : 'border-top:1px solid #000000;';
    return `<tr><td style="${top}padding:14px 0;font-size:14px;color:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${escapeHtml(row.label)}</td><td style="${top}padding:14px 0;font-size:16px;font-weight:700;color:#10b981;text-align:right;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${escapeHtml(row.value)}</td></tr>`;
  }).join('\n');
  let buttonSection = '';
  if (stats.buttonClicks.length > 0) {
    const buttonRows = stats.buttonClicks.map(b =>
      `<tr><td style="border-top:1px solid #eeeeee;padding:10px 0;font-size:13px;color:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${escapeHtml(b.intent)}</td><td style="border-top:1px solid #eeeeee;padding:10px 0;font-size:14px;font-weight:700;color:#10b981;text-align:right;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${b.count}</td></tr>`
    ).join('\n');
    buttonSection = `<p style="margin:24px 0 12px;font-size:13px;font-weight:700;color:#10b981;letter-spacing:0.04em;text-transform:uppercase;">Button clicks</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${buttonRows}</table>`;
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}</table>${buttonSection}`;
}

function buildFooter(): string {
  return `<tr><td align="center" style="background:#F5F5F5;border:1px solid #000000;border-top:none;border-radius:0 0 8px 8px;padding:20px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#888888;line-height:1.6;">You&rsquo;re receiving this because you&rsquo;re a CallMagnet client.<br><a href="mailto:hello@callmagnet.com.au" style="color:#10b981;text-decoration:none;">Contact us</a></td></tr>`;
}

export function buildWeeklyEmailHtml(client: ClientRow, stats: ClientStats, monLabel: string, sunLabel: string): string {
  const weekLabel = escapeHtml(`Week of ${monLabel} — ${sunLabel}`);
  const preheader = escapeHtml(`Your CallMagnet weekly summary — ${monLabel} to ${sunLabel}`);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CallMagnet Weekly Summary</title></head><body style="margin:0;padding:0;background:#F5F5F5;"><div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:transparent;">${preheader}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F5;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;"><tr><td style="background:#F5F5F5;border:1px solid #000000;border-bottom:2px solid #10b981;border-radius:8px 8px 0 0;padding:20px 28px;"><span style="font-family:ui-monospace,monospace;font-size:14px;font-weight:700;letter-spacing:0.16em;color:#10b981;text-transform:uppercase;">★ CallMagnet</span></td></tr><tr><td style="background:#FFFFFF;border:1px solid #000000;border-top:none;border-radius:0 0 8px 8px;padding:28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><p style="margin:0 0 24px;font-size:14px;font-weight:700;color:#10b981;letter-spacing:0.04em;">${weekLabel}</p>${buildStatsRows(stats)}</td></tr>${buildFooter()}</table></td></tr></table></body></html>`;
}
