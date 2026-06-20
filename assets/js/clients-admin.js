// ═══ Clients Admin JS ═════════════════════════════════════════════════════════
// Auth: exact middle-man-admin.js pattern — dual gate, elements captured before
// await, null-safe guards, storageKey 'callmagnet-auth-token'.

const CA_SUPABASE_URL      = 'https://iskvvnhacqdxybpmwuni.supabase.co';
const CA_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlza3Z2bmhhY3FkeHlicG13dW5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTAyOTYsImV4cCI6MjA5MDA4NjI5Nn0.c3uR-CSQXsgfYMnzK8KOxZjoqRPwaMsUuGpMPwvCsk8';
const CA_REAL_ADMIN_EMAIL  = 'car312@hotmail.com';

let caSb          = null;
let allClients    = [];   // full sorted list from DB
let smsCountMap   = {};   // { client_id → total count }
let currentList   = [];   // currently displayed (after filter)
let showCancelled = false;

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
    .select('id,business_name,owner_name,email,owner_phone,twilio_number,plan_type,pricing_package,account_status,last_renewal_date,middle_man_slug,middle_man_enabled,created_at,cancellation_scheduled,cancelled_at,stripe_subscription_id,stripe_customer_id,is_test_account')
    .order('created_at', { ascending: false });

  if (cr.error) {
    console.error('[clients-admin] load error:', cr.error.message);
    if (grid) grid.innerHTML =
      '<div class="ca-empty"><div class="ca-empty-title">Failed to load clients</div></div>';
    return;
  }

  allClients  = cr.data || [];
  console.log('allClients count:', allClients.length);
  console.log('statuses:', allClients.map(c => c.account_status + ' / test:' + c.is_test_account));
  currentList = allClients.slice();
  caSetCount(allClients.length);

  // SMS count intentionally omitted — non-critical, removed to avoid RLS 500
  smsCountMap = {};

  caApplyFilters();
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

  // Wire reset-password buttons
  grid.querySelectorAll('[data-action="reset-pw"]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id   = btn.dataset.id;
      var form = document.getElementById('ca-pw-form-' + id);
      if (form) form.classList.toggle('visible');
    });
  });

  // Wire show/hide toggle
  grid.querySelectorAll('[data-action="pw-show"]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id  = btn.dataset.id;
      var inp = document.getElementById('ca-pw-input-' + id);
      if (!inp) return;
      if (inp.type === 'password') { inp.type = 'text';     btn.textContent = 'Hide'; }
      else                         { inp.type = 'password'; btn.textContent = 'Show'; }
    });
  });

  // Wire confirm buttons
  grid.querySelectorAll('[data-action="pw-confirm"]').forEach(function(btn) {
    btn.addEventListener('click', function() { caResetPassword(btn.dataset.id, btn); });
  });

  // Wire cancel buttons
  grid.querySelectorAll('[data-action="pw-cancel"]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id   = btn.dataset.id;
      var form = document.getElementById('ca-pw-form-' + id);
      var inp  = document.getElementById('ca-pw-input-' + id);
      var flash = document.getElementById('ca-pw-flash-' + id);
      if (form)  form.classList.remove('visible');
      if (inp)   { inp.value = ''; inp.type = 'password'; }
      if (flash) { flash.className = 'ca-pw-flash'; flash.textContent = ''; }
    });
  });

  // Wire delete-mm buttons
  grid.querySelectorAll('[data-action="delete-mm"]').forEach(function(btn) {
    btn.addEventListener('click', function() { caDeleteMM(btn); });
  });

  // Wire cancel-sub buttons
  grid.querySelectorAll('[data-action="cancel-sub"]').forEach(function(btn) {
    btn.addEventListener('click', function() { caCancel(btn); });
  });

  // Wire activate buttons
  grid.querySelectorAll('[data-action="activate"]').forEach(function(btn) {
    btn.addEventListener('click', function() { caActivate(btn); });
  });
}

