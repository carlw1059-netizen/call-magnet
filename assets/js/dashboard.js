// ============================================================
// CallMagnet dashboard — optimised release
// Combines all fixes from both development sessions
// ============================================================

const SUPABASE_URL = 'https://iskvvnhacqdxybpmwuni.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlza3Z2bmhhY3FkeHlicG13dW5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTAyOTYsImV4cCI6MjA5MDA4NjI5Nn0.c3uR-CSQXsgfYMnzK8KOxZjoqRPwaMsUuGpMPwvCsk8';


let sb;
let currentClient = null;
let currentMode = 'week';
let currentOffset = 0;
let autoRefreshTimer = null;
let bookingInFlight = false;
let statsRequestId = 0;

function isAccountReadOnly() {
  if (!currentClient) return true;
  if (currentClient.is_test_account) return false;
  if (currentClient.account_status === 'suspended') return true;
  if (currentClient.cancellation_scheduled) return true;
  return false;
}


function showForgot() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('forgotScreen').classList.add('active');
}

function showLogin() {
  document.getElementById('forgotScreen').classList.remove('active');
  document.getElementById('loginScreen').style.display = 'flex';
  const btn = document.getElementById('loginBtn');
  btn.disabled = false;
  btn.textContent = 'Sign in';
}

function showRecovery() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('forgotScreen').classList.remove('active');
  document.getElementById('dash').style.display = 'none';
  const recoveryScreen = document.getElementById('recoveryScreen');
  recoveryScreen.style.display = '';
  recoveryScreen.classList.remove('screen-fade-out');
  recoveryScreen.classList.add('active');
  document.getElementById('recoveryErrorMsg').style.display = 'none';
  document.getElementById('recoverySuccessMsg').style.display = 'none';
  document.getElementById('recoveryPassInput').value = '';
  document.getElementById('recoveryPassConfirm').value = '';
  const btn = document.getElementById('recoveryBtn');
  btn.disabled = false;
  btn.textContent = 'Update password and sign in';
}

function toggleRecoveryPass(id) {
  const input = document.getElementById(id);
  input.type = input.type === 'password' ? 'text' : 'password';
}

async function handleRecovery() {
  const pass1 = document.getElementById('recoveryPassInput').value;
  const pass2 = document.getElementById('recoveryPassConfirm').value;
  const btn = document.getElementById('recoveryBtn');
  const errDiv = document.getElementById('recoveryErrorMsg');
  const okDiv = document.getElementById('recoverySuccessMsg');
  errDiv.style.display = 'none';
  okDiv.style.display = 'none';

  if (pass1.length < 6) {
    errDiv.textContent = 'Password must be at least 6 characters.';
    errDiv.style.display = 'block';
    return;
  }
  if (pass1 !== pass2) {
    errDiv.textContent = 'Passwords do not match.';
    errDiv.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Updating...';

  try {
    const { error } = await sb.auth.updateUser({ password: pass1 });
    if (error) {
      errDiv.textContent = error.message;
      errDiv.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Update password and sign in';
      return;
    }

    // Clear must_change_password flag if this was a forced first-login change
    if (currentClient?.must_change_password) {
      await sb.from('clients')
        .update({ must_change_password: false })
        .eq('id', currentClient.id)
        .catch(() => {}); // best-effort
      if (currentClient) currentClient.must_change_password = false;
    }

    okDiv.style.display = 'block';
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      setTimeout(async () => {
        await crossFadeToDashboard(user, document.getElementById('recoveryScreen'));
      }, 900);
    } else {
      errDiv.textContent = 'Password updated. Please sign in again.';
      errDiv.style.display = 'block';
      setTimeout(() => {
        document.getElementById('recoveryScreen').classList.remove('active');
        document.getElementById('loginScreen').style.display = 'flex';
      }, 1500);
    }
  } catch (e) {
    errDiv.textContent = 'Network error. Try again.';
    errDiv.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Update password and sign in';
  }
}

function togglePassword() {
  const input = document.getElementById('passwordInput');
  input.type = input.type === 'password' ? 'text' : 'password';
}

async function handleAuth() {
  const email    = document.getElementById('emailInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  const btn      = document.getElementById('loginBtn');
  const errDiv   = document.getElementById('errorMsg');
  errDiv.style.display = 'none';
  if (!email || !password) {
    errDiv.textContent = 'Enter your email and password.';
    errDiv.style.display = 'block';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Signing in...';
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      errDiv.textContent = error.message;
      errDiv.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Sign in';
    } else {
      await crossFadeToDashboard(data.user, document.getElementById('loginScreen'));
    }
  } catch (e) {
    errDiv.textContent = 'Network error. Check your connection and try again.';
    errDiv.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

async function handleReset() {
  const email = document.getElementById('resetEmailInput').value.trim();
  const btn = document.getElementById('resetBtn');
  const errDiv = document.getElementById('resetErrorMsg');
  errDiv.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: 'https://callmagnet.com.au' });
    if (error) {
      errDiv.textContent = error.message;
      errDiv.style.display = 'block';
    } else {
      document.getElementById('resetSuccessMsg').style.display = 'block';
    }
  } catch (e) {
    errDiv.textContent = 'Network error. Try again.';
    errDiv.style.display = 'block';
  }
  btn.disabled = false;
  btn.textContent = 'Send reset link';
}

async function handleLogout() {
  stopAutoRefresh();
  currentClient = null;
  document.getElementById('dash').style.display = 'none';
  const loginScreen = document.getElementById('loginScreen');
  loginScreen.style.display = 'flex';
  document.getElementById('emailInput').value    = '';
  document.getElementById('passwordInput').value = '';
  document.getElementById('errorMsg').style.display = 'none';
  const btn = document.getElementById('loginBtn');
  btn.disabled = false;
  btn.textContent = 'Sign in';
  try { await sb.auth.signOut(); } catch (e) { console.warn('signOut error:', e); }
}

function showTermsModal() { document.getElementById('termsModal').classList.add('open'); }
function hideTermsModal() { document.getElementById('termsModal').classList.remove('open'); }

async function acceptTerms() {
  const btn = document.getElementById('acceptTermsBtn');
  const errDiv = document.getElementById('termsErrorMsg');
  errDiv.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    const now = new Date().toISOString();
    const { error } = await sb.from('clients')
      .update({ terms_accepted: true, terms_accepted_at: now })
      .eq('id', currentClient.id);
    if (error) {
      errDiv.textContent = 'Could not save. Try again or email hello@callmagnet.com.au';
      errDiv.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'I agree — continue to dashboard';
      return;
    }
    currentClient.terms_accepted = true;
    currentClient.terms_accepted_at = now;
    hideTermsModal();
  } catch (e) {
    errDiv.textContent = 'Network error. Try again.';
    errDiv.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'I agree — continue to dashboard';
  }
}

