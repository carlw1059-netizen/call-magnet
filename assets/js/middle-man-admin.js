// ═══ Middle Man Admin — full page editor ════════════════════════════════════
// White business-tool page. Two views: manager (client list) + edit (single).
// Auth: is_admin === true AND email === REAL_ADMIN_EMAIL dual gate.

const MMA_SUPABASE_URL      = 'https://iskvvnhacqdxybpmwuni.supabase.co';
const MMA_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlza3Z2bmhhY3FkeHlicG13dW5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTAyOTYsImV4cCI6MjA5MDA4NjI5Nn0.c3uR-CSQXsgfYMnzK8KOxZjoqRPwaMsUuGpMPwvCsk8';
const MMA_REAL_ADMIN_EMAIL  = 'car312@hotmail.com';

let mmaSb              = null;
let _editClientId      = null;
let _editClientData    = null;

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
      .select('id,business_name,vertical,middle_man_enabled,middle_man_slug')
      .order('business_name', { ascending: true });
    if (result.error) throw result.error;

    var clients = (result.data || []).filter(function(c) {
      return c.middle_man_enabled || c.middle_man_slug;
    });

    if (clients.length === 0) {
      listEl.innerHTML = '<div class="mma-loading">No Middle Man clients found.<br><span style="font-size:12px;color:#BBBBBB;">Enable Middle Man on a client or set a slug to get started.</span></div>';
      return;
    }

    listEl.innerHTML = clients.map(buildClientCard).join('');

    // Wire edit buttons via delegation
    listEl.addEventListener('click', function(ev) {
      var btn = ev.target.closest('.mma-edit-btn');
      if (btn) showEditView(btn.dataset.id);
    });
  } catch (err) {
    listEl.innerHTML = '<div class="mma-error">Failed to load: ' + _e(err.message) + '</div>';
  }
}

function buildClientCard(c) {
  var liveBadge  = c.middle_man_enabled
    ? '<span class="mma-badge mma-badge-live">LIVE</span>'
    : '<span class="mma-badge mma-badge-off">OFF</span>';
  var vertBadge  = '<span class="mma-badge mma-badge-vert">' + _e(c.vertical || 'unknown') + '</span>';
  var slugHtml   = c.middle_man_slug
    ? '<a href="https://callmagnet.com.au/b/' + encodeURIComponent(c.middle_man_slug) + '" target="_blank" rel="noopener" class="mma-slug-link">callmagnet.com.au/b/' + _e(c.middle_man_slug) + '</a>'
    : '<span class="mma-no-slug">No slug set</span>';

  return '<div class="mma-client-card">' +
    '<div class="mma-client-header">' +
      '<div class="mma-client-left">' +
        '<span class="mma-client-name">' + _e(c.business_name) + '</span>' +
        vertBadge + liveBadge +
      '</div>' +
      '<button class="mma-edit-btn" data-id="' + _e(c.id) + '">Edit</button>' +
    '</div>' +
    slugHtml +
  '</div>';
}

