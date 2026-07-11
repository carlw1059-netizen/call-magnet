// twilio-missed-call: receives Twilio Studio's http_1 widget POST when a call
// to a client's Twilio number goes unanswered, looks up which client owns the
// To number, and records a row in sms_events.
//
// Idempotency: twilio_call_sid has a partial UNIQUE index (added by migration
// 20260503120000). On Twilio retries the second insert raises a 23505 unique
// violation (PostgREST 409), which we catch and return 200 OK so Twilio stops.
//
// Auth: deployed with --no-verify-jwt (Twilio doesn't send Bearer tokens).
// The function URL itself is the secret. A future hardening pass can add
// Twilio signature verification.
//
// Payload (Twilio standard, application/x-www-form-urlencoded):
//   From      caller's E.164 number          → sms_events.customer_number
//   To        the Twilio number called       → sms_events.client_number
//   CallSid   Twilio's 34-char unique ID     → sms_events.twilio_call_sid
//   Body      optional SMS body              → sms_events.message_body (NULL on missed-call)
//
// Two-number schedule feature:
//   schedule_enabled = false → single number mode. Only twilio_number is active.
//                              twilio_number_2 is ignored entirely.
//   schedule_enabled = true  → dual number mode. Both numbers are active.
//                              client_schedules table is queried for today's
//                              Melbourne day to determine which line is expected.
//                              Fallback: Line 1 (twilio_number) if no schedule row
//                              exists for today. SMS ALWAYS fires regardless.
//
// Day-of-week and time resolution is done entirely in Postgres using
// AT TIME ZONE 'Australia/Melbourne' to avoid Deno runtime timezone drift.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { BRAND, escapeHtml, renderEmailShell } from "../_shared/emailStyles.ts";

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY');
const ALERT_TO                  = 'car312@hotmail.com';

// ── Helper: convert HH:MM:SS time string to minutes since midnight ────────────
function timeToMins(t: string): number {
  const [h, m] = t.substring(0, 5).split(':').map(Number);
  return h * 60 + m;
}

