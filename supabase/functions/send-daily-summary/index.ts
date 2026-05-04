// send-daily-summary: fired once daily at 23:00 Melbourne (cron schedule
// 0 13 * * * UTC, which is 23:00 AEST in winter and 00:00 AEDT in summer —
// see migration comment for DST notes). Iterates over every active client,
// computes today's missed-call count plus cumulative 7-day and 30-day
// counts, derives industry-benchmark booking and revenue estimates per
// window, persists today's stats to daily_summary_runs, and sends one
// email per client via Resend.
//
// Auth: shared-secret guard via X-Internal-Secret header. Same pattern as
// send-pushover-alert / save-push-subscription / send-client-notification.
// Caller is dispatch_daily_summary() (a SECURITY DEFINER plpgsql function
// that pulls INTERNAL_SECRET from the Postgres Vault and POSTs here).
//
// SMS-sent vs missed-calls: today both counts are read from sms_events and
// are equal — every successful insert in twilio-missed-call corresponds to
// one auto-SMS dispatched by Twilio Studio's "Send Message" widget. If we
// later split SMS dispatch into a separate table, the queries below split
// into two and the equality goes away.
//
// Trailing windows are CUMULATIVE: "Last 7 days" includes today (so the
// 7d count >= today's count), "Last 30 days" includes today and last
// week. This matches natural-language reading.
//
// Industry benchmarks for booking estimation:
//   - 55-70% of missed callers book elsewhere within 5 minutes if not
//     contacted (low/high range used for the recovered-bookings estimate).
//
// Per-vertical revenue averages (AUD):
//   restaurant  $75 / cover
//   hairdresser $100 / service
//   barber      $45 / service
//   tradie      $400 / job
//   default     $75               (covers any unrecognized vertical)
//
// daily_summary_runs persists TODAY'S stats only. The 7d/30d numbers are
// computed fresh on each cron fire and used in the email; they're not
// persisted (deriving them later from past daily_summary_runs rows is
// straightforward if we ever need historical 7d/30d).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { BRAND, escapeHtml, renderEmailShell } from "../_shared/emailStyles.ts";

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET           = Deno.env.get('INTERNAL_SECRET');
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY');

const REVENUE_PER_BOOKING: Record<string, number> = {
  restaurant:  75,
  hairdresser: 100,
  barber:      45,
  tradie:      400,
};
const DEFAULT_REVENUE_PER_BOOKING = 75;

const BOOKING_RATE_LOW  = 0.55;
const BOOKING_RATE_HIGH = 0.70;

const DASHBOARD_CTA_URL = 'https://callmagnet.com.au/?source=email';

interface ClientRow {
  id:            string;
  business_name: string;
  email:         string;
  vertical:      string | null;
}

interface ClientResult {
  client_id:     string;
  business_name: string;
  email_sent:    boolean;
  reason?:       string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    if (!INTERNAL_SECRET) {
      console.error('send-daily-summary: INTERNAL_SECRET missing from env');
      return json(500, { error: 'config_error', detail: 'shared secret not configured in Vault' });
    }

    if (req.headers.get('X-Internal-Secret') !== INTERNAL_SECRET) {
      return json(401, { error: 'unauthorized' });
    }

    if (!RESEND_API_KEY) {
      console.error('send-daily-summary: RESEND_API_KEY missing from env');
      return json(500, { error: 'config_error', detail: 'RESEND_API_KEY not configured' });
    }

    // Compute today's date in Melbourne calendar terms — used as the
    // summary_date key for daily_summary_runs and in the email subject.
    const now            = new Date();
    const melbDateString = formatMelbourneDate(now);                            // e.g. "Monday 4 May"
    const melbIsoDate    = formatMelbourneIsoDate(now);                         // e.g. "2026-05-04"

