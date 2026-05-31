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
      listEl.innerHTML = '<div class="mma-loading">No Middle Man clients found.<br><span style="font-size:13px;color:#BBBBBB;">Enable Middle Man on a client or set a slug to get started.</span></div>';
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
      .select('id,business_name,vertical,middle_man_enabled,middle_man_slug,booking_url,middle_man_logo_url,middle_man_promo_text,middle_man_background_url,middle_man_background_type,middle_man_background_poster_url,middle_man_buttons,middle_man_updated_at')
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

  // ── 4. Booking URL
  var bookingSection =
    '<div class="mma-section">' +
      '<div class="mma-section-label">Booking URL</div>' +
      '<div class="mma-section-hint" style="font-size:12px;color:#000000;margin-bottom:6px;">Where "Book a table" sends callers — and where SMS goes when Middle Man is OFF. (OpenTable / SevenRooms / Fresha / any booking link)</div>' +
      '<div style="display:flex;gap:8px;align-items:center;">' +
        '<input id="mmaBookingUrlInput" class="mma-field-input" type="url" value="' + _e(_editClientData.booking_url || '') + '" placeholder="https://..." style="flex:1;" />' +
        '<button id="mmaBookingUrlSaveBtn" class="mma-save-btn">Save</button>' +
      '</div>' +
      '<div id="mmaBookingUrlMsg" class="mma-saved-msg" style="margin-left:0;margin-top:6px;"></div>' +
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

  // ── 5a. Background Photo card (FIX 5)
  var photoThumbHtml = hasPhoto
    ? '<img src="' + _e(bgUrl) + '?v=' + Date.now() + '" id="mmaPhotoThumb" class="mma-bg-thumb" alt="Current background photo" />'
    : '<div id="mmaPhotoThumb" class="mma-bg-placeholder">★</div>';
  var photoRemoveHtml = hasPhoto
    ? '<button id="mmaPhotoRemoveBtn" class="mma-remove-bg-btn">Remove photo</button>'
    : '';
  var photoSection =
    '<div class="mma-section">' +
      '<div class="mma-section-label">Background Photo</div>' +
      '<div style="display:flex;align-items:flex-start;gap:16px;">' +
        photoThumbHtml +
        '<div>' +
          '<button id="mmaPhotoUploadBtn" class="mma-save-btn">Upload photo</button>' +
          '<div class="mma-info">JPG or PNG, portrait orientation works best. Max 5 MB.</div>' +
          '<div id="mmaPhotoProgress" class="mma-progress"></div>' +
          '<div id="mmaPhotoErr" class="mma-err"></div>' +
          photoRemoveHtml +
        '</div>' +
      '</div>' +
    '</div>';

  // ── 5b. Background Video card (FIX 5 + FIX 6)
  var videoPreviewHtml;
  if (hasVideo) {
    // Build the video element via HTML string; we'll wire autoplay in JS after render
    videoPreviewHtml =
      '<video id="mmaVideoPreview" class="mma-video-preview"' +
        ' autoplay muted playsinline webkit-playsinline loop preload="auto">' +
        '<source src="' + _e(bgUrl) + '?v=' + Date.now() + '" type="video/mp4" />' +
      '</video>';
  } else {
    videoPreviewHtml = '<div id="mmaVideoPreview" class="mma-video-placeholder">▶</div>';
  }
  var videoRemoveHtml = hasVideo
    ? '<button id="mmaVideoRemoveBtn" class="mma-remove-bg-btn">Remove video</button>'
    : '';
  var videoSection =
    '<div class="mma-section">' +
      '<div class="mma-section-label">Background Video</div>' +
      '<div style="display:flex;align-items:flex-start;gap:16px;">' +
        videoPreviewHtml +
        '<div>' +
          '<button id="mmaVideoUploadBtn" class="mma-save-btn">Upload video</button>' +
          '<div class="mma-info">MP4 only, vertical 9:16 (Instagram Reel shape). Max 10 MB.</div>' +
          '<div id="mmaVideoProgress" class="mma-progress"></div>' +
          '<div id="mmaVideoErr" class="mma-err"></div>' +
          videoRemoveHtml +
        '</div>' +
      '</div>' +
    '</div>';

  // ── 6. Buttons (FIX 4: helper text above list)
  var btnRows = buttons.filter(Boolean).map(function(b, i) { return buildBtnRowHtml(b, i); }).join('');
  var btnsSection =
    '<div class="mma-section">' +
      '<div class="mma-section-label">Customer Buttons</div>' +
      '<p class="mma-btn-hint">Order = position on caller\'s page (1 = top, 6 = bottom). Tick = button is live for customers. Untick to hide without deleting. X = delete permanently.</p>' +
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

  content.innerHTML = heading + logoSection + toggleSection + slugSection + bookingSection + promoSection + photoSection + videoSection + btnsSection + previewHtml;

  // ── Wire event listeners ─────────────────────────────────────────────────────
  document.getElementById('mmaLogoUploadBtn').addEventListener('click', uploadLogo);
  var mmaLogoRemoveBtn = document.getElementById('mmaLogoRemoveBtn');
  if (mmaLogoRemoveBtn) mmaLogoRemoveBtn.addEventListener('click', removeLogo);

  document.getElementById('mmaToggleBtn').addEventListener('click', toggleEnabled);
  document.getElementById('mmaSlugSaveBtn').addEventListener('click', saveSlug);
  document.getElementById('mmaBookingUrlSaveBtn').addEventListener('click', saveBookingUrl);

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
    if (removeBtn) removeBtn.closest('.mma-btn-row').remove();
  });
  document.getElementById('mmaAddBtnBtn').addEventListener('click', addBtnRow);
  document.getElementById('mmaSaveBtnsBtn').addEventListener('click', saveButtons);

  // FIX 6: Autoplay the video preview if one is already set
  if (hasVideo) {
    _bootVideoPreview('mmaVideoPreview');
  }
}

