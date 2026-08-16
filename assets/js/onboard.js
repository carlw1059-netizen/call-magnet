const SUPABASE_URL = '%%SUPABASE_URL%%';
const SUPABASE_ANON_KEY = '%%SUPABASE_ANON_KEY%%';

let sb = null;
let session = null;
let verticals = [];
let sendSmsOn = true;
let mmEnabledOn = true;
let isTestAccount = false;
let editClientId = null;

/** Convert business name to a valid slug. */
function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/** Sanitise slug input as the admin types (keep only valid chars). */
function sanitiseSlugInput(raw) {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').slice(0, 50);
}

function showState(id) {
  ['gateLoading','gateLogin','gateForbidden'].forEach(s => {
    document.getElementById(s).classList.toggle('visible', s === id);
  });
}

function formatAuPhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('61') && digits.length >= 10) return '+' + digits;
  if (digits.startsWith('04') && digits.length === 10) return '+61' + digits.slice(1);
  if (digits.startsWith('4')  && digits.length === 9)  return '+61' + digits;
  return raw;
}

async function loadVerticals() {
  const res = await fetch(SUPABASE_URL + '/rest/v1/verticals?active=eq.true&order=display_order.asc&select=vertical_key,display_name,default_avg_job_value,default_customer_sms,example_sms_templates', {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY }
  });
  if (!res.ok) {
    throw new Error('Could not load verticals: ' + res.status);
  }
  verticals = await res.json();
  const sel = document.getElementById('verticalSelect');
  sel.innerHTML = verticals.map(v =>
    '<option value="' + v.vertical_key + '" data-avg="' + v.default_avg_job_value + '">' + v.display_name + '</option>'
  ).join('');
  // Pre-fill avg + SMS from first vertical
  prefillAvgFromVertical();
  prefillSmsFromVertical();
  updateSmsCounter();
}

function currentVerticalConfig() {
  const key = document.getElementById('verticalSelect').value;
  return verticals.find(v => v.vertical_key === key);
}

function prefillAvgFromVertical() {
  const sel = document.getElementById('verticalSelect');
  const opt = sel.options[sel.selectedIndex];
  if (opt && opt.dataset.avg) {
    document.getElementById('avgJobValueInput').value = opt.dataset.avg;
  }
}

// "Dirty" flag — once the owner types into the textarea, stop auto-replacing
// content on vertical-change or booking-url-change. Reset when an example
// is clicked or a vertical change auto-fills.
let smsDirty = false;

function substituteLink(template) {
  const url = (document.getElementById('bookingUrlInput').value || '').trim();
  if (!url) return template; // leave [LINK] literal until URL entered
  return template.replace(/\[LINK\]/g, url);
}

function prefillSmsFromVertical() {
  if (smsDirty) return; // respect manual edits
  const cfg = currentVerticalConfig();
  if (!cfg) return;
  const ta = document.getElementById('smsTemplateInput');
  if (!ta) return;
  ta.value = substituteLink(cfg.default_customer_sms || '');
  renderExampleButtons(cfg);
  updateSmsCounter();
}

function renderExampleButtons(cfg) {
  const wrap = document.getElementById('smsExampleBtns');
  const examples = Array.isArray(cfg?.example_sms_templates) ? cfg.example_sms_templates : [];
  if (examples.length === 0) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = examples.map((tmpl, idx) =>
    '<button type="button" class="sms-example-btn" data-idx="' + idx + '">' + escapeHtml(tmpl) + '</button>'
  ).join('');
  wrap.querySelectorAll('.sms-example-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-idx'));
      const ta = document.getElementById('smsTemplateInput');
      if (!ta) return;
      ta.value = substituteLink(examples[idx] || '');
      smsDirty = false;
      updateSmsCounter();
    });
  });
}

