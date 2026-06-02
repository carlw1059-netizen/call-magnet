// ═══ Clients Admin JS ═════════════════════════════════════════════════════════
// Auth: exact middle-man-admin.js pattern — dual gate, elements captured before
// await, null-safe guards, storageKey 'callmagnet-auth-token'.

const CA_SUPABASE_URL      = 'https://iskvvnhacqdxybpmwuni.supabase.co';
const CA_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlza3Z2bmhhY3FkeHlicG13dW5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTAyOTYsImV4cCI6MjA5MDA4NjI5Nn0.c3uR-CSQXsgfYMnzK8KOxZjoqRPwaMsUuGpMPwvCsk8';
const CA_REAL_ADMIN_EMAIL  = 'car312@hotmail.com';

let caSb        = null;
let allClients  = [];   // full sorted list from DB
let smsCountMap = {};   // { client_id → total count }
let currentList = [];   // currently displayed (after filter)

// ─── HTML escape ──────────────────────────────────────────────────────────────
function _e(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

// ─── Update header count ──────────────────────────────────────────────────────
function caSetCount(n) {
  var el = document.getElementById('caCount');
  if (el) el.textContent = '· ' + n;
}

// ─── Load clients + SMS counts ────────────────────────────────────────────────
async function caLoad() {
  var grid = document.getElementById('caGrid');
  if (grid) grid.innerHTML = '<div class="ca-loading">Loading…</div>';

  // Clients — newest first
  var cr = await caSb
    .from('clients')
    .select('id,business_name,owner_name,email,owner_phone,twilio_number,plan_type,account_status,last_renewal_date,middle_man_slug,middle_man_enabled,created_at')
    .order('created_at', { ascending: false });

  if (cr.error) {
    console.error('[clients-admin] load error:', cr.error.message);
    if (grid) grid.innerHTML =
      '<div class="ca-empty"><div class="ca-empty-title">Failed to load clients</div></div>';
    return;
  }

  allClients  = cr.data || [];
  currentList = allClients.slice();
  caSetCount(allClients.length);

  // Single SMS count query — all client_id rows, grouped in JS
  smsCountMap = {};
  try {
    var sr = await caSb.from('sms_events').select('client_id').limit(500000);
    if (!sr.error) {
      (sr.data || []).forEach(function(row) {
        if (row.client_id) {
          smsCountMap[row.client_id] = (smsCountMap[row.client_id] || 0) + 1;
        }
      });
    }
  } catch (_) { /* non-fatal */ }

  caRender(currentList);
}

// ─── Render grid ──────────────────────────────────────────────────────────────
function caRender(list) {
  var grid = document.getElementById('caGrid');
  if (!grid) return;

  var q = '';
  var searchEl = document.getElementById('caSearch');
  if (searchEl) q = searchEl.value || '';

  if (list.length === 0) {
    grid.innerHTML = q.trim()
      ? '<div class="ca-empty"><div class="ca-empty-title">No results for &ldquo;' + _e(q.trim()) + '&rdquo;</div></div>'
      : '<div class="ca-empty"><div class="ca-empty-title">No clients yet</div></div>';
    return;
  }

  grid.innerHTML = list.map(caCard).join('');

  // Wire all copy buttons (inline + action bar)
  grid.querySelectorAll('[data-action="copy"]').forEach(function(btn) {
    btn.addEventListener('click', function() { caCopy(btn); });
  });

  // Wire toggle buttons
  grid.querySelectorAll('[data-action="toggle"]').forEach(function(btn) {
    btn.addEventListener('click', function() { caToggle(btn); });
  });
}

// ─── Build one client card ─────────────────────────────────────────────────────
function caCard(c) {

  // ── Status badge ──
  var statusCls =
    c.account_status === 'active'    ? 'ca-status-active'    :
    c.account_status === 'suspended' ? 'ca-status-suspended' :
    'ca-status-cancelled';
  var statusLabel = c.account_status
    ? c.account_status.charAt(0).toUpperCase() + c.account_status.slice(1)
    : '—';

  // ── Plan badge ──
  var planBadge = '';
  if (c.plan_type) {
    var pk = c.plan_type.toLowerCase();
    var planCls =
      pk === 'bronze'     ? 'ca-plan-bronze'     :
      pk === 'silver'     ? 'ca-plan-silver'     :
      pk === 'gold'       ? 'ca-plan-gold'       :
      pk === 'restaurant' ? 'ca-plan-restaurant' :
      'ca-plan-other';
    planBadge = '<span class="ca-badge ' + planCls + '">' + _e(c.plan_type) + '</span>';
  }

  // ── Renewal date — DD MMM YYYY ──
  var renewal = '—';
  if (c.last_renewal_date) {
    try {
      renewal = new Date(c.last_renewal_date).toLocaleDateString('en-AU', {
        day: '2-digit', month: 'short', year: 'numeric',
      });
    } catch (_) { renewal = _e(c.last_renewal_date); }
  }

  // ── Middle Man ──
  var mmHtml = '';
  if (c.middle_man_slug) {
    var mmBadge = c.middle_man_enabled
      ? '<span class="ca-badge ca-status-active" style="font-size:10px;">Live</span>'
      : '<span class="ca-badge ca-status-cancelled" style="font-size:10px;">Off</span>';
    mmHtml =
      '<div class="ca-detail">' +
        '<a href="https://callmagnet.com.au/b/' + _e(c.middle_man_slug) + '" ' +
           'target="_blank" rel="noopener" class="ca-mono">' +
           'callmagnet.com.au/b/' + _e(c.middle_man_slug) + ' ↗' +
        '</a> ' + mmBadge +
      '</div>';
  } else {
    mmHtml = '<div class="ca-detail ca-muted">No slug set</div>';
  }

  // ── Twilio ──
  var twilioHtml = '<div class="ca-detail">';
  if (c.twilio_number) {
    twilioHtml +=
      '<span class="ca-mono">' + _e(c.twilio_number) + '</span>' +
      ' <button class="ca-copy-inline" data-action="copy" data-val="' + _e(c.twilio_number) + '">Copy</button>';
  } else {
    twilioHtml += '<span class="ca-muted">—</span>';
  }
  twilioHtml += '</div>';

  // ── SMS count ──
  var smsCount = smsCountMap[c.id] || 0;

  // ── Toggle action button ──
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

  return (
    '<div class="ca-card" data-id="' + _e(c.id) + '">' +

      // Business name + owner name
      '<div class="ca-biz-name">' + _e(c.business_name || '—') + '</div>' +
      (c.owner_name ? '<div class="ca-owner-name">' + _e(c.owner_name) + '</div>' : '') +

      // CONTACT
      '<span class="ca-section-label">Contact</span>' +
      (c.email
        ? '<div class="ca-detail"><a href="mailto:' + _e(c.email) + '">' + _e(c.email) + '</a></div>'
        : '<div class="ca-detail ca-muted">—</div>') +
      (c.owner_phone
        ? '<div class="ca-detail">' + _e(c.owner_phone) + '</div>'
        : '') +

      // SUBSCRIPTION
      '<span class="ca-section-label">Subscription</span>' +
      '<div class="ca-detail">' +
        planBadge +
        (planBadge ? ' ' : '') +
        '<span class="ca-badge ' + statusCls + '">' + _e(statusLabel) + '</span>' +
      '</div>' +
      '<div class="ca-detail">' + _e(renewal) + '</div>' +

      // CALLMAGNET
      '<span class="ca-section-label">CallMagnet</span>' +
      twilioHtml +
      mmHtml +

      // ACTIVITY
      '<span class="ca-section-label">Activity</span>' +
      '<div class="ca-detail">' +
        '<span class="ca-sms-count">' + smsCount.toLocaleString() + '</span>' +
        '&nbsp;missed call SMSes sent' +
      '</div>' +

      // Action buttons
      '<div class="ca-actions">' +
        '<a href="/admin/middle-man.html?client=' + _e(c.id) + '" class="ca-btn">Manage</a>' +
        (c.twilio_number
          ? '<button class="ca-btn" data-action="copy" data-val="' + _e(c.twilio_number) + '">Copy Twilio</button>'
          : '') +
        toggleBtn +
      '</div>' +

    '</div>'
  );
}

// ─── Real-time search ─────────────────────────────────────────────────────────
function caFilter() {
  var q = '';
  var searchEl = document.getElementById('caSearch');
  if (searchEl) q = searchEl.value.toLowerCase().trim();

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

  function onSuccess() {
    btn.textContent = 'Copied!';
    btn.disabled = true;
    setTimeout(function() { btn.textContent = orig; btn.disabled = false; }, 2000);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(val).then(onSuccess).catch(fallback);
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
      onSuccess();
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

  var result = await caSb.from('clients').update({ account_status: next }).eq('id', id);

  if (result.error) {
    alert('Update failed: ' + result.error.message);
    btn.disabled    = false;
    btn.textContent = label;
    return;
  }

  // Update in-memory data so filter is consistent after re-render
  [allClients, currentList].forEach(function(arr) {
    var c = arr.find(function(x) { return x.id === id; });
    if (c) c.account_status = next;
  });

  caRender(currentList);
}

// ─── Boot — verbatim middle-man-admin.js pattern ──────────────────────────────
document.addEventListener('DOMContentLoaded', async function() {
  var gateEl = document.getElementById('caAuthGate');
  var pageEl = document.getElementById('caPage');

  // Initialise Supabase (same storage key as dashboard — shared session)
  caSb = supabase.createClient(CA_SUPABASE_URL, CA_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      storage: window.localStorage,
      storageKey: 'callmagnet-auth-token',
      autoRefreshToken: true,
      detectSessionInUrl: false,
    }
  });

  // Auth check
  var sessionResult = await caSb.auth.getSession();
  var sess = sessionResult.data && sessionResult.data.session;

  if (!sess) {
    window.location.href = '/admin/';
    return;
  }

  var isAdmin = sess.user && sess.user.app_metadata && sess.user.app_metadata.is_admin === true;
  var email   = ((sess.user && sess.user.email) || '').toLowerCase();

  if (!isAdmin || email !== CA_REAL_ADMIN_EMAIL) {
    window.location.href = '/admin/';
    return;
  }

  // Show page
  if (gateEl) gateEl.style.display = 'none';
  if (pageEl) pageEl.style.display  = 'block';

  // Wire back button
  var backBtn = document.getElementById('caBackBtn');
  if (backBtn) backBtn.addEventListener('click', function() { window.location.href = '/admin/'; });

  // Wire search
  var searchEl = document.getElementById('caSearch');
  if (searchEl) searchEl.addEventListener('input', caFilter);

  // Load data
  await caLoad();
});