// ─── Button row HTML builder ──────────────────────────────────────────────────
function buildBtnRowHtml(btn, idx) {
  return '<div class="mma-btn-row">' +
    '<input type="number" min="1" max="6" value="' + _e(btn.sort_order || idx + 1) + '" class="mma-btn-order" />' +
    '<input type="checkbox"' + (btn.enabled !== false ? ' checked' : '') + ' class="mma-btn-enabled mma-btn-enabled-cb" />' +
    '<input type="text" value="' + _e(btn.label || '') + '" maxlength="40" placeholder="Button label…" class="mma-btn-label" />' +
    '<input type="color" class="mma-btn-color" value="' + _e(btn.color || '#00D4FF') + '" title="Button colour" style="width:36px;height:32px;padding:2px;border:none;border-radius:6px;cursor:pointer;background:none;" />' +
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

// ─── Save booking URL ─────────────────────────────────────────────────────────
async function saveBookingUrl() {
  if (!_editClientId) return;
  var input = document.getElementById('mmaBookingUrlInput');
  var url   = (input.value || '').trim();
  if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
    input.value = url;
  }
  try {
    var result = await mmaSb.from('clients').update({ booking_url: url || null }).eq('id', _editClientId);
    if (result.error) throw result.error;
    if (_editClientData) _editClientData.booking_url = url;
    _flash('mmaBookingUrlMsg', '✓ Saved', false);
  } catch (err) {
    _flash('mmaBookingUrlMsg', '✗ ' + err.message, true);
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
    var colorInput = row.querySelector('.mma-btn-color');
    var color = colorInput ? colorInput.value : '#00D4FF';
    buttons.push({
      label:      label,
      sort_order: parseInt(row.querySelector('.mma-btn-order').value, 10) || 1,
      enabled:    row.querySelector('.mma-btn-enabled-cb').checked,
      color:      color,
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

  var btn = document.getElementById(isVideo ? 'mmaVideoRemoveBtn' : 'mmaPhotoRemoveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Removing…'; }

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
    if (btn) btn.style.display = 'none';
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Remove ' + typeLabel; }
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