// ── Helper: check if nowMins falls within a time window ──────────────────────
// Handles midnight-spanning windows (e.g. 22:00 → 02:00)
function inWindow(nowMins: number, startMins: number, endMins: number): boolean {
  if (endMins > startMins) {
    // Normal window (e.g. 09:00 → 17:00)
    return nowMins >= startMins && nowMins < endMins;
  } else {
    // Midnight-spanning window (e.g. 22:00 → 02:00)
    return nowMins >= startMins || nowMins < endMins;
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://callmagnet.com.au',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Test-Time-Mins, X-Test-Day-Name',
};

Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get('warmup') === '1') {
    return new Response(JSON.stringify({ warmup: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    // ── Parse Twilio's form-encoded body ──────────────────────────────────
    const form    = await req.formData();
    const callSid = (form.get('CallSid') ?? '').toString().trim();
    const from    = (form.get('From')    ?? '').toString().trim();
    const to      = (form.get('To')      ?? '').toString().trim();
    const bodyRaw = (form.get('Body')    ?? '').toString().trim();
    const body    = bodyRaw.length > 0 ? bodyRaw : null;

    const testTimeMins = req.headers.get('X-Test-Time-Mins');
    const testDayName  = req.headers.get('X-Test-Day-Name');

    if (!callSid || !from || !to) {
      return json(400, { error: 'missing_required_field', detail: 'CallSid, From, and To are all required' });
    }

    // ── Look up client ────────────────────────────────────────────────────
    // First fetch client by twilio_number only (works for all clients).
    // If schedule_enabled, we also check twilio_number_2.
    // We do a single broad fetch and filter in code to avoid two round trips.
    const lookupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients` +
      `?or=(twilio_number.eq.${encodeURIComponent(to)},twilio_number_2.eq.${encodeURIComponent(to)})` +
      `&is_test_account=eq.false&account_status=eq.active` +
      `&select=id,business_name,schedule_enabled,twilio_number,twilio_number_2,manual_line_override`,
      {
        headers: {
          apikey:        SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!lookupRes.ok) {
      throw new Error(`client_lookup_failed: ${lookupRes.status} ${await lookupRes.text()}`);
    }
    const allMatches = await lookupRes.json() as {
      id:                   string;
      business_name:        string;
      schedule_enabled:     boolean;
      twilio_number:        string | null;
      twilio_number_2:      string | null;
      manual_line_override: number | null;
    }[];

    // Filter: if schedule_enabled=false, only match on twilio_number (Line 1).
    // If schedule_enabled=true, match on either number.
    const clients = allMatches.filter(c =>
      c.twilio_number === to ||
      (c.schedule_enabled && c.twilio_number_2 === to)
    );

    // ── Orphaned call ─────────────────────────────────────────────────────
    if (clients.length === 0) {
      console.warn(`orphaned_call: no client found for To=${to} CallSid=${callSid}`);
      return json(200, { ok: true, skipped: 'no_client_for_to_number' });
    }

    const client       = clients[0];
    const clientId     = client.id;
    const businessName = client.business_name;

    // ── Manual line override log ──────────────────────────────────────────
    // Observation only — does not block SMS or change behaviour.
    if (client.manual_line_override !== null && client.manual_line_override !== undefined) {
      const onLine1  = to === client.twilio_number;
      const onLine2  = to === client.twilio_number_2;
      const expected = (client.manual_line_override === 1 && onLine1) || (client.manual_line_override === 2 && onLine2);
      console.log(`manual_override: client=${clientId} to=${to} override=Line${client.manual_line_override} onLine1=${onLine1} onLine2=${onLine2} expected=${expected}`);
    }

    // ── Schedule gate-check ───────────────────────────────────────────────
    // Only runs when schedule_enabled=true.
    // Uses Postgres for timezone resolution — zero Deno timezone risk.
    // SMS ALWAYS fires regardless of schedule state.
    if (client.schedule_enabled) {
      try {
        let dayName: string;
        let nowMins: number;

        if (testTimeMins !== null && testDayName !== null) {
          dayName = testDayName.toLowerCase().trim();
          nowMins = parseInt(testTimeMins, 10);
        } else {
          const melbRes = await fetch(
            `${SUPABASE_URL}/rest/v1/rpc/get_melbourne_day_and_time`,
            {
              method:  'POST',
              headers: {
                apikey:         SUPABASE_SERVICE_ROLE_KEY,
                Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({}),
            },
          );
          if (!melbRes.ok) {
            return json(500, { ok: false, error: 'Failed to get Melbourne time' });
          }
          const melb = await melbRes.json() as { day_name: string; time_mins: number };
          dayName = melb.day_name;
          nowMins = melb.time_mins;
        }

        // Fetch today's schedule row
        const todayRes = await fetch(
          `${SUPABASE_URL}/rest/v1/client_schedules` +
          `?client_id=eq.${encodeURIComponent(clientId)}` +
          `&day_of_week=eq.${encodeURIComponent(dayName)}` +
          `&is_active=eq.true&select=*&limit=1`,
          {
            headers: {
              apikey:        SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
          },
        );

        if (todayRes.ok) {
          const rows = await todayRes.json() as {
            line1_start: string | null;
            line1_end:   string | null;
            line2_start: string | null;
            line2_end:   string | null;
          }[];

          if (rows.length === 0) {
            // No schedule for today — fallback to Line 1
            const onLine1  = to === client.twilio_number;
            console.log(`schedule_check: client=${clientId} to=${to} day=${dayName} no_schedule_fallback=line1 onLine1=${onLine1} expected=${onLine1}`);
          } else {
            const row = rows[0];
            let expectedLine: 1 | 2 | null = null;

            if (row.line1_start && row.line1_end) {
              const l1Start = timeToMins(row.line1_start);
              const l1End   = timeToMins(row.line1_end);
              if (inWindow(nowMins, l1Start, l1End)) expectedLine = 1;
            }

            if (expectedLine === null && row.line2_start && row.line2_end) {
              const l2Start = timeToMins(row.line2_start);
              const l2End   = timeToMins(row.line2_end);
              if (inWindow(nowMins, l2Start, l2End)) expectedLine = 2;
            }

            // Outside all windows — fallback to Line 1
            if (expectedLine === null) expectedLine = 1;

            const onLine1    = to === client.twilio_number;
            const onLine2    = to === client.twilio_number_2;
            const expected   = (expectedLine === 1 && onLine1) || (expectedLine === 2 && onLine2);

            console.log(`schedule_check: client=${clientId} to=${to} day=${dayName} nowMins=${nowMins} expectedLine=${expectedLine} onLine1=${onLine1} onLine2=${onLine2} expected=${expected}`);
          }
        }
      } catch (schedErr) {
        // Schedule check is non-fatal — log and continue to SMS send
        console.warn(`schedule_check_error: ${schedErr instanceof Error ? schedErr.message : String(schedErr)}`);
      }
    }

    // ── Insert sms_events row ─────────────────────────────────────────────
    const insertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/sms_events`,
      {
        method: 'POST',
        headers: {
          apikey:         SUPABASE_SERVICE_ROLE_KEY,
          Authorization:  `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer:         'return=representation',
        },
        body: JSON.stringify({
          client_id:       clientId,
          customer_number: from,
          client_number:   to,
          twilio_call_sid: callSid,
          message_body:    body,
        }),
      },
    );

    if (insertRes.status === 409) {
      console.log(`duplicate_call_sid: ${callSid} already logged for ${businessName}, returning 200`);
      return json(200, { ok: true, duplicate: true });
    }

    if (!insertRes.ok) {
      throw new Error(`insert_failed: ${insertRes.status} ${await insertRes.text()}`);
    }

    const inserted   = await insertRes.json() as { id: string }[];
    const smsEventId = inserted[0]?.id ?? null;
    return json(200, { ok: true, id: smsEventId, sms_event_id: smsEventId, client_id: clientId });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`twilio-missed-call fatal: ${errMsg}`);

    if (RESEND_API_KEY) {
      const alertContent = `
        <h1 style="font-size:22px;font-weight:700;color:${BRAND.primaryText};margin:0 0 4px;letter-spacing:-0.01em;">⚠️ twilio-missed-call failed</h1>
        <p style="font-size:14px;color:${BRAND.secondaryText};margin:0 0 16px;">A missed-call webhook errored — Twilio will retry, but investigate.</p>
        <p style="font-size:13px;color:${BRAND.primaryText};margin:0 0 8px;"><strong>Function:</strong> twilio-missed-call</p>
        <p style="font-size:13px;color:${BRAND.primaryText};margin:0 0 8px;"><strong>Error:</strong> ${escapeHtml(errMsg)}</p>
        <p style="font-size:13px;color:${BRAND.primaryText};margin:0 0 16px;"><strong>Time:</strong> ${new Date().toISOString()}</p>
        <p style="font-size:13px;color:${BRAND.secondaryText};margin:0;">Twilio will retry — investigate in Supabase logs.</p>
      `;
      fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from:    'CallMagnet Alerts <hello@callmagnet.com.au>',
          to:      ALERT_TO,
          subject: '⚠️ CallMagnet — twilio-missed-call failed',
          html:    renderEmailShell(alertContent, 'twilio-missed-call failed — Twilio will retry'),
        }),
      }).catch(() => {});
    }

    return json(500, { error: 'internal_error', detail: errMsg });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
