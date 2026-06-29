// notify-expiry: daily cron (23:00 UTC = 9am AEST) that sends two types of alerts:
//   1. Clients whose free_period_ends_at is ~3 days away → warning email to
//      the client AND hello@callmagnet.com.au.
//   2. Clients whose SMS count this month has reached 80% of their sms_included allowance → alert email to
//      hello@callmagnet.com.au only.
//
// Auth: X-Internal-Secret header (same pattern as send-daily-summary).
// Cron dispatch: dispatch_notify_expiry() plpgsql function pulls INTERNAL_SECRET
// from Vault and POSTs here — see migration 20260621000001_schedule_notify_expiry_cron.sql.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { BRAND, escapeHtml, renderEmailShell } from "../_shared/emailStyles.ts";

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET           = Deno.env.get('INTERNAL_SECRET');
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY');

const RESEND_FROM = 'CallMagnet <hello@callmagnet.com.au>';
const ALERT_TO    = 'hello@callmagnet.com.au';

interface ClientRow {
  id:              string;
  business_name:   string;
  email:           string | null;
  sms_included:    number;
  free_period_ends_at: string | null;
}

Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get('warmup') === '1') {
    return new Response(JSON.stringify({ warmup: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    if (!INTERNAL_SECRET) {
      console.error('notify-expiry: INTERNAL_SECRET missing from env');
      return json(500, { error: 'config_error', detail: 'shared secret not configured' });
    }
    if (req.headers.get('X-Internal-Secret') !== INTERNAL_SECRET) {
      return json(401, { error: 'unauthorized' });
    }
    if (!RESEND_API_KEY) {
      console.error('notify-expiry: RESEND_API_KEY missing from env');
      return json(500, { error: 'config_error', detail: 'RESEND_API_KEY not configured' });
    }

    const now = new Date();

    // ── Window: 3 days from now (the full 24-hour UTC day, 3 days out) ───────
    const threeDaysStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3)).toISOString();
    const threeDaysEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 4)).toISOString();

    // ── Month start for SMS count ─────────────────────────────────────────────
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    // ── Fetch all active clients ──────────────────────────────────────────────
    const clientsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients` +
      `?account_status=eq.active&is_test_account=eq.false` +
      `&select=id,business_name,email,sms_included,free_period_ends_at`,
      {
        headers: {
          apikey:        SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    if (!clientsRes.ok) {
      throw new Error(`clients_lookup_failed: ${clientsRes.status} ${await clientsRes.text()}`);
    }
    const clients = await clientsRes.json() as ClientRow[];

    const expiryWarningsSent: string[] = [];
    const smsAlertsSent:      string[] = [];

    for (const client of clients) {
      // ── Check 1: free period ends in ~3 days ────────────────────────────────
      if (client.free_period_ends_at) {
        const endsAt = client.free_period_ends_at;
        if (endsAt >= threeDaysStart && endsAt < threeDaysEnd) {
          try {
            const endsDate = new Date(endsAt).toLocaleDateString('en-AU', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
              timeZone: 'Australia/Melbourne',
            });

            // Email to client
            if (client.email) {
              const clientHtml = buildExpiryWarningEmail(client.business_name, endsDate, false);
              await sendEmail(
                RESEND_API_KEY,
                client.email,
                `Your CallMagnet free period ends in 3 days — ${client.business_name}`,
                clientHtml,
              );
            }

            // Email to admin
            const adminHtml = buildExpiryWarningEmail(client.business_name, endsDate, true);
            await sendEmail(
              RESEND_API_KEY,
              ALERT_TO,
              `[CallMagnet] Free period ending soon — ${client.business_name}`,
              adminHtml,
            );

            expiryWarningsSent.push(client.id);
            console.log(`notify-expiry: free-period warning sent for client_id=${client.id} ends_at=${endsAt}`);
          } catch (e) {
            console.error(`notify-expiry: expiry warning failed for client_id=${client.id}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }

      // ── Check 2: SMS count this month >= 20 ─────────────────────────────────
      try {
        const countRes = await fetch(
          `${SUPABASE_URL}/rest/v1/sms_events` +
          `?client_id=eq.${encodeURIComponent(client.id)}` +
          `&received_at=gte.${encodeURIComponent(monthStart)}` +
          `&select=id`,
          {
            method: 'HEAD',
            headers: {
              apikey:        SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              Prefer:        'count=exact',
            },
          }
        );
        if (countRes.ok) {
          const contentRange = countRes.headers.get('content-range') || '*/0';
          const slash        = contentRange.lastIndexOf('/');
          const smsCount     = parseInt(slash >= 0 ? contentRange.slice(slash + 1) : '0', 10);
          const smsIncluded  = typeof client.sms_included === 'number' ? client.sms_included : 50;
          const smsThreshold = Math.floor(smsIncluded * 0.8);
          if (Number.isFinite(smsCount) && smsCount >= smsThreshold) {
            const alertHtml   = buildSmsAlertEmail(client.business_name, smsCount, smsIncluded);
            await sendEmail(
              RESEND_API_KEY,
              ALERT_TO,
              `[CallMagnet] SMS usage alert — ${client.business_name} (${smsCount}/${smsIncluded} this month)`,
              alertHtml,
            );
            smsAlertsSent.push(client.id);
            console.log(`notify-expiry: SMS alert sent for client_id=${client.id} count=${smsCount}/${smsIncluded}`);
          }
        }
      } catch (e) {
        console.error(`notify-expiry: SMS count check failed for client_id=${client.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return json(200, {
      ok:                    true,
      clients_checked:       clients.length,
      expiry_warnings_sent:  expiryWarningsSent.length,
      sms_alerts_sent:       smsAlertsSent.length,
    });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`notify-expiry fatal: ${errMsg}`);
    return json(500, { error: 'internal_error', detail: errMsg });
  }
});

async function sendEmail(
  apiKey: string,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
  });
  if (!res.ok) {
    throw new Error(`resend_failed to=${to}: ${res.status} ${await res.text()}`);
  }
}

function buildExpiryWarningEmail(businessName: string, endsDate: string, isAdmin: boolean): string {
  const safe = escapeHtml(businessName);
  const safeDate = escapeHtml(endsDate);

  const heading = `<h1 style="font-size:24px;font-weight:700;color:${BRAND.primaryText};margin:0 0 16px;">
    ${isAdmin ? `Free period ending — ${safe}` : `Your free period ends soon, ${safe}`}
  </h1>`;

  const body = isAdmin
    ? `<p style="color:${BRAND.secondaryText};font-size:15px;line-height:1.6;margin:0 0 20px;">
        <strong style="color:${BRAND.primaryText};">${safe}</strong> has a free period ending on
        <strong style="color:${BRAND.accent};">${safeDate}</strong> (3 days from now).
        Consider reaching out to confirm their subscription continues.
      </p>`
    : `<p style="color:${BRAND.secondaryText};font-size:15px;line-height:1.6;margin:0 0 20px;">
        Your CallMagnet free period ends on
        <strong style="color:${BRAND.accent};">${safeDate}</strong>.
        After this date your subscription will continue automatically. If you have any questions,
        reply to this email or contact <a href="mailto:hello@callmagnet.com.au" style="color:${BRAND.accent};">hello@callmagnet.com.au</a>.
      </p>`;

  return renderEmailShell(heading + body, isAdmin
    ? `${businessName} free period ends in 3 days`
    : `Your CallMagnet free period ends on ${endsDate}`
  );
}

function buildSmsAlertEmail(businessName: string, smsCount: number, smsIncluded: number): string {
  const safe = escapeHtml(businessName);

  const heading = `<h1 style="font-size:24px;font-weight:700;color:${BRAND.primaryText};margin:0 0 16px;">
    SMS usage alert — ${safe}
  </h1>`;

  const body = `<p style="color:${BRAND.secondaryText};font-size:15px;line-height:1.6;margin:0 0 20px;">
    <strong style="color:${BRAND.primaryText};">${safe}</strong> has sent
    <strong style="color:${BRAND.accent};">${smsCount}</strong> SMS this month
    (plan includes <strong style="color:${BRAND.primaryText};">${smsIncluded}</strong>).
    They are approaching or have reached their monthly limit.
  </p>`;

  return renderEmailShell(heading + body, `${businessName} has used ${smsCount}/${smsIncluded} SMS this month`);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