// ─── Build one client card ─────────────────────────────────────────────────────
function caCard(c) {

  // ── Status badge ──
  var statusCls =
    c.account_status === 'active'          ? 'ca-status-active'    :
    c.account_status === 'suspended'       ? 'ca-status-suspended' :
    c.account_status === 'pending_setup'   ? 'ca-status-pending'   :
    c.account_status === 'pending_payment' ? 'ca-status-pending'   :
    'ca-status-cancelled';
  var statusLabel = c.account_status
    ? c.account_status.charAt(0).toUpperCase() + c.account_status.slice(1)
    : '—';

  // ── Plan badge ──
  var planBadge = '';
  if (c.pricing_package) {
    var pkgLabel =
      c.pricing_package === 'restaurant'  ? 'Restaurant'       :
      c.pricing_package === 'hairdresser' ? 'Hairdresser/Barber' :
      c.pricing_package === 'free_trial'  ? 'Free Trial'       :
      null;
    var pkgCls =
      c.pricing_package === 'restaurant'  ? 'ca-plan-restaurant' :
      c.pricing_package === 'hairdresser' ? 'ca-plan-other'      :
      'ca-plan-other';
    if (pkgLabel) {
      planBadge = '<span class="ca-badge ' + pkgCls + '">' + _e(pkgLabel) + '</span>';
    }
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
    var mmBadge = (c.middle_man_enabled && c.account_status === 'active')
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
              'data-current="' + _e(c.account_status) + '">Suspend</button>';
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
        (c.account_status === 'pending_setup'
          ? '<button class="ca-btn" style="background:#10b981;color:#0a1a14;font-weight:700;" ' +
              'data-action="activate" ' +
              'data-id="' + _e(c.id) + '" ' +
              'data-name="' + _e(c.business_name || '') + '" ' +
              'data-pkg="' + _e(c.pricing_package || c.plan_type || '') + '">Activate</button>'
          : '') +
        '<button class="ca-btn" data-action="reset-pw" data-id="' + _e(c.id) + '">Reset password</button>' +
        '<button class="ca-btn" style="background:#CC5500;" data-action="delete-mm" data-id="' + _e(c.id) + '" data-name="' + _e(c.business_name || '') + '">Delete MM config</button>' +
        (c.cancellation_scheduled
          ? '<span class="ca-badge ca-status-cancelled" style="font-size:11px;padding:4px 10px;">Cancellation scheduled</span>'
          : ((c.account_status === 'active' || c.account_status === 'suspended')
              ? '<button class="ca-btn" style="background:#CC5500;" data-action="cancel-sub" data-id="' + _e(c.id) + '" data-name="' + _e(c.business_name || '') + '">Cancel subscription</button>'
              : '')) +
      '</div>' +

      // Inline reset-password form (hidden until button clicked)
      '<div class="ca-pw-form" id="ca-pw-form-' + _e(c.id) + '">' +
        '<div class="ca-pw-row">' +
          '<div class="ca-pw-input-wrap">' +
            '<input class="ca-pw-input" type="password" minlength="8" placeholder="New password (min 8 chars)" ' +
                   'id="ca-pw-input-' + _e(c.id) + '" />' +
            '<button type="button" class="ca-pw-show" data-action="pw-show" data-id="' + _e(c.id) + '">Show</button>' +
          '</div>' +
          '<button class="ca-btn success" data-action="pw-confirm" data-id="' + _e(c.id) + '">Confirm</button>' +
          '<button class="ca-btn danger"  data-action="pw-cancel"  data-id="' + _e(c.id) + '">Cancel</button>' +
        '</div>' +
        '<div class="ca-pw-flash" id="ca-pw-flash-' + _e(c.id) + '"></div>' +
      '</div>' +

    '</div>'
  );
}

// ─── Real-time search + status filter ────────────────────────────────────────
function caApplyFilters() {
  var q = '';
  var searchEl = document.getElementById('caSearch');
  if (searchEl) q = searchEl.value.toLowerCase().trim();

  currentList = allClients.filter(function(c) {
    if (!showCancelled && (c.is_test_account || c.account_status === 'cancelled')) return false;
    if (!q) return true;
    return (
      (c.business_name || '').toLowerCase().includes(q) ||
      (c.owner_name    || '').toLowerCase().includes(q) ||
      (c.email         || '').toLowerCase().includes(q) ||
      (c.owner_phone   || '').toLowerCase().includes(q) ||
      (c.twilio_number || '').toLowerCase().includes(q)
    );
  });
  caSetCount(currentList.length);
  caRender(currentList);
}