async function crossFadeToDashboard(user, fromEl) {
  const dashEl = document.getElementById('dash');
  const skeletonEl = document.querySelector('.dashboard-skeleton');
  const mainEl = dashEl.querySelector('.main');
  const fromHadActive = fromEl ? fromEl.classList.contains('active') : false;
  let hideFromTimer = null;

  const revert = () => {
    if (hideFromTimer) clearTimeout(hideFromTimer);
    if (fromEl) {
      fromEl.classList.remove('screen-fade-out');
      fromEl.style.display = '';
      if (fromHadActive) fromEl.classList.add('active');
    }
    dashEl.style.display = 'none';
    dashEl.classList.remove('screen-fade-in');
    if (skeletonEl) skeletonEl.style.display = 'none';
    if (mainEl) mainEl.style.display = '';
  };

  if (fromEl) fromEl.classList.add('screen-fade-out');

  setTimeout(() => {
    if (mainEl) mainEl.style.display = 'none';
    if (skeletonEl) skeletonEl.style.display = 'block';
    dashEl.classList.add('screen-fade-in');
    dashEl.style.display = 'block';
  }, 50);

  hideFromTimer = setTimeout(() => {
    if (fromEl) {
      fromEl.classList.remove('screen-fade-out');
      fromEl.classList.remove('active');
      fromEl.style.display = 'none';
    }
    dashEl.classList.remove('screen-fade-in');
  }, 400);

  try {
    const ok = await loadDashboard(user, { skipScreenSwap: true });
    if (!ok) {
      revert();
      return false;
    }
    if (ok === 'must_change_password') {
      // loadDashboard already called showRecovery(). Just clean up the fade.
      dashEl.style.display = 'none';
      dashEl.classList.remove('screen-fade-in');
      if (fromEl) {
        fromEl.classList.remove('screen-fade-out');
        fromEl.style.display = 'none';
      }
      return false;
    }
    if (skeletonEl) skeletonEl.style.display = 'none';
    if (mainEl) mainEl.style.display = '';
    return true;
  } catch (err) {
    revert();
    throw err;
  }
}

async function loadDashboard(user, opts = {}) {
  const { data: clients, error } = await sb
    .from('clients')
    .select('*')
    .eq('email', user.email)
    .limit(1);

  if (error || !clients || clients.length === 0) {
    document.getElementById('errorMsg').textContent = 'No client record found. Contact hello@callmagnet.com.au';
    document.getElementById('errorMsg').style.display = 'block';
    const btn = document.getElementById('loginBtn');
    btn.disabled = false;
    btn.textContent = 'Sign in';
    return false;
  }

  currentClient = clients[0];

  if (typeof progressier !== 'undefined' && currentClient?.id) {
    progressier.add({ id: currentClient.id });
  }

  // First-login forced password change — must happen before any dashboard load
  if (currentClient.must_change_password) {
    showRecovery();
    return 'must_change_password'; // signals crossFadeToDashboard to skip revert
  }

  if (!opts.skipScreenSwap) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dash').style.display = 'block';
  }

  if (!currentClient.terms_accepted) showTermsModal();

  if (currentClient.account_status === 'suspended' && !currentClient.is_test_account) {
    document.getElementById('suspensionBanner').classList.add('active');
  }
  if (currentClient.cancellation_scheduled && !currentClient.is_test_account) {
    const endDate = new Date(currentClient.cancelled_at);
    endDate.setDate(endDate.getDate() + 30);
    document.getElementById('cancellationEndDate').textContent =
      endDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('cancellationBanner').classList.add('active');
  }

  document.getElementById('bizNameLarge').textContent = currentClient.business_name;
  document.title = currentClient.business_name + ' — CallMagnet';

  if (currentClient.date_of_birth) {
    const parts = String(currentClient.date_of_birth).split('-');
    if (parts.length >= 3) {
      const dobMonth = parseInt(parts[1], 10) - 1;
      const dobDay = parseInt(parts[2].slice(0, 2), 10);
      const today = new Date();
      if (dobDay === today.getDate() && dobMonth === today.getMonth()) {
        document.getElementById('birthdayBizName').textContent = currentClient.business_name;
        document.getElementById('birthdayBanner').style.display = 'block';
      }
    }
  }

  if (currentClient.subscription_start) {
    const start = new Date(currentClient.subscription_start);
    const today = new Date();
    const dayOfMonth = start.getDate();
    let renewal = new Date(today.getFullYear(), today.getMonth(), dayOfMonth);
    if (renewal <= today) renewal.setMonth(renewal.getMonth() + 1);
    const days = Math.ceil((renewal - today) / 86400000);
    document.getElementById('renewalValue').textContent = days === 1 ? 'Tomorrow' : days + ' days';
  }

  setTimeout(maybeShowInstallBanner, 1500);
  refreshVerticalToggleVisibility();
  renderTilesForMode(getDashboardMode());
  await loadStats();
  startAutoRefresh();
  return true;
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(async () => {
    if (currentClient && document.visibilityState === 'visible') {
      await loadStats();
    }
  }, 30000);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && currentClient) {
    await loadStats();
  }
});

function getPeriodBounds(mode, offset) {
  const now = new Date();
  let start, end, label;
  if (mode === 'week') {
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day + 6) % 7) + (offset * 7));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    start = monday; end = sunday;
    const opts = { day: 'numeric', month: 'short' };
    label = monday.toLocaleDateString('en-AU', opts) + ' — ' + sunday.toLocaleDateString('en-AU', opts);
  } else {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    start = new Date(d.getFullYear(), d.getMonth(), 1); start.setHours(0, 0, 0, 0);
    end = new Date(d.getFullYear(), d.getMonth() + 1, 0); end.setHours(23, 59, 59, 999);
    label = d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  }
  return { start, end, label };
}

function setMode(mode) {
  currentMode = mode;
  currentOffset = 0;
  document.getElementById('toggleWeek').classList.toggle('active', mode === 'week');
  document.getElementById('toggleMonth').classList.toggle('active', mode === 'month');
  document.getElementById('nextBtn').disabled = true;
  loadStats();
}

function navigate(dir) {
  currentOffset += dir;
  document.getElementById('nextBtn').disabled = currentOffset >= 0;
  loadStats();
}

async function handleRefresh() {
  const btn = document.getElementById('refreshBtn');
  const icon = document.getElementById('refreshIcon');
  if (btn.disabled) return;
  btn.disabled = true;
  icon.classList.add('spinning');
  try {
    await loadStats();
  } finally {
    icon.classList.remove('spinning');
    btn.disabled = false;
  }
}

