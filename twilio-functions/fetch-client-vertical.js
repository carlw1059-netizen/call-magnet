/*
 * Purpose:
 *   Fetches a Supabase client record by the Twilio phone number that was called.
 *   Intended to run as a Twilio Serverless Function, called from a Studio
 *   "Run Function" widget placed before the Send Message (sms_reply) widget.
 *   Returns the client's vertical, business name, and booking URL so Studio
 *   can select the right SMS reply template via Liquid.
 *
 *   Uses the anon-safe RPC pattern: calls the get_client_vertical() Supabase
 *   function (SECURITY DEFINER, anon-executable) via PostgREST instead of
 *   querying the clients table directly. This means only the public anon key
 *   is needed — no service role key in Twilio.
 *
 * Required environment variables
 * (set in Twilio Console → Functions → callmagnet-helpers → Environment Variables):
 *
 *   SUPABASE_URL      – project hostname only, no https:// prefix
 *                       e.g. iskvvnhacqdxybpmwuni.supabase.co
 *
 *   SUPABASE_ANON_KEY – Supabase anon (public) key.
 *                       Find it: Supabase Dashboard → Settings → API →
 *                       Project API keys → "anon public" row → copy that key.
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
  customer_sms_template: 'Hi — sorry I missed your call. Click to book:',
};

exports.handler = async function (context, event, callback) {
  const to = String(event.To || event.to || '').trim();

  if (!to) {
    console.warn('[fetch-client-vertical] No To param in event — returning fallback');
    return callback(null, FALLBACK);
  }

  const rawUrl = context.SUPABASE_URL;
  const anonKey = context.SUPABASE_ANON_KEY;

  if (!rawUrl || !anonKey) {
    console.error('[fetch-client-vertical] Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars');
    return callback(null, FALLBACK);
  }

  // Strip any accidental https:// prefix or trailing slash from the env var value
  const host = rawUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');

  const url = `https://${host}/rest/v1/rpc/get_client_vertical`;

  let response;
  try {
    response = await got.post(url, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      json: { p_twilio_number: to },   // got serialises body + sets Content-Type: application/json
      responseType: 'json',
      timeout: { request: 5000 },      // 5-second hard timeout; fail fast if Supabase is slow
      throwHttpErrors: false,          // handle non-2xx manually so we can log the body
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

  const { vertical, business_name, booking_url, customer_sms_template, shortio_link, middle_man_slug } = rows[0];

  // Build the SMS link using a three-tier fallback chain:
  //   1. shortio_link    — Short.io short URL (tracking + brevity) — preferred
  //   2. middle_man_slug — build callmagnet.com.au/b/<slug> if no Short.io link yet
  //   3. booking_url     — raw Fresha / OpenTable URL (legacy fallback)
  // Substituted into the stored [LINK] placeholder so Twilio Studio stays trivial:
  //   {{widgets.fetch_client.parsed.customer_sms_template}} Reply STOP to opt out
  const bookingUrl = booking_url || 'https://callmagnet.com.au';
  const smsLink = shortio_link
    || (middle_man_slug ? `https://callmagnet.com.au/b/${middle_man_slug}` : null)
    || bookingUrl;
  const tmpl = (customer_sms_template || FALLBACK.customer_sms_template).replace(/\[LINK\]/g, smsLink);

  return callback(null, {
    vertical:              vertical      || 'default',
    business_name:         business_name || 'us',
    booking_url:           bookingUrl,
    customer_sms_template: tmpl,
  });
};
