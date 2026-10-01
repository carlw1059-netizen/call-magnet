import { BRAND, escapeHtml as sharedEscapeHtml, renderEmailShell } from './emailStyles.ts';
import { ui } from './emailUi.ts';
import { getEmailParts } from './emailCopy.ts';
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
  socialTaps:       Array<{ platform: string; count: number }>;
}


async function fetchButtonClicksWithHours(clientId: string): Promise<Array<{ intent: string; count: number; peakHours: Array<{ hour: number; count: number }> }>> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const url =
    `${SUPABASE_URL}/rest/v1/link_clicks` +
    `?client_id=eq.${encodeURIComponent(clientId)}` +
    `&clicked_at=gte.${encodeURIComponent(ninetyDaysAgo)}` +
    `&intent=not.is.null` +
    `&intent=not.like.social_%25` +
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

const SOCIAL_FRIENDLY: Record<string, string> = {
  social_instagram:  'Instagram',
  social_facebook:   'Facebook',
  social_tiktok:     'TikTok',
  social_youtube:    'YouTube',
  social_whatsapp:   'WhatsApp',
  social_spotify:    'Spotify',
  social_soundcloud: 'SoundCloud',
};

async function fetchSocialTaps(clientId: string, weekStart: string, weekEnd: string): Promise<Array<{ platform: string; count: number }>> {
  const url =
    `${SUPABASE_URL}/rest/v1/link_clicks` +
    `?client_id=eq.${encodeURIComponent(clientId)}` +
    `&clicked_at=gte.${encodeURIComponent(weekStart)}` +
    `&clicked_at=lte.${encodeURIComponent(weekEnd)}` +
    `&intent=like.social_%25` +
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
    if (row.intent in SOCIAL_FRIENDLY) counts[row.intent] = (counts[row.intent] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([intent, count]) => ({ platform: SOCIAL_FRIENDLY[intent], count }))
    .sort((a, b) => b.count - a.count);
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

async function countLinkClicksExcludingSocial(clientId: string, weekStart: string, weekEnd: string): Promise<number> {
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/link_clicks` +
      `?client_id=eq.${encodeURIComponent(clientId)}` +
      `&clicked_at=gte.${encodeURIComponent(weekStart)}` +
      `&clicked_at=lte.${encodeURIComponent(weekEnd)}` +
      `&or=(intent.is.null,intent.not.like.social_%25)` +
      `&select=id`;
    const res = await fetch(url, {
      method: 'HEAD',
      headers: {
        apikey:        SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer:        'count=exact',
      },
    });
    if (!res.ok) return 0;
    const m = (res.headers.get('content-range') ?? '').match(/\/(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  }
}

export async function calcClientStats(client: ClientRow, weekStart: string, weekEnd: string): Promise<ClientStats> {
  const now         = new Date().toISOString();
  const periodStart = client.last_renewal_date ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [smsSent, optOuts, linkClicks, bookingsLogged, currentPeriodSms, buttonClicks, heatmapData, socialTaps] = await Promise.all([
    countRows('sms_events',  'received_at', client.id, weekStart, weekEnd),
    countRows('opt_outs',    'opted_out_at', client.id, weekStart, weekEnd),
    countLinkClicksExcludingSocial(client.id, weekStart, weekEnd),
    countRows('bookings',    'booked_at',   client.id, weekStart, weekEnd),
    countRows('sms_events',  'received_at', client.id, periodStart, now),
    fetchButtonClicksWithHours(client.id),
    fetchHeatmapData(client.id),
    fetchSocialTaps(client.id, weekStart, weekEnd),
  ]);
  const conversionRate = smsSent > 0 ? `${(linkClicks / smsSent * 100).toFixed(1)}%` : '0%';
  let daysUntilRenewal: number | null = null;
  if (client.reset_date) {
    const msUntil = new Date(client.reset_date).getTime() - Date.now();
    daysUntilRenewal = msUntil > 0 ? Math.ceil(msUntil / 86_400_000) : 0;
  }
  const overage = Math.max(0, currentPeriodSms - (client.sms_included ?? 0));
  return { smsSent, optOuts, linkClicks, bookingsLogged, conversionRate, daysUntilRenewal, overage, buttonClicks, heatmapData, socialTaps };
}

function buildHeatmapTable(heatmapData: Array<{ day_of_week: number; hour_of_day: number; call_count: number }>): string {
  if (heatmapData.length === 0) return '';
  const F = BRAND.fontStack;
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
    if (count === 0 || maxCount === 0) return BRAND.pageBackground;
    const intensity = count / maxCount;
    if (intensity < 0.25) return 'rgba(6,214,160,0.25)';
    if (intensity < 0.5)  return 'rgba(6,214,160,0.5)';
    if (intensity < 0.75) return 'rgba(6,214,160,0.75)';
    return BRAND.accent;
  }
  function cellColor(count: number): string {
    if (count === 0 || maxCount === 0) return BRAND.secondaryText;
    return count / maxCount >= 0.5 ? BRAND.pageBackground : BRAND.primaryText;
  }
  const headerCells = SHOW_HOURS.map(h => `<td style="padding:3px 2px;font-size:9px;color:${BRAND.secondaryText};text-align:center;font-family:${F};">${HOUR_LABELS[h]}</td>`).join('');
  const bodyRows = DAYS.map(d => {
    const cells = SHOW_HOURS.map(h => {
      const count = lookup[`${d}-${h}`] ?? 0;
      return `<td style="padding:4px 2px;height:18px;background:${cellBg(count)};border:1px solid ${BRAND.borderColor};border-radius:2px;text-align:center;font-size:10px;font-weight:700;color:${cellColor(count)};font-family:${F};">${count > 0 ? String(count) : ''}</td>`;
    }).join('');
    return `<tr><td style="padding:4px 6px 4px 0;font-size:11px;color:${BRAND.secondaryText};font-family:${F};white-space:nowrap;">${DAY_LABELS[d]}</td>${cells}</tr>`;
  }).join('');
  const peakSentence = `Peak: ${DAY_LABELS[peakDay]} ${HOUR_LABELS[peakHour]} (${maxCount} missed call${maxCount === 1 ? '' : 's'})`;
  return ui.panel(
    ui.label('When they called · last 90 days, 8am–10pm') +
    `<div style="overflow-x:auto;"><table role="presentation" cellpadding="0" cellspacing="2" border="0" style="width:100%;min-width:320px;"><tr><td></td>${headerCells}</tr>${bodyRows}</table></div>` +
    `<div style="margin-top:10px;">${ui.small(sharedEscapeHtml(peakSentence))}</div>`
  );
}

function buildStatsRows(stats: ClientStats): string {
  const rows: Array<[string, string]> = [
    ['Missed callers who got your message', String(stats.smsSent)],
    ...(stats.optOuts > 0 ? [['Opt-Outs', String(stats.optOuts)] as [string, string]] : []),
    ['People who opened your page', String(stats.linkClicks)],
    ['Bookings logged via your page', String(stats.bookingsLogged)],
    ['Page open rate', stats.conversionRate],
    ['Days until renewal', stats.daysUntilRenewal !== null ? String(stats.daysUntilRenewal) : '—'],
    ['Overage', stats.overage > 0 ? `+${stats.overage}` : '0'],
  ];
  const mainSection = ui.panel(ui.rows(rows.map(([l, v]) => [sharedEscapeHtml(l), sharedEscapeHtml(v)] as [string, string])));

  let buttonSection = '';
  if (stats.buttonClicks.length > 0) {
    const HOUR_LABELS = ['12am','1am','2am','3am','4am','5am','6am','7am','8am','9am','10am','11am','12pm','1pm','2pm','3pm','4pm','5pm','6pm','7pm','8pm','9pm','10pm','11pm'];
    buttonSection = ui.panel(ui.label('Button clicks') + ui.rows(stats.buttonClicks.map(b => {
      const peak = b.peakHours.length > 0
        ? ` <span style="font-size:12px;color:${BRAND.secondaryText};">· peak ${sharedEscapeHtml(b.peakHours.map(p => `${HOUR_LABELS[p.hour]} (${p.count})`).join(', '))}</span>`
        : '';
      return [sharedEscapeHtml(b.intent) + peak, b.count] as [string, number];
    })));
  }

  let socialSection = '';
  if (stats.socialTaps.length > 0) {
    socialSection = ui.panel(ui.label('Social taps') + ui.rows(stats.socialTaps.map(s =>
      [sharedEscapeHtml(s.platform), `${s.count} tap${s.count === 1 ? '' : 's'}`] as [string, string])));
  }

  return mainSection + buttonSection + socialSection + buildHeatmapTable(stats.heatmapData);
}

async function getDashboardUrl(email: string): Promise<string> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supa = createClient(supabaseUrl, serviceKey);
    const { data } = await supa.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: 'https://callmagnet.com.au' },
    });
    return data?.properties?.action_link ?? 'https://callmagnet.com.au';
  } catch {
    return 'https://callmagnet.com.au';
  }
}

// Words come from the email_copy table (Carl edits them in Supabase); look is locked in emailUi.ts
export async function buildWeeklyEmail(client: ClientRow, stats: ClientStats, monLabel: string, sunLabel: string): Promise<{ subject: string; html: string }> {
  const copy = await getEmailParts('weekly_summary', {
    BUSINESS_NAME: client.business_name,
    MISSED_CALLS:  String(stats.smsSent),
    WEEK_LABEL:    `${monLabel} — ${sunLabel}`,
  });
  const dashboardUrl = await getDashboardUrl(client.email);
  const html = renderEmailShell(
    copy.top +
    buildStatsRows(stats) +
    (copy.buttonLabel ? ui.button(dashboardUrl, sharedEscapeHtml(copy.buttonLabel)) : '') +
    copy.footnoteHtml,
    copy.preheader,
  );
  return { subject: copy.subject, html };
}

export async function buildWeeklyEmailHtml(client: ClientRow, stats: ClientStats, monLabel: string, sunLabel: string): Promise<string> {
  return (await buildWeeklyEmail(client, stats, monLabel, sunLabel)).html;
}