// ─── Show/hide cancelled toggle ───────────────────────────────────────────────
function toggleCancelled() {
  showCancelled = !showCancelled;
  var btn = document.getElementById('caShowCancelledBtn');
  if (btn) btn.textContent = showCancelled ? 'Hide cancelled' : 'Show cancelled';
  caApplyFilters();
}
window.toggleCancelled = toggleCancelled;

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

// ─── Reset client password ───────────────────────────────────────────────────
async function caResetPassword(clientId, confirmBtn) {
  var inp   = document.getElementById('ca-pw-input-'  + clientId);
  var flash = document.getElementById('ca-pw-flash-'  + clientId);
  if (!inp || !flash) return;

  var pw = inp.value;
  if (!pw || pw.length < 8) {
    flash.className   = 'ca-pw-flash fail';
    flash.textContent = 'Password must be at least 8 characters.';
    return;
  }

  var sessionResult = await caSb.auth.getSession();
  var sess = sessionResult.data && sessionResult.data.session;
  if (!sess) {
    flash.className   = 'ca-pw-flash fail';
    flash.textContent = 'Not signed in — please refresh and try again.';
    return;
  }

  confirmBtn.disabled    = true;
  confirmBtn.textContent = 'Saving…';
  flash.className        = 'ca-pw-flash';
  flash.textContent      = '';

  try {
    var res  = await fetch(CA_SUPABASE_URL + '/functions/v1/reset-client-password', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + sess.access_token,
      },
      body: JSON.stringify({ client_id: clientId, new_password: pw }),
    });
    var data = await res.json().catch(function() { return {}; });

    if (res.ok && data.ok) {
      flash.className   = 'ca-pw-flash ok';
      flash.textContent = 'Password reset.';
      inp.value         = '';
      inp.type          = 'password';
      // Reset show/hide label
      var showBtn = inp.parentNode && inp.parentNode.querySelector('[data-action="pw-show"]');
      if (showBtn) showBtn.textContent = 'Show';
    } else {
      flash.className   = 'ca-pw-flash fail';
      flash.textContent = 'Failed: ' + (data.detail || data.error || res.status);
    }
  } catch (e) {
    flash.className   = 'ca-pw-flash fail';
    flash.textContent = 'Network error: ' + (e && e.message ? e.message : e);
  }

  confirmBtn.disabled    = false;
  confirmBtn.textContent = 'Confirm';
}

// ─── Delete Middle Man config (does NOT delete the row) ──────────────────────
async function caDeleteMM(btn) {
  var id   = btn.dataset.id;
  var name = btn.dataset.name || 'this client';

  console.log('[caDeleteMM] clearing MM config for client id:', id);

  if (!confirm('This will remove all Middle Man configuration for ' + name + '. The client row in Supabase will NOT be deleted. Are you sure?')) return;

  btn.disabled    = true;
  btn.textContent = 'Clearing…';

  var result = await caSb.from('clients').update({
    middle_man_buttons:               [],
    middle_man_background_url:        null,
    middle_man_background_poster_url: null,
    middle_man_background_type:       null,
    middle_man_logo_url:              null,
    booking_url:                      null,
    shortio_link:                     null,
  }).eq('id', id);

  console.log('[caDeleteMM] supabase result:', JSON.stringify({ error: result.error, data: result.data }));

  if (result.error) {
    alert('Clear failed: ' + result.error.message);
    btn.disabled    = false;
    btn.textContent = 'Delete MM config';
    return;
  }

  allClients  = allClients.filter(function(x) { return x.id !== id; });
  currentList = currentList.filter(function(x) { return x.id !== id; });
  caRender(currentList);
}