    // Three trailing windows, all cumulative (each includes "now" and runs
    // backward). "Last 7 days" includes today; "Last 30 days" includes the
    // past week and today. Matches natural-language reading.
    const windowStartToday = new Date(now.getTime() - 24       * 60 * 60 * 1000).toISOString();
    const windowStart7d    = new Date(now.getTime() - 7  * 24  * 60 * 60 * 1000).toISOString();
    const windowStart30d   = new Date(now.getTime() - 30 * 24  * 60 * 60 * 1000).toISOString();

    // ── fetch all active clients ───────────────────────────────────────────
    // NOTE: spec said `subscription_status = 'active'` but the actual column
    // is `account_status` (subscription_status doesn't exist on clients).
    // Filtering on account_status as the only correct interpretation.
    const clientsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?account_status=eq.active&select=id,business_name,email,vertical`,
      {
        headers: {
          apikey:        SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!clientsRes.ok) {
      throw new Error(`clients_lookup_failed: ${clientsRes.status} ${await clientsRes.text()}`);
    }
    const clients = await clientsRes.json() as ClientRow[];

    const results: ClientResult[] = [];

    for (const client of clients) {
      try {
        // Three count queries in parallel — one HEAD per window.
        const [missedCallsCount, missed7d, missed30d] = await Promise.all([
          countSmsEventsForClient(client.id, windowStartToday),
          countSmsEventsForClient(client.id, windowStart7d),
          countSmsEventsForClient(client.id, windowStart30d),
        ]);
        const smsSentCount = missedCallsCount;                                  // 1:1 today (see header note)

        const revPerBooking =
          (client.vertical && REVENUE_PER_BOOKING[client.vertical]) ?? DEFAULT_REVENUE_PER_BOOKING;

        // Today
        const estBookingsLow      = Math.round(missedCallsCount * BOOKING_RATE_LOW);
        const estBookingsHigh     = Math.round(missedCallsCount * BOOKING_RATE_HIGH);
        const estRevenueLow       = estBookingsLow  * revPerBooking;
        const estRevenueHigh      = estBookingsHigh * revPerBooking;

        // Last 7 days (cumulative — includes today)
        const estBookings7dLow    = Math.round(missed7d * BOOKING_RATE_LOW);
        const estBookings7dHigh   = Math.round(missed7d * BOOKING_RATE_HIGH);
        const estRevenue7dLow     = estBookings7dLow  * revPerBooking;
        const estRevenue7dHigh    = estBookings7dHigh * revPerBooking;

        // Last 30 days (cumulative — includes today)
        const estBookings30dLow   = Math.round(missed30d * BOOKING_RATE_LOW);
        const estBookings30dHigh  = Math.round(missed30d * BOOKING_RATE_HIGH);
        const estRevenue30dLow    = estBookings30dLow  * revPerBooking;
        const estRevenue30dHigh   = estBookings30dHigh * revPerBooking;

        // ── UPSERT daily_summary_runs row (today only — 7d/30d not persisted) ──
        const upsertRes = await fetch(
          `${SUPABASE_URL}/rest/v1/daily_summary_runs?on_conflict=client_id,summary_date`,
          {
            method: 'POST',
            headers: {
              apikey:        SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
              Prefer:        'resolution=merge-duplicates,return=representation',
            },
            body: JSON.stringify({
              client_id:               client.id,
              summary_date:            melbIsoDate,
              missed_calls_count:      missedCallsCount,
              sms_sent_count:          smsSentCount,
              estimated_bookings_low:  estBookingsLow,
              estimated_bookings_high: estBookingsHigh,
              estimated_revenue_low:   estRevenueLow,
              estimated_revenue_high:  estRevenueHigh,
              email_sent:              false,
            }),
          },
        );
        if (!upsertRes.ok) {
          throw new Error(`daily_summary_runs_upsert_failed: ${upsertRes.status} ${await upsertRes.text()}`);
        }
        const upserted = await upsertRes.json() as { id: string }[];
        const runId    = upserted[0]?.id;

        // ── send email ──────────────────────────────────────────────────────
        if (!client.email) {
          results.push({ client_id: client.id, business_name: client.business_name, email_sent: false, reason: 'no_email_on_record' });
          continue;
        }

        const emailHtml = buildSummaryEmail({
          businessName:    client.business_name,
          dateString:      melbDateString,
          // Today
          missedCalls:     missedCallsCount,
          smsSent:         smsSentCount,
          bookingsLow:     estBookingsLow,
          bookingsHigh:    estBookingsHigh,
          revenueLow:      estRevenueLow,
          revenueHigh:     estRevenueHigh,
          // Last 7 days
          missedCalls7d:   missed7d,
          bookingsLow7d:   estBookings7dLow,
          bookingsHigh7d:  estBookings7dHigh,
          revenueLow7d:    estRevenue7dLow,
          revenueHigh7d:   estRevenue7dHigh,
          // Last 30 days
          missedCalls30d:  missed30d,
          bookingsLow30d:  estBookings30dLow,
          bookingsHigh30d: estBookings30dHigh,
          revenueLow30d:   estRevenue30dLow,
          revenueHigh30d:  estRevenue30dHigh,
        });

        const subject = buildSummarySubject(client.business_name, missedCallsCount);

        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization:  `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from:    'CallMagnet <hello@callmagnet.com.au>',
            to:      client.email,
            subject,
            html:    emailHtml,
          }),
        });

        if (!resendRes.ok) {
          const errBody = await resendRes.text();
          console.warn(`resend_failed for client_id=${client.id}: ${resendRes.status} ${errBody}`);
          results.push({ client_id: client.id, business_name: client.business_name, email_sent: false, reason: `resend_${resendRes.status}` });
          continue;
        }

        // ── mark email_sent = true ──────────────────────────────────────────
        if (runId) {
          fetch(
            `${SUPABASE_URL}/rest/v1/daily_summary_runs?id=eq.${encodeURIComponent(runId)}`,
            {
              method: 'PATCH',
              headers: {
                apikey:        SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json',
                Prefer:        'return=minimal',
              },
              body: JSON.stringify({ email_sent: true, sent_at: new Date().toISOString() }),
            },
          ).catch((err) => console.warn(`mark_sent_failed for run_id=${runId}: ${err}`));
        }

        results.push({ client_id: client.id, business_name: client.business_name, email_sent: true });

      } catch (clientErr) {
        const errMsg = clientErr instanceof Error ? clientErr.message : String(clientErr);
        console.error(`per_client_error for client_id=${client.id}: ${errMsg}`);
        results.push({ client_id: client.id, business_name: client.business_name, email_sent: false, reason: errMsg });
      }
    }

    return json(200, {
      ok:             true,
      summary_date:   melbIsoDate,
      clients_count:  clients.length,
      emails_sent:    results.filter(r => r.email_sent).length,
      emails_failed:  results.filter(r => !r.email_sent).length,
      results,
    });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`send-daily-summary fatal: ${errMsg}`);
    return json(500, { error: 'internal_error', detail: errMsg });
  }
});

