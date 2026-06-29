// ═══ Middle Man Admin — full page editor ══════════════════ BUILD-20260625 ══
// White business-tool page. Two views: manager (client list) + edit (single).
// Auth: is_admin === true AND email === REAL_ADMIN_EMAIL dual gate.

const MMA_SUPABASE_URL      = 'https://iskvvnhacqdxybpmwuni.supabase.co';
const MMA_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlza3Z2bmhhY3FkeHlicG13dW5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTAyOTYsImV4cCI6MjA5MDA4NjI5Nn0.c3uR-CSQXsgfYMnzK8KOxZjoqRPwaMsUuGpMPwvCsk8';
const MMA_REAL_ADMIN_EMAIL  = 'car312@hotmail.com';

let mmaSb              = null;
let _editClientId      = null;
let _editClientData    = null;
let _smsShortLink      = '';

// ─── Escape helper ────────────────────────────────────────────────────────────
function _e(s) {
  return String(s || '').replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ─── Flash a saved/error message beside a button ──────────────────────────────
function _flash(elId, text, isError) {
  var el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  el.style.color   = isError ? '#CC0000' : '#06D6A0';
  el.style.display = 'inline';
  setTimeout(function() { el.style.display = 'none'; el.style.color = '#06D6A0'; }, isError ? 3000 : 2000);
}

// ─── View switcher ────────────────────────────────────────────────────────────
function showManagerView() {
  _editClientId   = null;
  _editClientData = null;
  var body = document.getElementById('mmaBody');
  body.innerHTML =
    '<div class="mma-section">' +
      '<div class="mma-section-label">All Middle Man Clients</div>' +
      '<div id="mmaClientList"><div class="mma-loading">Loading…</div></div>' +
    '</div>';
  loadManager();
}

function showEditView(clientId) {
  _editClientId   = clientId;
  _editClientData = null;
  var body = document.getElementById('mmaBody');
  body.innerHTML =
    '<button class="mma-back-to-list" id="mmaBackToList">← All clients</button>' +
    '<div id="mmaEditContent"><div class="mma-loading">Loading…</div></div>';
  document.getElementById('mmaBackToList').addEventListener('click', showManagerView);
  loadClientForEdit(clientId);
}

// ─── Manager view: load and render client list ────────────────────────────────
async function loadManager() {
  var listEl = document.getElementById('mmaClientList');
  if (!listEl) return;
  try {
    var result = await mmaSb
      .from('clients')
      .select('id,business_name,vertical,middle_man_enabled,middle_man_slug,is_demo_account,is_locked,demo_active,is_test_account')
      .order('business_name', { ascending: true });
    if (result.error) throw result.error;

    var clients = (result.data || []).filter(function(c) {
      return (c.middle_man_enabled || c.middle_man_slug) && !c.is_test_account;
    });

    if (clients.length === 0) {
      listEl.innerHTML = '<div class="mma-loading">No Middle Man clients found.<br><span style="font-size:13px;color:#BBBBBB;">Enable Middle Man on a client or set a slug to get started.</span></div>';
      return;
    }

    var isAnyDemoActive = clients.some(function(c) { return c.is_demo_account && c.demo_active; });
    var activeDemoId    = isAnyDemoActive ? clients.find(function(c) { return c.is_demo_account && c.demo_active; }).id : null;
    listEl.innerHTML = clients.map(function(c) { return buildClientCard(c, isAnyDemoActive, activeDemoId); }).join('');

    // Wire edit/delete buttons via delegation
    listEl.addEventListener('click', function(ev) {
      var btn = ev.target.closest('.mma-edit-btn');
      if (btn) showEditView(btn.dataset.id);
      var lockBtn = ev.target.closest('.mma-lock-btn, .mma-unlock-btn');
      if (lockBtn) lockUnlockClient(lockBtn);
      var demoToggle = ev.target.closest('.mma-demo-toggle');
      if (demoToggle && !demoToggle.disabled) toggleDemoActive(demoToggle);
      var delBtn = ev.target.closest('.mma-delete-btn');
      if (delBtn) {
        var card = delBtn.closest('.mma-client-card');
        _showDeleteOverlay(card, delBtn.dataset.id, delBtn.dataset.name);
      }
    });
  } catch (err) {
    listEl.innerHTML = '<div class="mma-error">Failed to load: ' + _e(err.message) + '</div>';
  }
}

function buildClientCard(c, isAnyDemoActive, activeDemoId) {
  var liveBadge  = c.middle_man_enabled
    ? '<span class="mma-badge mma-badge-live">LIVE</span>'
    : '<span class="mma-badge mma-badge-off">OFF</span>';
  var vertBadge  = '<span class="mma-badge mma-badge-vert">' + _e(c.vertical || 'unknown') + '</span>';
  var demoBadge  = c.is_demo_account ? '<span class="mma-badge mma-badge-demo">DEMO</span>' : '';
  var slugHtml   = c.middle_man_slug
    ? '<a href="https://callmagnet.com.au/b/' + encodeURIComponent(c.middle_man_slug) + '" target="_blank" rel="noopener" class="mma-slug-link">callmagnet.com.au/b/' + _e(c.middle_man_slug) + '</a>'
    : '<span class="mma-no-slug">No slug set</span>';

  var lockCtrl = '';
  if (c.is_demo_account) {
    if (c.is_locked) {
      lockCtrl =
        '<span class="mma-badge mma-badge-locked">LOCKED</span>' +
        '<button class="mma-unlock-btn" data-id="' + _e(c.id) + '" data-locked="1">Unlock</button>';
    } else {
      lockCtrl = '<button class="mma-lock-btn" data-id="' + _e(c.id) + '" data-locked="0">Lock</button>';
    }
  }

  var demoToggleHtml = '';
  if (c.is_demo_account) {
    var isActive   = !!c.demo_active;
    var isDisabled = c.is_locked || (isAnyDemoActive && !isActive);
    demoToggleHtml =
      '<div class="mma-demo-toggle-wrap">' +
        '<span class="mma-demo-toggle-label">Active demo</span>' +
        '<button class="mma-demo-toggle' + (isActive ? ' mma-demo-toggle-on' : '') + '"' +
          ' data-id="' + _e(c.id) + '"' +
          ' data-active="' + (isActive ? '1' : '0') + '"' +
          (isDisabled ? ' disabled' : '') +
          ' title="' + (isActive ? 'Active demo — click to deactivate' : 'Set as active demo') + '">' +
        '</button>' +
      '</div>';
  }

  return '<div class="mma-client-card" style="position:relative;">' +
    '<div class="mma-client-header">' +
      '<div class="mma-client-left">' +
        '<span class="mma-client-name">' + _e(c.business_name) + '</span>' +
        vertBadge + liveBadge + demoBadge +
      '</div>' +
      '<div style="display:flex;gap:6px;align-items:center;">' +
        demoToggleHtml +
        lockCtrl +
        '<button class="mma-edit-btn" data-id="' + _e(c.id) + '">Edit</button>' +
      '</div>' +
    '</div>' +
    slugHtml +
    '<div style="margin-top:2px;text-align:right;">' +
      '<button class="mma-delete-btn" data-id="' + _e(c.id) + '" data-name="' + _e(c.business_name) + '" style="background:#AD1515;color:#fff;border:none;padding:8px 14px;line-height:1.4;border-radius:4px;font-size:13px;cursor:pointer;">Delete Client</button>' +
    '</div>' +
  '</div>';
}

function _showDeleteOverlay(card, clientId, clientName) {
  var overlay = document.createElement('div');
  overlay.className = 'mma-delete-overlay';
  overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.6);border-radius:inherit;z-index:50;display:flex;align-items:center;justify-content:center;';

  var box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:8px;padding:20px;width:260px;position:relative;font-family:inherit;box-shadow:0 4px 24px rgba(0,0,0,0.3);';

  var closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'position:absolute;top:8px;right:10px;background:none;border:none;font-size:16px;cursor:pointer;color:#555;line-height:1;';
  closeBtn.addEventListener('click', function() { overlay.remove(); });

  var msg = document.createElement('p');
  msg.style.cssText = 'font-size:14px;font-weight:600;color:#111;margin:0 0 16px;';
  msg.textContent = 'Delete ' + clientName + '? This cannot be undone.';

  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

  var cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'background:#e5e7eb;color:#111;border:none;padding:7px 14px;border-radius:4px;font-size:13px;cursor:pointer;font-family:inherit;';
  cancelBtn.addEventListener('click', function() { overlay.remove(); });

  var confirmBtn = document.createElement('button');
  confirmBtn.textContent = 'Confirm Delete';
  confirmBtn.className = 'confirm-delete-btn';
  confirmBtn.style.cssText = 'background:#AD1515;color:#fff;border:none;padding:7px 14px;border-radius:4px;font-size:13px;cursor:pointer;font-family:inherit;';
  var errMsg = document.createElement('div');
  errMsg.style.cssText = 'font-size:13px;color:#dc2626;margin-top:10px;display:none;';

  confirmBtn.addEventListener('click', async function() {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting…';
    errMsg.style.display = 'none';

    try {
      var res = await fetch('https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/delete-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      });
      var data = await res.json().catch(function() { return {}; });

      if (res.ok && data.success === true) {
        var parentCard = overlay.closest('.mma-client-card');
        if (parentCard) {
          parentCard.remove();
        } else {
          overlay.remove();
        }
      } else {
        throw new Error(data.error || ('Server error ' + res.status));
      }
    } catch (err) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm Delete';
      errMsg.textContent = err instanceof Error ? err.message : String(err);
      errMsg.style.display = 'block';
    }
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);
  box.appendChild(closeBtn);
  box.appendChild(msg);
  box.appendChild(btnRow);
  box.appendChild(errMsg);
  overlay.appendChild(box);
  card.appendChild(overlay);
}

function mmaPasswordModal(actionText) {
  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;';

    var box = document.createElement('div');
    box.style.cssText = 'background:#FFFFFF;border:1px solid #000000;border-radius:10px;padding:24px;width:320px;box-shadow:0 4px 24px rgba(0,0,0,0.18);font-family:inherit;';

    var labelEl = document.createElement('div');
    labelEl.style.cssText = 'font-size:14px;font-weight:600;color:#000000;margin-bottom:14px;';
    labelEl.textContent = actionText;

    var inputEl = document.createElement('input');
    inputEl.type = 'password';
    inputEl.placeholder = 'Password';
    inputEl.style.cssText = 'width:100%;box-sizing:border-box;border:1px solid #CCCCCC;border-radius:7px;padding:8px 10px;font-size:14px;margin-bottom:6px;outline:none;font-family:inherit;';

    var errEl = document.createElement('div');
    errEl.style.cssText = 'font-size:12px;color:#CC0000;min-height:18px;margin-bottom:12px;';

    var btnsEl = document.createElement('div');
    btnsEl.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'background:#F5F5F5;color:#333333;border:1px solid #CCCCCC;border-radius:7px;padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;';

    var okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.style.cssText = 'background:#10b981;color:#FFFFFF;border:none;border-radius:7px;padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;';

    function dismiss(confirmed) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(confirmed);
    }

    function onKey(e) {
      if (e.key === 'Escape') dismiss(false);
      if (e.key === 'Enter')  okBtn.click();
    }

    cancelBtn.addEventListener('click', function() { dismiss(false); });
    okBtn.addEventListener('click', function() {
      if (inputEl.value !== 'Demo2026!') {
        errEl.textContent = 'Incorrect password.';
        inputEl.value = '';
        inputEl.focus();
        return;
      }
      dismiss(true);
    });

    document.addEventListener('keydown', onKey);

    btnsEl.appendChild(cancelBtn);
    btnsEl.appendChild(okBtn);
    box.appendChild(labelEl);
    box.appendChild(inputEl);
    box.appendChild(errEl);
    box.appendChild(btnsEl);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    setTimeout(function() { inputEl.focus(); }, 30);
  });
}