async function loadStats() {
  if (!currentClient) return;

  const myRequestId = ++statsRequestId;

  try {
    const { data: fresh } = await sb
      .from('clients')
      .select('*')
      .eq('id', currentClient.id)
      .single();
    if (fresh && myRequestId === statsRequestId) currentClient = fresh;
  } catch (e) {
    console.warn('client refresh failed, using cached', e);
  }

  if (myRequestId !== statsRequestId) return;

  const { start, end, label } = getPeriodBounds(currentMode, currentOffset);
  document.getElementById('periodLabelText').textContent = label;

  const clientId = currentClient.id;
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  let effectiveStart = startIso;
  if (currentClient.reset_date) {
    const rd = new Date(currentClient.reset_date);
    if (rd > start) effectiveStart = rd.toISOString();
  }

  const monthStartIso = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const todayStartIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  // For link-taps-today: respect reset_date if it occurred today (take whichever is later)
  const tapsTodayStart = effectiveStart > todayStartIso ? effectiveStart : todayStartIso;

  let smsRes, clickRes, bookRes, monthSmsRes, tapsTodayRes;
  try {
    [smsRes, clickRes, bookRes, monthSmsRes, tapsTodayRes] = await Promise.all([
      sb.from('sms_events').select('id', { count: 'exact' }).eq('client_id', clientId).gte('received_at', effectiveStart).lte('received_at', endIso),
      sb.from('link_clicks').select('id', { count: 'exact' }).eq('client_id', clientId).gte('created_at', effectiveStart).lte('created_at', endIso),
      sb.from('bookings').select('id', { count: 'exact' }).eq('client_id', clientId).gte('booked_at', effectiveStart).lte('booked_at', endIso),
      sb.from('sms_events').select('id', { count: 'exact' }).eq('client_id', clientId).gte('received_at', monthStartIso),
      sb.from('link_clicks').select('id', { count: 'exact' }).eq('client_id', clientId).gte('clicked_at', tapsTodayStart)
    ]);
  } catch (e) {
    console.error('stats load failed', e);
    return;
  }

  if (myRequestId !== statsRequestId) return;

  const smsCount = smsRes.count || 0;
  const clickCount = clickRes.count || 0;
  const bookCount = bookRes.count || 0;
  const monthSms = monthSmsRes.count || 0;
  const tapsTodayCount = tapsTodayRes.count || 0;

  document.getElementById('smsCount').textContent = smsCount;
  document.getElementById('clickCount').textContent = clickCount;
  document.getElementById('bookingCount').textContent = bookCount;

  const conv = smsCount > 0 ? Math.round((clickCount / smsCount) * 100) + '%' : '—';
  document.getElementById('convRate').textContent = conv;

  const avgJob = currentClient.avg_job_value || 0;
  let revenue = 0, heroSub = '';

  if (clickCount > 0 && bookCount > 0) {
    const realConv = bookCount / clickCount;
    revenue = Math.round(clickCount * avgJob * realConv);
    heroSub = 'Real conversion rate: ' + Math.round(realConv * 100) + '%';
  } else if (clickCount > 0) {
    revenue = Math.round(clickCount * avgJob * 0.62);
    heroSub = 'Estimated conversion (62%)';
  } else if (bookCount > 0) {
    revenue = Math.round(bookCount * avgJob);
    heroSub = bookCount + ' bookings × $' + avgJob + ' avg';
  }

  if (avgJob === 0 && (smsCount > 0 || bookCount > 0)) {
    heroSub = 'Set your average job value to see revenue';
  }

  const isFullyEmpty = smsCount === 0 && bookCount === 0 && clickCount === 0;
  const heroValueEl = document.getElementById('heroValue');
  if (isFullyEmpty) {
    heroValueEl.innerHTML = '<span style="font-size: 22px; font-weight: 400; opacity: 0.55; letter-spacing: 0;">Your first booking will appear here</span>';
    document.getElementById('heroSub').textContent = '';
  } else {
    heroValueEl.textContent = '$' + revenue.toLocaleString();
    document.getElementById('heroSub').textContent = heroSub;
  }
  document.getElementById('demoBanner').style.display = isFullyEmpty ? 'block' : 'none';

  updateSmsCounter(monthSms);

  const smsIncluded = currentClient.sms_included || 50;
  const overage = Math.max(0, monthSms - smsIncluded);
  if (overage > 0) {
    document.getElementById('overageRow').style.display = 'flex';
    renderOverageDisplay((overage * 0.10).toFixed(2));
  } else {
    document.getElementById('overageRow').style.display = 'none';
  }

  if (getDashboardMode() === 'restaurant') {
    await loadRestaurantTileData(clientId, myRequestId);
    if (currentClient.middle_man_enabled) {
      loadMiddleManSection().catch(e => console.warn('MM section load failed', e));
    }
  }

  await loadActivity(clientId, effectiveStart, endIso, myRequestId);
}

// is_admin flag lives on auth.users.raw_app_meta_data and is mirrored into
// the JWT session at sign-in. We cache the boolean on auth-state-change so
// downstream call sites (renderTilesForMode, vertical toggle visibility,
// etc.) can read it synchronously.
let _isAdminCached = false;
let _adminUserEmail = '';
// Only this email address should see the admin FAB and sidebar.
// car312@hotmail.com also has is_admin=true in app_metadata (test account)
// but must NOT see admin UI elements.
const REAL_ADMIN_EMAIL = 'car312@hotmail.com';

function isAdminToggleUser() {
  return _isAdminCached === true;
}

function refreshAdminFab() {
  // Gate admin UI on both the is_admin flag AND the real admin email.
  // This prevents the test account (which shares is_admin=true) from seeing
  // the admin FAB and sidebar.
  const showAdmin = _isAdminCached === true && _adminUserEmail.toLowerCase() === REAL_ADMIN_EMAIL;
  const fab = document.getElementById('adminFab');
  if (fab) fab.style.display = showAdmin ? 'flex' : 'none';
  const sidebar = document.getElementById('adminSidebar');
  if (sidebar) sidebar.classList.toggle('visible', showAdmin);
  // Toggle class on #dash so the topbar-logo shifts right (eliminates the "T"
  // bleed — see CSS comment above .admin-sidebar-open rule).
  const dash = document.getElementById('dash');
  if (dash) dash.classList.toggle('admin-sidebar-open', showAdmin);
}


function getDashboardMode() {
  if (isAdminToggleUser()) {
    try {
      const v = localStorage.getItem('dashboardMode');
      if (v === 'restaurant' || v === 'hairdresser') return v;
    } catch (e) { /* localStorage unavailable */ }
    return 'hairdresser';
  }
  if (currentClient && currentClient.vertical === 'restaurant') return 'restaurant';
  return 'hairdresser';
}

function setDashboardMode(mode) {
  if (mode !== 'restaurant' && mode !== 'hairdresser') return;
  try { localStorage.setItem('dashboardMode', mode); } catch (e) { /* no-op */ }
  renderTilesForMode(mode);
  if (mode === 'restaurant' && currentClient) {
    loadRestaurantTileData(currentClient.id, statsRequestId);
    if (currentClient.middle_man_enabled) {
      loadMiddleManSection();
    }
  }
  if (isAdminToggleUser() && currentClient) {
    const dbVertical = mode === 'restaurant' ? 'restaurant' : 'barber';
    const toggle = document.getElementById('verticalToggle');
    if (toggle) toggle.classList.add('vt-saving');
    sb.from('clients')
      .update({ vertical: dbVertical })
      .eq('id', currentClient.id)
      .then(({ error }) => {
        if (error) console.error('[toggle] vertical update failed:', error.message);
        else console.log('[toggle] clients.vertical →', dbVertical);
        if (toggle) toggle.classList.remove('vt-saving');
      });
  }
}

function renderTilesForMode(mode) {
  const hg = document.getElementById('hairdresserMetrics');
  const lbr = document.querySelector('.log-booking-row');
  const vtR = document.getElementById('vtRestaurant');
  const vtH = document.getElementById('vtHairdresser');
  const hero = document.querySelector('.hero');
  // Hide MM section when switching away from restaurant (re-shown by loadMiddleManSection)
  if (mode !== 'restaurant') {
    const mmSec = document.getElementById('mmSection');
    if (mmSec) mmSec.classList.remove('visible');
  }
  if (mode === 'restaurant') {
    if (hg) hg.style.display = 'none';
    if (lbr) lbr.style.display = 'none';
    if (hero) hero.style.display = 'none';
    if (vtR) vtR.classList.add('active');
    if (vtH) vtH.classList.remove('active');
  } else {
    if (hg) hg.style.display = 'grid';
    if (lbr) lbr.style.display = 'flex';
    if (hero) hero.style.display = 'block';
    if (vtR) vtR.classList.remove('active');
    if (vtH) vtH.classList.add('active');
  }

  // ── Restaurant + Middle Man: hide dashboard chrome not relevant to this vertical ──
  const isRestaurantMM = currentClient &&
    currentClient.vertical === 'restaurant' &&
    currentClient.middle_man_enabled === true;
  document.getElementById('refreshBtn')?.classList.toggle('hidden', !!isRestaurantMM);
  document.getElementById('periodNav')?.classList.toggle('hidden', !!isRestaurantMM);
  document.getElementById('toggleRow')?.classList.toggle('hidden', !!isRestaurantMM);
}

