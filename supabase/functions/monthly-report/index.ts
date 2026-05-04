// Session 2 — monthly-report edge function (Chunk D of E).
// Cron-triggered (Chunk E) at 9am Australia/Melbourne on the 1st of each month.
// Generates a previous-month recap email per eligible client and sends via Resend.
// Idempotency: monthly_reports UNIQUE (client_id, period_month).
// Auth: rejects any caller whose Authorization header is not Bearer SUPABASE_SERVICE_ROLE_KEY.
//
// Body shape: { client_id?: uuid, period_month?: "YYYY-MM-01", dry_run?: boolean }
//   - client_id   : scope to one client (test/replay).
//   - period_month: override target month (replay).
//   - dry_run     : skip lock insert, skip Resend, skip alert email; return preview HTML.
//
// Email rebrand (Session 4 D2): brand colours pulled from _shared/emailStyles.ts
// so future palette changes are a single-file edit. The recap email keeps its
// distinctive multi-section card layout (header bar, hero stat, 2×2 grid,
// footer note); the run-summary alert email uses the standard renderEmailShell.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { BRAND, escapeHtml as sharedEscapeHtml, renderEmailShell } from '../_shared/emailStyles.ts';

// ─── env ──────────────────────────────────────────────────────────────────
const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY')!;
const BLOCKED_CLIENT_IDS = (Deno.env.get('BLOCKED_CLIENT_IDS') ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

// ─── constants ────────────────────────────────────────────────────────────
const RESEND_FROM      = 'CallMagnet <hello@callmagnet.com.au>';
const ALERT_TO         = 'hello@callmagnet.com.au';
const MIN_DAYS_OF_DATA = 14;
const TZ               = 'Australia/Melbourne';
const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ─── types ────────────────────────────────────────────────────────────────
interface Period {
  start: Date;
  end: Date;
  label: string;
  monthIso: string;
}

interface ClientRow {
  id: string;
  business_name: string;
  email: string | null;
  suburb: string | null;
  industry: string | null;
  account_status: string;
  cancellation_scheduled: boolean;
  terms_accepted: boolean;
  subscription_start: string | null;
  avg_job_value: number | null;
}

interface ClientReportPayload {
  sms_count: number;
  click_count: number;
  booking_count: number;
  tap_rate_pct: number | null;
  estimated_revenue: number;
  repeat_caller_count: number;
  busiest_day_dow: number | null;
  busiest_day_calls: number | null;
  benchmark_cohort_size: number | null;
  benchmark_median_tap_rate_pct: number | null;
  benchmark_median_bookings_per_100_calls: number | null;
}

interface SentEntry    { client_id: string; business_name: string; resend_message_id?: string }
interface SkippedEntry { client_id: string; business_name: string; reason: string }
interface FailedEntry  { client_id: string; business_name: string; error: string }

// ─── time helpers ─────────────────────────────────────────────────────────
// Two-pass tz offset calc: assume a UTC instant, ask Intl what wall-clock that is in `tz`,
// the difference is the offset. Robust at month/midnight boundaries — well clear of the
// 2am-3am DST transition window where wall-clocks are ambiguous.
function tzOffsetMillis(date: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value || '0', 10);
  let hour = get('hour');
  if (hour === 24) hour = 0;
  const tzMs = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return tzMs - date.getTime();
}

function melbourneLocalToUtc(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0, ms = 0): Date {
  const naive = new Date(Date.UTC(y, m - 1, d, hh, mm, ss, ms));
  const offset = tzOffsetMillis(naive, TZ);
  return new Date(naive.getTime() - offset);
}

function periodFromYearMonth(y: number, m: number): Period {
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = melbourneLocalToUtc(y, m, 1, 0, 0, 0, 0);
  const end   = melbourneLocalToUtc(y, m, lastDay, 23, 59, 59, 999);
  const monthIso = `${y}-${String(m).padStart(2, '0')}-01`;
  const label = new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ, month: 'long', year: 'numeric',
  }).format(start);
  return { start, end, label, monthIso };
}

function getMelbournePreviousMonth(now: Date): Period {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value || '0', 10);
  const curY = get('year');
  const curM = get('month');
  const prevY = curM === 1 ? curY - 1 : curY;
  const prevM = curM === 1 ? 12       : curM - 1;
  return periodFromYearMonth(prevY, prevM);
}

