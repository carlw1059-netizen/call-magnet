/*
 * Purpose:
 *   Fetches a Supabase client record by the Twilio phone number that was called.
 *   Intended to run as a Twilio Serverless Function, called from a Studio
 *   "Run Function" widget placed before the Send Message (sms_reply) widget.
 *   Returns the client's vertical, business name, and booking URL so Studio
 *   can select the right SMS reply template via Liquid.
 *
 * Required environment variables
 * (set in Twilio Console → Functions → callmagnet-helpers → Environment Variables):
 *
 *   SUPABASE_URL          – project hostname only, no https:// prefix
 *                           e.g. iskvvnhacqdxybpmwuni.supabase.co
 *
 *   SUPABASE_SERVICE_ROLE_KEY – Supabase SERVICE ROLE key (not the anon key).
 *                           The clients table has row-level security; unauthenticated
 *                           anon reads return an empty array. The service role key
 *                           bypasses RLS for this server-side lookup — the same
 *                           approach used by the twilio-missed-call edge function.
 *                           Find it: Supabase Dashboard → Settings → API →
 *                           "service_role" (the one labelled "secret").
 *
 * Expected event parameters (sent by Studio "Run Function" widget):
 *   To – Twilio number that received the missed call, E.164 format (+61468083169)
 *
 * Return shape (JSON object):
 *   { vertical: string, business_name: string, booking_url: string }
 *   Studio accesses these as: widgets.WIDGET_NAME.parsed.vertical etc.
 *
 * Fallback on any failure (timeout, auth error, no DB match, malformed response):
 *   { vertical: 'default', business_name: 'us', booking_url: 'https://callmagnet.com.au' }
 *   Studio will fall through to the generic SMS template when vertical === 'default'.
 */

'use strict';

const got = require('got');

const FALLBACK = {
  vertical: 'default',
  business_name: 'us',
  booking_url: 'https://callmagnet.com.au',
};

exports.handler = async function (context, event, callback) {
  const to = String(event.To || event.to || '').trim();

  if (!to) {
    console.warn('[fetch-client-vertical] No To param in event — returning fallback');
    return callback(null, FALLBACK);
  }

  const rawUrl = context.SUPABASE_URL;
  const serviceKey = context.SUPABASE_SERVICE_ROLE_KEY;

  if (!rawUrl || !serviceKey) {
    console.error('[fetch-client-vertical] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    return callback(null, FALLBACK);
  }

  // Strip any accidental https:// prefix or trailing slash from the env var value
  const host = rawUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');

  const url =
    `https://${host}/rest/v1/clients` +
    `?twilio_number=eq.${encodeURIComponent(to)}` +
    `&select=vertical,business_name,booking_url`;

  let response;
  try {
    response = await got(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json',
      },
      responseType: 'json',
      timeout: { request: 5000 },   // 5-second hard timeout; fail fast if Supabase is slow
      throwHttpErrors: false,       // handle non-2xx manually so we can log the body
    });
  } catch (err) {
    // Network failure, DNS error, connection refused, or timeout
    console.error('[fetch-client-vertical] Request error:', err.message);
    return callback(null, FALLBACK);
  }

  if (response.statusCode !== 200) {
    console.error(
      `[fetch-client-vertical] Supabase returned ${response.statusCode}:`,
      JSON.stringify(response.body)
    );
    return callback(null, FALLBACK);
  }

  const rows = response.body;

  if (!Array.isArray(rows) || rows.length === 0) {
    console.warn('[fetch-client-vertical] No client row for To:', to);
    return callback(null, FALLBACK);
  }

  const { vertical, business_name, booking_url } = rows[0];

  return callback(null, {
    vertical:      vertical      || 'default',
    business_name: business_name || 'us',
    booking_url:   booking_url   || 'https://callmagnet.com.au',
  });
};