function refreshVerticalToggleVisibility() {
  const t = document.getElementById('verticalToggle');
  if (!t) return;
  if (isAdminToggleUser()) t.classList.add('visible');
  else t.classList.remove('visible');
}

// Mel-local start-of-today as UTC ISO. Offset is recomputed each call so AEST/AEDT
// transitions don't quietly drift the boundary.
function melbourneStartOfTodayUtcIso() {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const melHm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const utcHm = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const [mh, mm] = melHm.split(':').map(Number);
  const [uh, um] = utcHm.split(':').map(Number);
  let offsetMin = (mh * 60 + mm) - (uh * 60 + um);
  if (offsetMin < -720) offsetMin += 1440;
  if (offsetMin > 720)  offsetMin -= 1440;
  return new Date(Date.parse(ymd + 'T00:00:00Z') - offsetMin * 60000).toISOString();
}

// Most recent Monday 5pm Melbourne as UTC ISO. The "week" for $-recovered resets here.
// If today is Mon before 5pm, returns last Monday 5pm; otherwise this week's Monday 5pm.
// Offset is sampled for the target date, so a DST switch between now and target won't drift.
function melbourneMostRecentMonday5pmUtcIso() {
  const now = new Date();
  const np = {};
  const nowFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false, weekday: 'short'
  });
  for (const p of nowFmt.formatToParts(now)) {
    if (p.type !== 'literal') np[p.type] = p.value;
  }
  const dayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const dow = dayMap[np.weekday];
  const hourMel = parseInt(np.hour, 10);
  const daysBack = (dow === 1) ? (hourMel >= 17 ? 0 : 7) : (dow - 1);

  const baseUtc = Date.UTC(parseInt(np.year, 10), parseInt(np.month, 10) - 1, parseInt(np.day, 10));
  const tDate = new Date(baseUtc - daysBack * 86400000);
  const tYmd = tDate.getUTCFullYear() + '-' +
               String(tDate.getUTCMonth() + 1).padStart(2, '0') + '-' +
               String(tDate.getUTCDate()).padStart(2, '0');

  // Sample 12:00 UTC of target date; Mel sees 22:00 (AEST) or 23:00 (AEDT) — same calendar date.
  const sample = new Date(Date.parse(tYmd + 'T12:00:00Z'));
  const sampleMelHour = parseInt(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Australia/Melbourne', hour: '2-digit', hour12: false
  }).format(sample), 10);
  const offsetHours = sampleMelHour - 12;

  return new Date(Date.parse(tYmd + 'T17:00:00Z') - offsetHours * 3600000).toISOString();
}

async function loadRestaurantTileData(clientId, myRequestId) {
  const tonightStartIso = melbourneStartOfTodayUtcIso();

  let todaySmsRes;
  try {
    todaySmsRes = await sb.from('sms_events').select('received_at').eq('client_id', clientId).gte('received_at', tonightStartIso);
  } catch (e) {
    console.warn('restaurant tiles fetch failed', e);
    return;
  }
  if (myRequestId !== statsRequestId) return;

  const todayEvents = todaySmsRes.data || [];
  const peakEl = document.getElementById('rPeakWindowToday');
  if (peakEl) peakEl.textContent = computePeakWindowLabel(todayEvents);
}

// Bucket today's sms_events into 30-min Melbourne-local slots, return the
// peak slot as a human-friendly label. Examples:
//   0 events       → "No calls yet today"
//   1–2 events     → "12pm — 1 call"  (single time, count)
//   3+ events      → "6:30–7:30pm — 8 calls"  (range, count)
// Tie-break = earliest slot wins.
function computePeakWindowLabel(events) {
  if (!events || events.length === 0) return '—';

  const buckets = new Map();   // "HH:MM" → count
  const meta    = new Map();   // "HH:MM" → { h, m }  for label formatting
  for (const ev of events) {
    if (!ev || !ev.received_at) continue;
    const dt = new Date(ev.received_at);
    if (Number.isNaN(dt.getTime())) continue;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Australia/Melbourne',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(dt);
    const h = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const m = parseInt(parts.find(p => p.type === 'minute').value, 10);
    const bucketMin = m < 30 ? 0 : 30;
    const key = String(h).padStart(2, '0') + ':' + String(bucketMin).padStart(2, '0');
    buckets.set(key, (buckets.get(key) || 0) + 1);
    if (!meta.has(key)) meta.set(key, { h, m: bucketMin });
  }

  // Earliest bucket with peak count (strict > so the first one we hit wins ties).
  const sortedKeys = Array.from(buckets.keys()).sort();
  let peakKey = sortedKeys[0];
  let peakCount = buckets.get(peakKey);
  for (const k of sortedKeys) {
    const v = buckets.get(k);
    if (v > peakCount) { peakKey = k; peakCount = v; }
  }

  const { h, m } = meta.get(peakKey);
  const callWord = peakCount === 1 ? '1 call' : peakCount + ' calls';

  if (events.length <= 2) {
    return formatSingleTime(h, m) + ' — ' + callWord;
  }
  const endH = m === 30 ? (h + 1) % 24 : h;
  const endM = m === 30 ? 0 : 30;
  return formatTimeRange(h, m, endH, endM) + ' — ' + callWord;
}

function formatSingleTime(h, m) {
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12  = h % 12 === 0 ? 12 : h % 12;
  return h12 + (m === 0 ? '' : ':' + String(m).padStart(2, '0')) + ampm;
}

function formatTimeRange(h, m, endH, endM) {
  const startAmpm = h >= 12 ? 'pm' : 'am';
  const endAmpm   = endH >= 12 ? 'pm' : 'am';
  const h12       = h % 12 === 0 ? 12 : h % 12;
  const endH12    = endH % 12 === 0 ? 12 : endH % 12;
  const startStr  = h12 + (m === 0 ? '' : ':' + String(m).padStart(2, '0'));
  const endStr    = endH12 + (endM === 0 ? '' : ':' + String(endM).padStart(2, '0'));
  if (startAmpm === endAmpm) {
    return startStr + '–' + endStr + endAmpm;
  }
  return startStr + startAmpm + '–' + endStr + endAmpm;
}

function updateSmsCounter(count) {
  const row = document.getElementById('smsOdomRow');
  if (count > 999) {
    row.innerHTML = '<div class="sms-overflow">' + count.toLocaleString() + '</div>';
    return;
  }
  if (!document.getElementById('odom-2')) {
    row.innerHTML =
      '<div class="odometer">' +
      '<div class="odometer-cell" id="odom-2"><span class="old">0</span><span class="new">0</span></div>' +
      '<div class="odometer-sep"></div>' +
      '<div class="odometer-cell" id="odom-1"><span class="old">0</span><span class="new">0</span></div>' +
      '<div class="odometer-sep"></div>' +
      '<div class="odometer-cell" id="odom-0"><span class="old">0</span><span class="new">0</span></div>' +
      '</div>';
  }
  const str = String(count).padStart(3, '0');
  ['odom-2','odom-1','odom-0'].forEach((id, i) => {
    const cell = document.getElementById(id);
    if (!cell) return;
    const newDigit = str[i];
    const oldSpan = cell.querySelector('.old');
    const newSpan = cell.querySelector('.new');
    if (oldSpan && oldSpan.textContent !== newDigit) {
      newSpan.textContent = newDigit;
      cell.classList.add('rolling');
      setTimeout(() => { oldSpan.textContent = newDigit; cell.classList.remove('rolling'); }, 350);
    }
  });
}