// ── helpers ─────────────────────────────────────────────────────────────────

async function countSmsEventsForClient(clientId: string, windowStartIso: string): Promise<number> {
  // PostgREST count via Prefer: count=exact + HEAD-style empty body.
  // Returns 0 when no rows match.
  const url =
    `${SUPABASE_URL}/rest/v1/sms_events` +
    `?client_id=eq.${encodeURIComponent(clientId)}` +
    `&received_at=gte.${encodeURIComponent(windowStartIso)}` +
    `&select=id`;

  const res = await fetch(url, {
    method: 'HEAD',
    headers: {
      apikey:        SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer:        'count=exact',
    },
  });
  if (!res.ok) {
    throw new Error(`count_sms_events_failed: ${res.status} ${await res.text()}`);
  }
  // Content-Range header looks like "0-0/<total>" or "*/0" when empty.
  const contentRange = res.headers.get('content-range') || '*/0';
  const slash        = contentRange.lastIndexOf('/');
  const totalStr     = slash >= 0 ? contentRange.slice(slash + 1) : '0';
  const total        = parseInt(totalStr, 10);
  return Number.isFinite(total) ? total : 0;
}

function formatMelbourneDate(d: Date): string {
  // Produces e.g. "Monday 4 May" — weekday, day-of-month (no leading zero), month name.
  const weekday = new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'Australia/Melbourne' }).format(d);
  const day     = new Intl.DateTimeFormat('en-AU', { day:     'numeric', timeZone: 'Australia/Melbourne' }).format(d);
  const month   = new Intl.DateTimeFormat('en-AU', { month:   'long',    timeZone: 'Australia/Melbourne' }).format(d);
  return `${weekday} ${day} ${month}`;
}