function mmaFlashError(msg) {
  var el = document.createElement('div');
  el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#FFFFFF;border:1px solid #CC0000;border-radius:8px;padding:10px 20px;font-size:13px;color:#CC0000;font-weight:600;z-index:10000;box-shadow:0 2px 12px rgba(0,0,0,0.12);font-family:inherit;';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function() { el.remove(); }, 3500);
}

async function lockUnlockClient(btn) {
  var id       = btn.dataset.id;
  var isLocked = btn.dataset.locked === '1';
  var action   = isLocked ? 'unlock' : 'lock';
  var confirmed = await mmaPasswordModal('Enter the demo password to ' + action + ' this client:');
  if (!confirmed) return;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    var res = await mmaSb.from('clients').update({ is_locked: !isLocked }).eq('id', id);
    if (res.error) throw res.error;
    showManagerView();
  } catch (err) {
    mmaFlashError('Error: ' + err.message);
    btn.disabled = false;
    btn.textContent = isLocked ? 'Unlock' : 'Lock';
  }
}

async function toggleDemoActive(btn) {
  var clientId       = btn.dataset.id;
  var currentlyActive = btn.dataset.active === '1';
  var newActive       = !currentlyActive;

  // Optimistic DOM update — instant visual response
  if (newActive) {
    btn.classList.add('mma-demo-toggle-on');
    btn.dataset.active = '1';
    btn.title = 'Active demo — click to deactivate';
    document.querySelectorAll('.mma-demo-toggle').forEach(function(t) {
      if (t !== btn) t.disabled = true;
    });
  } else {
    btn.classList.remove('mma-demo-toggle-on');
    btn.dataset.active = '0';
    btn.title = 'Set as active demo';
    document.querySelectorAll('.mma-demo-toggle').forEach(function(t) {
      if (t !== btn) t.disabled = false;
    });
  }

  // Background Supabase update — revert via full re-render only on failure
  try {
    var res = await mmaSb.from('clients').update({ demo_active: newActive }).eq('id', clientId);
    if (res.error) throw res.error;
  } catch (err) {
    alert('Error updating demo state: ' + err.message);
    loadManager();
  }
}

// ─── Edit view: fetch client and render editor ────────────────────────────────
async function loadClientForEdit(clientId) {
  var content = document.getElementById('mmaEditContent');
  if (!content) return;
  try {
    var result = await mmaSb
      .from('clients')
      .select('id,business_name,email,vertical,middle_man_enabled,middle_man_slug,booking_url,middle_man_logo_url,middle_man_promo_text,middle_man_background_url,middle_man_background_type,middle_man_background_poster_url,middle_man_buttons,middle_man_updated_at,is_demo_account,is_locked,shortio_link,shortio_link_id,customer_sms_template,twilio_number')
      .eq('id', clientId)
      .single();
    if (result.error) throw result.error;
    _editClientData = result.data;
    renderEditBody(result.data);
  } catch (err) {
    console.error('[loadClientForEdit] ERROR:', err);
    content.innerHTML = '<div class="mma-error">Failed to load client: ' + _e(err.message) + '</div>';
  }
}

