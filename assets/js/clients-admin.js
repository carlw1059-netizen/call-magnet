// ═══ Clients Admin JS ═════════════════════════════════════════════════════
// Auth pattern mirrors middle-man-admin.js exactly:
//   is_admin === true AND email === REAL_ADMIN_EMAIL (dual gate)
// Reads use anon key + authenticated session (RLS allows admin reads).
// Status updates use same authenticated client (RLS allows admin writes).

const CA_SUPABASE_URL      = 'https://iskvvnhacqdxybpmwuni.supabase.co';
const CA_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlza3Z2bmhhY3FkeHlicG13dW5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTAyOTYsImV4cCI6MjA5MDA4NjI5Nn0.c3uR-CSQXsgfYMnzK8KOxZjoqRPwaMsUuGpMPwvCsk8';
const CA_REAL_ADMIN_EMAIL  = 'car312@hotmail.com';

let caSb         = null;
let allClients   = [];   // full sorted list from DB
let smsCountMap  = {};   // { client_id → count }
let currentList  = [];   // currently visible (after filter)

// ─── HTML escape ──────────────────────────────────────────────────────────────
function _e(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

// ─── Update "Clients · N" count in header ────────────────────────────────────
function caSetCount(n) {
  var el = document.getElementById('caCount');
  if (el) el.textContent = '· ' + n;
}

// ─── Load all clients + SMS counts ───────────────────────────────────────────
async function caLoad() {
  var grid = document.getElementById('caGrid');
  if (grid) grid.innerHTML = '<div class="ca-loading">Loading…</div>';

  // Fetch clients (newest first)
  var clientResult = await caSb
    .from('clients')
    .select([
      'id',
      'business_name',
      'owner_name',
      'email',
      'owner_phone',
      'twilio_number',
      'plan_type',
      'account_status',
      'middle_man_slug',
      'middle_man_enabled',
      'last_renewal_date',
      'created_at',
    ].join(','))
    .order('created_at', { ascending: false });

  if (clientResult.error) {
    console.error('[clients-admin] load error:', clientResult.error.message);
    if (grid) grid.innerHTML =
      '<div class="ca-empty"><div class="ca-empty-title">Failed to load clients</div>' +
      _e(clientResult.error.message) + '</div>';
    return;
  }

  allClients  = clientResult.data || [];
  currentList = allClients.slice();
  caSetCount(allClients.length);

  // Single SMS count query — pull all client_id values and aggregate in JS.
  // This avoids one-query-per-client and doesn't require PostgREST GROUP BY.
  smsCountMap = {};
  try {
    var smsResult = await caSb
      .from('sms_events')
      .select('client_id')
      .limit(200000);   // generous ceiling; revisit when volume grows
    if (!smsResult.error) {
      (smsResult.data || []).forEach(function(row) {
        if (row.client_id) {
          smsCountMap[row.client_id] = (smsCountMap[row.client_id] || 0) + 1;
        }
      });
    } else {
      console.warn('[clients-admin] sms_events query error:', smsResult.error.message);
    }
  } catch (smsErr) {
    console.warn('[clients-admin] sms_events exception:', smsErr);
  }

  caRender(currentList);
}

// ─── Render grid ─────────────────────────────────────────────────────────────
function caRender(list) {
  var grid = document.getElementById('caGrid');
  if (!grid) return;

  var q = (document.getElementById('caSearch') || {}).value || '';

  if (list.length === 0) {
    if (q.trim()) {
      grid.innerHTML =
        '<div class="ca-empty">' +
          '<div class="ca-empty-title">No results for &ldquo;' + _e(q.trim()) + '&rdquo;</div>' +
        '</div>';
    } else {
      grid.innerHTML = '<div class="ca-empty"><div class="ca-empty-title">No clients yet</div></div>';
    }
    return;
  }

  grid.innerHTML = list.map(caCard).join('');

  // Wire copy buttons
  grid.querySelectorAll('[data-action="copy"]').forEach(function(btn) {
    btn.addEventListener('click', function() { caCopy(btn); });
  });

  // Wire suspend/reactivate buttons
  grid.querySelectorAll('[data-action="toggle"]').forEach(function(btn) {
    btn.addEventListener('click', function() { caToggle(btn); });
  });
}

// ─── Build a single client card ───────────────────────────────────────────────
function caCard(c) {
  // Status badge
  var statusClass =
    c.account_status === 'active'    ? 'ca-badge-active'    :
    c.account_status === 'suspended' ? 'ca-badge-suspended' :
    'ca-badge-cancelled';
  var statusLabel = c.account_status
    ? c.account_status.charAt(0).toUpperCase() + c.account_status.slice(1)
    : '—';

  // Plan badge
  var planBadge = '';
  if (c.plan_type) {
    var planKey = c.plan_type.toLowerCase();
    var planClass =
      planKey === 'bronze'     ? 'ca-badge-bronze'     :
      planKey === 'silver'     ? 'ca-badge-silver'     :
      planKey === 'gold'       ? 'ca-badge-gold'       :
      planKey === 'restaurant' ? 'ca-badge-restaurant' :
      'ca-badge-plan';
    planBadge = '<span class="ca-badge ' + planClass + '">' + _e(c.plan_type) + '</span>';
  }

  // Renewal date
  var renewalText = '—';
  if (c.last_renewal_date) {
    try {
      renewalText = new Date(c.last_renewal_date).toLocaleDateString('en-AU', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
    } catch (_) { renewalText = _e(c.last_renewal_date); }
  }

  // Middle Man row
  var mmRow = '';
  if (c.middle_man_slug) {
    var mmBadge = c.middle_man_enabled
      ? '<span class="ca-badge ca-badge-active" style="font-size:10px;">Live</span>'
      : '<span class="ca-badge ca-badge-cancelled" style="font-size:10px;">Off</span>';
    mmRow =
      '<div class="ca-row">' +
        '<span class="ca-label">M.Man</span>' +
        '<span class="ca-value">' +
          '<a href="https://callmagnet.com.au/b/' + _e(c.middle_man_slug) + '" ' +
             'target="_blank" rel="noopener" class="ca-link ca-mono">' +
             _e(c.middle_man_slug) + ' ↗</a>' +
          ' ' + mmBadge +
        '</span>' +
      '</div>';
  }

  // SMS count
  var smsCount = smsCountMap[c.id] || 0;

  // Twilio row with inline copy
  var twilioRow =
    '<div class="ca-row">' +
      '<span class="ca-label">Twilio</span>' +
      '<span class="ca-value">';
  if (c.twilio_number) {
    twilioRow +=
      '<span class="ca-mono">' + _e(c.twilio_number) + '</span>' +
      ' <button class="ca-copy-inline" data-action="copy" ' +
              'data-val="' + _e(c.twilio_number) + '" ' +
              'title="Copy Twilio number">Copy</button>';
  } else {
    twilioRow += '<span class="ca-muted">—</span>';
  }
  twilioRow += '</span></div>';

  // Action: always Manage + Copy Twilio; toggle only for active/suspended
  var toggleBtn = '';
  if (c.account_status === 'active') {
    toggleBtn =
      '<button class="ca-btn danger" data-action="toggle" ' +
              'data-id="' + _e(c.id) + '" ' +
              'data-name="' + _e(c.business_name || '') + '" ' +
              'data-current="active">Suspend</button>';
  } else if (c.account_status === 'suspended') {
    toggleBtn =
      '<button class="ca-btn success" data-action="toggle" ' +
              'data-id="' + _e(c.id) + '" ' +
              'data-name="' + _e(c.business_name || '') + '" ' +
              'data-current="suspended">Reactivate</button>';
  }

  var copyTwilioBtn = c.twilio_number
    ? '<button class="ca-btn" data-action="copy" ' +
              'data-val="' + _e(c.twilio_number) + '" ' +
              'title="Copy Twilio number">Copy Twilio</button>'
    : '';

  return (
    '<div class="ca-card" data-id="' + _e(c.id) + '">' +

      '<div class="ca-card-top">' +
        '<div class="ca-card-biz">' + _e(c.business_name || '—') + '</div>' +
        '<div class="ca-card-badges">' +
          '<span class="ca-badge ' + statusClass + '">' + _e(statusLabel) + '</span>' +
          planBadge +
        '</div>' +
      '</div>' +

      '<div class="ca-card-details">' +
        (c.owner_name
          ? '<div class="ca-row"><span class="ca-label">Owner</span>' +
            '<span class="ca-value">' + _e(c.owner_name) + '</span></div>'
          : '') +
        (c.email
          ? '<div class="ca-row"><span class="ca-label">Email</span>' +
            '<span class="ca-value"><a href="mailto:' + _e(c.email) + '" class="ca-link">' +
            _e(c.email) + '</a></span></div>'
          : '') +
        (c.owner_phone
          ? '<div class="ca-row"><span class="ca-label">Phone</span>' +
            '<span class="ca-value">' + _e(c.owner_phone) + '</span></div>'
          : '') +
        twilioRow +
        mmRow +
        '<div class="ca-row"><span class="ca-label">Renewal</span>' +
        '<span class="ca-value">' + _e(renewalText) + '</span></div>' +
        '<div class="ca-row"><span class="ca-label">SMS</span>' +
        '<span class="ca-value">' + smsCount.toLocaleString() + '</span></div>' +
      '</div>' +

      '<div class="ca-card-actions">' +
        '<a href="/admin/middle-man.html?client=' + _e(c.id) + '" class="ca-btn">Manage</a>' +
        copyTwilioBtn +
        toggleBtn +
      '</div>' +

    '</div>'
  );
}

// ─── Real-time search filter ──────────────────────────────────────────────────
function caFilter() {
  var q = ((document.getElementById('caSearch') || {}).value || '').toLowerCase().trim();
  if (!q) {
    currentList = allClients.slice();
  } else {
    currentList = allClients.filter(function(c) {
      return (
        (c.business_name || '').toLowerCase().includes(q) ||
        (c.owner_name    || '').toLowerCase().includes(q) ||
        (c.email         || '').toLowerCase().includes(q) ||
        (c.owner_phone   || '').toLowerCase().includes(q) ||
        (c.twilio_number || '').toLowerCase().includes(q)
      );
    });
  }
  caSetCount(currentList.length);
  caRender(currentList);
}

// ─── Copy to clipboard ────────────────────────────────────────────────────────
function caCopy(btn) {
  var val  = btn.dataset.val || '';
  var orig = btn.textContent;

  function done() {
    btn.textContent = 'Copied!';
    btn.disabled = true;
    setTimeout(function() { btn.textContent = orig; btn.disabled = false; }, 2000);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(val).then(done).catch(fallback);
  } else {
    fallback();
  }

  function fallback() {
    try {
      var ta = document.createElement('textarea');
      ta.value = val;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (_) { /* silently ignore */ }
  }
}

// ─── Suspend / Reactivate ─────────────────────────────────────────────────────
async function caToggle(btn) {
  var id      = btn.dataset.id;
  var name    = btn.dataset.name;
  var current = btn.dataset.current;
  var next    = current === 'active' ? 'suspended' : 'active';
  var label   = current === 'active' ? 'Suspend' : 'Reactivate';

  if (!confirm(label + ' ' + (name || 'this client') + '?')) return;

  btn.disabled    = true;
  btn.textContent = 'Updating…';

  var result = await caSb
    .from('clients')
    .update({ account_status: next })
    .eq('id', id);

  if (result.error) {
    alert('Update failed: ' + result.error.message);
    btn.disabled    = false;
    btn.textContent = label;
    return;
  }

  // Update in-memory data so filter stays correct
  [allClients, currentList].forEach(function(arr) {
    var c = arr.find(function(x) { return x.id === id; });
    if (c) c.account_status = next;
  });

  caRender(currentList);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async function() {
  // Initialise Supabase — same storage key as dashboard (shared session)
  caSb = supabase.createClient(CA_SUPABASE_URL, CA_SUPABASE_ANON_KEY, {
    auth: {
      persistSession:     true,
      storage:            window.localStorage,
      storageKey:         'callmagnet-auth-token',
      autoRefreshToken:   true,
      detectSessionInUrl: false,
    },
  });

  // ── Dual auth gate (same logic as middle-man-admin.js) ──────────────────
  var sessionResult = await caSb.auth.getSession();
  var sess = sessionResult.data && sessionResult.data.session;

  if (!sess) { window.location.href = '/'; return; }

  var isAdmin = sess.user && sess.user.app_metadata &&
                sess.user.app_metadata.is_admin === true;
  var email   = ((sess.user && sess.user.email) || '').toLowerCase();

  if (!isAdmin || email !== CA_REAL_ADMIN_EMAIL) {
    window.location.href = '/';
    return;
  }

  // Auth passed — show page
  document.getElementById('caAuthGate').style.display = 'none';
  document.getElementById('caPage').style.display     = 'block';

  // Wire back button
  document.getElementById('caBackBtn').addEventListener('click', function() {
    window.location.href = '/';
  });

  // Wire search
  document.getElementById('caSearch').addEventListener('input', caFilter);

  // Load data
  await caLoad();
});