// ─── Edit view: fetch client and render editor ────────────────────────────────
async function loadClientForEdit(clientId) {
  var content = document.getElementById('mmaEditContent');
  if (!content) return;
  try {
    var result = await mmaSb
      .from('clients')
      .select('id,business_name,vertical,middle_man_enabled,middle_man_slug,middle_man_promo_text,middle_man_background_url,middle_man_background_type,middle_man_buttons,middle_man_updated_at')
      .eq('id', clientId)
      .single();
    if (result.error) throw result.error;
    _editClientData = result.data;
    renderEditBody(result.data);
  } catch (err) {
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

  // ── 1. Heading
  var heading = '<div style="font-size:20px;font-weight:700;color:#111;margin-bottom:20px;">' + _e(client.business_name) + '</div>';

  // ── 2. Toggle
  var toggleSection =
    '<div class="mma-section">' +
      '<div class="mma-section-label">Middle Man Enabled</div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
        '<span id="mmaEnabledDesc" style="font-size:13px;color:#555;">' +
          (enabledOn ? 'Currently ON — live for customers' : 'Currently OFF — hidden from customers') +
        '</span>' +
        '<button id="mmaToggleBtn" class="mma-toggle-btn ' + (enabledOn ? 'mma-toggle-on' : 'mma-toggle-off') + '">' +
          (enabledOn ? 'ON' : 'OFF') +
        '</button>' +
      '</div>' +
    '</div>';

  // ── 3. Slug
  var slugSection =
    '<div class="mma-section">' +
      '<div class="mma-section-label">Slug (URL)</div>' +
      '<div style="display:flex;gap:8px;align-items:center;">' +
        '<span style="font-size:11px;color:#999;white-space:nowrap;font-family:monospace;">callmagnet.com.au/b/</span>' +
        '<input id="mmaSlugInput" class="mma-field-input" value="' + _e(slug) + '" placeholder="your-slug" maxlength="50" style="font-family:monospace;" />' +
        '<button id="mmaSlugSaveBtn" class="mma-save-btn">Save</button>' +
      '</div>' +
      '<div id="mmaSlugMsg" class="mma-saved-msg" style="margin-left:0;margin-top:6px;"></div>' +
    '</div>';

  // ── 4. Promo text
  var promoSection =
    '<div class="mma-section">' +
      '<div class="mma-section-label">Promo Text</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">' +
        '<span style="font-size:11px;color:#888;">Shown above buttons on the Middle Man page</span>' +
        '<span id="mmaPromoCount" style="font-size:11px;color:#AAAAAA;">' + promo.length + '/80</span>' +
      '</div>' +
      '<textarea id="mmaPromoInput" rows="2" maxlength="80" class="mma-field-input" style="resize:none;line-height:1.4;" placeholder="Short message shown to customers…">' + _e(promo) + '</textarea>' +
      '<div style="display:flex;align-items:center;margin-top:8px;">' +
        '<button id="mmaPromoSaveBtn" class="mma-save-btn">Save</button>' +
        '<span id="mmaPromoMsg" class="mma-saved-msg">✓ Saved</span>' +
      '</div>' +
    '</div>';

  // ── 5. Background
  var thumbHtml = bgUrl
    ? '<img src="' + _e(bgUrl) + '" id="mmaBgThumb" class="mma-bg-thumb" alt="Current background" />'
    : '<div id="mmaBgThumb" class="mma-bg-placeholder">★</div>';
  var removeBtnHtml = bgUrl
    ? '<button id="mmaRemoveBgBtn" class="mma-remove-bg-btn">Remove background</button>'
    : '';
  var bgSection =
    '<div class="mma-section">' +
      '<div class="mma-section-label">Background Image</div>' +
      '<div style="display:flex;align-items:flex-start;gap:16px;">' +
        thumbHtml +
        '<div>' +
          '<button id="mmaUploadBtn" class="mma-save-btn">Upload new</button>' +
          '<div class="mma-info">Portrait photo works best, or upload an MP4 video (max 10 MB).</div>' +
          '<div id="mmaUploadProgress" class="mma-progress"></div>' +
          '<div id="mmaUploadErr" class="mma-err"></div>' +
          removeBtnHtml +
        '</div>' +
      '</div>' +
    '</div>';

  // ── 6. Buttons
  var btnRows = buttons.filter(Boolean).map(function(b, i) { return buildBtnRowHtml(b, i); }).join('');
  var btnsSection =
    '<div class="mma-section">' +
      '<div class="mma-section-label">Customer Buttons</div>' +
      '<div id="mmaBtnBuilder">' + btnRows + '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-top:8px;">' +
        '<button id="mmaAddBtnBtn" class="mma-add-btn-link">+ Add button</button>' +
        '<button id="mmaSaveBtnsBtn" class="mma-save-btn">Save buttons</button>' +
        '<span id="mmaBtnsMsg" class="mma-saved-msg">✓ Saved</span>' +
      '</div>' +
    '</div>';

  // ── 7. Preview link
  var previewHtml = slug
    ? '<div style="text-align:center;padding:8px 0 4px;">' +
        '<a id="mmaPreviewLink" href="https://callmagnet.com.au/b/' + encodeURIComponent(slug) + '" target="_blank" rel="noopener" class="mma-preview-link">View live page →</a>' +
      '</div>'
    : '<div id="mmaPreviewLinkWrap"></div>';

  content.innerHTML = heading + toggleSection + slugSection + promoSection + bgSection + btnsSection + previewHtml;

  // ── Wire up event listeners ──────────────────────────────────────────────────
  document.getElementById('mmaToggleBtn').addEventListener('click', toggleEnabled);
  document.getElementById('mmaSlugSaveBtn').addEventListener('click', saveSlug);

  var promoInput = document.getElementById('mmaPromoInput');
  promoInput.addEventListener('input', function() {
    document.getElementById('mmaPromoCount').textContent = promoInput.value.length + '/80';
  });
  document.getElementById('mmaPromoSaveBtn').addEventListener('click', savePromo);

  document.getElementById('mmaUploadBtn').addEventListener('click', triggerUpload);

  var removeBgBtn = document.getElementById('mmaRemoveBgBtn');
  if (removeBgBtn) removeBgBtn.addEventListener('click', removeBg);

  // Button builder: delegation for remove buttons
  document.getElementById('mmaBtnBuilder').addEventListener('click', function(ev) {
    var removeBtn = ev.target.closest('.mma-btn-remove');
    if (removeBtn) removeBtn.closest('.mma-btn-row').remove();
  });
  document.getElementById('mmaAddBtnBtn').addEventListener('click', addBtnRow);
  document.getElementById('mmaSaveBtnsBtn').addEventListener('click', saveButtons);
}

// ─── Button row HTML builder ──────────────────────────────────────────────────
function buildBtnRowHtml(btn, idx) {
  return '<div class="mma-btn-row">' +
    '<input type="number" min="1" max="6" value="' + _e(btn.sort_order || idx + 1) + '" class="mma-btn-order" />' +
    '<input type="checkbox"' + (btn.enabled !== false ? ' checked' : '') + ' class="mma-btn-enabled mma-btn-enabled-cb" />' +
    '<input type="text" value="' + _e(btn.label || '') + '" maxlength="40" placeholder="Button label…" class="mma-btn-label" />' +
    '<button type="button" class="mma-btn-remove" title="Remove">×</button>' +
  '</div>';
}

function addBtnRow() {
  var builder = document.getElementById('mmaBtnBuilder');
  if (!builder) return;
  if (builder.children.length >= 6) { alert('Maximum 6 buttons allowed.'); return; }
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
    // Update preview link
    var previewLink = document.getElementById('mmaPreviewLink');
    if (previewLink && slug) previewLink.href = 'https://callmagnet.com.au/b/' + encodeURIComponent(slug);
  } catch (err) {
    _flash('mmaSlugMsg', '✗ ' + err.message, true);
  }
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
  var rows    = document.querySelectorAll('#mmaBtnBuilder .mma-btn-row');
  var buttons = [];
  rows.forEach(function(row) {
    var label = row.querySelector('.mma-btn-label').value.trim();
    if (!label) return;
    buttons.push({
      label:      label,
      sort_order: parseInt(row.querySelector('.mma-btn-order').value, 10) || 1,
      enabled:    row.querySelector('.mma-btn-enabled-cb').checked,
    });
  });
  try {
    var result = await mmaSb.from('clients').update({ middle_man_buttons: buttons }).eq('id', _editClientId);
    if (result.error) throw result.error;
    if (_editClientData) _editClientData.middle_man_buttons = buttons;
    _flash('mmaBtnsMsg', '✓ Saved', false);
  } catch (err) {
    _flash('mmaBtnsMsg', '✗ ' + err.message, true);
  }
}