function renderEditBody(client) {
  var content = document.getElementById('mmaEditContent');
  if (!content) return;

  // Parse buttons
  var buttons = [];
  try {
    buttons = Array.isArray(client.middle_man_buttons)
      ? client.middle_man_buttons
      : JSON.parse(client.middle_man_buttons || '[]');
  } catch (_) { buttons = []; }

  var enabledOn = !!client.middle_man_enabled;
  var slug      = client.middle_man_slug || '';
  var promo     = client.middle_man_promo_text || '';
  var bgUrl     = client.middle_man_background_url || '';
  var bgType    = client.middle_man_background_type || 'image';
  var hasPhoto  = !!(bgUrl && bgType === 'image');
  var hasVideo  = !!(bgUrl && bgType === 'video');

  // ── 0. Logo upload
  var logoSection =
    '<div class="mma-section">' +
      '<div class="mma-section-label">Business Logo</div>' +
      '<div class="mma-section-hint" style="font-size:12px;color:#000000;margin-bottom:8px;">Shown at the top of the Middle Man page instead of the business name text. PNG with transparent background works best. To change the logo, simply upload a new one — it replaces the existing one automatically.</div>' +
      ((_editClientData.middle_man_logo_url)
        ? '<img id="mmaLogoPreview" src="' + _editClientData.middle_man_logo_url + '" style="max-height:80px;max-width:200px;object-fit:contain;margin-bottom:10px;display:block;border-radius:6px;" />'
        : '<div id="mmaLogoPreview" style="margin-bottom:10px;font-size:12px;color:#000000;">No logo uploaded yet.</div>') +
      '<div style="display:flex;gap:8px;align-items:center;">' +
        '<input id="mmaLogoInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" style="flex:1;font-size:13px;" />' +
        '<button id="mmaLogoUploadBtn" class="mma-save-btn">Upload</button>' +
      '</div>' +
      '<div id="mmaLogoMsg" class="mma-saved-msg" style="margin-left:0;margin-top:6px;"></div>' +
      (_editClientData.middle_man_logo_url
        ? '<button id="mmaLogoRemoveBtn" class="mma-save-btn" style="margin-top:8px;background:#cc3333;">Remove logo</button>'
        : '') +
    '</div>';

  // ── 1. Heading (FIX 1: 22px)
  var heading =
    '<div style="font-size:22px;font-weight:700;color:#111;margin-bottom:20px;">' +
      _e(client.business_name) +
    '</div>';

  // ── 2. Toggle (FIX 1: 15px, FIX 2: color #000)
  var toggleSection =
    '<div class="mma-section">' +
      '<div class="mma-section-label">Middle Man Enabled</div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
        '<span id="mmaEnabledDesc" style="font-size:15px;color:#000000;">' +
          (enabledOn ? 'Currently ON — live for customers' : 'Currently OFF — hidden from customers') +
        '</span>' +
        '<button id="mmaToggleBtn" class="mma-toggle-btn ' + (enabledOn ? 'mma-toggle-on' : 'mma-toggle-off') + '">' +
          (enabledOn ? 'ON' : 'OFF') +
        '</button>' +
      '</div>' +
    '</div>';

  // ── 3. Slug (FIX 1: 13px, FIX 2: #000)
  var slugSection =
    '<div class="mma-section">' +
      '<div class="mma-section-label">Slug (URL)</div>' +
      '<div style="display:flex;gap:8px;align-items:center;">' +
        '<span style="font-size:13px;color:#000000;white-space:nowrap;font-family:monospace;">callmagnet.com.au/b/</span>' +
        '<input id="mmaSlugInput" class="mma-field-input" value="' + _e(slug) + '" placeholder="your-slug" maxlength="50" style="font-family:monospace;" />' +
        '<button id="mmaSlugSaveBtn" class="mma-save-btn">Save</button>' +
      '</div>' +
      '<div id="mmaSlugMsg" class="mma-saved-msg" style="margin-left:0;margin-top:6px;"></div>' +
    '</div>';

  // ── 3c. Short Link & SMS Setup
  _smsShortLink     = client.shortio_link || '';
  var _smsTmplVal   = client.customer_sms_template || '';
  var shortioSmsSection =
    '<div class="mma-section">' +
      '<div id="mmaSmsSectionLabel" style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#06D6A0;cursor:pointer;user-select:none;display:flex;justify-content:space-between;align-items:center;">' +
        'SHORT LINK &amp; SMS SETUP' +
        '<span id="mmaSmsSectionArrow" style="font-size:12px;color:#06D6A0;">&#9658; Show</span>' +
      '</div>' +
      '<div id="mmaSmsSectionBody" style="display:none;margin-top:14px;">' +

        // SHORT LINK
        '<div style="font-size:13px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#000;margin-bottom:12px;">Step 1: Create Short Link</div>' +
        '<div style="font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#10b981;margin-bottom:4px;">Client Slug</div>' +
        '<input type="text" value="' + _e(client.middle_man_slug || '') + '" readonly style="width:100%;border:1px solid #ccc;border-radius:6px;padding:8px 10px;font-size:14px;color:#000;background:#f9fafb;font-family:inherit;font-weight:600;box-sizing:border-box;" />' +
        '<button id="mmaCreateShortLinkBtn"' + (_smsShortLink ? ' disabled' : '') + ' style="margin-top:12px;width:100%;background:#10b981;color:#fff;border:none;border-radius:6px;padding:9px;font-size:14px;font-weight:700;cursor:pointer;">Create Short Link in Short.io</button>' +
        '<div id="mmaCreateTag" style="margin-top:8px;">' + (_smsShortLink ? '<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;background:#d1fae5;color:#065f46;">&#10003; Connected</span>' : '') + '</div>' +
        '<div id="mmaShortLinkRow" style="' + (_smsShortLink ? '' : 'display:none;') + '">' +
          '<div style="font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#10b981;margin-bottom:4px;margin-top:12px;">Short Link Created</div>' +
          '<input type="text" id="mmaShortLinkOutput" readonly value="' + _e(_smsShortLink) + '" style="width:100%;border:1px solid #ccc;border-radius:6px;padding:8px 10px;font-size:14px;color:#000;background:#f9fafb;font-family:inherit;font-weight:600;box-sizing:border-box;" />' +
        '</div>' +

        '<div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">' +
        '<div style="font-size:13px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#000;margin-bottom:12px;">Step 2: SMS Message</div>' +
        '<div style="font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#10b981;margin-bottom:4px;">Customer SMS Template</div>' +
        '<textarea id="mmaSmsTmpl" rows="3" style="width:100%;border:1px solid #ccc;border-radius:6px;padding:8px 10px;font-size:14px;color:#000;background:#fff;font-family:inherit;resize:vertical;line-height:1.5;box-sizing:border-box;">' + _e(_smsTmplVal) + '</textarea>' +
        '<div id="mmaSmsCount" style="text-align:right;font-size:12px;font-weight:600;color:#10b981;margin-top:4px;">0/160</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;margin-top:9px;">' +
          '<button class="mma-sms-starter" style="background:#f0fdf4;border:1px solid #6ee7b7;border-radius:6px;padding:7px 10px;font-size:12px;color:#065f46;cursor:pointer;text-align:left;line-height:1.4;font-family:inherit;">Hi! Sorry we missed you. Book a table: [LINK]</button>' +
          '<button class="mma-sms-starter" style="background:#f0fdf4;border:1px solid #6ee7b7;border-radius:6px;padding:7px 10px;font-size:12px;color:#065f46;cursor:pointer;text-align:left;line-height:1.4;font-family:inherit;">Hi — couldn\'t reach the phone. Reserve here: [LINK]</button>' +
          '<button class="mma-sms-starter" style="background:#f0fdf4;border:1px solid #6ee7b7;border-radius:6px;padding:7px 10px;font-size:12px;color:#065f46;cursor:pointer;text-align:left;line-height:1.4;font-family:inherit;">Hi! Sorry I missed your call. Tap to book: [LINK]</button>' +
        '</div>' +
        '</div>' +
        '<div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">' +
        '<div style="font-size:13px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#000;margin-bottom:12px;">Step 3: SMS Preview</div>' +
        '<div id="mmaSmsPreview" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:14px;line-height:1.6;color:#000;word-break:break-word;min-height:54px;font-weight:600;">—</div>' +
        '<div style="margin-top:7px;font-size:12px;color:#6b7280;">Characters: <span id="mmaSmsPreviewCount" style="color:#10b981;font-weight:600;">0</span></div>' +
        '</div>' +
        '<div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:20px;">' +
        '<div style="font-size:13px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#000;margin-bottom:12px;">Step 4: Send &amp; Save</div>' +
        '<div style="font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#10b981;margin-bottom:4px;">Send to Number</div>' +
        '<input type="text" id="mmaSmsTestTo" placeholder="+61412345678" style="width:100%;border:1px solid #ccc;border-radius:6px;padding:8px 10px;font-size:14px;color:#000;background:#fff;font-family:inherit;font-weight:600;box-sizing:border-box;" />' +
        '<button id="mmaSmsTestBtn" style="margin-top:12px;width:100%;background:#10b981;color:#fff;border:none;border-radius:6px;padding:9px;font-size:14px;font-weight:700;cursor:pointer;">Send Test SMS</button>' +
        '<div id="mmaSmsTestTag" style="margin-top:8px;font-size:12px;font-weight:700;"></div>' +
        '<button id="mmaSmsSaveBtn" disabled style="margin-top:8px;width:100%;background:#aaa;color:#fff;border:none;border-radius:6px;padding:9px;font-size:14px;font-weight:700;cursor:not-allowed;">Save to System</button>' +
        '<div id="mmaSmsSaveMsg" style="font-size:13px;font-weight:600;margin-top:8px;display:none;"></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  // ── 3b. Client Login (email display + password reset)
  var clientLoginSection =
    '<div class="mma-section">' +
      '<div class="mma-section-label">Client Login</div>' +
      '<div style="margin-bottom:10px;">' +
        '<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#10b981;margin-bottom:4px;">Login email</div>' +
        '<div style="font-size:14px;color:#111111;font-family:monospace;padding:8px 10px;background:#F8F8F8;border:1px solid #CCCCCC;border-radius:7px;">' +
          _e(client.email || '—') +
        '</div>' +
      '</div>' +
      '<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#10b981;margin-bottom:4px;">New password</div>' +
      '<div style="display:flex;gap:8px;align-items:center;">' +
        '<div style="position:relative;flex:1;">' +
          '<input id="mmaPwInput" type="password" minlength="8" placeholder="Min 8 characters" class="mma-field-input" style="padding-right:52px;" />' +
          '<button type="button" id="mmaPwShowBtn" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#06D6A0;font-size:12px;font-weight:700;cursor:pointer;padding:2px 4px;font-family:inherit;line-height:1;">Show</button>' +
        '</div>' +
        '<button id="mmaPwSaveBtn" class="mma-save-btn">Save</button>' +
      '</div>' +
      '<div id="mmaPwMsg" class="mma-saved-msg" style="margin-left:0;margin-top:6px;"></div>' +
    '</div>';

  // ── 5. Promo text (FIX 1: 13px, FIX 2: #000)
  var promoSection =
    '<div class="mma-section">' +
      '<div class="mma-section-label">Promo Text</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">' +
        '<span style="font-size:13px;color:#000000;">Shown above buttons on the Middle Man page</span>' +
        '<span id="mmaPromoCount" style="font-size:13px;color:#000000;">' + promo.length + '/80</span>' +
      '</div>' +
      '<textarea id="mmaPromoInput" rows="2" maxlength="80" class="mma-field-input" style="resize:none;line-height:1.4;" placeholder="Short message shown to customers…">' + _e(promo) + '</textarea>' +
      '<div style="display:flex;align-items:center;margin-top:8px;">' +
        '<button id="mmaPromoSaveBtn" class="mma-save-btn">Save</button>' +
        '<span id="mmaPromoMsg" class="mma-saved-msg">✓ Saved</span>' +
      '</div>' +
    '</div>';

  // ── 5a+5b. Combined Background Media section (video + photo + live preview columns)
  var mediaSection =
    '<div class="mma-section">' +
      '<div class="mma-section-label">Background Media</div>' +
      '<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;">' +

        // VIDEO COLUMN
        '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:0 0 auto;width:185px;">' +
          '<div class="mma-media-label">Video</div>' +
          (bgType === 'video' && bgUrl
            ? '<video id="mmaVideoPreview" class="mma-video-preview" autoplay muted playsinline webkit-playsinline loop preload="auto"><source src="' + _e(bgUrl) + '?v=' + Date.now() + '" type="video/mp4" /></video>'
            : '<div id="mmaVideoPreview" class="mma-video-placeholder">▶</div>') +
          '<button id="mmaVideoUploadBtn" class="mma-save-btn">Upload video</button>' +
          '<div class="mma-info" style="text-align:center;font-size:11px;">MP4, vertical 9:16. Max 10 MB.</div>' +
          '<div id="mmaVideoProgress" class="mma-progress"></div>' +
          '<div id="mmaVideoErr" class="mma-err"></div>' +
          (bgType === 'video' && bgUrl ? '<button id="mmaVideoRemoveBtn" class="mma-remove-bg-btn">Remove video</button>' : '') +
        '</div>' +

        // PHOTO COLUMN
        '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:0 0 auto;width:185px;">' +
          '<div class="mma-media-label">Photo</div>' +
          (bgType === 'image' && bgUrl
            ? '<img src="' + _e(bgUrl) + '?v=' + Date.now() + '" id="mmaPhotoThumb" class="mma-bg-thumb" alt="Background photo" />'
            : '<div id="mmaPhotoThumb" class="mma-video-placeholder" style="font-size:24px;">★</div>') +
          '<button id="mmaPhotoUploadBtn" class="mma-save-btn">Upload photo</button>' +
          '<div class="mma-info" style="text-align:center;font-size:11px;">JPG or PNG, portrait. Max 5 MB.</div>' +
          '<div id="mmaPhotoProgress" class="mma-progress"></div>' +
          '<div id="mmaPhotoErr" class="mma-err"></div>' +
          '<button id="mmaPhotoRemoveBtn" class="mma-remove-bg-btn"' + (!(bgType === 'image' && bgUrl) ? ' style="opacity:0.3;pointer-events:none;"' : '') + '>Remove photo</button>' +
        '</div>' +

        // LIVE PREVIEW COLUMN — iPhone 15 proportions
        '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:0 0 auto;">' +
          '<div class="mma-media-label">Live preview</div>' +
          '<div class="mma-preview-phone" id="mmaPreviewPhone">' +
            '<div class="mma-preview-notch"></div>' +
            '<div class="mma-preview-screen" id="mmaPreviewScreen"></div>' +
          '</div>' +
        '</div>' +

      '</div>' +
    '</div>';

  // ── 6. Buttons
  var btnRows = buttons.filter(Boolean).map(function(b, i) { return buildBtnRowHtml(b, i); }).join('');
  var btnsSection =
    '<div class="mma-section">' +
      '<div class="mma-section-label">Customer Buttons</div>' +
      '<p class="mma-btn-hint">Order = position on caller\'s page (1 = top, 9 = bottom). Tick = button is live for customers. Untick to hide without deleting. X = delete permanently.</p>' +
      '<div id="mmaBtnBuilder">' + btnRows + '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-top:8px;">' +
        '<button id="mmaAddBtnBtn" class="mma-add-btn-link">+ Add button</button>' +
        '<button id="mmaSaveBtnsBtn" class="mma-save-btn">Save buttons</button>' +
        '<span id="mmaBtnsMsg" class="mma-saved-msg">✓ Saved</span>' +
      '</div>' +
    '</div>';

  // ── 8. Notification Messages
  var notifSection = buildNotifSection(buttons);

  // ── 8. Preview link
  var previewHtml = slug
    ? '<div style="text-align:center;padding:8px 0 4px;">' +
        '<a id="mmaPreviewLink" href="https://callmagnet.com.au/b/' + encodeURIComponent(slug) + '" target="_blank" rel="noopener" class="mma-preview-link">View live page →</a>' +
      '</div>'
    : '<div id="mmaPreviewLinkWrap"></div>';

  var lockedDemo    = !!(client.is_demo_account && client.is_locked);
  var lockedBanner  = lockedDemo
    ? '<div style="background:#FFF0E0;border:1px solid #FFA040;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:14px;font-weight:600;color:#7A4400;">🔒 DEMO LOCKED — use the Lock/Unlock button on the client list to unlock before editing.</div>'
    : '';
  var formWrapStart = lockedDemo ? '<div style="opacity:0.6;pointer-events:none;">' : '';
  var formWrapEnd   = lockedDemo ? '</div>' : '';
  content.innerHTML = heading + lockedBanner + formWrapStart + toggleSection + slugSection + shortioSmsSection + clientLoginSection + promoSection + logoSection + mediaSection + btnsSection + notifSection + previewHtml + formWrapEnd;

  // ── Wire event listeners ─────────────────────────────────────────────────────
  document.getElementById('mmaLogoUploadBtn').addEventListener('click', uploadLogo);
  var mmaLogoRemoveBtn = document.getElementById('mmaLogoRemoveBtn');
  if (mmaLogoRemoveBtn) mmaLogoRemoveBtn.addEventListener('click', removeLogo);

  document.getElementById('mmaToggleBtn').addEventListener('click', toggleEnabled);
  document.getElementById('mmaSlugSaveBtn').addEventListener('click', saveSlug);

  // Client Login — show/hide toggle + save password
  document.getElementById('mmaPwShowBtn').addEventListener('click', function() {
    var inp = document.getElementById('mmaPwInput');
    if (inp.type === 'password') { inp.type = 'text';     this.textContent = 'Hide'; }
    else                         { inp.type = 'password'; this.textContent = 'Show'; }
  });
  document.getElementById('mmaPwSaveBtn').addEventListener('click', saveClientPassword);

  var promoInput = document.getElementById('mmaPromoInput');
  promoInput.addEventListener('input', function() {
    document.getElementById('mmaPromoCount').textContent = promoInput.value.length + '/80';
  });
  document.getElementById('mmaPromoSaveBtn').addEventListener('click', savePromo);

  document.getElementById('mmaPhotoUploadBtn').addEventListener('click', triggerPhotoUpload);
  document.getElementById('mmaVideoUploadBtn').addEventListener('click', triggerVideoUpload);

  var photoRemoveBtn = document.getElementById('mmaPhotoRemoveBtn');
  if (photoRemoveBtn) photoRemoveBtn.addEventListener('click', removeBg);
  var videoRemoveBtn = document.getElementById('mmaVideoRemoveBtn');
  if (videoRemoveBtn) videoRemoveBtn.addEventListener('click', removeBg);

  // Button builder delegation
  document.getElementById('mmaBtnBuilder').addEventListener('click', function(ev) {
    var removeBtn = ev.target.closest('.mma-btn-remove');
    if (removeBtn) { removeBtn.closest('.mma-btn-row').remove(); renderPreview(); syncNotifRows(); return; }

    var sparklesBtn = ev.target.closest('.mma-btn-sparkles');
    if (sparklesBtn) {
      var spOn = sparklesBtn.classList.toggle('mma-btn-sparkles-on');
      sparklesBtn.title = spOn ? 'Sparkles ON — click to turn off' : 'Sparkles OFF — click to turn on';
      sparklesBtn.style.background = spOn ? 'rgba(180,130,255,0.25)' : 'rgba(255,255,255,0.1)';
      return;
    }

    var emojiPickBtn = ev.target.closest('.mma-btn-emoji-pick');
    if (emojiPickBtn) {
      ev.stopPropagation();
      var rows = document.querySelectorAll('#mmaBtnBuilder .mma-btn-row');
      var rowIdx = Array.prototype.indexOf.call(rows, emojiPickBtn.closest('.mma-btn-row'));
      emojiPickBtn.dataset.pickerId = 'btn-emoji-' + rowIdx;
      var proxy = document.createElement('input');
      proxy.type = 'hidden';
      proxy.value = '';
      proxy.addEventListener('input', function() {
        var em = proxy.value;
        if (em) { emojiPickBtn.textContent = em; emojiPickBtn.dataset.emoji = em; }
        if (proxy.parentNode) proxy.parentNode.removeChild(proxy);
      });
      document.body.appendChild(proxy);
      mmaShowEmojiPicker(proxy, emojiPickBtn);
      return;
    }

  });
  // Hex input ↔ colour picker sync (input delegation covers all rows incl. newly added)
  document.getElementById('mmaBtnBuilder').addEventListener('input', function(ev) {
    var row = ev.target.closest('.mma-btn-row');
    if (!row) return;

    var hexInput = ev.target.closest('.mma-btn-hex');
    if (hexInput) {
      // User typed/pasted a hex code — validate then update the colour picker
      var raw = hexInput.value.trim();
      var hex = raw.charAt(0) === '#' ? raw : '#' + raw;
      // Expand 3-char shorthand: #abc → #aabbcc
      if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
        hex = '#' + hex[1]+hex[1] + hex[2]+hex[2] + hex[3]+hex[3];
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return; // invalid — do nothing
      var cp = row.querySelector('.mma-btn-color');
      if (cp) cp.value = hex;
      renderPreview();
      return;
    }

    var colorInput = ev.target.closest('.mma-btn-color');
    if (colorInput) {
      // Colour picker changed — mirror to the hex text input
      var hi = row.querySelector('.mma-btn-hex');
      if (hi) hi.value = colorInput.value;
      // renderPreview() is already called by the wirePreview() listener on .mma-btn-color
      return;
    }
  });

  document.getElementById('mmaAddBtnBtn').addEventListener('click', function() {
    addBtnRow();
    setTimeout(function() { wirePreview(); renderPreview(); syncNotifRows(); }, 50);
  });
  document.getElementById('mmaSaveBtnsBtn').addEventListener('click', saveButtons);
  document.getElementById('mmaSaveNotifsBtn').addEventListener('click', saveNotifications);
  wireNotifBuilder();

  // ── Short Link & SMS section wiring ──────────────────────────────────────────
  (function() {
    var label  = document.getElementById('mmaSmsSectionLabel');
    var body   = document.getElementById('mmaSmsSectionBody');
    var arrow  = document.getElementById('mmaSmsSectionArrow');
    if (label && body) {
      label.addEventListener('click', function() {
        var hidden = body.style.display === 'none';
        body.style.display = hidden ? 'block' : 'none';
        if (arrow) arrow.innerHTML = hidden ? '&#9660; Hide' : '&#9658; Show';
      });
    }

    function updateSmsPreview() {
      var tmplEl   = document.getElementById('mmaSmsTmpl');
      var tmpl     = tmplEl ? tmplEl.value : '';
      var link     = _smsShortLink || '[LINK]';
      var preview  = tmpl.replace(/\[LINK\]/gi, link);
      var prevEl   = document.getElementById('mmaSmsPreview');
      var countEl  = document.getElementById('mmaSmsCount');
      var pcountEl = document.getElementById('mmaSmsPreviewCount');
      if (prevEl)   prevEl.textContent   = preview || '—';
      if (countEl) {
        countEl.textContent = tmpl.length + '/160';
        countEl.style.color = tmpl.length > 160 ? '#CC0000' : '#10b981';
      }
      if (pcountEl) pcountEl.textContent = preview.length;
    }

    var tmplEl = document.getElementById('mmaSmsTmpl');
    if (tmplEl) tmplEl.addEventListener('input', updateSmsPreview);

    document.querySelectorAll('.mma-sms-starter').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var t = document.getElementById('mmaSmsTmpl');
        if (t) { t.value = btn.textContent; updateSmsPreview(); }
      });
    });

    updateSmsPreview();

    var createBtn = document.getElementById('mmaCreateShortLinkBtn');
    if (createBtn) createBtn.addEventListener('click', function() { createShortioLink(); });

    var testBtn = document.getElementById('mmaSmsTestBtn');
    if (testBtn) testBtn.addEventListener('click', function() { sendTestSmsFromEdit(); });

    var saveBtn = document.getElementById('mmaSmsSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', function() { saveSmsToSystem(); });
  })();

  // Pulse toggle buttons — toggle on/off state when clicked
  document.querySelectorAll('.mma-btn-pulse').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var isOn = btn.classList.toggle('mma-btn-pulse-on');
      btn.title = isOn ? 'Glow ON — click to turn off' : 'Glow OFF — click to turn on';
      btn.style.background = isOn ? 'rgba(0,200,100,0.2)' : 'rgba(255,255,255,0.1)';
    });
  });

  // FIX 6: Autoplay the video preview if one is already set
  if (hasVideo) {
    _bootVideoPreview('mmaVideoPreview');
  }

  // Live preview — wire and render
  wirePreview();
  renderPreview();
}

