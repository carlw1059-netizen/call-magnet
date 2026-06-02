// ═══ Clients Admin — full client list with search, suspend, Twilio copy ═════
// Auth: is_admin === true AND email === REAL_ADMIN_EMAIL (dual gate).
// Data: clients table, sorted created_at DESC, filtered client-side.

const CA_SUPABASE_URL      = 'https://iskvvnhacqdxybpmwuni.supabase.co';
const CA_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlza3Z2bmhhY3FkeHlicG13dW5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTAyOTYsImV4cCI6MjA5MDA4NjI5Nn0.c3uR-CSQXsgfYMnzK8KOxZjoqRPwaMsUuGpMPwvCsk8';
const CA_REAL_ADMIN_EMAIL  = 'car312@hotmail.com';

let caSb        = null;
let caSession   = null;
let allClients  = [];   // full sorted list from DB
let currentList = [];   // currently displayed (filtered) list

// ─── Escape helpers ──────────────────────────────────────────────────────────
function caEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function caEscAttr(s) {
  // Safe for use inside double-quoted HTML attributes
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

// ─── Count display ───────────────────────────────────────────────────────────
function caUpdateCount(n) {
  var el = document.getElementById('caCount');
  if (el) el.textContent = '· ' + n;
}

// ─── Fetch all clients ───────────────────────────────────────────────────────
async function caLoadClients() {
  var grid = document.getElementById('caGrid');
  if (grid) grid.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';

  var result = await caSb
    .from('clients')
    .select([
      'id',
      'business_name',
      'email',
      'owner_phone',
      'twilio_number',
      'plan_type',
      'account_status',
      'middle_man_slug',
      'middle_man_enabled',
      'last_renewal_date',
      'created_at',
      'suburb',
      'vertical',
    ].join(','))
    .order('created_at', { ascending: false });

  if (result.error) {
    console.error('[clients-admin] load error:', result.error.message);
    if (grid) grid.innerHTML =
      '<div class="empty-state"><div class="empty-title">Failed to load clients</div>' +
      '<div class="empty-sub">' + caEsc(result.error.message) + '</div></div>';
    return;
  }

  allClients  = result.data || [];
  currentList = allClients.slice();
  caUpdateCount(allClients.length);
  caRenderGrid(currentList);
}

// ─── Render grid ─────────────────────────────────────────────────────────────
function caRenderGrid(list) {
  var grid = document.getElementById('caGrid');
  if (!grid) return;

  var searchVal = (document.getElementById('caSearch') || {}).value || '';

  if (list.length === 0) {
    if (searchVal.trim()) {
      grid.innerHTML =
        '<div class="empty-state">' +
          '<div class="empty-icon">🔍</div>' +
          '<div class="empty-title">No results for &ldquo;' + caEsc(searchVal.trim()) + '&rdquo;</div>' +
          '<div class="empty-sub">Try a different name, email or number.</div>' +
        '</div>';
    } else {
      grid.innerHTML =
        '<div class="empty-state">' +
          '<div class="empty-icon">📋</div>' +
          '<div class="empty-title">No clients yet</div>' +
        '</div>';
    }
    return;
  }

  grid.innerHTML = list.map(caRenderCard).join('');

  // Wire copy-twilio buttons
  grid.querySelectorAll('[data-action="copy-twilio"]').forEach(function(btn) {
    btn.addEventListener('click', function() { caCopyTwilio(btn); });
  });

  // Wire toggle-status buttons
  grid.querySelectorAll('[data-action="toggle-status"]').forEach(function(btn) {
    btn.addEventListener('click', function() { caToggleStatus(btn); });
  });
}

// ─── Render single card ───────────────────────────────────────────────────────
function caRenderCard(c) {
  // Status badge
  var statusClass = c.account_status === 'active'    ? 'status-active'    :
                    c.account_status === 'suspended'  ? 'status-suspended'  :
                    'status-cancelled';
  var statusLabel = c.account_status
    ? c.account_status.charAt(0).toUpperCase() + c.account_status.slice(1)
    : 'Unknown';

  // Plan badge
  var planBadge = c.plan_type
    ? '<span class="badge badge-plan">' + caEsc(c.plan_type) + '</span>'
    : '';

  // Location subtitle
  var locHtml = c.suburb
    ? '<div class="card-location">' + caEsc(c.suburb) + (c.vertical ? ' · ' + caEsc(c.vertical) : '') + '</div>'
    : (c.vertical ? '<div class="card-location">' + caEsc(c.vertical) + '</div>' : '');

  // Renewal date
  var renewalText = '—';
  if (c.last_renewal_date) {
    try {
      renewalText = new Date(c.last_renewal_date).toLocaleDateString('en-AU', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
    } catch (_) { renewalText = caEsc(c.last_renewal_date); }
  }

  // Middle Man row
  var mmHtml = '';
  if (c.middle_man_slug) {
    var mmLiveBadge = c.middle_man_enabled
      ? '<span class="badge badge-mm-on">Live</span>'
      : '<span class="badge badge-mm-off">Off</span>';
    mmHtml =
      '<div class="card-row">' +
        '<span class="card-label">M.Man</span>' +
        '<span class="card-value">' +
          '<a href="https://callmagnet.com.au/b/' + caEscAttr(c.middle_man_slug) + '" ' +
             'target="_blank" rel="noopener" class="card-link">' +
             caEsc(c.middle_man_slug) + ' ↗' +
          '</a>' +
          ' ' + mmLiveBadge +
        '</span>' +
      '</div>';
  }

  // Twilio row
  var twilioHtml =
    '<div class="card-row">' +
      '<span class="card-label">Twilio</span>' +
      '<span class="card-value">';
  if (c.twilio_number) {
    twilioHtml +=
      caEsc(c.twilio_number) +
      ' <button class="btn-copy" data-action="copy-twilio" ' +
              'data-number="' + caEscAttr(c.twilio_number) + '" ' +
              'title="Copy Twilio number">Copy</button>';
  } else {
    twilioHtml += '<span class="muted">—</span>';
  }
  twilioHtml += '</span></div>';

  // Action: Manage button always present
  var manageBtn =
    '<a href="/admin/middle-man.html?client=' + caEscAttr(c.id) + '" class="btn btn-primary">Manage</a>';

  // Action: toggle status (active ↔ suspended; no action for cancelled)
  var toggleBtn = '';
  if (c.account_status === 'active') {
    toggleBtn =
      '<button class="btn btn-danger" data-action="toggle-status" ' +
              'data-id="' + caEscAttr(c.id) + '" ' +
              'data-name="' + caEscAttr(c.business_name || '') + '" ' +
              'data-current="active">Suspend</button>';
  } else if (c.account_status === 'suspended') {
    toggleBtn =
      '<button class="btn btn-success" data-action="toggle-status" ' +
              'data-id="' + caEscAttr(c.id) + '" ' +
              'data-name="' + caEscAttr(c.business_name || '') + '" ' +
              'data-current="suspended">Reactivate</button>';
  }

  return (
    '<div class="client-card" data-id="' + caEscAttr(c.id) + '">' +

      '<div class="card-header">' +
        '<div class="card-header-left">' +
          '<div class="card-biz-name">' + caEsc(c.business_name || '—') + '</div>' +
          locHtml +
        '</div>' +
        '<div class="card-badges">' +
          '<span class="badge ' + statusClass + '">' + caEsc(statusLabel) + '</span>' +
          planBadge +
        '</div>' +
      '</div>' +

      '<div class="card-body">' +
        (c.email
          ? '<div class="card-row"><span class="card-label">Email</span>' +
            '<span class="card-value">' + caEsc(c.email) + '</span></div>'
          : '') +
        (c.owner_phone
          ? '<div class="card-row"><span class="card-label">Phone</span>' +
            '<span class="card-value">' + caEsc(c.owner_phone) + '</span></div>'
          : '') +
        twilioHtml +
        mmHtml +
        '<div class="card-row"><span class="card-label">Renewal</span>' +
        '<span class="card-value">' + caEsc(renewalText) + '</span></div>' +
      '</div>' +

      '<div class="card-actions">' +
        manageBtn +
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
        (c.business_name  || '').toLowerCase().includes(q) ||
        (c.email          || '').toLowerCase().includes(q) ||
        (c.owner_phone    || '').toLowerCase().includes(q) ||
        (c.twilio_number  || '').toLowerCase().includes(q)
      );
    });
  }
  caUpdateCount(currentList.length);
  caRenderGrid(currentList);
}