function formatMelbourneIsoDate(d: Date): string {
  // Produces YYYY-MM-DD in Melbourne calendar terms — used as the
  // summary_date key.
  const parts = new Intl.DateTimeFormat('en-CA', {
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
    timeZone: 'Australia/Melbourne',
  }).format(d);
  return parts; // en-CA returns YYYY-MM-DD natively
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-AU');
}

// ── email building ──────────────────────────────────────────────────────────

interface SummaryEmailParams {
  businessName: string;
  dateString:   string;
  // Today
  missedCalls:  number;
  smsSent:      number;
  bookingsLow:  number;
  bookingsHigh: number;
  revenueLow:   number;
  revenueHigh:  number;
  // Last 7 days (cumulative — includes today)
  missedCalls7d:  number;
  bookingsLow7d:  number;
  bookingsHigh7d: number;
  revenueLow7d:   number;
  revenueHigh7d:  number;
  // Last 30 days (cumulative — includes today)
  missedCalls30d:  number;
  bookingsLow30d:  number;
  bookingsHigh30d: number;
  revenueLow30d:   number;
  revenueHigh30d:  number;
}

function buildSummarySubject(businessName: string, missedCallsCount: number): string {
  if (missedCallsCount > 0) {
    const noun = missedCallsCount === 1 ? 'missed call' : 'missed calls';
    return `${businessName} — ${missedCallsCount} ${noun} recovered today`;
  }
  return `${businessName} — quiet day today`;
}

// Compact secondary-hierarchy stat card. Shared by both quiet and active
// branches for the "Last 7 days" and "Last 30 days" sections.
function renderTrailingWindow(
  label: string,
  missed: number,
  revenueLow: number,
  revenueHigh: number,
): string {
  const noun = missed === 1 ? 'missed call' : 'missed calls';
  const revenueLine =
    missed > 0
      ? `<div style="font-size:14px;color:${BRAND.accent};font-weight:600;">$${formatMoney(revenueLow)}–$${formatMoney(revenueHigh)} estimated</div>`
      : `<div style="font-size:14px;color:${BRAND.secondaryText};">No activity in this window</div>`;

  return `<div style="margin-bottom:14px;">
    <div style="font-size:11px;color:${BRAND.secondaryText};font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px;">${label}</div>
    <div style="background:${BRAND.pageBackground};border:1px solid ${BRAND.borderColor};border-radius:8px;padding:18px 20px;">
      <div style="font-size:24px;font-weight:300;color:${BRAND.primaryText};letter-spacing:-0.01em;line-height:1.1;margin-bottom:6px;">${missed} ${noun}</div>
      ${revenueLine}
    </div>
  </div>`;
}