// ─── Button row HTML builder ──────────────────────────────────────────────────
function buildBtnRowHtml(btn, idx) {
  return '<div class="mma-btn-row">' +
    '<input type="number" min="1" max="9" value="' + _e(btn.sort_order || idx + 1) + '" class="mma-btn-order" />' +
    '<button type="button" class="mma-btn-emoji-pick" data-emoji="' + _e(btn.emoji || '') + '" title="Pick emoji" style="width:36px;height:32px;border:none;border-radius:6px;cursor:pointer;font-size:16px;background:rgba(255,255,255,0.1);">' + _e(btn.emoji || '😊') + '</button>' +
    '<input type="checkbox"' + (btn.enabled !== false ? ' checked' : '') + ' class="mma-btn-enabled mma-btn-enabled-cb" />' +
    '<input type="text" value="' + _e(btn.label || '') + '" maxlength="40" placeholder="Button label…" class="mma-btn-label" />' +
    '<input type="url" value="' + _e(btn.url || '') + '" placeholder="Button URL (optional)…" class="mma-btn-url" />' +
    '<input type="color" class="mma-btn-color" value="' + _e(btn.color || '#00D4FF') + '" title="Button colour" style="width:36px;height:32px;padding:2px;border:none;border-radius:6px;cursor:pointer;background:none;" />' +
    '<input type="text" class="mma-btn-hex" value="' + _e(btn.color || '#00D4FF') + '" maxlength="7" placeholder="#rrggbb" style="width:62px;padding:3px 5px;font-size:11px;font-family:monospace;border:1px solid #ccc;border-radius:5px;background:#fff;color:#111;outline:none;" />' +
    '<button type="button" class="mma-btn-pulse' + (btn.animate !== false ? ' mma-btn-pulse-on' : '') + '" title="' + (btn.animate !== false ? 'Glow ON — click to turn off' : 'Glow OFF — click to turn on') + '" style="width:36px;height:32px;border:none;border-radius:6px;cursor:pointer;font-size:16px;background:' + (btn.animate !== false ? 'rgba(0,200,100,0.2)' : 'rgba(255,255,255,0.1)') + ';">✦</button>' +
    '<button type="button" class="mma-btn-sparkles' + (btn.sparkles ? ' mma-btn-sparkles-on' : '') + '" title="' + (btn.sparkles ? 'Sparkles ON — click to turn off' : 'Sparkles OFF — click to turn on') + '" style="width:36px;height:32px;border:none;border-radius:6px;cursor:pointer;font-size:14px;background:' + (btn.sparkles ? 'rgba(180,130,255,0.25)' : 'rgba(255,255,255,0.1)') + ';">✨</button>' +
    '<button type="button" class="mma-btn-remove" title="Remove">×</button>' +
  '</div>';
}

function addBtnRow() {
  var builder = document.getElementById('mmaBtnBuilder');
  if (!builder) return;
  if (builder.children.length >= 9) { alert('Maximum 9 buttons allowed.'); return; }
  var idx = builder.children.length;
  builder.insertAdjacentHTML('beforeend', buildBtnRowHtml({ label: '', sort_order: idx + 1, enabled: true }, idx));
}