// ─── Upload background ────────────────────────────────────────────────────────
function triggerUpload() {
  if (!_editClientId) return;
  var fileInput    = document.createElement('input');
  fileInput.type   = 'file';
  fileInput.accept = 'image/jpeg,image/png,.jpg,.jpeg,.png,video/mp4,.mp4';

  fileInput.onchange = async function(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;

    var uploadBtn = document.getElementById('mmaUploadBtn');
    var progress  = document.getElementById('mmaUploadProgress');
    var errEl     = document.getElementById('mmaUploadErr');

    uploadBtn.disabled   = true;
    uploadBtn.textContent = 'Uploading…';
    errEl.style.display  = 'none';
    progress.textContent = '';

    var sessionResult = await mmaSb.auth.getSession();
    var sess = sessionResult.data && sessionResult.data.session;
    if (!sess) {
      uploadBtn.disabled    = false;
      uploadBtn.textContent = 'Upload new';
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
      uploadBtn.textContent = 'Upload new';
      progress.textContent  = '';
      var resp;
      try { resp = JSON.parse(xhr.responseText); } catch (_) { resp = {}; }

      if (xhr.status !== 200 || !resp.ok) {
        errEl.textContent   = 'Upload failed: ' + (resp.detail || resp.error || 'HTTP ' + xhr.status);
        errEl.style.display = 'block';
        return;
      }

      var isVideo = resp.type === 'video';
      var newUrl  = resp.urls && (isVideo
        ? resp.urls.video
        : (resp.urls.portrait || Object.values(resp.urls)[0]));

      if (newUrl) {
        // Replace thumbnail with appropriate preview element
        var thumb = document.getElementById('mmaBgThumb');
        if (thumb) {
          var newThumb;
          if (isVideo) {
            newThumb            = document.createElement('video');
            newThumb.src        = newUrl + '?t=' + Date.now();
            newThumb.muted      = true;
            newThumb.autoplay   = true;
            newThumb.loop       = true;
            newThumb.playsInline = true;
            newThumb.setAttribute('webkit-playsinline', '');
          } else {
            newThumb     = document.createElement('img');
            newThumb.src = newUrl + '?t=' + Date.now();
            newThumb.alt = 'Current background';
          }
          newThumb.id        = 'mmaBgThumb';
          newThumb.className = 'mma-bg-thumb';
          thumb.parentNode.replaceChild(newThumb, thumb);
        }
        // Update internal state
        if (_editClientData) {
          _editClientData.middle_man_background_url  = newUrl;
          _editClientData.middle_man_background_type = resp.type || 'image';
        }
        // Show remove button if not already present
        if (!document.getElementById('mmaRemoveBgBtn')) {
          var removeBtn       = document.createElement('button');
          removeBtn.id        = 'mmaRemoveBgBtn';
          removeBtn.className = 'mma-remove-bg-btn';
          removeBtn.textContent = 'Remove background';
          removeBtn.addEventListener('click', removeBg);
          uploadBtn.parentNode.appendChild(removeBtn);
        }
      }
    });

    xhr.addEventListener('error', function() {
      uploadBtn.disabled    = false;
      uploadBtn.textContent = 'Upload new';
      progress.textContent  = '';
      errEl.textContent     = 'Network error — please try again.';
      errEl.style.display   = 'block';
    });

    xhr.send(fd);
  };

  fileInput.click();
}

// ─── Remove background ────────────────────────────────────────────────────────
async function removeBg() {
  if (!_editClientId || !_editClientData) return;
  var bizName = _editClientData.business_name || 'this client';
  if (!confirm('Remove background for ' + bizName + '?')) return;

  var btn = document.getElementById('mmaRemoveBgBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Removing…'; }

  try {
    var result = await mmaSb.from('clients')
      .update({ middle_man_background_url: null, middle_man_background_type: null })
      .eq('id', _editClientId);
    if (result.error) throw result.error;

    _editClientData.middle_man_background_url  = null;
    _editClientData.middle_man_background_type = null;

    // Replace thumb with placeholder
    var thumb = document.getElementById('mmaBgThumb');
    if (thumb) {
      var placeholder       = document.createElement('div');
      placeholder.id        = 'mmaBgThumb';
      placeholder.className = 'mma-bg-placeholder';
      placeholder.textContent = '★';
      thumb.parentNode.replaceChild(placeholder, thumb);
    }
    if (btn) btn.style.display = 'none';
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Remove background'; }
    alert('Remove failed: ' + err.message);
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