function renderOverageDisplay(dollarStr) {
  const overageOdom = document.getElementById('overageOdom');
  const numericValue = parseFloat(dollarStr);
  if (numericValue > 99.99) {
    overageOdom.innerHTML = '<div class="overage-overflow">$' + dollarStr + '</div>';
    return;
  }
  if (!document.getElementById('ov-3')) {
    overageOdom.innerHTML =
      '<div class="odometer-prefix">$</div>' +
      '<div class="odometer-cell" id="ov-3"><span class="old">0</span><span class="new">0</span></div>' +
      '<div class="odometer-sep"></div>' +
      '<div class="odometer-cell" id="ov-2"><span class="old">0</span><span class="new">0</span></div>' +
      '<div class="odometer-sep"></div>' +
      '<div class="odometer-cell" id="ov-1"><span class="old">0</span><span class="new">0</span></div>' +
      '<div class="odometer-sep"></div>' +
      '<div class="odometer-cell" id="ov-0"><span class="old">0</span><span class="new">0</span></div>';
    overageOdom.className = 'odometer';
  }
  const cleaned = dollarStr.replace('.', '').padStart(4, '0');
  ['ov-3','ov-2','ov-1','ov-0'].forEach((id, i) => {
    const cell = document.getElementById(id);
    if (!cell) return;
    const newDigit = cleaned[i] || '0';
    const oldSpan = cell.querySelector('.old');
    const newSpan = cell.querySelector('.new');
    if (oldSpan && newSpan && oldSpan.textContent !== newDigit) {
      newSpan.textContent = newDigit;
      cell.classList.add('rolling');
      setTimeout(() => { oldSpan.textContent = newDigit; cell.classList.remove('rolling'); }, 350);
    }
  });
}

async function loadActivity(clientId, startIso, endIso, parentRequestId) {
  const card = document.getElementById('activityCard');
  let smsRes, clickRes, bookRes;
  try {
    [smsRes, clickRes, bookRes] = await Promise.all([
      sb.from('sms_events').select('customer_number,received_at').eq('client_id', clientId).gte('received_at', startIso).lte('received_at', endIso).order('received_at', { ascending: false }).limit(30),
      sb.from('link_clicks').select('customer_number,created_at').eq('client_id', clientId).gte('created_at', startIso).lte('created_at', endIso).order('created_at', { ascending: false }).limit(30),
      sb.from('bookings').select('id,booked_at,source').eq('client_id', clientId).gte('booked_at', startIso).lte('booked_at', endIso).order('booked_at', { ascending: false }).limit(30)
    ]);
  } catch (e) {
    console.error('activity load failed', e);
    return;
  }

  if (parentRequestId !== undefined && parentRequestId !== statsRequestId) return;

  const events = [];
  (smsRes.data || []).forEach(e => events.push({ type: 'sms', number: e.customer_number, time: new Date(e.received_at) }));
  (clickRes.data || []).forEach(e => events.push({ type: 'click', number: e.customer_number, time: new Date(e.created_at) }));
  (bookRes.data || []).forEach(e => events.push({ type: 'book', number: e.id, time: new Date(e.booked_at), source: e.source }));
  events.sort((a, b) => b.time - a.time);

  // Hide tap/click events entirely; hide entries where caller is unknown (null/empty phone)
  const visibleEvents = events.filter(e => e.type !== 'click' && (e.type === 'book' || !!e.number));

  if (visibleEvents.length === 0) { card.innerHTML = ''; return; }

  const latest = visibleEvents[0];
  const latestLabel = latest.type === 'sms' ? 'SMS sent to ' + maskNumber(latest.number) :
    latest.type === 'click' ? 'Link tapped by ' + maskNumber(latest.number) : 'Booking logged';
  const latestTime = latest.time.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) + ' · ' + latest.time.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

  let rows = '';
  visibleEvents.slice(0, 20).forEach(e => {
    const pill = e.type === 'sms' ? '<span class="status-pill">SMS</span>' :
      e.type === 'click' ? '<span class="status-pill pill-click">CLICK</span>' :
      '<span class="status-pill pill-book">BOOKED</span>';
    const label = e.type === 'book' ? (e.source === 'manual' ? 'Booking logged manually' : 'Booking confirmed') : maskNumber(e.number);
    const timeStr = e.time.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) + ' · ' + e.time.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    rows += '<div class="activity-row"><div><div class="activity-number">' + label + '</div><div class="activity-time">' + timeStr + '</div></div>' + pill + '</div>';
  });

  card.innerHTML =
    '<div class="activity-summary" onclick="toggleActivity()">' +
      '<div class="activity-summary-left">' +
        '<div class="dot"></div>' +
        '<div>' +
          '<div class="activity-summary-text">' + latestLabel + '</div>' +
          '<div class="activity-summary-sub">' + latestTime + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="expand-icon" id="expandIcon">▾</div>' +
    '</div>' +
    '<div class="activity-dropdown" id="activityDropdown">' + rows + '</div>';
}

function toggleActivity() {
  document.getElementById('activityDropdown')?.classList.toggle('open');
  document.getElementById('expandIcon')?.classList.toggle('open');
}

function maskNumber(num) {
  if (!num) return 'Unknown';
  const s = String(num).replace(/\D/g, '');
  if (s.length >= 6) return s.slice(0, 4) + ' ··· ' + s.slice(-3);
  return '***';
}

async function logBooking() {
  if (!currentClient) return;
  if (bookingInFlight) return;
  if (isAccountReadOnly()) {
    showLogBookingError('Account paused. Email hello@callmagnet.com.au');
    return;
  }

  bookingInFlight = true;
  const btn = document.getElementById('logBookingBtn');
  btn.disabled = true;

  const now = new Date().toISOString();
  try {
    const { error } = await sb.from('bookings').insert({
      client_id: currentClient.id,
      source: 'manual',
      booked_at: now
    });
    if (error) {
      console.error('booking insert error:', error);
      showLogBookingError('Failed — try again');
    } else {
      const confirm = document.getElementById('logBookingConfirm');
      confirm.style.display = 'flex';
      setTimeout(() => { confirm.style.display = 'none'; }, 2500);
      await loadStats();
    }
  } catch (e) {
    console.error('logBooking error:', e);
    showLogBookingError('Network error');
  } finally {
    setTimeout(() => {
      bookingInFlight = false;
      btn.disabled = false;
    }, 800);
  }
}