// ─── Toggle enabled ───────────────────────────────────────────────────────────
async function toggleEnabled() {
  if (!_editClientId || !_editClientData) return;
  var btn    = document.getElementById('mmaToggleBtn');
  var desc   = document.getElementById('mmaEnabledDesc');
  var newVal = !_editClientData.middle_man_enabled;
  btn.disabled = true;
  try {
    var result = await mmaSb.from('clients').update({ middle_man_enabled: newVal }).eq('id', _editClientId);
    if (result.error) throw result.error;
    _editClientData.middle_man_enabled = newVal;
    btn.textContent = newVal ? 'ON' : 'OFF';
    btn.className   = 'mma-toggle-btn ' + (newVal ? 'mma-toggle-on' : 'mma-toggle-off');
    if (desc) desc.textContent = newVal ? 'Currently ON — live for customers' : 'Currently OFF — hidden from customers';
  } catch (err) {
    alert('Toggle failed: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

// ─── Upload logo ──────────────────────────────────────────────────────────────
async function uploadLogo() {
  if (!_editClientId) return;
  var input = document.getElementById('mmaLogoInput');
  var file  = input && input.files && input.files[0];
  if (!file) { _flash('mmaLogoMsg', '✗ No file selected', true); return; }
  if (file.size > 2 * 1024 * 1024) { _flash('mmaLogoMsg', '✗ File must be under 2MB', true); return; }
  var btn = document.getElementById('mmaLogoUploadBtn');
  btn.disabled = true; btn.textContent = 'Uploading…';
  try {
    var fd = new FormData();
    fd.append('client_id', _editClientId);
    fd.append('file', file);
    var res = await fetch(MMA_SUPABASE_URL + '/functions/v1/upload-middle-man-logo', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + (await mmaSb.auth.getSession()).data.session.access_token },
      body: fd,
    });
    var json = await res.json();
    if (!res.ok) throw new Error(json.error || res.statusText);
    if (_editClientData) _editClientData.middle_man_logo_url = json.url;
    var preview = document.getElementById('mmaLogoPreview');
    if (preview) {
      preview.outerHTML = '<img id="mmaLogoPreview" src="' + json.url + '" style="max-height:80px;max-width:200px;object-fit:contain;margin-bottom:10px;display:block;border-radius:6px;" />';
    }
    _flash('mmaLogoMsg', '✓ Logo uploaded', false);
    var existingRemoveBtn = document.getElementById('mmaLogoRemoveBtn');
    if (!existingRemoveBtn) {
      var removeBtn = document.createElement('button');
      removeBtn.id = 'mmaLogoRemoveBtn';
      removeBtn.className = 'mma-save-btn';
      removeBtn.style.cssText = 'margin-top:8px;background:#cc3333;';
      removeBtn.textContent = 'Remove logo';
      removeBtn.addEventListener('click', removeLogo);
      document.getElementById('mmaLogoMsg').parentNode.appendChild(removeBtn);
    }
  } catch (err) {
    _flash('mmaLogoMsg', '✗ ' + err.message, true);
  } finally {
    btn.disabled = false; btn.textContent = 'Upload';
  }
}

async function removeLogo() {
  if (!_editClientId) return;
  try {
    var result = await mmaSb.from('clients').update({ middle_man_logo_url: null }).eq('id', _editClientId);
    if (result.error) throw result.error;
    if (_editClientData) _editClientData.middle_man_logo_url = null;
    var preview = document.getElementById('mmaLogoPreview');
    if (preview) preview.outerHTML = '<div id="mmaLogoPreview" style="margin-bottom:10px;font-size:12px;color:#000000;">No logo uploaded yet.</div>';
    var removeBtn = document.getElementById('mmaLogoRemoveBtn');
    if (removeBtn) removeBtn.style.display = 'none';
    _flash('mmaLogoMsg', '✓ Logo removed', false);
  } catch (err) {
    _flash('mmaLogoMsg', '✗ ' + err.message, true);
  }
}

// ─── Save slug ────────────────────────────────────────────────────────────────
async function saveSlug() {
  if (!_editClientId) return;
  var input = document.getElementById('mmaSlugInput');
  var raw   = (input.value || '').trim().toLowerCase();
  var slug  = raw.replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  input.value = slug;
  try {
    var result = await mmaSb.from('clients').update({ middle_man_slug: slug || null }).eq('id', _editClientId);
    if (result.error) throw result.error;
    if (_editClientData) _editClientData.middle_man_slug = slug;
    _flash('mmaSlugMsg', '✓ Saved', false);
    var previewLink = document.getElementById('mmaPreviewLink');
    if (previewLink && slug) previewLink.href = 'https://callmagnet.com.au/b/' + encodeURIComponent(slug);
  } catch (err) {
    _flash('mmaSlugMsg', '✗ ' + err.message, true);
  }
}

// ─── Reset client password ───────────────────────────────────────────────────
async function saveClientPassword() {
  if (!_editClientId) return;
  var inp = document.getElementById('mmaPwInput');
  var pw  = inp ? inp.value : '';
  if (!pw || pw.length < 8) {
    _flash('mmaPwMsg', '✗ Password must be at least 8 characters', true);
    return;
  }
  var sessionResult = await mmaSb.auth.getSession();
  var sess = sessionResult.data && sessionResult.data.session;
  if (!sess) {
    _flash('mmaPwMsg', '✗ Not signed in — please refresh', true);
    return;
  }
  var btn = document.getElementById('mmaPwSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    var res  = await fetch('https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/reset-client-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sess.access_token },
      body:    JSON.stringify({ client_id: _editClientId, new_password: pw }),
    });
    var data = await res.json().catch(function() { return {}; });
    if (res.ok && data.ok) {
      _flash('mmaPwMsg', '✓ Password reset', false);
      inp.value = '';
      inp.type  = 'password';
      var showBtn = document.getElementById('mmaPwShowBtn');
      if (showBtn) showBtn.textContent = 'Show';
    } else {
      _flash('mmaPwMsg', '✗ ' + (data.detail || data.error || res.status), true);
    }
  } catch (e) {
    _flash('mmaPwMsg', '✗ Network error: ' + (e && e.message ? e.message : e), true);
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
}

// ─── Save promo text ──────────────────────────────────────────────────────────
async function savePromo() {
  if (!_editClientId) return;
  var input = document.getElementById('mmaPromoInput');
  var text  = (input.value || '').trim();
  if (text.length > 80) {
    _flash('mmaPromoMsg', '✗ Max 80 chars', true);
    return;
  }
  try {
    var result = await mmaSb.from('clients').update({ middle_man_promo_text: text || null }).eq('id', _editClientId);
    if (result.error) throw result.error;
    _flash('mmaPromoMsg', '✓ Saved', false);
  } catch (err) {
    _flash('mmaPromoMsg', '✗ ' + err.message, true);
  }
}

// ─── Save buttons ─────────────────────────────────────────────────────────────
async function saveButtons() {
  if (!_editClientId) return;
  var rows      = document.querySelectorAll('#mmaBtnBuilder .mma-btn-row');
  var notifRows = document.querySelectorAll('#mmaNotifBuilder .mma-notif-row');
  var buttons = [];
  rows.forEach(function(row, idx) {
    var label = row.querySelector('.mma-btn-label').value.trim();
    if (!label) return;
    var colorInput   = row.querySelector('.mma-btn-color');
    var color        = colorInput ? colorInput.value : '#00D4FF';
    var pulseBtn     = row.querySelector('.mma-btn-pulse');
    var animate      = pulseBtn ? pulseBtn.classList.contains('mma-btn-pulse-on') : false;
    var sparklesBtn  = row.querySelector('.mma-btn-sparkles');
    var notifRow     = notifRows[idx];
    var titleEl      = notifRow ? notifRow.querySelector('.mma-notif-title') : null;
    var msgEl        = notifRow ? notifRow.querySelector('.mma-notif-msg')   : null;
    var existingBtns = Array.isArray(_editClientData && _editClientData.middle_man_buttons) ? _editClientData.middle_man_buttons : [];
    var existing     = existingBtns[idx] || {};
    var uiTitle      = titleEl ? titleEl.value.trim() : '';
    var uiMsg        = msgEl   ? msgEl.value.trim()   : '';
    buttons.push({
      label:        label,
      sort_order:   parseInt(row.querySelector('.mma-btn-order').value, 10) || 1,
      enabled:      row.querySelector('.mma-btn-enabled-cb').checked,
      color:        color,
      animate:      animate,
      sparkles:     sparklesBtn ? sparklesBtn.classList.contains('mma-btn-sparkles-on') : false,
      url:          (function(v) { return v && !/^https?:\/\//i.test(v) ? 'https://' + v : v; })((row.querySelector('.mma-btn-url') || { value: '' }).value.trim()),
      emoji:        (row.querySelector('.mma-btn-emoji-pick') || {}).dataset && row.querySelector('.mma-btn-emoji-pick').dataset.emoji || '',
      push_title:   uiTitle || (typeof existing.push_title   === 'string' ? existing.push_title   : ''),
      push_message: uiMsg   || (typeof existing.push_message === 'string' ? existing.push_message : ''),
    });
  });
  try {
    var result = await mmaSb.from('clients').update({ middle_man_buttons: buttons }).eq('id', _editClientId).select('id');
    if (result.error) throw result.error;
    if (!result.data || result.data.length === 0) throw new Error('No rows updated — check client ID or RLS');
    if (_editClientData) _editClientData.middle_man_buttons = buttons;
    _flash('mmaBtnsMsg', '✓ Saved', false);
  } catch (err) {
    _flash('mmaBtnsMsg', '✗ ' + err.message, true);
  }
}

// ─── Notification Messages panel ─────────────────────────────────────────────

var MMA_DEFAULT_PUSH_TITLE = '';
var MMA_DEFAULT_PUSH_MSG   = '';

var MMA_EMOJI_LIST = [
  '🍽️','🍕','🍔','🍣','🥂','🍷','🍸','🎂','☕','🍜','🥗','🍱',
  '✂️','💇','💅','🧴','💆','🪒','💄','👗',
  '📋','✏️','📢','🔔','💬','✅','❌','⚠️','📝','📌','🔗','📎',
  '👋','🏃','👤','💁','❓','🎁','🔍','📱','🤝','👍','❤️','😊',
  '💎','🌟','⭐','✨','🎉','🎊','💫','🔥','🏆','💰','⏰','🆕',
  '🚗','🚕','🏠','📍','🗺️','🧭','🚘','🛻',
  '🔧','🔨','⚙️','🛠️','🪛','🔌','💡','🏗️',
  '📅','🗓️','⏱️','🕐','📆','🗒️','📊','📈',
  '🎵','🎤','🎭','🎬','🎮','🎯','⚽','🏋️',
  '🌿','🌸','🐾','🦮','🐕','🐈','🌞','🌈',
];

function mmaInsertAtCursor(field, text) {
  if (typeof field.selectionStart === 'number' && field.setRangeText) {
    field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end');
    field.dispatchEvent(new Event('input'));
    field.focus();
  } else {
    field.value += text;
    field.dispatchEvent(new Event('input'));
  }
}

function mmaShowEmojiPicker(targetField, triggerBtn) {
  var existing = document.getElementById('mmaEmojiPicker');
  if (existing) {
    var wasFor = existing.dataset.openedFor;
    existing.parentNode.removeChild(existing);
    if (wasFor === triggerBtn.dataset.pickerId) return; // toggle closed
  }

  var picker = document.createElement('div');
  picker.id = 'mmaEmojiPicker';
  picker.dataset.openedFor = triggerBtn.dataset.pickerId;
  picker.style.cssText = [
    'position:fixed',
    'z-index:10000',
    'background:#ffffff',
    'border:1px solid #E0E0E0',
    'border-radius:10px',
    'padding:8px',
    'display:grid',
    'grid-template-columns:repeat(8,1fr)',
    'gap:2px',
    'box-shadow:0 8px 32px rgba(0,0,0,0.18)',
    'max-width:288px',
  ].join(';');

  MMA_EMOJI_LIST.forEach(function(em) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = em;
    b.style.cssText = 'border:none;background:none;cursor:pointer;font-size:18px;padding:4px 2px;border-radius:4px;line-height:1;';
    b.addEventListener('mouseenter', function() { b.style.background = '#F0F0F0'; });
    b.addEventListener('mouseleave', function() { b.style.background = 'none'; });
    b.addEventListener('click', function(e) {
      e.stopPropagation();
      mmaInsertAtCursor(targetField, em);
      if (picker.parentNode) picker.parentNode.removeChild(picker);
    });
    picker.appendChild(b);
  });

  var rect = triggerBtn.getBoundingClientRect();
  picker.style.top  = (rect.bottom + 4) + 'px';
  picker.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 296)) + 'px';
  document.body.appendChild(picker);

  function onOutside(e) {
    if (!picker.contains(e.target) && e.target !== triggerBtn) {
      if (picker.parentNode) picker.parentNode.removeChild(picker);
      document.removeEventListener('mousedown', onOutside);
    }
  }
  setTimeout(function() { document.addEventListener('mousedown', onOutside); }, 0);
}