// ─── Copy Twilio number to clipboard ─────────────────────────────────────────
function caCopyTwilio(btn) {
  var number = btn.dataset.number || '';
  var orig   = btn.textContent;

  function onSuccess() {
    btn.textContent = 'Copied!';
    btn.disabled = true;
    setTimeout(function() { btn.textContent = orig; btn.disabled = false; }, 2000);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(number).then(onSuccess).catch(function() { fallbackCopy(); });
  } else {
    fallbackCopy();
  }

  function fallbackCopy() {
    try {
      var ta = document.createElement('textarea');
      ta.value = number;
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
async function caToggleStatus(btn) {
  var id      = btn.dataset.id;
  var name    = btn.dataset.name;
  var current = btn.dataset.current;  // 'active' | 'suspended'
  var next    = current === 'active' ? 'suspended' : 'active';
  var action  = current === 'active' ? 'Suspend' : 'Reactivate';

  if (!confirm(action + ' ' + (name || 'this client') + '?')) return;

  btn.disabled    = true;
  btn.textContent = 'Updating…';

  var result = await caSb
    .from('clients')
    .update({ account_status: next })
    .eq('id', id);

  if (result.error) {
    alert('Update failed: ' + result.error.message);
    btn.disabled    = false;
    btn.textContent = action;
    return;
  }

  // Update local data so filter still works correctly
  var c = allClients.find(function(x) { return x.id === id; });
  if (c) c.account_status = next;
  var cc = currentList.find(function(x) { return x.id === id; });
  if (cc) cc.account_status = next;

  caRenderGrid(currentList);
}

// ─── Sign out ─────────────────────────────────────────────────────────────────
async function caSignout() {
  await caSb.auth.signOut();
  window.location.href = '/';
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async function() {
  caSb = supabase.createClient(CA_SUPABASE_URL, CA_SUPABASE_ANON_KEY, {
    auth: {
      persistSession:     true,
      storage:            window.localStorage,
      storageKey:         'callmagnet-auth-token',
      autoRefreshToken:   true,
      detectSessionInUrl: false,
    },
  });

  var sessionResult = await caSb.auth.getSession();
  caSession = sessionResult.data && sessionResult.data.session;

  // Hide loading gate
  var gateLoading = document.getElementById('gateLoading');
  if (gateLoading) gateLoading.classList.remove('visible');

  if (!caSession) {
    var gateLogin = document.getElementById('gateLogin');
    if (gateLogin) gateLogin.classList.add('visible');
    return;
  }

  var isAdmin = caSession.user &&
                caSession.user.app_metadata &&
                caSession.user.app_metadata.is_admin === true;
  var email   = ((caSession.user && caSession.user.email) || '').toLowerCase();

  if (!isAdmin || email !== CA_REAL_ADMIN_EMAIL) {
    var gateForbidden = document.getElementById('gateForbidden');
    if (gateForbidden) gateForbidden.classList.add('visible');
    var signoutBtn = document.getElementById('caSignout');
    if (signoutBtn) signoutBtn.style.display = 'block';
    return;
  }

  // Auth passed — show page
  window.refreshAdminFab(caSession);
  var signoutBtn = document.getElementById('caSignout');
  if (signoutBtn) signoutBtn.style.display = 'block';
  var mainContent = document.getElementById('mainContent');
  if (mainContent) mainContent.style.display = 'block';

  // Wire search
  var searchEl = document.getElementById('caSearch');
  if (searchEl) searchEl.addEventListener('input', caFilter);

  // Load and render
  await caLoadClients();
});