function showLogBookingError(text) {
  const el = document.getElementById('logBookingError');
  if (!el) return;
  el.textContent = '✗ ' + text;
  el.style.display = 'flex';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function showResetModal() { document.getElementById('resetModal').classList.add('open'); }
function closeResetModal() { document.getElementById('resetModal').classList.remove('open'); document.body.classList.remove('panel-open'); }

async function confirmReset() {
  if (!currentClient) return;
  if (isAccountReadOnly()) { closeResetModal(); return; }
  try {
    const { error } = await sb.rpc('reset_client_counter', { p_client_id: currentClient.id });
    if (error) { console.error('reset failed', error); closeResetModal(); return; }
    currentClient.reset_date = new Date().toISOString();
  } catch (e) { console.error('reset failed', e); }
  closeResetModal();
  await loadStats();
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

  document.getElementById('logBookingBtn').addEventListener('click', (e) => {
    e.preventDefault();
    logBooking();
  });

  // Login form: Enter on either field submits.
  const emailInputEl    = document.getElementById('emailInput');
  const passwordInputEl = document.getElementById('passwordInput');
  if (emailInputEl)    emailInputEl.addEventListener('keydown',    e => { if (e.key === 'Enter') handleAuth(); });
  if (passwordInputEl) passwordInputEl.addEventListener('keydown', e => { if (e.key === 'Enter') handleAuth(); });

  // Recovery-screen: Enter submits.
  const recoveryPass    = document.getElementById('recoveryPassInput');
  const recoveryConfirm = document.getElementById('recoveryPassConfirm');
  if (recoveryPass)    recoveryPass.addEventListener('keydown',    e => { if (e.key === 'Enter') handleRecovery(); });
  if (recoveryConfirm) recoveryConfirm.addEventListener('keydown', e => { if (e.key === 'Enter') handleRecovery(); });

  const { data: { session } } = await sb.auth.getSession();
  _isAdminCached = (session?.user?.app_metadata && session.user.app_metadata.is_admin === true);
  _adminUserEmail = session?.user?.email ?? '';
  refreshAdminFab();
  if (session?.user) {
    await crossFadeToDashboard(session.user, document.getElementById('loginScreen'));
  }

  sb.auth.onAuthStateChange((event, newSession) => {
    _isAdminCached = (newSession?.user?.app_metadata && newSession.user.app_metadata.is_admin === true);
    _adminUserEmail = newSession?.user?.email ?? '';
    refreshAdminFab();
    if (event === 'PASSWORD_RECOVERY') {
      showRecovery();
    }
  });

  // Register service worker for offline support and instant reopens
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('/progressier.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  }
});

let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  maybeShowInstallBanner();
});

function isIOSSafari() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isStandalone = window.navigator.standalone === true;
  return isIOS && !isStandalone;
}

function isAlreadyInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// Mobile-only gate. Install-as-PWA UX is only useful on phones/tablets where
// the app icon lives on a home screen. Desktop "install" via Chrome creates
// an installed app in OS dock but offers no value over a browser tab here.
// Belt-and-braces: UA sniff first, fall back to viewport width for dev-tools
// mobile-emulation mode.
function isMobileDevice() {
  const ua = navigator.userAgent || '';
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return true;
  return window.matchMedia('(max-width: 768px)').matches;
}

function maybeShowInstallBanner() {
  if (!isMobileDevice()) return;
  if (isAlreadyInstalled()) return;
  if (localStorage.getItem('callmagnet-install-dismissed') === '1') return;
  if (!currentClient) return;

  const banner = document.getElementById('installPromptBanner');
  if (!banner) return;

  if (deferredInstallPrompt) {
    banner.classList.remove('ios-mode');
    document.querySelector('.install-banner-text').textContent = 'Install CallMagnet on your home screen for instant access.';
    banner.style.display = 'flex';
  } else if (isIOSSafari()) {
    banner.classList.add('ios-mode');
    document.querySelector('.install-banner-text').textContent = 'Tap Share → Add to Home Screen to install CallMagnet.';
    banner.style.display = 'flex';
  }
}

async function handleInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  if (outcome === 'accepted') {
    document.getElementById('installPromptBanner').style.display = 'none';
  }
}

function dismissInstall() {
  localStorage.setItem('callmagnet-install-dismissed', '1');
  document.getElementById('installPromptBanner').style.display = 'none';
}

// ── Admin Tools Panel ──────────────────────────────────────────────────────

function openAdminPanel() {
  document.getElementById('adminPanel').classList.add('open');
  document.getElementById('adminPanelOverlay').classList.add('open');
  document.body.classList.add('panel-open');
}