function buildNotifRowHtml(idx, sortOrder, label, pushTitle, pushMsg) {
  var titleVal = pushTitle || '';
  var msgVal   = pushMsg   || '';
  return '<div class="mma-notif-row" style="background:#F8F8F8;border:1px solid #E0E0E0;border-radius:8px;padding:12px;margin-bottom:10px;">' +
    '<div style="font-size:14px;font-weight:700;color:#111111;margin-bottom:10px;">' + _e(sortOrder) + ' — ' + _e(label) + '</div>' +

    '<div style="margin-bottom:8px;">' +
      '<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#06D6A0;margin-bottom:4px;">Title</div>' +
      '<div style="display:flex;gap:6px;align-items:center;">' +
        '<input type="text" class="mma-notif-title mma-field-input" value="' + _e(titleVal) + '" placeholder="' + _e(MMA_DEFAULT_PUSH_TITLE) + '" style="flex:1;font-size:14px;" />' +
        '<button type="button" class="mma-emoji-trigger" data-picker-id="nt-' + idx + '" data-target="title" data-idx="' + idx + '" title="Insert emoji" style="width:34px;height:34px;border:1px solid #D0D0D0;border-radius:6px;background:#fff;cursor:pointer;font-size:17px;flex-shrink:0;">😊</button>' +
      '</div>' +
    '</div>' +

    '<div style="margin-bottom:8px;">' +
      '<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#06D6A0;margin-bottom:4px;">Message</div>' +
      '<div style="display:flex;gap:6px;align-items:flex-start;">' +
        '<textarea class="mma-notif-msg mma-field-input" rows="2" placeholder="' + _e(MMA_DEFAULT_PUSH_MSG) + '" style="flex:1;font-size:14px;resize:vertical;">' + _e(msgVal) + '</textarea>' +
        '<button type="button" class="mma-emoji-trigger" data-picker-id="nm-' + idx + '" data-target="msg" data-idx="' + idx + '" title="Insert emoji" style="width:34px;height:34px;border:1px solid #D0D0D0;border-radius:6px;background:#fff;cursor:pointer;font-size:17px;flex-shrink:0;margin-top:2px;">😊</button>' +
      '</div>' +
    '</div>' +

    '<button type="button" class="mma-save-btn mma-test-push-btn" data-idx="' + idx + '" style="font-size:13px;padding:6px 14px;">Test 🔔</button>' +
  '</div>';
}

function buildNotifSection(buttons) {
  var enabledBtns = (buttons || []).filter(Boolean);
  var rows = enabledBtns.map(function(b, i) {
    return buildNotifRowHtml(i, b.sort_order || (i + 1), b.label || '', b.push_title || '', b.push_message || '');
  }).join('');

  return '<div class="mma-section">' +
    '<div class="mma-section-label">Notification Messages</div>' +
    '<p class="mma-btn-hint" style="margin-bottom:14px;">Customise the push notification sent to the client\'s installed app when a customer taps each button. Use <strong>Test 🔔</strong> to fire a real notification to all registered devices right now.</p>' +
    '<div id="mmaNotifBuilder">' +
      (rows || '<div style="color:#888888;font-size:14px;">No buttons yet — add buttons above first.</div>') +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:10px;margin-top:12px;">' +
      '<button id="mmaSaveNotifsBtn" class="mma-save-btn">Save notifications</button>' +
      '<span id="mmaNotifsMsg" class="mma-saved-msg">✓ Saved</span>' +
    '</div>' +
  '</div>';
}

function syncNotifRows() {
  var saved = {};
  document.querySelectorAll('#mmaNotifBuilder .mma-notif-row').forEach(function(row, i) {
    var t = row.querySelector('.mma-notif-title');
    var m = row.querySelector('.mma-notif-msg');
    saved[i] = {
      title: t ? t.value : '',
      msg:   m ? m.value : '',
    };
  });

  var btnRows = document.querySelectorAll('#mmaBtnBuilder .mma-btn-row');
  var html = '';
  if (btnRows.length === 0) {
    html = '<div style="color:#888888;font-size:14px;">No buttons yet — add buttons above first.</div>';
  } else {
    btnRows.forEach(function(row, i) {
      var label     = (row.querySelector('.mma-btn-label') || {}).value || '';
      var sortOrder = (row.querySelector('.mma-btn-order') || {}).value || (i + 1);
      var vals      = saved[i] || {};
      html += buildNotifRowHtml(i, sortOrder, label, vals.title || '', vals.msg || '');
    });
  }

  var builder = document.getElementById('mmaNotifBuilder');
  if (builder) {
    builder.innerHTML = html;
    wireNotifBuilder();
  }
}

function wireNotifBuilder() {
  var builder = document.getElementById('mmaNotifBuilder');
  if (!builder) return;

  builder.querySelectorAll('.mma-emoji-trigger').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var idx    = parseInt(btn.dataset.idx, 10);
      var target = btn.dataset.target;
      var rows   = builder.querySelectorAll('.mma-notif-row');
      var row    = rows[idx];
      if (!row) return;
      var field  = target === 'title' ? row.querySelector('.mma-notif-title') : row.querySelector('.mma-notif-msg');
      if (field) mmaShowEmojiPicker(field, btn);
    });
  });

  builder.querySelectorAll('.mma-test-push-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { sendTestPush(btn); });
  });
}