// Email-safe centered button. Wrapped in <table align="center"> because
// Outlook can't centre with flexbox.
function renderCtaButton(url: string, label: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 24px;">
    <tr>
      <td align="center">
        <a href="${url}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;padding:14px 32px;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;font-family:${BRAND.fontStack};letter-spacing:0.02em;">${label}</a>
      </td>
    </tr>
  </table>`;
}

function buildSummaryEmail(p: SummaryEmailParams): string {
  const safeBusiness = escapeHtml(p.businessName);
  const safeDate     = escapeHtml(p.dateString);
  const hasActivity  = p.missedCalls > 0;

  const heading = `<h1 class="em-heading" style="font-size:26px;font-weight:700;color:${BRAND.primaryText};margin:0 0 4px;letter-spacing:-0.02em;">Today at ${safeBusiness}</h1>
    <p style="font-size:13px;color:${BRAND.secondaryText};margin:0 0 28px;font-weight:600;">${safeDate}</p>`;

  // Branch-specific today content (existing layouts, qualified label on
  // active-branch ROI block to disambiguate from 7d/30d).
  let todayContent: string;
  let footnote:     string;
  let preheader:    string;

  if (hasActivity) {
    todayContent = `<div style="background:${BRAND.pageBackground};border:1px solid ${BRAND.borderColor};border-radius:8px;padding:24px;margin-bottom:14px;text-align:center;">
        <div style="font-size:13px;color:${BRAND.secondaryText};font-weight:600;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:8px;">Missed calls captured</div>
        <div class="em-bigstat" style="font-size:48px;font-weight:300;color:${BRAND.accent};letter-spacing:-0.02em;line-height:1;">${p.missedCalls}</div>
      </div>
      <div style="background:${BRAND.pageBackground};border:1px solid ${BRAND.borderColor};border-radius:8px;padding:20px;margin-bottom:24px;text-align:center;">
        <div style="font-size:12px;color:${BRAND.secondaryText};font-weight:600;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:6px;">Auto-SMS sent</div>
        <div style="font-size:28px;font-weight:300;color:${BRAND.primaryText};letter-spacing:-0.02em;line-height:1;">${p.smsSent}</div>
      </div>
      <div style="background:${BRAND.successBg};border:1px solid ${BRAND.accent};border-radius:8px;padding:20px;margin-bottom:24px;">
        <div style="font-size:11px;color:${BRAND.accent};font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:10px;">Estimated impact today</div>
        <div style="font-size:16px;font-weight:600;color:${BRAND.primaryText};line-height:1.5;">
          Approximately <strong>${p.bookingsLow}–${p.bookingsHigh}</strong> bookings recovered,<br>
          worth <strong>$${formatMoney(p.revenueLow)}–$${formatMoney(p.revenueHigh)}</strong>.
        </div>
      </div>`;
    footnote  = `<p style="font-size:12px;color:${BRAND.secondaryText};margin:0;line-height:1.5;">Industry data suggests 55–70% of missed callers book elsewhere within 5 minutes when they don't get an answer. CallMagnet keeps your booking link in their pocket within seconds.</p>`;
    preheader = `${p.missedCalls} missed call${p.missedCalls === 1 ? '' : 's'} captured today at ${p.businessName}`;
  } else {
    todayContent = `<div style="background:${BRAND.pageBackground};border:1px solid ${BRAND.borderColor};border-radius:8px;padding:24px;margin-bottom:24px;text-align:center;">
        <div style="font-size:13px;color:${BRAND.secondaryText};font-weight:600;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:8px;">Today</div>
        <div class="em-bigstat" style="font-size:48px;font-weight:300;color:${BRAND.primaryText};letter-spacing:-0.02em;line-height:1;">0</div>
        <div style="font-size:13px;color:${BRAND.secondaryText};margin-top:8px;">missed calls — a quiet day</div>
      </div>`;
    footnote  = `<p style="font-size:12px;color:${BRAND.secondaryText};margin:0;line-height:1.5;">CallMagnet is on the line — every missed call still gets your booking link within seconds.</p>`;
    preheader = `Quiet day at ${p.businessName} — past performance below`;
  }

  // Shared trailing-window sections + CTA — same in both branches.
  const last7  = renderTrailingWindow('Last 7 days',  p.missedCalls7d,  p.revenueLow7d,  p.revenueHigh7d);
  const last30 = renderTrailingWindow('Last 30 days', p.missedCalls30d, p.revenueLow30d, p.revenueHigh30d);
  const cta    = renderCtaButton(DASHBOARD_CTA_URL, 'View dashboard →');

  return renderEmailShell(heading + todayContent + last7 + last30 + cta + footnote, preheader);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