function parsePeriodMonthOverride(raw: unknown): Period | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-01$/.exec(raw);
  if (!m) return null;
  const y  = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (mm < 1 || mm > 12) return null;
  return periodFromYearMonth(y, mm);
}

function daysOfPeriodOverlap(period: Period, subscriptionStartIso: string | null): number {
  if (!subscriptionStartIso) return Number.POSITIVE_INFINITY;
  const subStart = new Date(subscriptionStartIso);
  const overlapStart = subStart > period.start ? subStart : period.start;
  if (overlapStart > period.end) return 0;
  const ms = period.end.getTime() - overlapStart.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000) + 1);
}

// ─── eligibility ──────────────────────────────────────────────────────────
function eligibilityReason(c: ClientRow, period: Period): string | null {
  if (BLOCKED_CLIENT_IDS.includes(c.id)) return 'blocked_id';
  if (!c.email)                          return 'no_email';
  if (c.account_status === 'suspended')  return 'account_suspended';
  if (c.cancellation_scheduled)          return 'cancellation_scheduled';
  if (!c.terms_accepted)                 return 'terms_not_accepted';
  const days = daysOfPeriodOverlap(period, c.subscription_start);
  if (days < MIN_DAYS_OF_DATA)           return `insufficient_period_overlap_${days}d`;
  return null;
}

// ─── data gathering ───────────────────────────────────────────────────────
async function gatherClientReport(
  sb: SupabaseClient, c: ClientRow, period: Period,
): Promise<ClientReportPayload> {
  const { data: tapRow, error: tapErr } = await sb.from('v_tap_rate')
    .select('sms_count, click_count, tap_rate_pct')
    .eq('client_id', c.id)
    .eq('month', period.monthIso)
    .maybeSingle();
  if (tapErr) throw new Error(`v_tap_rate: ${tapErr.message}`);

  const { count: bookingCount, error: bookErr } = await sb.from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', c.id)
    .gte('booked_at', period.start.toISOString())
    .lte('booked_at', period.end.toISOString());
  if (bookErr) throw new Error(`bookings: ${bookErr.message}`);

  const { count: repeatCount, error: repErr } = await sb.from('v_repeat_callers')
    .select('customer_number', { count: 'exact', head: true })
    .eq('client_id', c.id)
    .eq('is_repeat', true);
  if (repErr) throw new Error(`v_repeat_callers: ${repErr.message}`);

  const { data: dailyRows, error: dailyErr } = await sb.from('v_call_patterns_daily')
    .select('dow, call_count')
    .eq('client_id', c.id)
    .order('call_count', { ascending: false })
    .limit(1);
  if (dailyErr) throw new Error(`v_call_patterns_daily: ${dailyErr.message}`);
  const busiest = dailyRows?.[0];

  let benchmark:
    | { cohort_size: number; median_tap_rate_pct: number | null; median_bookings_per_100_calls: number | null }
    | null = null;
  if (c.suburb && c.industry) {
    const { data: benchRow, error: benchErr } = await sb.from('v_suburb_benchmarks')
      .select('cohort_size, median_tap_rate_pct, median_bookings_per_100_calls')
      .eq('suburb', c.suburb)
      .eq('industry', c.industry)
      .maybeSingle();
    if (benchErr) throw new Error(`v_suburb_benchmarks: ${benchErr.message}`);
    benchmark = benchRow ?? null;
  }

  const smsCount   = tapRow?.sms_count   ?? 0;
  const clickCount = tapRow?.click_count ?? 0;
  const tapRatePct = tapRow?.tap_rate_pct ?? null;
  const avgJob     = c.avg_job_value ?? 0;
  const bookings   = bookingCount ?? 0;

  // Mirrors the dashboard's hero revenue heuristic (index.html:937-953).
  let estimatedRevenue = 0;
  if (clickCount > 0 && bookings > 0) {
    estimatedRevenue = Math.round(clickCount * avgJob * (bookings / clickCount));
  } else if (clickCount > 0) {
    estimatedRevenue = Math.round(clickCount * avgJob * 0.7);
  } else if (bookings > 0) {
    estimatedRevenue = Math.round(bookings * avgJob);
  }

  return {
    sms_count: smsCount,
    click_count: clickCount,
    booking_count: bookings,
    tap_rate_pct: tapRatePct,
    estimated_revenue: estimatedRevenue,
    repeat_caller_count: repeatCount ?? 0,
    busiest_day_dow: busiest?.dow ?? null,
    busiest_day_calls: busiest?.call_count ?? null,
    benchmark_cohort_size: benchmark?.cohort_size ?? null,
    benchmark_median_tap_rate_pct: benchmark?.median_tap_rate_pct ?? null,
    benchmark_median_bookings_per_100_calls: benchmark?.median_bookings_per_100_calls ?? null,
  };
}