async function saveNotifications() {
  if (!_editClientId) return;
  var btnRows   = document.querySelectorAll('#mmaBtnBuilder .mma-btn-row');
  var notifRows = document.querySelectorAll('#mmaNotifBuilder .mma-notif-row');
  var buttons   = [];
  btnRows.forEach(function(row, i) {
    var label = row.querySelector('.mma-btn-label').value.trim();
    if (!label) return;
    var colorInput  = row.querySelector('.mma-btn-color');
    var color       = colorInput ? colorInput.value : '#00D4FF';
    var pulseBtn    = row.querySelector('.mma-btn-pulse');
    var animate     = pulseBtn ? pulseBtn.classList.contains('mma-btn-pulse-on') : false;
    var sparklesBtn = row.querySelector('.mma-btn-sparkles');
    var notifRow    = notifRows[i];
    var titleEl     = notifRow ? notifRow.querySelector('.mma-notif-title') : null;
    var msgEl       = notifRow ? notifRow.querySelector('.mma-notif-msg')   : null;
    buttons.push({
      label:        label,
      sort_order:   parseInt(row.querySelector('.mma-btn-order').value, 10) || 1,
      enabled:      row.querySelector('.mma-btn-enabled-cb').checked,
      color:        color,
      animate:      animate,
      sparkles:     sparklesBtn ? sparklesBtn.classList.contains('mma-btn-sparkles-on') : false,
      url:          (function(v) { return v && !/^https?:\/\//i.test(v) ? 'https://' + v : v; })((row.querySelector('.mma-btn-url') || { value: '' }).value.trim()),
      push_title:   titleEl ? titleEl.value.trim() : '',
      push_message: msgEl   ? msgEl.value.trim()   : '',
    });
  });
  try {
    var result = await mmaSb.from('clients').update({ middle_man_buttons: buttons }).eq('id', _editClientId);
    if (result.error) throw result.error;
    if (_editClientData) _editClientData.middle_man_buttons = buttons;
    _flash('mmaNotifsMsg', '✓ Saved', false);
  } catch (err) {
    _flash('mmaNotifsMsg', '✗ ' + err.message, true);
  }
}

async function sendTestPush(btn) {
  if (!_editClientId) return;
  var idx       = parseInt(btn.dataset.idx, 10);
  var notifRows = document.querySelectorAll('#mmaNotifBuilder .mma-notif-row');
  var row       = notifRows[idx];
  if (!row) return;
  var titleEl = row.querySelector('.mma-notif-title');
  var msgEl   = row.querySelector('.mma-notif-msg');
  var title   = titleEl ? titleEl.value.trim() : '';
  var message = msgEl   ? msgEl.value.trim()   : '';
  if (!title || !message) { alert('Title and message cannot be empty.'); return; }

  var origText    = btn.textContent;
  btn.disabled    = true;
  btn.textContent = 'Sending…';

  try {
    var sessResult = await mmaSb.auth.getSession();
    var token = sessResult.data && sessResult.data.session && sessResult.data.session.access_token;
    if (!token) { alert('Not authenticated.'); btn.disabled = false; btn.textContent = origText; return; }

    var res = await fetch(MMA_SUPABASE_URL + '/functions/v1/test-push-notification', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body:    JSON.stringify({ client_id: _editClientId, title: title, message: message }),
    });
    var json = await res.json().catch(function() { return {}; });

    if (!res.ok || !json.ok) {
      console.error('[sendTestPush] error:', json);
      btn.textContent = '✗ Failed';
    } else {
      btn.textContent = 'Sent! ✓';
    }
  } catch (err) {
    console.error('[sendTestPush] exception:', err);
    btn.textContent = '✗ Error';
  }
  setTimeout(function() { btn.textContent = origText; btn.disabled = false; }, 2000);
}

// ─── Photo upload ─────────────────────────────────────────────────────────────
function triggerPhotoUpload() {
  _triggerUpload(
    'image/jpeg,image/png,.jpg,.jpeg,.png',
    'mmaPhotoUploadBtn', 'mmaPhotoProgress', 'mmaPhotoErr',
    'Upload photo'
  );
}

// ─── Video upload ─────────────────────────────────────────────────────────────
function triggerVideoUpload() {
  _triggerUpload(
    'video/mp4,.mp4',
    'mmaVideoUploadBtn', 'mmaVideoProgress', 'mmaVideoErr',
    'Upload video'
  );
}

// ─── Shared upload core ───────────────────────────────────────────────────────
function _triggerUpload(accept, uploadBtnId, progressId, errId, defaultBtnText) {
  if (!_editClientId) return;

  var fileInput  = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = accept;

  fileInput.onchange = async function(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;

    var uploadBtn = document.getElementById(uploadBtnId);
    var progress  = document.getElementById(progressId);
    var errEl     = document.getElementById(errId);

    uploadBtn.disabled    = true;
    uploadBtn.textContent = 'Uploading…';
    errEl.style.display   = 'none';
    progress.textContent  = '';

    var sessionResult = await mmaSb.auth.getSession();
    var sess = sessionResult.data && sessionResult.data.session;
    if (!sess) {
      uploadBtn.disabled    = false;
      uploadBtn.textContent = defaultBtnText;
      errEl.textContent     = 'Not authenticated';
      errEl.style.display   = 'block';
      return;
    }

    var fd = new FormData();
    fd.append('client_id', _editClientId);
    fd.append('file', file);

    var xhr = new XMLHttpRequest();
    xhr.open('POST', MMA_SUPABASE_URL + '/functions/v1/upload-middle-man-background');
    xhr.setRequestHeader('Authorization', 'Bearer ' + sess.access_token);
    xhr.setRequestHeader('apikey', MMA_SUPABASE_ANON_KEY);

    xhr.upload.addEventListener('progress', function(e) {
      if (e.lengthComputable) progress.textContent = Math.round((e.loaded / e.total) * 100) + '%';
    });

    xhr.addEventListener('load', function() {
      uploadBtn.disabled    = false;
      uploadBtn.textContent = defaultBtnText;
      progress.textContent  = '';
      var resp;
      try { resp = JSON.parse(xhr.responseText); } catch (_) { resp = {}; }

      if (xhr.status !== 200 || !resp.ok) {
        errEl.textContent   = resp.detail || resp.error || ('Upload failed — HTTP ' + xhr.status);
        errEl.style.display = 'block';
        return;
      }

      var isVideo = resp.type === 'video';
      var newUrl  = resp.urls && (isVideo
        ? resp.urls.video
        : (resp.urls.portrait || Object.values(resp.urls)[0]));

      if (!newUrl) return;

      // Update internal state
      if (_editClientData) {
        _editClientData.middle_man_background_url  = newUrl;
        _editClientData.middle_man_background_type = resp.type || 'image';
      }

      if (isVideo) {
        // Update video preview (FIX 6: autoplay with all iOS attrs)
        _setVideoPreview(newUrl);
        // Extract first frame as poster and upload (non-blocking, fails silently)
        _extractAndUploadPoster(newUrl, _editClientId);
        // Clear photo thumbnail — video is now active
        _setPhotoThumb(null);
        // Show video remove, ensure photo remove is hidden
        _ensureRemoveBtn('mmaVideoRemoveBtn', 'Remove video');
        var prBtn = document.getElementById('mmaPhotoRemoveBtn');
        if (prBtn) prBtn.style.display = 'none';
      } else {
        // Update photo thumbnail
        _setPhotoThumb(newUrl);
        // Clear video preview — photo is now active
        _setVideoPreview(null);
        // Show photo remove, ensure video remove is hidden
        _ensureRemoveBtn('mmaPhotoRemoveBtn', 'Remove photo');
        var vrBtn = document.getElementById('mmaVideoRemoveBtn');
        if (vrBtn) vrBtn.style.display = 'none';
      }
    });

    xhr.addEventListener('error', function() {
      uploadBtn.disabled    = false;
      uploadBtn.textContent = defaultBtnText;
      progress.textContent  = '';
      errEl.textContent     = 'Network error — please try again.';
      errEl.style.display   = 'block';
    });

    xhr.send(fd);
  };

  fileInput.click();
}

// ─── Background preview helpers ───────────────────────────────────────────────

function _setPhotoThumb(url) {
  var thumb = document.getElementById('mmaPhotoThumb');
  if (!thumb) return;
  if (url) {
    var img   = document.createElement('img');
    img.src   = url + '?t=' + Date.now();
    img.id    = 'mmaPhotoThumb';
    img.className = 'mma-bg-thumb';
    img.alt   = 'Current background photo';
    thumb.parentNode.replaceChild(img, thumb);
  } else {
    var ph   = document.createElement('div');
    ph.id    = 'mmaPhotoThumb';
    ph.className = 'mma-bg-placeholder';
    ph.textContent = '★';
    thumb.parentNode.replaceChild(ph, thumb);
  }
}

// FIX 6: Creates a <video> with all 6 iOS Safari attrs + .load() + .play().catch()
function _setVideoPreview(url) {
  var existing = document.getElementById('mmaVideoPreview');
  if (!existing) return;
  if (url) {
    var vid = document.createElement('video');
    vid.id  = 'mmaVideoPreview';
    vid.className = 'mma-video-preview';
    vid.setAttribute('autoplay', '');
    vid.setAttribute('muted', '');
    vid.setAttribute('playsinline', '');
    vid.setAttribute('webkit-playsinline', '');
    vid.setAttribute('loop', '');
    vid.setAttribute('preload', 'auto');
    vid.muted      = true;   // belt-and-suspenders: iOS ignores attr alone
    vid.playsInline = true;  // belt-and-suspenders
    var src  = document.createElement('source');
    src.src  = url + '?t=' + Date.now();
    src.type = 'video/mp4';
    vid.appendChild(src);
    existing.parentNode.replaceChild(vid, existing);
    vid.load();
    vid.play().catch(function() { /* silently fail — user can still confirm visually */ });
  } else {
    var ph = document.createElement('div');
    ph.id  = 'mmaVideoPreview';
    ph.className = 'mma-video-placeholder';
    ph.textContent = '▶';
    existing.parentNode.replaceChild(ph, existing);
  }
}

// FIX 6: Wire autoplay on an already-in-DOM video element (after renderEditBody)
function _bootVideoPreview(id) {
  var vid = document.getElementById(id);
  if (!vid || vid.tagName !== 'VIDEO') return;
  vid.muted      = true;
  vid.playsInline = true;
  vid.load();
  vid.play().catch(function() { /* silently fail */ });
}

function _ensureRemoveBtn(btnId, label) {
  if (document.getElementById(btnId)) {
    // Already exists — make it visible
    document.getElementById(btnId).style.display = '';
    return;
  }
  // Create it and append to the right upload button's parent
  var uploadBtnId = (btnId === 'mmaPhotoRemoveBtn') ? 'mmaPhotoUploadBtn' : 'mmaVideoUploadBtn';
  var uploadBtn   = document.getElementById(uploadBtnId);
  if (!uploadBtn || !uploadBtn.parentNode) return;
  var btn           = document.createElement('button');
  btn.id            = btnId;
  btn.className     = 'mma-remove-bg-btn';
  btn.textContent   = label;
  btn.addEventListener('click', removeBg);
  uploadBtn.parentNode.appendChild(btn);
}

// ─── Client-side poster extraction (JOB 1: instant-look video load) ─────────
// Called immediately after a video upload completes. Creates a hidden <video>,
// seeks to 0.1 s (avoids a pitch-black opener frame), draws the frame to a
// canvas, converts to JPEG, uploads to <clientId>/poster.jpg in Storage, and
// writes the public URL to clients.middle_man_background_poster_url.
//
// Entirely non-fatal — wrapped in try/catch so a canvas security restriction,
// CORS issue, or network hiccup never blocks the main upload flow.
async function _extractAndUploadPoster(videoUrl, clientId) {
  console.log('[poster] START — clientId:', clientId, '| url:', videoUrl);
  try {
    var vid = document.createElement('video');
    vid.crossOrigin = 'anonymous';
    vid.muted       = true;
    vid.preload     = 'metadata';

    // Wait for the video to load enough metadata to seek, then move to 0.1 s
    console.log('[poster] creating video element, waiting for loadedmetadata…');
    await new Promise(function(resolve, reject) {
      var timer = setTimeout(function() { reject(new Error('timeout waiting for seeked')); }, 12000);
      vid.addEventListener('loadedmetadata', function() {
        console.log('[poster] loadedmetadata fired — dimensions:', vid.videoWidth, 'x', vid.videoHeight, '| seeking to 0.1s');
        vid.currentTime = 0.1; // 100 ms — skips any all-black open frame
      }, { once: true });
      vid.addEventListener('seeked', function() {
        clearTimeout(timer);
        console.log('[poster] seeked fired — ready to draw');
        resolve();
      }, { once: true });
      vid.addEventListener('error', function(e) {
        clearTimeout(timer);
        var code = vid.error ? vid.error.code : '?';
        reject(new Error('video element error (code ' + code + ')'));
      }, { once: true });
      vid.src = videoUrl;
    });

    // Draw the seeked frame to a canvas
    console.log('[poster] drawing frame to canvas (' + (vid.videoWidth || 1280) + 'x' + (vid.videoHeight || 720) + ')');
    var canvas    = document.createElement('canvas');
    canvas.width  = vid.videoWidth  || 1280;
    canvas.height = vid.videoHeight || 720;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);

    // Extract as JPEG blob (0.85 quality balances file size vs. clarity)
    console.log('[poster] extracting JPEG blob…');
    var blob = await new Promise(function(resolve) {
      canvas.toBlob(resolve, 'image/jpeg', 0.85);
    });
    if (!blob) {
      console.warn('[poster] FAIL — canvas.toBlob returned null (canvas may be tainted by CORS)');
      return;
    }
    console.log('[poster] blob ready —', blob.size, 'bytes');

    // Upload to the middle-man-backgrounds storage bucket
    var storagePath  = clientId + '/poster.jpg';
    console.log('[poster] uploading to storage:', storagePath);
    var uploadResult = await mmaSb.storage
      .from('middle-man-backgrounds')
      .upload(storagePath, blob, { contentType: 'image/jpeg', upsert: true });
    if (uploadResult.error) {
      console.warn('[poster] FAIL — storage upload error:', uploadResult.error.message);
      return;
    }
    console.log('[poster] storage upload OK');

    var urlResult = mmaSb.storage.from('middle-man-backgrounds').getPublicUrl(storagePath);
    var publicUrl = urlResult.data && urlResult.data.publicUrl;
    if (!publicUrl) {
      console.warn('[poster] FAIL — could not resolve public URL from storage');
      return;
    }
    console.log('[poster] public URL:', publicUrl);

    // Write the poster URL to the clients table
    console.log('[poster] writing poster URL to clients table…');
    var dbResult = await mmaSb.from('clients')
      .update({ middle_man_background_poster_url: publicUrl })
      .eq('id', clientId);
    if (dbResult.error) {
      console.warn('[poster] FAIL — DB update error:', dbResult.error.message);
      return;
    }

    if (_editClientData) _editClientData.middle_man_background_poster_url = publicUrl;
    console.log('[poster] SUCCESS — poster saved →', publicUrl);
  } catch (err) {
    // Non-fatal — the video still plays without a poster; caller sees dark background
    console.warn('[poster] FAIL (caught) —', (err && err.message) || String(err));
  }
}

// ─── Remove background ────────────────────────────────────────────────────────
async function removeBg() {
  if (!_editClientId || !_editClientData) return;
  var bizName  = _editClientData.business_name || 'this client';
  var isVideo  = _editClientData.middle_man_background_type === 'video';
  var typeLabel = isVideo ? 'video' : 'photo';
  if (!confirm('Remove ' + typeLabel + ' background for ' + bizName + '?')) return;

  try {
    var result = await mmaSb.from('clients')
      .update({ middle_man_background_url: null, middle_man_background_type: null, middle_man_background_poster_url: null })
      .eq('id', _editClientId);
    if (result.error) throw result.error;

    _editClientData.middle_man_background_url         = null;
    _editClientData.middle_man_background_type        = null;
    _editClientData.middle_man_background_poster_url  = null;

    if (isVideo) {
      _setVideoPreview(null);
    } else {
      _setPhotoThumb(null);
    }
    _setVideoPreview(null);

    var btn = document.getElementById(isVideo ? 'mmaVideoRemoveBtn' : 'mmaPhotoRemoveBtn');
    if (btn) btn.style.display = 'none';
  } catch (err) {
    var btn = document.getElementById(isVideo ? 'mmaVideoRemoveBtn' : 'mmaPhotoRemoveBtn');
    if (btn) { btn.disabled = false; btn.textContent = 'Remove ' + typeLabel; }
    alert('Remove failed: ' + err.message);
  }
}