function updateSmsCounter() {
  const ta = document.getElementById('smsTemplateInput');
  if (!ta) return;
  const body = ta.value || '';
  const len = body.length;
  const el = document.getElementById('smsCounter');
  const tailEl = document.getElementById('smsTailPreview');
  el.classList.remove('warn', 'over');
  if (mmEnabledOn) {
    el.textContent = len + '/160';
    if (len > 160) el.classList.add('over');
    else if (len > 140) el.classList.add('warn');
    tailEl.style.display = 'none';
  } else {
    const total = len + ' Reply STOP to opt out'.length;
    el.textContent = len + '/138 (+22 tail = ' + total + '/160)';
    if (len > 138) el.classList.add('over');
    else if (len > 120) el.classList.add('warn');
    tailEl.style.display = '';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function onBookingUrlChanged() {
  if (smsDirty) return;
  const cfg = currentVerticalConfig();
  if (!cfg) return;
  // Re-apply the default with the new URL substituted
  const smsTaUrl = document.getElementById('smsTemplateInput');
  if (!smsTaUrl) return;
  smsTaUrl.value = substituteLink(cfg.default_customer_sms || '');
  updateSmsCounter();
}

function toggleSms() {
  sendSmsOn = !sendSmsOn;
  document.getElementById('sendSmsToggle').classList.toggle('on', sendSmsOn);
}

function toggleTestAccount() {
  isTestAccount = !isTestAccount;
  document.getElementById('testAccountToggle').classList.toggle('on', isTestAccount);
}

function syncBookingUrlRow() {
  var row = document.getElementById('bookingUrlRow');
  var inp = document.getElementById('bookingUrlInput');
  if (mmEnabledOn) {
    row.style.display = 'none';
    inp.removeAttribute('required');
  } else {
    row.style.display = '';
    inp.setAttribute('required', '');
  }
}

function toggleMmEnabled() {
  mmEnabledOn = !mmEnabledOn;
  document.getElementById('mmEnabledToggle').classList.toggle('on', mmEnabledOn);
  updateSmsCounter();
  syncBookingUrlRow();
}

/** Update the live Middle Man URL preview from the current business name. */
function updateMmPreview() {
  const biz = (document.getElementById('businessNameInput').value || '').trim();
  const wrap = document.getElementById('mmPreviewWrap');
  const urlEl = document.getElementById('mmPreviewUrl');
  if (!biz) { wrap.style.display = 'none'; return; }
  const slug = generateSlug(biz);
  wrap.style.display = 'block';
  urlEl.textContent = 'callmagnet.com.au/b/' + slug;
}

function togglePasswordVisibility() {
  const inp = document.getElementById('initialPasswordInput');
  const btn = document.getElementById('togglePasswordBtn');
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.textContent = 'Hide';
  } else {
    inp.type = 'password';
    btn.textContent = 'Show';
  }
}

function showError(msg) {
  const box = document.getElementById('errorBox');
  box.textContent = msg;
  box.classList.add('visible');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearError() {
  document.getElementById('errorBox').classList.remove('visible');
}

async function submitForm() {
  clearError();

  const business_name    = document.getElementById('businessNameInput').value.trim();
  const owner_name       = document.getElementById('ownerNameInput').value.trim();
  const vertical         = document.getElementById('verticalSelect').value;
  const pricing_package  = document.getElementById('pricingPackageSelect').value;
  const owner_email        = document.getElementById('ownerEmailInput').value.trim().toLowerCase();
  const initial_password   = document.getElementById('initialPasswordInput').value;
  const owner_phone        = formatAuPhone(document.getElementById('ownerPhoneInput').value);
  const twilio_number = formatAuPhone(document.getElementById('twilioNumberInput').value);
  const abn           = document.getElementById('abnInput').value.replace(/\D/g, '');
  const avg_raw       = document.getElementById('avgJobValueInput').value.trim();
  const avg_job_value = avg_raw ? Number(avg_raw) : null;
  const booking_url = document.getElementById('bookingUrlInput').value.trim();
  const customer_sms_template = (document.getElementById('smsTemplateInput')?.value || '').trim();
  const free_period_days = Math.max(0, parseInt(document.getElementById('freePeriodDaysInput').value || '0', 10) || 0);
  const sms_included = parseInt(document.getElementById('smsIncludedSelect').value, 10);

  if (!business_name)    return showError('Business name is required.');
  if (!vertical)         return showError('Pick a vertical.');
  if (!pricing_package)  return showError('Select a pricing package.');
  if (!owner_email || !owner_email.includes('@')) return showError('Valid owner email is required.');
  if (!editClientId && (!initial_password || initial_password.length < 8)) return showError('Initial password must be at least 8 characters.');
  if (!owner_phone || !/^\+61\d{8,11}$/.test(owner_phone)) return showError('Owner phone must be an Australian mobile (04xx or +614xx).');
  if (!twilio_number || !/^\+614\d{8}$/.test(twilio_number)) return showError('Twilio number must be a valid AU mobile (+614XXXXXXXX).');
  if (abn && abn.length !== 11) return showError('ABN must be 11 digits.');
  if (!mmEnabledOn && (!booking_url || !/^https?:\/\//.test(booking_url))) return showError('Booking URL must start with https://');
  if (/callmagnet\.com\.au/i.test(customer_sms_template)) return showError('Customer SMS must not mention callmagnet.com.au (customer-facing — brand stays invisible).');
  if (mmEnabledOn) {
    if (customer_sms_template.length > 160) return showError('SMS body too long — must be 160 chars or fewer (Middle Man ON: no tail appended).');
  } else {
    if (customer_sms_template.length > 138) return showError('SMS body too long — must be 138 chars or fewer so it fits under 160 with " Reply STOP to opt out" tail.');
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;

  // ── Edit mode: update existing client row directly ───────────────────────
  if (editClientId) {
    btn.textContent = 'Saving…';
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/clients?id=eq.' + encodeURIComponent(editClientId),
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + session.access_token,
            'apikey': SUPABASE_ANON_KEY,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({
            business_name,
            owner_name:         owner_name || null,
            email: owner_email,
            owner_phone,
            twilio_number,
            vertical,
            sms_included,
            free_period_days,
            middle_man_enabled: mmEnabledOn,
            customer_sms_template,
            abn:                abn || null,
            avg_job_value,
            booking_url:        booking_url || null,
          }),
        }
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => String(res.status));
        showError('Update failed: ' + detail);
        btn.disabled = false;
        btn.textContent = 'Save Changes';
        return;
      }
      const box = document.getElementById('errorBox');
      box.style.color = '#007A5E';
      box.style.background = '#D4F7EE';
      box.style.borderColor = '#06D6A0';
      box.textContent = 'Client updated successfully';
      box.classList.add('visible');
      btn.disabled = false;
      btn.textContent = 'Save Changes';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      showError('Network error: ' + (e?.message || e));
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
    return;
  }

  // ── Create mode: call create-client edge function ────────────────────────
  btn.textContent = 'Creating…';

  try {
    const res = await fetch(SUPABASE_URL + '/functions/v1/create-client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session.access_token
      },
      body: JSON.stringify({
        business_name,
        owner_name:         owner_name || null,
        vertical,
        owner_email,
        initial_password,
        owner_phone,
        twilio_number,
        abn: abn || null,
        avg_job_value,
        booking_url,
        customer_sms_template,
        send_sms:           sendSmsOn,
        middle_man_enabled: mmEnabledOn,
        free_period_days,
        pricing_package,
        is_test_account:    isTestAccount,
        sms_included,
        // middle_man_slug and middle_man_buttons omitted — create-client auto-generates both
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      const msg = data.detail || data.error || ('Server returned ' + res.status);
      showError('Create failed: ' + msg);
      btn.disabled = false;
      btn.textContent = 'Create Client';
      return;
    }
    window.location.href = '/admin/middle-man.html';
  } catch (e) {
    showError('Network error: ' + (e?.message || e));
    btn.disabled = false;
    btn.textContent = 'Create Client';
  }
}

function showSuccess(data, owner_phone) {
  document.getElementById('formCard').style.display = 'none';
  document.getElementById('successCard').classList.add('visible');

  const smsEl = document.getElementById('smsStatus');
  if (data.sms_sent) {
    smsEl.className = 'sms-status ok';
    smsEl.textContent = '✓ Welcome SMS sent to ' + owner_phone;
  } else if (data.sms_error) {
    smsEl.className = 'sms-status fail';
    smsEl.textContent = '⚠️ SMS failed: ' + data.sms_error;
  } else {
    smsEl.className = 'sms-status fail';
    smsEl.textContent = '⚠️ SMS not sent.';
  }

  const emailEl = document.getElementById('emailStatus');
  if (data.welcome_email_sent) {
    emailEl.className = 'sms-status ok';
    emailEl.textContent = '✓ Welcome email sent (includes temp password)' + (data.is_new_user ? '' : ' — existing user, no new password');
  } else if (data.welcome_email_error) {
    emailEl.className = 'sms-status fail';
    emailEl.textContent = '⚠️ Welcome email failed: ' + data.welcome_email_error;
  }

  // ── Middle Man confirmation ──────────────────────────────────────────────
  const slug = data.middle_man_slug || null;
  const mmEnabled = data.middle_man_enabled !== false;
  const mmUrlEl   = document.getElementById('mmSuccessUrl');
  const smsLinkEl = document.getElementById('mmSuccessSmsLink');
  const noteEl    = document.getElementById('mmSuccessNote');
  const copyBtn   = document.getElementById('copyMmUrlBtn');

  if (slug && mmEnabled) {
    const mmUrl = 'callmagnet.com.au/b/' + slug;
    mmUrlEl.textContent   = mmUrl;
    copyBtn.style.display = 'inline-block';
    copyBtn.dataset.url   = 'https://' + mmUrl;

    smsLinkEl.textContent = 'https://cm1.au/' + slug;
    noteEl.textContent    = 'Middle Man is ON — callers who miss this number will be sent to the smart page.';
  } else if (slug && !mmEnabled) {
    mmUrlEl.textContent   = 'callmagnet.com.au/b/' + slug + ' (configured but OFF)';
    smsLinkEl.textContent = 'SMS will go straight to booking URL (Middle Man is OFF)';
    noteEl.textContent    = 'Turn Middle Man ON in the Middle Man admin to activate the smart page.';
  } else {
    mmUrlEl.textContent   = '—';
    smsLinkEl.textContent = 'SMS will go to booking URL';
    noteEl.textContent    = '';
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function copyMmUrl() {
  const btn = document.getElementById('copyMmUrlBtn');
  const url = btn.dataset.url || '';
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy Middle Man URL'; btn.classList.remove('copied'); }, 2000);
  }).catch(() => {
    btn.textContent = 'Copy failed';
    setTimeout(() => { btn.textContent = 'Copy Middle Man URL'; }, 2000);
  });
}

function resetForm() {
  document.getElementById('successCard').classList.remove('visible');
  document.getElementById('businessNameInput').value = '';
  document.getElementById('ownerEmailInput').value = '';
  document.getElementById('initialPasswordInput').value = '';
  document.getElementById('initialPasswordInput').type = 'password';
  document.getElementById('togglePasswordBtn').textContent = 'Show';
  document.getElementById('ownerPhoneInput').value = '';
  document.getElementById('twilioNumberInput').value = '';
  document.getElementById('abnInput').value = '';
  document.getElementById('bookingUrlInput').value = '';
  smsDirty = false;
  mmEnabledOn = true;
  document.getElementById('mmEnabledToggle').classList.add('on');
  document.getElementById('mmPreviewWrap').style.display = 'none';
  syncBookingUrlRow();
  prefillAvgFromVertical();
  prefillSmsFromVertical();
  updateSmsCounter();
  document.getElementById('formCard').style.display = 'block';
  const btn = document.getElementById('submitBtn');
  btn.disabled = false;
  btn.textContent = 'Create Client';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function handleSignout() {
  await sb.auth.signOut();
  window.location.href = '/';
}

async function sendTestNotification() {
  const btn = document.getElementById('testNotifBtn');
  if (!btn || btn.disabled) return;
  const orig = btn.textContent;
  btn.textContent = 'Sending…';
  btn.disabled = true;
  try {
    if (!session) {
      btn.textContent = 'Not signed in';
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2500);
      return;
    }
    const res = await fetch(SUPABASE_URL + '/functions/v1/send-test-notification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({})
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      btn.textContent = '✓ Sent!';
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2500);
    } else {
      btn.textContent = 'Failed: ' + (data.error || res.status);
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
    }
  } catch (e) {
    btn.textContent = 'Error';
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      storage: window.localStorage,
      storageKey: 'callmagnet-auth-token',
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  const { data: { session: s } } = await sb.auth.getSession();
  session = s;

  if (!session) {
    showState('gateLogin');
    return;
  }

  const isAdmin = session.user?.app_metadata?.is_admin === true;
  const email   = (session.user?.email || '').toLowerCase();
  if (!isAdmin || email !== 'car312@hotmail.com') {
    showState('gateForbidden');
    return;
  }
  window.refreshAdminFab(session);

  // Authed + admin — show form
  document.getElementById('gateLoading').classList.remove('visible');
  // signout button removed from this page
  document.getElementById('formCard').style.display = 'block';
  syncBookingUrlRow();

  try {
    await loadVerticals();
  } catch (e) {
    showError('Could not load verticals dropdown: ' + (e?.message || e));
  }

  // ── Edit mode: pre-fill form from ?client=<id> ──────────────────────────
  const editId = new URLSearchParams(window.location.search).get('client');
  if (editId) {
    editClientId = editId;
    if (!session || !session.access_token) {
      showError('Session expired — please refresh the page and try again.');
      return;
    }
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/clients' +
        '?id=eq.' + encodeURIComponent(editId) +
        '&select=business_name,owner_name,email,owner_phone,twilio_number,vertical,pricing_package,sms_included,free_period_days,middle_man_enabled,customer_sms_template,abn,avg_job_value,booking_url' +
        '&limit=1',
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + session.access_token } }
      );
      const rows = await res.json().catch(() => []);
      console.log('Edit prefill response:', rows);
      const c = rows && rows[0];
      if (c) {
        if (c.business_name)       document.getElementById('businessNameInput').value    = c.business_name;
        if (c.owner_name)          document.getElementById('ownerNameInput').value        = c.owner_name;
        if (c.email)               document.getElementById('ownerEmailInput').value       = c.email;
        if (c.owner_phone)         document.getElementById('ownerPhoneInput').value       = c.owner_phone;
        if (c.twilio_number)       document.getElementById('twilioNumberInput').value     = c.twilio_number;
        if (c.vertical)            document.getElementById('verticalSelect').value        = c.vertical;
        if (c.pricing_package)     document.getElementById('pricingPackageSelect').value  = c.pricing_package;
        if (c.sms_included != null) document.getElementById('smsIncludedSelect').value   = String(c.sms_included);
        if (c.free_period_days != null) document.getElementById('freePeriodDaysInput').value = String(c.free_period_days);
        if (c.abn)                 document.getElementById('abnInput').value              = c.abn;
        if (c.avg_job_value != null) document.getElementById('avgJobValueInput').value   = String(c.avg_job_value);
        if (c.booking_url)         document.getElementById('bookingUrlInput').value     = c.booking_url;
        if (c.customer_sms_template) {
          const smsTaLoad = document.getElementById('smsTemplateInput');
          if (smsTaLoad) { smsTaLoad.value = c.customer_sms_template; smsDirty = true; }
        }
        mmEnabledOn = c.middle_man_enabled !== false;
        document.getElementById('mmEnabledToggle').classList.toggle('on', mmEnabledOn);
        syncBookingUrlRow();
        updateMmPreview();
        updateSmsCounter();
        document.getElementById('submitBtn').textContent = 'Save Changes';
        document.querySelector('h1').textContent = 'Edit Client';
        document.title = 'CallMagnet — Edit Client';
      }
    } catch (e) {
      showError('Could not load client for editing: ' + (e?.message || e));
    }
  }

  document.getElementById('verticalSelect').addEventListener('change', () => {
    prefillAvgFromVertical();
    smsDirty = false;
    prefillSmsFromVertical();
  });

  // Booking URL blur: re-substitute [LINK] in SMS if owner hasn't edited yet
  document.getElementById('bookingUrlInput').addEventListener('blur', onBookingUrlChanged);

  // Auto-format phone fields on blur
  const phoneFields = ['ownerPhoneInput', 'twilioNumberInput'];
  phoneFields.forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('blur', () => {
      const formatted = formatAuPhone(el.value);
      if (formatted) el.value = formatted;
    });
  });

  // Business name: live preview of Middle Man URL on every keypress
  document.getElementById('businessNameInput').addEventListener('input', updateMmPreview);
});