// ─── Activate client (pending_setup → active + create subscription) ──────────
async function caActivate(btn) {
  var id   = btn.dataset.id;
  var name = btn.dataset.name || 'this client';
  var pkg  = btn.dataset.pkg  || '';

  // Prompt for pricing_package if not stored in plan_type
  if (!['restaurant', 'hairdresser'].includes(pkg)) {
    pkg = prompt('Enter pricing package for ' + name + ' (restaurant or hairdresser):') || '';
    pkg = pkg.trim().toLowerCase();
    if (!['restaurant', 'hairdresser'].includes(pkg)) {
      alert('Invalid package — must be "restaurant" or "hairdresser".');
      return;
    }
  }

  if (!confirm('Activate ' + name + '? This will start their ' + pkg + ' subscription and send them their account-live email.')) return;

  btn.disabled    = true;
  btn.textContent = 'Activating…';

  var sessionResult = await caSb.auth.getSession();
  var sess = sessionResult.data && sessionResult.data.session;
  if (!sess) {
    alert('Not signed in — please refresh and try again.');
    btn.disabled    = false;
    btn.textContent = 'Activate';
    return;
  }

  try {
    var res  = await fetch(CA_SUPABASE_URL + '/functions/v1/activate-client', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + sess.access_token,
      },
      body: JSON.stringify({ client_id: id, pricing_package: pkg }),
    });
    var data = await res.json().catch(function() { return {}; });

    if (res.ok && data.success) {
      [allClients, currentList].forEach(function(arr) {
        var c = arr.find(function(x) { return x.id === id; });
        if (c) c.account_status = 'active';
      });
      caRender(currentList);
    } else {
      alert('Activate failed: ' + (data.detail || data.error || res.status));
      btn.disabled    = false;
      btn.textContent = 'Activate';
    }
  } catch (e) {
    alert('Network error: ' + (e && e.message ? e.message : e));
    btn.disabled    = false;
    btn.textContent = 'Activate';
  }
}

// ─── Cancel subscription ──────────────────────────────────────────────────────
async function caCancel(btn) {
  var id   = btn.dataset.id;
  var name = btn.dataset.name || 'this client';

  if (!confirm('This will cancel ' + name + '\'s subscription at the end of their current billing period. They will keep access until then. Are you sure?')) return;

  btn.disabled    = true;
  btn.textContent = 'Cancelling…';

  var sessionResult = await caSb.auth.getSession();
  var sess = sessionResult.data && sessionResult.data.session;
  if (!sess) {
    alert('Not signed in — please refresh and try again.');
    btn.disabled    = false;
    btn.textContent = 'Cancel subscription';
    return;
  }

  try {
    var res  = await fetch(CA_SUPABASE_URL + '/functions/v1/cancel-client', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + sess.access_token,
      },
      body: JSON.stringify({ client_id: id }),
    });
    var data = await res.json().catch(function() { return {}; });

    if (res.ok && data.success) {
      // Update in-memory record and re-render to show badge
      [allClients, currentList].forEach(function(arr) {
        var c = arr.find(function(x) { return x.id === id; });
        if (c) c.cancellation_scheduled = true;
      });
      caRender(currentList);
    } else {
      alert('Cancel failed: ' + (data.detail || data.error || res.status));
      btn.disabled    = false;
      btn.textContent = 'Cancel subscription';
    }
  } catch (e) {
    alert('Network error: ' + (e && e.message ? e.message : e));
    btn.disabled    = false;
    btn.textContent = 'Cancel subscription';
  }
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
    window.location.href = '/';
    return;
  }

  var isAdmin = sess.user && sess.user.app_metadata && sess.user.app_metadata.is_admin === true;
  var email   = ((sess.user && sess.user.email) || '').toLowerCase();

  if (!isAdmin || email !== CA_REAL_ADMIN_EMAIL) {
    window.location.href = '/';
    return;
  }

  // Show page
  if (gateEl) gateEl.style.display = 'none';
  if (pageEl) pageEl.style.display  = 'block';

  // Wire back button
  var backBtn = document.getElementById('caBackBtn');
  if (backBtn) backBtn.addEventListener('click', function() { window.location.href = '/'; });

  // Wire search
  var searchEl = document.getElementById('caSearch');
  if (searchEl) searchEl.addEventListener('input', caApplyFilters);

  // Load data
  await caLoad();
});