// ─── email rendering ──────────────────────────────────────────────────────
const escapeHtml = sharedEscapeHtml;

function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-AU');
}

// Recap email keeps its distinctive multi-section card layout (header bar,
// hero stat block, 2×2 metric grid, prose footer). All brand colours pulled
// from BRAND so a palette swap propagates without touching this function.
function renderEmailHTML(c: ClientRow, p: ClientReportPayload, period: Period): string {
  const biz = escapeHtml(c.business_name);
  const month = escapeHtml(period.label);
  const busiestLine = (p.busiest_day_dow !== null && p.busiest_day_calls !== null && p.busiest_day_calls > 0)
    ? `<p style="margin:0 0 12px;">Across the last 90 days, your busiest day for missed calls is <strong>${escapeHtml(DOW_NAMES[p.busiest_day_dow])}</strong> (${p.busiest_day_calls} calls).</p>`
    : '';
  const benchLine = (p.benchmark_cohort_size !== null && p.benchmark_median_tap_rate_pct !== null && p.tap_rate_pct !== null)
    ? `<p style="margin:0 0 12px;">Compared to ${p.benchmark_cohort_size} similar businesses in your area: their median tap rate is ${p.benchmark_median_tap_rate_pct}% — yours is ${p.tap_rate_pct}%.</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Your ${month} CallMagnet recap</title></head>
<body style="margin:0;padding:0;background:${BRAND.pageBackground};font-family:${BRAND.fontStack};color:${BRAND.primaryText};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.pageBackground};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.cardBackground};border:1px solid ${BRAND.borderColor};border-radius:10px;overflow:hidden;">
        <tr><td style="padding:24px 28px;background:${BRAND.cardBackground};border-bottom:1px solid ${BRAND.borderColor};color:${BRAND.accent};font-family:'DM Mono', ui-monospace, SFMono-Regular, monospace;letter-spacing:0.15em;font-size:14px;font-weight:700;text-transform:uppercase;">★ CallMagnet</td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 8px;font-size:22px;color:${BRAND.primaryText};letter-spacing:-0.01em;">Hi ${biz},</h1>
          <p style="margin:0 0 20px;font-size:15px;color:${BRAND.secondaryText};">Here's how ${month} went.</p>

          <div style="background:${BRAND.successBg};border:1px solid ${BRAND.accent};border-radius:8px;padding:18px 20px;margin-bottom:18px;">
            <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.accent};font-weight:700;margin-bottom:6px;">Estimated revenue recovered</div>
            <div style="font-size:36px;color:${BRAND.accent};font-weight:300;letter-spacing:-0.02em;">${escapeHtml(fmtMoney(p.estimated_revenue))}</div>
          </div>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
            <tr>
              <td width="50%" style="padding:6px 6px 6px 0;vertical-align:top;">
                <div style="border:1px solid ${BRAND.accent};border-radius:6px;padding:10px 14px;">
                  <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${BRAND.accent};font-weight:700;margin-bottom:4px;">SMS sent</div>
                  <div style="font-size:24px;color:${BRAND.primaryText};font-weight:300;">${p.sms_count}</div>
                </div>
              </td>
              <td width="50%" style="padding:6px 0 6px 6px;vertical-align:top;">
                <div style="border:1px solid ${BRAND.accent};border-radius:6px;padding:10px 14px;">
                  <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${BRAND.accent};font-weight:700;margin-bottom:4px;">Link taps</div>
                  <div style="font-size:24px;color:${BRAND.primaryText};font-weight:300;">${p.click_count}</div>
                </div>
              </td>
            </tr>
            <tr>
              <td width="50%" style="padding:6px 6px 6px 0;vertical-align:top;">
                <div style="border:1px solid ${BRAND.accent};border-radius:6px;padding:10px 14px;">
                  <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${BRAND.accent};font-weight:700;margin-bottom:4px;">Bookings</div>
                  <div style="font-size:24px;color:${BRAND.primaryText};font-weight:300;">${p.booking_count}</div>
                </div>
              </td>
              <td width="50%" style="padding:6px 0 6px 6px;vertical-align:top;">
                <div style="border:1px solid ${BRAND.accent};border-radius:6px;padding:10px 14px;">
                  <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${BRAND.accent};font-weight:700;margin-bottom:4px;">Tap rate</div>
                  <div style="font-size:24px;color:${BRAND.primaryText};font-weight:300;">${p.tap_rate_pct ?? 0}%</div>
                </div>
              </td>
            </tr>
          </table>

          <p style="margin:0 0 12px;font-size:14px;color:${BRAND.primaryText};">You've now had <strong>${p.repeat_caller_count}</strong> ${p.repeat_caller_count === 1 ? 'customer' : 'customers'} call you back twice or more.</p>
          ${busiestLine}
          ${benchLine}

          <p style="margin:24px 0 0;font-size:13px;color:${BRAND.secondaryText};">Sign in to your dashboard at <a href="https://callmagnet.com.au" style="color:${BRAND.accent};">callmagnet.com.au</a> to see live activity.</p>
        </td></tr>
        <tr><td style="padding:18px 28px;background:${BRAND.pageBackground};border-top:1px solid ${BRAND.borderColor};font-size:11px;color:${BRAND.mutedText};font-family:'DM Mono', ui-monospace, SFMono-Regular, monospace;letter-spacing:0.05em;">CallMagnet — Pull every customer back.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Run-summary alert email — fired at the end of each cron run with sent /
// skipped / failed totals. Uses the standard renderEmailShell since it's
// a simple internal alert, not a customer-facing email.
function renderAlertEmailHTML(period: Period, sent: SentEntry[], skipped: SkippedEntry[], failed: FailedEntry[]): string {
  const failedRows = failed.length === 0
    ? `<li style="color:${BRAND.secondaryText};"><em>None.</em></li>`
    : failed.map(f => `<li><code>${escapeHtml(f.client_id)}</code> — ${escapeHtml(f.business_name)} — ${escapeHtml(f.error)}</li>`).join('');
  const skippedRows = skipped.length === 0
    ? `<li style="color:${BRAND.secondaryText};"><em>None.</em></li>`
    : skipped.map(s => `<li><code>${escapeHtml(s.client_id)}</code> — ${escapeHtml(s.business_name)} — ${escapeHtml(s.reason)}</li>`).join('');

  const content = `
    <h1 style="font-size:22px;font-weight:700;color:${BRAND.primaryText};margin:0 0 4px;letter-spacing:-0.01em;">Monthly report run — ${escapeHtml(period.label)}</h1>
    <p style="font-size:14px;color:${BRAND.secondaryText};margin:0 0 20px;">
      <strong>Sent:</strong> ${sent.length} &middot;
      <strong>Skipped:</strong> ${skipped.length} &middot;
      <strong>Failed:</strong> ${failed.length}
    </p>
    <h2 style="font-size:14px;font-weight:700;color:${BRAND.primaryText};margin:16px 0 8px;">Failed</h2>
    <ul style="margin:0 0 16px;padding-left:20px;font-size:13px;color:${BRAND.primaryText};line-height:1.6;">${failedRows}</ul>
    <h2 style="font-size:14px;font-weight:700;color:${BRAND.primaryText};margin:16px 0 8px;">Skipped</h2>
    <ul style="margin:0;padding-left:20px;font-size:13px;color:${BRAND.primaryText};line-height:1.6;">${skippedRows}</ul>
  `;

  return renderEmailShell(content, `Monthly report ${period.label}: ${sent.length} sent / ${skipped.length} skipped / ${failed.length} failed`);
}

// ─── Resend dispatch ──────────────────────────────────────────────────────
async function sendViaResend(args: { to: string; subject: string; html: string }): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [args.to],
        subject: args.subject,
        html: args.html,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 500)}` };
    }
    const json = await res.json();
    return { ok: true, messageId: typeof json?.id === 'string' ? json.id : undefined };
  } catch (err) {
    return { ok: false, error: `Resend fetch threw: ${(err as Error).message}` };
  }
}