function closeAdminPanel() {
  document.getElementById('adminPanel').classList.remove('open');
  document.getElementById('adminPanelOverlay').classList.remove('open');
  document.body.classList.remove('panel-open');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeToolPanel(); closeAdminPanel(); closeMmPanel(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLE MAN — Customer requests tiles + slide-out panel
// Only rendered when: client.vertical === 'restaurant' AND middle_man_enabled
// ═══════════════════════════════════════════════════════════════════════════

const MM_NEON     = ['#00D4FF','#FF6B00','#39FF14','#FF10F0','#FFE600','#BF00FF'];
const MM_NEON_RGB = ['0,212,255','255,107,0','57,255,20','255,16,240','255,230,0','191,0,255'];

// ── Tile flicker prevention ────────────────────────────────────────────────
// mmLastCounts stores the most recently confirmed count per formType so that
// re-renders during auto-refresh show the last known count (not "0") while
// the new fetch is in flight. mmDataLoaded gates the initial loading skeleton.
let mmLastCounts  = {}; // { formType: count }
let mmDataLoaded  = false;

function mmHexRgba(hex, a) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// Same classification logic as b.html — change/cancel before book so "cancel my booking" → change_cancel
function mmClassifyLabel(label) {
  const l = label.toLowerCase().trim();
  if (l.includes('change') || l.includes('cancel') || l.includes('reschedule')) return 'change_cancel';
  if (l.includes('book'))                                                         return 'booking';
  if (l.includes('function') || l.includes('event') || l.includes('private'))    return 'function';
  if (l.includes('late') || l.includes('arrival'))                               return 'late_arrival';
  if (l.includes('lost') || l.includes('found'))                                 return 'lost_found';
  return 'something_else';
}

function mmLabelEmoji(label) {
  const l = label.toLowerCase();
  if (l.includes('change') || l.includes('alter') || l.includes('cancel')) return '✏️';
  if (l.includes('book'))                                                   return '🍽️';
  if (l.includes('function') || l.includes('event'))                       return '🎁';
  if (l.includes('lost') || l.includes('found'))                           return '❓';
  if (l.includes('late') || l.includes('running'))                         return '🏃';
  return '📣';
}

// Show last 4 digits only, prefixed with bullets
function mmMaskPhone(phone) {
  if (!phone) return '—';
  const d = String(phone).replace(/\D/g, '');
  if (d.length >= 4) return '••••••' + d.slice(-4);
  return '•••' + d;
}

// Tap-to-reveal phone widget. Returns HTML for a masked number that reveals
// the full number (as a tel: link) on tap. Pass event so propagation to the
// card accordion toggle is stopped.
function buildPhoneReveal(fullPhone) {
  if (!fullPhone) return '—';
  const masked = mmMaskPhone(fullPhone);
  const safe = String(fullPhone).replace(/[^\d+]/g, '');
  return '<span class="phone-masked" data-phone="' + safe + '" data-masked="' + masked + '" onclick="togglePhoneReveal(this, event)">' +
         '<span class="phone-display">' + masked + '</span>' +
         '</span>';
}

window.togglePhoneReveal = function(el, event) {
  if (event) event.stopPropagation();
  const display = el.querySelector('.phone-display');
  const isRevealed = el.classList.contains('revealed');
  if (isRevealed) {
    display.textContent = el.dataset.masked;
    el.classList.remove('revealed');
    // Remove the inner tel: anchor if present
    const a = display.querySelector('a');
    if (a) display.textContent = el.dataset.masked;
  } else {
    const phone = el.dataset.phone;
    display.innerHTML = '<a href="tel:' + phone + '" onclick="event.stopPropagation()">' + phone + '</a>';
    el.classList.add('revealed');
  }
};

// "Sat 24 May, 7:43pm" format
function mmFormatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
    + ', '
    + d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ── Render the Customer requests tiles section ─────────────────────────────
async function loadMiddleManSection() {
  if (!currentClient) return;
  if (getDashboardMode() !== 'restaurant') return;
  if (!currentClient.middle_man_enabled) return;

  const sectionEl = document.getElementById('mmSection');
  if (!sectionEl) return;

  // Parse buttons JSON (may be array or string from Supabase)
  let buttons = [];
  try {
    buttons = Array.isArray(currentClient.middle_man_buttons)
      ? currentClient.middle_man_buttons
      : JSON.parse(currentClient.middle_man_buttons || '[]');
  } catch (_) { buttons = []; }

  const enabledBtns = buttons
    .filter(b => b && b.enabled !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .slice(0, 6);

  if (enabledBtns.length === 0) {
    sectionEl.classList.remove('visible');
    return;
  }

  // ── PHASE 1: Always render tiles immediately with 0 counts ──────────────
  // Zero is valid — '0 requests' means the feature is live and waiting.
  // Never hide a tile or the section because there is no data yet.
  sectionEl.classList.add('visible');

  const grid = document.getElementById('mmGrid');
  if (!grid) return;
  grid.innerHTML = '';

  // Build tile DOM and keep references to count els for phase-2 update
  const tileCountEls = [];
  enabledBtns.forEach((btn, idx) => {
    const rawLabel  = (btn.label || '').trim();
    const formType  = mmClassifyLabel(rawLabel);
    const emoji     = mmLabelEmoji(rawLabel);
    const display   = emoji + ' ' + rawLabel;
    const neonColor = MM_NEON[Math.min(idx, MM_NEON.length - 1)];
    const neonRgb   = MM_NEON_RGB[Math.min(idx, MM_NEON_RGB.length - 1)];

    const tile = document.createElement('div');
    tile.className = 'mm-tile';
    tile.style.setProperty('--mm-neon', neonColor);
    tile.style.setProperty('--mm-neon-rgb', neonRgb);
    tile.style.borderColor = neonColor;

    const countEl = document.createElement('div');
    countEl.className = 'mm-tile-count';
    if (mmDataLoaded && formType in mmLastCounts) {
      // Show last confirmed count — no flicker on re-render
      countEl.textContent = mmLastCounts[formType];
    } else {
      // First ever render — show pulsing dash as loading skeleton
      countEl.innerHTML = '<span style="animation:pulse 1.4s ease-in-out infinite;display:inline-block;opacity:0.4;font-size:28px">—</span>';
    }

    const todayName = new Date().toLocaleDateString('en-AU', { weekday: 'long' });

    tile.insertAdjacentHTML('beforeend', '<div class="mm-tile-label">' + display + '</div>');
    tile.appendChild(countEl);
    tile.insertAdjacentHTML('beforeend', '<div class="mm-tile-sub">' + todayName + '</div>');

    tile.addEventListener('click', () => openMmPanel(rawLabel, display, formType, neonColor));
    grid.appendChild(tile);
    tileCountEls.push({ countEl, formType, rawLabel });
  });

  // ── PHASE 2: Fetch counts in background, update tiles when ready ──────────
  const monthStartIso = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  let submissions = [], clicks = [];
  try {
    const [submissionsRes, clicksRes] = await Promise.all([
      sb.from('middle_man_form_submissions')
        .select('form_type')
        .eq('client_id', currentClient.id)
        .gte('submitted_at', monthStartIso),
      sb.from('link_clicks')
        .select('intent')
        .eq('client_id', currentClient.id)
        .not('intent', 'is', null)
        .gte('clicked_at', monthStartIso)
    ]);
    submissions = submissionsRes.data || [];
    clicks      = clicksRes.data      || [];
  } catch (e) {
    // Fetch failed — restore last known counts so tiles don't flicker to 0
    console.warn('MM section count fetch failed (keeping last known counts):', e);
    tileCountEls.forEach(({ countEl, formType }) => {
      if (formType in mmLastCounts) {
        countEl.textContent = mmLastCounts[formType];
      }
    });
    return;
  }

  const totalMmClicks    = clicks.length;
  const submissionCounts = {};
  submissions.forEach(s => {
    submissionCounts[s.form_type] = (submissionCounts[s.form_type] || 0) + 1;
  });
  const bookingBtnCount = enabledBtns.filter(b => mmClassifyLabel(b.label) === 'booking').length;

  tileCountEls.forEach(({ countEl, formType, rawLabel }) => {
    let count = 0;
    if (formType === 'booking') {
      count = bookingBtnCount === 1
        ? totalMmClicks
        : clicks.filter(c => c.intent && c.intent.toLowerCase().includes(rawLabel.toLowerCase())).length;
    } else {
      count = submissionCounts[formType] || 0;
    }
    // Persist confirmed count before updating DOM
    mmLastCounts[formType] = count;
    countEl.textContent = count;
  });
  mmDataLoaded = true;
}

// ── Open slide-out panel for a tile ──────────────────────────────────────
async function openMmPanel(rawLabel, displayLabel, formType, neonColor) {
  const overlay = document.getElementById('mmPanelOverlay');
  const panel   = document.getElementById('mmPanel');
  const titleEl = document.getElementById('mmPanelTitle');
  const subEl   = document.getElementById('mmPanelSub');
  const bodyEl  = document.getElementById('mmPanelBody');
  if (!overlay || !panel || !currentClient) return;

  // Apply neon theme to panel border + shadow
  panel.style.borderLeftColor = neonColor;
  panel.style.boxShadow = '-4px 0 24px ' + mmHexRgba(neonColor, 0.25);

  titleEl.textContent = displayLabel;
  subEl.textContent   = 'Loading…';
  bodyEl.innerHTML    = '<div class="mm-empty">Loading…</div>';

  overlay.classList.add('open');
  panel.classList.add('open');
  document.body.classList.add('panel-open');

  const monthStartIso = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  let records = [];
  try {
    if (formType === 'booking') {
      const { data } = await sb.from('link_clicks')
        .select('intent, clicked_at, customer_number')
        .eq('client_id', currentClient.id)
        .not('intent', 'is', null)
        .gte('clicked_at', monthStartIso)
        .order('clicked_at', { ascending: false })
        .limit(50);
      records = data || [];
    } else {
      const { data } = await sb.from('middle_man_form_submissions')
        .select('*')
        .eq('client_id', currentClient.id)
        .eq('form_type', formType)
        .gte('submitted_at', monthStartIso)
        .order('submitted_at', { ascending: false })
        .limit(50);
      records = data || [];
    }
  } catch (e) {
    console.warn('MM panel fetch failed', e);
  }

  const count = records.length;
  const word  = formType === 'booking' ? 'tap' : 'request';
  const dayName = new Date().toLocaleDateString('en-AU', { weekday: 'long' });
  subEl.textContent = count + ' ' + word + (count !== 1 ? 's' : '') + ' this ' + dayName;

  if (records.length === 0) {
    bodyEl.innerHTML = '<div class="mm-empty">★ No requests yet</div>';
    return;
  }

  bodyEl.innerHTML = records.map(r => buildMmCard(r, formType, neonColor)).join('');

  // ── Wire up accordion toggles ─────────────────────────────────────────────
  // Reset previously open card so the new panel starts fully collapsed.
  _mmOpenCard = null;
  bodyEl.querySelectorAll('[data-mm-expandable]').forEach(cardEl => {
    const toggleEl = cardEl.querySelector('[data-mm-toggle]');
    if (!toggleEl) return;
    // Tapping anywhere on the card toggles expand/collapse
    cardEl.addEventListener('click', (e) => {
      toggleMmCard(cardEl, toggleEl);
    });
  });
}

// ── Build a single submission card ────────────────────────────────────────
// Structure:
//   Primary  (always visible): title, name, phone
//   + note preview if note > 60 chars (class mm-card-note-preview, hidden when expanded)
//   Secondary (.mm-card-extra, max-height transition): submitted time + all extra fields
//   Toggle (▼ Show more / ▲ Less): appears on all form-submission cards
function buildMmCard(record, formType, neonColor) {
  const bdr = mmHexRgba(neonColor, 0.3);
  const shd = mmHexRgba(neonColor, 0.1);
  const cs  = `border-color:${bdr};box-shadow:0 0 8px ${shd}`;

  // Booking taps — flat card (only 2 fields, no expand needed)
  if (formType === 'booking') {
    return '<div class="mm-card" style="' + cs + '">' +
      '<div class="mm-card-title">🍽️ Booking tap</div>' +
      mmRow('Tapped at', mmFormatTime(record.clicked_at)) +
      (record.customer_number ? mmRow('Phone', buildPhoneReveal(record.customer_number)) : '') +
      '</div>';
  }

  const titles = {
    change_cancel:  '✏️ Change / Cancel request',
    'function':     '🎁 Function enquiry',
    late_arrival:   '🏃 Running late',
    lost_found:     '❓ Lost & found',
    something_else: '📣 Enquiry',
  };

  const noteText = record.note || '';
  const hasLongNote = noteText.length > 60;

  // ── Primary rows (always visible): name + phone ──────────────────────────
  const primaryRows = mmRow('Name',  record.caller_name || '—')
                    + mmRow('Phone', buildPhoneReveal(record.caller_phone));

  // ── Truncated note preview (shown when collapsed, hidden when expanded) ───
  let notePreviewRow = '';
  if (hasLongNote) {
    const noteKey = formType === 'late_arrival' ? 'How late'    :
                    formType === 'lost_found'   ? 'Description' :
                    formType === 'function'     ? 'Details'     :
                    formType === 'change_cancel'? 'Note'        : 'Message';
    const preview = _escMgr(noteText.slice(0, 60).trimEnd()) + '…';
    notePreviewRow =
      '<div class="mm-card-row mm-card-note-preview">' +
        '<span class="mm-card-key">' + noteKey + '</span>' +
        '<span class="mm-card-val" style="color:rgba(255,255,255,0.5)">' + preview + '</span>' +
      '</div>';
  }

  // ── Secondary rows (inside .mm-card-extra, expand on tap) ────────────────
  let secondaryRows = mmRow('Submitted', mmFormatTime(record.submitted_at));

  if (formType === 'change_cancel') {
    if (record.original_booking_time) secondaryRows += mmRow('Original booking', record.original_booking_time);
    if (record.requested_change)      secondaryRows += mmRow('Request',          record.requested_change);
    if (noteText)                     secondaryRows += mmRow('Note',             noteText);
  } else if (formType === 'function') {
    if (record.original_booking_time) secondaryRows += mmRow('Date of function', record.original_booking_time);
    if (noteText)                     secondaryRows += mmRow('Details',          noteText);
  } else if (formType === 'late_arrival') {
    if (record.original_booking_time) secondaryRows += mmRow('Booking time', record.original_booking_time);
    if (noteText)                     secondaryRows += mmRow('How late',     noteText);
  } else if (formType === 'lost_found') {
    if (record.original_booking_time) secondaryRows += mmRow('When visited', record.original_booking_time);
    if (noteText)                     secondaryRows += mmRow('Description',  noteText);
  } else {
    if (noteText)                     secondaryRows += mmRow('Message', noteText);
  }

  return '<div class="mm-card" style="' + cs + '" data-mm-expandable>' +
    '<div class="mm-card-title">' + (titles[formType] || '📣 Enquiry') + '</div>' +
    primaryRows +
    notePreviewRow +
    '<div class="mm-card-extra">' + secondaryRows + '</div>' +
    '<div class="mm-card-toggle" data-mm-toggle>▼ Show more</div>' +
    '</div>';
}

function mmRow(key, val) {
  return '<div class="mm-card-row">' +
    '<span class="mm-card-key">' + key + '</span>' +
    '<span class="mm-card-val">' + (val || '—') + '</span>' +
    '</div>';
}

function closeMmPanel() {
  const overlay = document.getElementById('mmPanelOverlay');
  const panel   = document.getElementById('mmPanel');
  if (overlay) overlay.classList.remove('open');
  if (panel)   panel.classList.remove('open');
  document.body.classList.remove('panel-open');
  _mmOpenCard = null; // reset accordion state on close
}

// ── Card accordion ─────────────────────────────────────────────────────────
let _mmOpenCard = null;

function toggleMmCard(cardEl, toggleEl) {
  // Collapse previously open card (only one open at a time)
  if (_mmOpenCard && _mmOpenCard !== cardEl) {
    _mmOpenCard.classList.remove('mm-card-open');
    const prevToggle = _mmOpenCard.querySelector('.mm-card-toggle');
    if (prevToggle) prevToggle.textContent = '▼ Show more';
  }
  const isOpen = cardEl.classList.toggle('mm-card-open');
  toggleEl.textContent = isOpen ? '▲ Less' : '▼ Show more';
  _mmOpenCard = isOpen ? cardEl : null;
}

async function sendTestNotification() {
  const btn = document.getElementById('testNotifBtn');
  if (!btn || btn.disabled) return;
  const orig = btn.textContent;
  btn.textContent = 'Sending…';
  btn.disabled = true;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { btn.textContent = 'Not signed in'; setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2500); return; }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-test-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ client_id: currentClient?.id ?? null }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      btn.textContent = '✓ Sent!';
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2500);
    } else {
      btn.textContent = `Failed: ${data.error ?? res.status}`;
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
    }
  } catch (e) {
    btn.textContent = 'Error — check console';
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL PANELS — admin slide-out panels for each tool
// ═══════════════════════════════════════════════════════════════════════════

let _activeToolPanelId = null;

function openToolPanel(panelId, iframeId, iframeSrc) {
  // Close any existing tool panel first, close FAB admin panel
  closeAdminPanel();
  if (_activeToolPanelId && _activeToolPanelId !== panelId) {
    const prev = document.getElementById(_activeToolPanelId);
    if (prev) prev.classList.remove('open');
  }
  const overlay = document.getElementById('toolPanelOverlay');
  const panel   = document.getElementById(panelId);
  if (!overlay || !panel) return;

  // Lazy-load iframe src on first open
  if (iframeId && iframeSrc) {
    const frame = document.getElementById(iframeId);
    if (frame && !frame.src.endsWith(iframeSrc.split('?')[0]) && frame.src !== location.origin + iframeSrc) {
      frame.src = iframeSrc;
    }
  }

  _activeToolPanelId = panelId;
  overlay.classList.add('open');
  panel.classList.add('open');
  document.body.classList.add('panel-open');
}

function closeToolPanel() {
  const overlay = document.getElementById('toolPanelOverlay');
  if (overlay) overlay.classList.remove('open');
  if (_activeToolPanelId) {
    const panel = document.getElementById(_activeToolPanelId);
    if (panel) panel.classList.remove('open');
    _activeToolPanelId = null;
  }
  document.body.classList.remove('panel-open');
}

function openOnboardPanel() {
  openToolPanel('toolOnboardPanel', 'toolOnboardFrame', '/admin/onboard.html');
}
function openClientsPanel() {
  openToolPanel('toolClientsPanel', 'toolClientsFrame', '/admin/clients.html');
}
function openCancelPanel() {
  openToolPanel('toolCancelPanel', 'toolCancelFrame', '/cancel.html');
}
// ─── Middle Man Manager — _escMgr kept for buildMmCard (customer requests viewer) ──

function _escMgr(s) {
  return String(s || '').replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

