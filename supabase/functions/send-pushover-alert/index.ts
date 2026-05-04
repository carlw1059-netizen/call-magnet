// send-pushover-alert: single-purpose helper that POSTs a notification to
// Pushover's API on behalf of internal callers (other edge functions, pg_cron
// jobs, etc).
//
// Auth: deployed with --no-verify-jwt. Internal callers must include an
// X-Internal-Secret request header matching the INTERNAL_SECRET stored in
// Vault. Wrong/missing header → 401 immediately. The shared secret prevents
// anyone who guesses the function URL from triggering notifications to
// Carl's phone — Supabase project URLs are not strong secrets on their own.
//
// SECRET RENAME (transitional): INTERNAL_SECRET is the canonical name.
// PUSHOVER_INTERNAL_SECRET is the legacy name we're rolling away from. This
// function reads INTERNAL_SECRET first and falls back to the legacy name
// while both Vault entries coexist. A future cleanup pass removes the
// fallback once PUSHOVER_INTERNAL_SECRET is deleted from Vault.
//
// SECRET ROTATION: INTERNAL_SECRET lives in TWO places — the Edge Functions
// Vault (read by this file via Deno.env.get) AND the Postgres Vault (read
// by callmagnet-daily-summary cron + notify_first_booking trigger via
// vault.decrypted_secrets WHERE name='INTERNAL_SECRET'). These two stores
// do not auto-sync. If you rotate the value you MUST update both entries
// with the matching new value, otherwise every cron-driven daily summary
// will 401 here while ad-hoc curl callers continue to work.
//
// Request body (application/json):
//   title     string             required  notification title (Pushover limit: 250 chars)
//   message   string             required  notification body  (Pushover limit: 1024 chars)
//   priority  integer (-2..2)    optional  Pushover priority; omitted from the
//                                          upstream call if not supplied. Note that
//                                          priority=2 ("emergency") additionally
//                                          requires retry/expire — not handled here;
//                                          use the dedicated emergency endpoint or
//                                          extend this function if needed.
//
// On length-limit or other Pushover validation failures we let the upstream
// API's 4xx surface through as a 500 to the caller — pre-validating length
// here would just duplicate Pushover's own checks.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PUSHOVER_USER_KEY  = Deno.env.get('PUSHOVER_USER_KEY');
const PUSHOVER_APP_TOKEN = Deno.env.get('PUSHOVER_APP_TOKEN');
// Prefer the canonical INTERNAL_SECRET; fall back to the legacy
// PUSHOVER_INTERNAL_SECRET while both Vault entries coexist. Drop the
// fallback after the cleanup pass removes the legacy entry.
const INTERNAL_SECRET    = Deno.env.get('INTERNAL_SECRET') ?? Deno.env.get('PUSHOVER_INTERNAL_SECRET');

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    if (!PUSHOVER_USER_KEY || !PUSHOVER_APP_TOKEN || !INTERNAL_SECRET) {
      console.error(
        'send-pushover-alert: missing required Vault secrets ' +
        '(PUSHOVER_USER_KEY, PUSHOVER_APP_TOKEN, or INTERNAL_SECRET / PUSHOVER_INTERNAL_SECRET)',
      );
      return json(500, {
        error: 'config_error',
        detail: 'Required Vault secrets not configured',
      });
    }

    // Shared-secret guard: blocks anyone who guesses the function URL from
    // triggering Pushover notifications. All internal callers (cron, db
    // triggers, other edge functions) must include this header.
    if (req.headers.get('X-Internal-Secret') !== INTERNAL_SECRET) {
      return json(401, { error: 'unauthorized' });
    }

    const body = await req.json().catch(() => null) as
      | { title?: unknown; message?: unknown; priority?: unknown }
      | null;
    if (!body || typeof body !== 'object') {
      return json(400, {
        error: 'invalid_body',
        detail: 'JSON body with title and message is required',
      });
    }

    const title    = typeof body.title   === 'string' ? body.title.trim()   : '';
    const message  = typeof body.message === 'string' ? body.message.trim() : '';
    const priority = typeof body.priority === 'number' ? body.priority : null;

    if (!title || !message) {
      return json(400, {
        error: 'missing_required_field',
        detail: 'title and message are both required and must be non-empty strings',
      });
    }

    if (priority !== null && (!Number.isInteger(priority) || priority < -2 || priority > 2)) {
      return json(400, {
        error: 'invalid_priority',
        detail: 'priority must be an integer between -2 and 2 inclusive',
      });
    }

    const params = new URLSearchParams({
      token: PUSHOVER_APP_TOKEN,
      user:  PUSHOVER_USER_KEY,
      title,
      message,
    });
    if (priority !== null) params.set('priority', String(priority));

    const pushoverRes = await fetch('https://api.pushover.net/1/messages.json', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params,
    });

    if (!pushoverRes.ok) {
      const errBody = await pushoverRes.text();
      console.error(`pushover_api_failed: status=${pushoverRes.status} body=${errBody}`);
      return json(500, {
        error:  'pushover_api_failed',
        status: pushoverRes.status,
        detail: errBody,
      });
    }

    return json(200, { ok: true });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`send-pushover-alert fatal: ${errMsg}`);
    return json(500, { error: 'internal_error', detail: errMsg });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