// ─── Live preview ────────────────────────────────────────────────────────────
function renderPreview() {
  var phone  = document.getElementById('mmaPreviewPhone');
  var screen = document.getElementById('mmaPreviewScreen');
  if (!phone || !screen) return;

  // Remove any existing background element
  var existingBg = phone.querySelector('.mma-preview-bg');
  if (existingBg) existingBg.parentNode.removeChild(existingBg);

  // Insert background (video or image) if one is set
  if (_editClientData && _editClientData.middle_man_background_url) {
    var pBgUrl  = _editClientData.middle_man_background_url;
    var pBgType = _editClientData.middle_man_background_type || 'image';
    if (pBgType === 'video') {
      var vid = document.createElement('video');
      vid.className = 'mma-preview-bg';
      vid.setAttribute('autoplay', '');
      vid.setAttribute('muted', '');
      vid.setAttribute('loop', '');
      vid.setAttribute('playsinline', '');
      vid.muted = true;
      if (_editClientData.middle_man_background_poster_url) {
        vid.setAttribute('poster', _editClientData.middle_man_background_poster_url);
      }
      var vsrc = document.createElement('source');
      vsrc.src  = pBgUrl;
      vsrc.type = 'video/mp4';
      vid.appendChild(vsrc);
      phone.insertBefore(vid, screen);
      vid.load();
      vid.play().catch(function() {});
    } else {
      var bgImg = document.createElement('img');
      bgImg.className = 'mma-preview-bg';
      bgImg.src = pBgUrl + '?v=' + Date.now();
      bgImg.alt = '';
      phone.insertBefore(bgImg, screen);
    }
  }

  // Build screen content
  var logoUrl = _editClientData ? (_editClientData.middle_man_logo_url || null) : null;
  var bizName = _editClientData ? (_editClientData.business_name || '') : '';

  var hasBg = !!(_editClientData && _editClientData.middle_man_background_url);

  screen.innerHTML =
    '<div style="height:105px;width:100%;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0 12px;">' +
      (logoUrl
        ? '<img src="' + logoUrl + '" alt="' + _e(bizName) + '" style="max-height:70px;max-width:85%;object-fit:contain;display:block;" />'
        : '<div style="color:#fff;font-size:11px;font-weight:700;text-align:center;padding:0 8px;">' + _e(bizName) + '</div>') +
    '</div>' +
    '<div style="height:38px;flex-shrink:0;"></div>' +
    '<div style="width:100%;padding:0 12px;flex-shrink:0;">' +
      (function() {
        var rows = document.querySelectorAll('#mmaBtnBuilder .mma-btn-row');
        var html = '';
        rows.forEach(function(row) {
          var label       = (row.querySelector('.mma-btn-label').value || '').trim();
          var enabled     = row.querySelector('.mma-btn-enabled-cb').checked;
          var color       = row.querySelector('.mma-btn-color') ? row.querySelector('.mma-btn-color').value : '#00D4FF';
          var pulseBtn    = row.querySelector('.mma-btn-pulse');
          var animate     = pulseBtn ? pulseBtn.classList.contains('mma-btn-pulse-on') : true;
          var sparklesBtn = row.querySelector('.mma-btn-sparkles');
          var hasSparkles = sparklesBtn ? sparklesBtn.classList.contains('mma-btn-sparkles-on') : false;
          if (!label || !enabled) return;
          html += '<div class="mma-preview-btn' + (!animate ? ' glow-off' : '') + '" style="--prev-neon:' + color + ';position:relative;">' +
            _e(label) +
            (hasSparkles ? '<span style="position:absolute;top:1px;right:3px;font-size:6px;line-height:1;opacity:0.7;pointer-events:none;">✨</span>' : '') +
            '</div>';
        });
        return html;
      })() +
    '</div>' +
    '<div class="mma-preview-footer">★ CallMagnet</div>';
}

function wirePreview() {
  document.querySelectorAll('.mma-btn-label').forEach(function(el) {
    el.addEventListener('input', renderPreview);
  });
  document.querySelectorAll('.mma-btn-color').forEach(function(el) {
    el.addEventListener('change', renderPreview);
    el.addEventListener('input', renderPreview);
  });
  document.querySelectorAll('.mma-btn-pulse').forEach(function(el) {
    el.addEventListener('click', function() { setTimeout(renderPreview, 10); });
  });
}

// ─── Short Link & SMS ────────────────────────────────────────────────────────
async function createShortioLink() {
  if (!_editClientData) return;
  var slug = (_editClientData.middle_man_slug || '').trim();
  if (!slug) { alert('Set and save a slug first.'); return; }

  var slugInput = document.getElementById('mmaSlugInput');
  if (slugInput && slugInput.value.trim() !== slug) {
    var tag = document.getElementById('mmaSmsTestTag');
    if (tag) { tag.textContent = '✗ Save your slug first'; tag.style.color = '#CC0000'; }
    return;
  }

  var btn = document.getElementById('mmaCreateShortLinkBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }

  try {
    var res  = await fetch(MMA_SUPABASE_URL + '/functions/v1/create-shortio-link-test', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slug: slug }),
    });
    var data = await res.json().catch(function() { return {}; });

    if (res.ok && data.shortURL) {
      _editClientData.shortio_link    = data.shortURL;
      _editClientData.shortio_link_id = data.id ? String(data.id) : null;
      _smsShortLink = data.shortURL;

      // Update button state
      if (btn) { btn.disabled = true; btn.textContent = '✓ Created'; }

      // Show Connected badge in #mmaCreateTag
      var createTag = document.getElementById('mmaCreateTag');
      if (createTag) createTag.innerHTML = '<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;background:#d1fae5;color:#065f46;">&#10003; Connected</span>';

      // Show short link row and populate output
      var shortLinkRow = document.getElementById('mmaShortLinkRow');
      if (shortLinkRow) shortLinkRow.style.display = '';
      var shortLinkOutput = document.getElementById('mmaShortLinkOutput');
      if (shortLinkOutput) shortLinkOutput.value = data.shortURL;

      // Trigger preview update
      var tmplEl = document.getElementById('mmaSmsTmpl');
      if (tmplEl) tmplEl.dispatchEvent(new Event('input'));
    } else {
      if (btn) { btn.disabled = false; btn.textContent = 'Create Short Link'; }
      var tag = document.getElementById('mmaSmsTestTag');
      if (tag) { tag.textContent = '✗ ' + (data.error || data.message || 'Error — see console'); tag.style.color = '#CC0000'; }
    }
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Short Link'; }
    var tag = document.getElementById('mmaSmsTestTag');
    if (tag) { tag.textContent = '✗ ' + err.message; tag.style.color = '#CC0000'; }
  }
}

async function sendTestSmsFromEdit() {
  var toEl   = document.getElementById('mmaSmsTestTo');
  var tag    = document.getElementById('mmaSmsTestTag');
  var btn    = document.getElementById('mmaSmsTestBtn');
  var prevEl = document.getElementById('mmaSmsPreview');

  var to      = toEl   ? toEl.value.trim()        : '';
  var message = prevEl ? prevEl.textContent.trim() : '';
  var slug    = _editClientData ? (_editClientData.middle_man_slug || '') : '';

  if (tag) { tag.textContent = ''; }
  if (!to)                         { if (tag) { tag.textContent = '✗ Phone number is required.';         tag.style.color = '#CC0000'; } return; }
  if (!_smsShortLink)              { if (tag) { tag.textContent = '✗ Create a short link first.';        tag.style.color = '#CC0000'; } return; }
  if (!message || message === '—') { if (tag) { tag.textContent = '✗ SMS message is empty.';             tag.style.color = '#CC0000'; } return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  try {
    var res  = await fetch(MMA_SUPABASE_URL + '/functions/v1/send-test-sms', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ to: to, message: message, slug: slug }),
    });
    var data = await res.json().catch(function() { return {}; });
    if (data.ok && data.sid) {
      if (tag) { tag.textContent = '✓ Sent — SID: ' + data.sid; tag.style.color = '#06D6A0'; }
      var saveBtn = document.getElementById('mmaSmsSaveBtn');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.style.background = '#10b981';
        saveBtn.style.cursor = 'pointer';
      }
    } else {
      if (tag) { tag.textContent = '✗ ' + (data.error || 'Unknown error'); tag.style.color = '#CC0000'; }
    }
  } catch (err) {
    if (tag) { tag.textContent = '✗ Network error: ' + err.message; tag.style.color = '#CC0000'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send test'; }
  }
}

async function saveSmsToSystem() {
  var tmplEl  = document.getElementById('mmaSmsTmpl');
  var saveBtn = document.getElementById('mmaSmsSaveBtn');
  var msgEl   = document.getElementById('mmaSmsSaveMsg');

  var template = tmplEl ? tmplEl.value.trim() : '';
  if (msgEl) { msgEl.style.display = 'none'; }

  if (!template || !/\[LINK\]/i.test(template)) {
    if (msgEl) { msgEl.textContent = '✗ Template must contain [LINK]'; msgEl.style.color = '#CC0000'; msgEl.style.display = 'block'; }
    return;
  }

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    var result = await mmaSb.from('clients').update({ customer_sms_template: template }).eq('id', _editClientData.id);
    if (result.error) throw result.error;
    _editClientData.customer_sms_template = template;
    if (msgEl) { msgEl.textContent = '✓ Saved'; msgEl.style.color = '#06D6A0'; msgEl.style.display = 'block'; }
    setTimeout(function() { if (msgEl) msgEl.style.display = 'none'; }, 2500);
  } catch (err) {
    if (msgEl) { msgEl.textContent = '✗ ' + err.message; msgEl.style.color = '#CC0000'; msgEl.style.display = 'block'; }
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save to system'; }
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async function() {
  var gateEl = document.getElementById('mmaAuthGate');
  var pageEl = document.getElementById('mmaPage');

  // Initialise Supabase (same storage key as dashboard — shared session)
  mmaSb = supabase.createClient(MMA_SUPABASE_URL, MMA_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      storage: window.localStorage,
      storageKey: 'callmagnet-auth-token',
      autoRefreshToken: true,
      detectSessionInUrl: false,
    }
  });

  // Auth check
  var sessionResult = await mmaSb.auth.getSession();
  var sess = sessionResult.data && sessionResult.data.session;

  if (!sess) {
    window.location.href = '/';
    return;
  }

  var isAdmin = sess.user && sess.user.app_metadata && sess.user.app_metadata.is_admin === true;
  var email   = ((sess.user && sess.user.email) || '').toLowerCase();

  if (!isAdmin || email !== MMA_REAL_ADMIN_EMAIL) {
    window.location.href = '/';
    return;
  }

  // Show page
  if (gateEl) gateEl.style.display = 'none';
  if (pageEl) pageEl.style.display  = 'block';

  // Wire back button
  var backBtn = document.getElementById('mmaBackToDashboard');
  if (backBtn) backBtn.addEventListener('click', function() { window.location.href = '/'; });

  // Deep-link: ?client=<uuid> opens edit directly
  var params   = new URLSearchParams(window.location.search);
  var clientId = params.get('client');
  if (clientId) {
    showEditView(clientId);
  } else {
    showManagerView();
  }
});