// ─── main handler ─────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  const auth = req.headers.get('Authorization') ?? '';
  if (auth !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { client_id?: string; period_month?: string; dry_run?: boolean } = {};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try { body = await req.json(); } catch { body = {}; }
  }

  const period = body.period_month
    ? parsePeriodMonthOverride(body.period_month)
    : getMelbournePreviousMonth(new Date());
  if (!period) {
    return new Response(JSON.stringify({ error: 'invalid_period_month', expected: 'YYYY-MM-01' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let q = sb.from('clients').select(
    'id, business_name, email, suburb, industry, account_status, cancellation_scheduled, terms_accepted, subscription_start, avg_job_value',
  );
  if (body.client_id) q = q.eq('id', body.client_id);
  const { data: clients, error: clientsErr } = await q;
  if (clientsErr) {
    return new Response(JSON.stringify({ error: 'clients_query_failed', detail: clientsErr.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  const dryRun = body.dry_run === true;
  const sent:    SentEntry[]    = [];
  const skipped: SkippedEntry[] = [];
  const failed:  FailedEntry[]  = [];
  let dryRunPreviewHtml: string | undefined;

  for (const c of (clients ?? []) as ClientRow[]) {
    const reason = eligibilityReason(c, period);
    if (reason) {
      skipped.push({ client_id: c.id, business_name: c.business_name, reason });
      continue;
    }

    if (body.client_id && !dryRun) {
      console.warn(
        `[monthly-report] ABOUT TO SEND LIVE EMAIL — client_id=${c.id} ` +
        `business="${c.business_name}" email=${c.email}`,
      );
    }

    if (dryRun) {
      try {
        const payload = await gatherClientReport(sb, c, period);
        const html = renderEmailHTML(c, payload, period);
        sent.push({ client_id: c.id, business_name: c.business_name });
        if (!dryRunPreviewHtml) dryRunPreviewHtml = html;
      } catch (err) {
        failed.push({ client_id: c.id, business_name: c.business_name, error: `dry_run_gather: ${(err as Error).message}` });
      }
      continue;
    }

    const { data: lockRow, error: lockErr } = await sb.from('monthly_reports')
      .insert({ client_id: c.id, period_month: period.monthIso, status: 'pending' })
      .select('id')
      .maybeSingle();

    if (lockErr) {
      const code = (lockErr as { code?: string }).code;
      if (code === '23505') {
        skipped.push({ client_id: c.id, business_name: c.business_name, reason: 'already_processed' });
      } else {
        failed.push({ client_id: c.id, business_name: c.business_name, error: `lock_insert: ${lockErr.message}` });
      }
      continue;
    }
    if (!lockRow) {
      skipped.push({ client_id: c.id, business_name: c.business_name, reason: 'lock_no_row' });
      continue;
    }
    const lockId = lockRow.id;

    let payload: ClientReportPayload | null = null;
    try {
      payload = await gatherClientReport(sb, c, period);
      const html = renderEmailHTML(c, payload, period);
      const send = await sendViaResend({
        to: c.email!, subject: `Your ${period.label} CallMagnet recap`, html,
      });
      if (!send.ok) throw new Error(send.error ?? 'unknown resend error');
      await sb.from('monthly_reports')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          resend_message_id: send.messageId,
          payload,
        })
        .eq('id', lockId);
      sent.push({ client_id: c.id, business_name: c.business_name, resend_message_id: send.messageId });
    } catch (err) {
      const errMsg = (err as Error).message;
      await sb.from('monthly_reports')
        .update({ status: 'failed', error_message: errMsg, payload })
        .eq('id', lockId);
      failed.push({ client_id: c.id, business_name: c.business_name, error: errMsg });
    }
  }

  if (!dryRun) {
    try {
      const alert = await sendViaResend({
        to: ALERT_TO,
        subject: `[monthly-report] ${period.label}: ${sent.length} sent, ${skipped.length} skipped, ${failed.length} failed`,
        html: renderAlertEmailHTML(period, sent, skipped, failed),
      });
      if (!alert.ok) console.error('[monthly-report] alert email failed:', alert.error);
    } catch (err) {
      console.error('[monthly-report] alert email threw:', (err as Error).message);
    }
  }

  return new Response(JSON.stringify({
    period: { label: period.label, month: period.monthIso },
    dry_run: dryRun,
    sent_count: sent.length,
    skipped_count: skipped.length,
    failed_count: failed.length,
    sent, skipped, failed,
    ...(dryRunPreviewHtml ? { dry_run_preview: dryRunPreviewHtml } : {}),
  }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
