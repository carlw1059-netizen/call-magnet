(function () {
  'use strict';

  var SUPABASE_URL  = '%%SUPABASE_URL%%';
  var SUPABASE_ANON = '%%SUPABASE_ANON_KEY%%';
  var FORM_FUNC_URL = SUPABASE_URL + '/functions/v1/submit-middle-man-form';
  var LOG_FUNC_URL  = SUPABASE_URL + '/functions/v1/log-middle-man-tap';
  var CLICK_LOG_URL = SUPABASE_URL + '/functions/v1/log-click';

  // ── Neon colour palette — position 1-6 (index 0-5) ───────────────────────
  var NEON = ['#00D4FF','#FF0000','#39FF14','#FF10F0','#FFE600','#BF00FF'];

  // ── Globals ───────────────────────────────────────────────────────────────
  var gSlug        = '';
  var gOpenFormKey = null;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function extractSlug() {
    var parts = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/');
    var isCallMagnet = window.location.hostname.indexOf('callmagnet.com.au') !== -1;
    if (isCallMagnet) {
      return (parts.length >= 2 && parts[0] === 'b') ? (parts[1] || '') : '';
    }
    return parts[0] || '';
  }

  function showMain() {
    document.getElementById('skeleton').style.display      = 'none';
    document.getElementById('stateNotFound').style.display = 'none';
    document.getElementById('mainPage').classList.add('visible');
  }
  function logClick(slug) {
    try {
      fetch(CLICK_LOG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: slug,
          user_agent: navigator.userAgent || '',
          referrer: document.referrer || ''
        })
      });
    } catch (e) {}
  }

  function showNotFound() {
    document.getElementById('skeleton').style.display      = 'none';
    document.getElementById('mainPage').classList.remove('visible');
    document.getElementById('stateNotFound').style.display = 'flex';
  }

  // ── Apply neon style to a button element by position index (0-based) ─────
  // color: optional per-button hex stored in button data; falls back to NEON[idx].
  function applyNeon(el, idx, color) {
    var c = color || NEON[Math.min(idx, NEON.length - 1)];
    var unit = el.closest('.btn-unit') || el.parentElement;
    unit.style.setProperty('--neon', c);
    el._neonColor = c;
    var unit = el.closest('.btn-unit');
    if (unit) {
      unit.style.setProperty('--neon', c);
      unit.dataset.neon = c;
    }
  }

  // ── Sparkles effect — slow ambient floating dust particles ───────────────
  // Particles start within the button zone, drift upward and fade out.
  // Colour exactly matches btn.color. Interval cleared when unit leaves DOM.
  function applySparkles(unit, color) {
    // Two particles immediately, two more staggered — then two every 700ms
    emitSparkle(unit, color);
    emitSparkle(unit, color);
    setTimeout(function() {
      if (!document.body.contains(unit)) return;
      emitSparkle(unit, color);
      emitSparkle(unit, color);
    }, 350);
    var iv = setInterval(function() {
      if (!document.body.contains(unit)) { clearInterval(iv); return; }
      emitSparkle(unit, color);
      emitSparkle(unit, color);
    }, 700);
    unit._sparkleInterval = iv;
  }

  function emitSparkle(unit, color) {
    var btnEl = unit.querySelector('.tap-btn');
    var btnH  = btnEl ? (btnEl.offsetHeight || 52) : 52;
    var unitW = unit.offsetWidth  || 300;
    var p     = document.createElement('div');
    p.className = 'btn-sparkle';
    var x     = 12 + Math.random() * Math.max(unitW - 24, 1);
    var y     =  4 + Math.random() * Math.max(btnH  * 0.85, 1);
    var drift = (Math.random() * 18 - 9).toFixed(1);
    var dur   = (1.8 + Math.random() * 1.4).toFixed(2);
    var delay = (Math.random() * 0.35).toFixed(2);
    var size  = (2 + Math.random() * 2).toFixed(1);
    p.style.cssText =
      'left:' + x.toFixed(1) + 'px;' +
      'top:'  + y.toFixed(1) + 'px;' +
      'width:'  + size + 'px;height:' + size + 'px;' +
      '--sparkle-color:' + color + ';' +
      '--sparkle-drift:' + drift + 'px;' +
      'animation-duration:' + dur + 's;' +
      'animation-delay:'    + delay + 's;';
    unit.appendChild(p);
    var lifetime = Math.ceil((parseFloat(dur) + parseFloat(delay) + 0.1) * 1000);
    setTimeout(function() { if (p.parentNode) p.parentNode.removeChild(p); }, lifetime);
  }

  // ── Fetch client from Supabase REST (anon key) ────────────────────────────
  async function fetchClient(slug) {
    var url = SUPABASE_URL + '/rest/v1/clients'
      + '?middle_man_slug=eq.' + encodeURIComponent(slug)
      + '&account_status=eq.active'
      + '&select=business_name,middle_man_logo_url,middle_man_background_url,middle_man_background_type,middle_man_background_poster_url,middle_man_promo_text,'
      + 'middle_man_buttons,middle_man_show_whats_on,vertical,'
      + 'social_enabled,social_instagram,social_instagram_color,social_facebook,social_facebook_color,'
      + 'social_tiktok,social_tiktok_color,social_youtube,social_youtube_color,social_whatsapp,social_whatsapp_color,'
      + 'social_spotify,social_spotify_color,social_soundcloud,social_soundcloud_color'
      + '&limit=1';
    var res = await fetch(url, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON },
    });
    if (!res.ok) throw new Error('Lookup failed: ' + res.status);
    var rows = await res.json();
    return rows.length > 0 ? rows[0] : null;
  }

  // ── Classify label → form type ────────────────────────────────────────────
  function classifyLabel(label) {
    var l = label.toLowerCase().trim();
    // Change / cancel (check before "book" so "cancel my booking" → change_cancel)
    if (l.indexOf('change') !== -1 || l.indexOf('cancel') !== -1 || l.indexOf('reschedule') !== -1) return 'change_cancel';
    // Direct booking
    if (l.indexOf('book') !== -1) return 'booking';
    if (l.indexOf('make a booking') !== -1 || l.indexOf('new booking') !== -1) return 'booking';
    // Function enquiry
    if (l.indexOf('function') !== -1 || l.indexOf('event') !== -1 || l.indexOf('private') !== -1) return 'function';
    // Late arrival
    if (l.indexOf('late') !== -1 || l.indexOf('running late') !== -1 || l.indexOf('arrival') !== -1) return 'late_arrival';
    // Lost & found
    if (l.indexOf('lost') !== -1 || l.indexOf('found') !== -1 || l.indexOf('left something') !== -1) return 'lost_found';
    // Fallback
    return 'something_else';
  }

  // ── AU phone validation ───────────────────────────────────────────────────
  function isValidAuPhone(v) {
    return /^(\+614\d{8}|04\d{8}|4\d{8}|614\d{8}|0[2-9]\d{8})$/.test(v.replace(/\s+/g, ''));
  }

  // ── Escape HTML ───────────────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  // ── Check SVG ────────────────────────────────────────────────────────────
  var CHECK_SVG = '<svg class="success-icon" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">'
    + '<circle cx="26" cy="26" r="25" stroke="currentColor" stroke-width="2" opacity="0.3"/>'
    + '<path d="M15 26l8 8 14-14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
    + '</svg>';

  // ── Success messages ──────────────────────────────────────────────────────
  function successMsg(formType, businessName) {
    switch (formType) {
      case 'change_cancel':  return "We’ve sent your request through. You’ll receive a confirmation once your booking is updated.";
      case 'function':       return esc(businessName) + ' will be in touch about your function enquiry.';
      case 'late_arrival':   return "We’ve let them know you’re on your way.";
      case 'lost_found':     return "We’ll look into it and give you a call if we find it.";
      default:               return esc(businessName) + ' has received your message and will be in touch shortly.';
    }
  }

  // ── Build inline form HTML ────────────────────────────────────────────────
  function buildFormHtml(formType, businessName) {
    var nameField = ''
      + '<div class="field-wrap">'
      + '<label class="field-label">Your name</label>'
      + '<input class="field-input" type="text" data-field="name" placeholder="Your name" autocomplete="name">'
      + '<span class="field-error" data-err="name">Please enter your name.</span>'
      + '</div>';

    var phoneField = ''
      + '<div class="field-wrap">'
      + '<label class="field-label">Your phone</label>'
      + '<input class="field-input" type="tel" data-field="phone" placeholder="04XX XXX XXX" autocomplete="tel" inputmode="tel">'
      + '<span class="field-error" data-err="phone">Please enter a valid Australian phone number.</span>'
      + '</div>';

    var noteFieldOpt = ''
      + '<div class="field-wrap">'
      + '<label class="field-label">Note <span class="opt">(optional)</span></label>'
      + '<textarea class="field-textarea" data-field="note" placeholder="Anything else we should know?" maxlength="500"></textarea>'
      + '<div class="field-counter"><span data-counter="note">0</span>/500</div>'
      + '</div>';

    var inner = '';
    if (formType === 'change_cancel') {
      inner = nameField + phoneField
        + '<div class="field-wrap">'
        + '<label class="field-label">Original booking</label>'
        + '<input class="field-input" type="text" data-field="original_booking_time" placeholder="e.g. Friday 7pm, table for 4">'
        + '<span class="field-error" data-err="original_booking_time">Please enter your original booking details.</span>'
        + '</div>'
        + '<div class="field-wrap">'
        + '<label class="field-label">What do you need?</label>'
        + '<select class="field-select" data-field="requested_change_type">'
        + '<option value="">Select one…</option>'
        + '<option value="Change to a new time">Change to a new time</option>'
        + '<option value="Cancel my booking">Cancel my booking</option>'
        + '</select>'
        + '<span class="field-error" data-err="requested_change_type">Please select an option.</span>'
        + '</div>'
        + '<div class="field-wrap" id="newTimeWrap" style="display:none">'
        + '<label class="field-label">New time</label>'
        + '<input class="field-input" type="text" data-field="new_time" placeholder="e.g. Saturday 8pm">'
        + '</div>'
        + noteFieldOpt;
    } else if (formType === 'function') {
      inner = nameField
        + '<div class="field-wrap">'
        + '<label class="field-label">Company name <span class="opt">(optional)</span></label>'
        + '<input class="field-input" type="text" data-field="company_name" placeholder="e.g. Acme Pty Ltd" autocomplete="organization">'
        + '</div>'
        + phoneField
        + '<div class="field-wrap">'
        + '<label class="field-label">Date of function</label>'
        + '<input class="field-input" type="text" data-field="original_booking_time" placeholder="e.g. Saturday 14 June">'
        + '<span class="field-error" data-err="original_booking_time">Please enter the date.</span>'
        + '</div>'
        + '<div class="field-wrap">'
        + '<label class="field-label">Number of guests</label>'
        + '<input class="field-input" type="number" data-field="guests" placeholder="e.g. 30" min="1" max="500" inputmode="numeric">'
        + '<span class="field-error" data-err="guests">Please enter the number of guests.</span>'
        + '</div>'
        + noteFieldOpt;
    } else if (formType === 'late_arrival') {
      inner = nameField + phoneField
        + '<div class="field-wrap">'
        + '<label class="field-label">Your booking time</label>'
        + '<input class="field-input" type="text" data-field="original_booking_time" placeholder="e.g. 7:30pm table for 2">'
        + '<span class="field-error" data-err="original_booking_time">Please enter your booking time.</span>'
        + '</div>'
        + '<div class="field-wrap">'
        + '<label class="field-label">How late are you running?</label>'
        + '<input class="field-input" type="text" data-field="note" placeholder="e.g. about 15 minutes">'
        + '<span class="field-error" data-err="note">Please enter how late you\'ll be.</span>'
        + '</div>';
    } else if (formType === 'lost_found') {
      inner = nameField + phoneField
        + '<div class="field-wrap">'
        + '<label class="field-label">When were you here?</label>'
        + '<input class="field-input" type="text" data-field="original_booking_time" placeholder="e.g. last Friday night">'
        + '<span class="field-error" data-err="original_booking_time">Please enter when you were here.</span>'
        + '</div>'
        + '<div class="field-wrap">'
        + '<label class="field-label">What did you lose?</label>'
        + '<input class="field-input" type="text" data-field="lost_item" placeholder="e.g. black iPhone 15">'
        + '<span class="field-error" data-err="lost_item">Please describe what you lost.</span>'
        + '</div>'
        + noteFieldOpt;
    } else {
      // something_else
      inner = nameField + phoneField
        + '<div class="field-wrap">'
        + '<label class="field-label">Message</label>'
        + '<textarea class="field-textarea" data-field="note" placeholder="How can we help?" maxlength="500"></textarea>'
        + '<div class="field-counter"><span data-counter="note">0</span>/500</div>'
        + '<span class="field-error" data-err="note">Please enter a message.</span>'
        + '</div>';
    }

    var titles = {
      change_cancel:  'Change or cancel booking',
      'function':     'Function enquiry',
      late_arrival:   'Running late',
      lost_found:     'Lost & found',
      something_else: 'Send us a message',
    };
    var submitLabels = {
      change_cancel:  'Send request',
      'function':     'Send enquiry',
      late_arrival:   'Let them know',
      lost_found:     'Send report',
      something_else: 'Send message',
    };

    return '<div class="inline-form" data-form-type="' + formType + '">'
      + '<div class="form-title">' + esc(titles[formType] || 'Send us a message') + '</div>'
      + inner
      + '<button class="submit-btn" type="button" data-submit data-label="' + esc(submitLabels[formType] || 'Send') + '">' + esc(submitLabels[formType] || 'Send') + '</button>'
      + '<div class="privacy-notice" style="font-size:11px;color:rgba(255,255,255,0.55);text-align:center;margin:8px 0 0;padding:0 8px;line-height:1.4;">'
      + 'Your details are shared with ' + esc(businessName || 'this business') + ' only, to help them respond to your request. '
      + '<a href="https://callmagnet.com.au/legal.html" target="_blank" style="color:rgba(255,255,255,0.55);text-decoration:underline;">Privacy Policy</a>'
      + '</div>'
      + '</div>';
  }

  // ── Attach form event listeners ───────────────────────────────────────────
  // intentLabel: the display label of the button (with emoji) — logged on submit
  // bookingUrl:  redirect destination after successful submit (2 second delay)
  function attachFormListeners(formWrap, formType, businessName, intentLabel, bookingUrl) {
    var form = formWrap.querySelector('.inline-form');
    if (!form) return;

    // Close button (X) — collapses this form and hides overlay
    var closeBtn = formWrap.querySelector('.form-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeForm);

    // Character counter on textareas
    form.querySelectorAll('textarea[data-field]').forEach(function(ta) {
      var field = ta.getAttribute('data-field');
      var counterEl = form.querySelector('[data-counter="' + field + '"]');
      if (counterEl) {
        ta.addEventListener('input', function() { counterEl.textContent = ta.value.length; });
      }
    });

    // Change/cancel: show/hide new-time field
    var changeTypeSelect = form.querySelector('[data-field="requested_change_type"]');
    var newTimeWrap      = form.querySelector('#newTimeWrap');
    if (changeTypeSelect && newTimeWrap) {
      changeTypeSelect.addEventListener('change', function() {
        newTimeWrap.style.display = (changeTypeSelect.value === 'Change to a new time') ? 'block' : 'none';
      });
    }

    var submitBtn = form.querySelector('[data-submit]');
    if (!submitBtn) return;

    submitBtn.addEventListener('click', function() {
      if (submitBtn.disabled) return;

      // ── Validate ──────────────────────────────────────────────────────────
      var isValid = true;
      function getField(n) {
        var el = form.querySelector('[data-field="' + n + '"]');
        return el ? el.value.trim() : '';
      }
      function markErr(n, show) {
        var el    = form.querySelector('[data-field="' + n + '"]');
        var errEl = form.querySelector('[data-err="' + n + '"]');
        if (el)    el.classList.toggle('error', show);
        if (errEl) errEl.classList.toggle('visible', show);
        if (show) isValid = false;
      }

      var name  = getField('name');
      var phone = getField('phone');
      markErr('name',  !name);
      markErr('phone', !phone || !isValidAuPhone(phone));

      if (formType === 'change_cancel') {
        markErr('original_booking_time', !getField('original_booking_time'));
        markErr('requested_change_type', !getField('requested_change_type'));
      } else if (formType === 'function') {
        markErr('original_booking_time', !getField('original_booking_time'));
        markErr('guests', !getField('guests'));
      } else if (formType === 'late_arrival') {
        markErr('original_booking_time', !getField('original_booking_time'));
        markErr('note', !getField('note'));
      } else if (formType === 'lost_found') {
        markErr('original_booking_time', !getField('original_booking_time'));
        markErr('lost_item', !getField('lost_item'));
      } else {
        markErr('note', !getField('note'));
      }
      if (!isValid) return;

      // ── Build payload ──────────────────────────────────────────────────────
      var payload = {
        slug:         gSlug,
        form_type:    formType,
        caller_name:  name,
        caller_phone: phone,
      };
      var obt  = getField('original_booking_time');
      var note = getField('note');
      if (obt) payload.original_booking_time = obt;

      if (formType === 'change_cancel') {
        var rctVal  = getField('requested_change_type');
        var newTime = getField('new_time');
        payload.requested_change = (rctVal === 'Change to a new time' && newTime)
          ? 'Change to: ' + newTime
          : rctVal;
        if (note) payload.note = note;
      } else if (formType === 'function') {
        var guests      = getField('guests');
        var companyName = getField('company_name');
        var noteBase    = 'Guests: ' + guests + (note ? '. ' + note : '');
        payload.note    = companyName ? 'Company: ' + companyName + '\n' + noteBase : noteBase;
        if (companyName) payload.company_name = companyName; // used by edge fn for push notification
      } else if (formType === 'lost_found') {
        var lostItem = getField('lost_item');
        payload.note = 'Lost: ' + lostItem + (note ? '. ' + note : '');
      } else {
        if (note) payload.note = note;
      }

      // ── Submit form ────────────────────────────────────────────────────────
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';

      fetch(FORM_FUNC_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
        body: JSON.stringify(payload),
      })
      .then(function() { handleSuccess(formWrap, name, formType, businessName); })
      .catch(function() { handleSuccess(formWrap, name, formType, businessName); });
      // Always show success — never block the customer
    });
  }

  // ── Show success screen and stay on page ────────────────────────────────
  // Booking redirects are handled in handleTap() before any form opens.
  // All other form types (change_cancel, function, late_arrival, lost_found,
  // something_else) show success and stay put.
  function handleSuccess(formWrap, name, formType, businessName) {
    var formEl = formWrap.querySelector('.inline-form');
    if (formEl) formEl.style.display = 'none';

    var successEl = document.createElement('div');
    successEl.className = 'success-state visible';
    successEl.innerHTML = CHECK_SVG
      + '<div class="success-heading">Got it, ' + esc(name) + '</div>'
      + '<div class="success-msg">' + successMsg(formType, businessName) + '</div>';
    formWrap.appendChild(successEl);

    // Reset the Send button at 0.8s — ready while success is still showing
    setTimeout(function() {
      var btn = formWrap.querySelector('[data-submit]');
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.label || 'Send';
      }
    }, 800);

    // At 2s — close form, return to home, clean up
    setTimeout(function() {
      closeForm();
      var existingSuccess = formWrap.querySelector('.success-state');
      if (existingSuccess) existingSuccess.remove();
      var formAgain = formWrap.querySelector('.inline-form');
      if (formAgain) formAgain.style.display = '';
    }, 2000);
  }

  // ── Close the currently open inline form ─────────────────────────────────
  function closeForm() {
    // CSS handles all style resets via class removal — no inline style cleanup needed
    document.querySelectorAll('.btn-unit').forEach(function(unit) {
      unit.classList.remove('slide-up', 'slide-down', 'form-open');
    });
    // Collapse all open form-wraps
    document.querySelectorAll('.form-wrap.open').forEach(function(el) {
      el.classList.remove('open');
    });
    var mainPage = document.getElementById('mainPage');
    if (mainPage) mainPage.classList.remove('has-open-form');
    gOpenFormKey = null;
    // Return #app to fixed 100svh
    var appEl = document.getElementById('app');
    if (appEl) appEl.classList.remove('form-active');
    // Hide tap-outside catcher
    var tapCatcher = document.getElementById('tapCatcher');
    if (tapCatcher) tapCatcher.style.display = 'none';
  }

  // ── Handle button tap ─────────────────────────────────────────────────────
  function handleTap(btnEl, btnKey, formType, bookingUrl, intentLabel, intentId) {
    btnEl.classList.add('pressed');
    setTimeout(function() { btnEl.classList.remove('pressed'); }, 180);

    fetch(LOG_FUNC_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: gSlug, intent: intentId || intentLabel }),
    }).catch(function() {});

    // Navigate if a URL is set — formType does not matter.
    if (bookingUrl) {
      setTimeout(function() { window.location.href = bookingUrl; }, 220);
      return;
    }

    // Toggle form — NO log call here
    var formWrap = document.getElementById('form-' + btnKey);
    if (!formWrap) return;

    var isOpen = formWrap.classList.contains('open');

    // Close any other open form (also hides overlay)
    if (gOpenFormKey !== null && gOpenFormKey !== btnKey) {
      closeForm();
    }

    if (isOpen) {
      closeForm();
    } else {
      // Close any other open form first
      if (gOpenFormKey !== null) closeForm();

      formWrap.classList.add('open');
      gOpenFormKey = btnKey;

      var tappedUnit = btnEl.closest('.btn-unit');
      if (tappedUnit) tappedUnit.classList.add('form-open');

      // Show tap-outside catcher (z-index 5, below the form-open unit at z-index 10)
      var tapCatcher = document.getElementById('tapCatcher');
      if (tapCatcher) tapCatcher.style.display = 'block';
    }
  }

  // ── Render the page ───────────────────────────────────────────────────────
  function render(client, slug) {
    gSlug = slug;

    // Video files are not cache-busted — the DB record changes when a new file
    // is uploaded (different filename or re-upload), and the ?v= timestamp was
    // causing the browser to download the file twice (preload used bare URL,
    // <source> used URL+timestamp — two different cache keys → double download
    // → GPU compositor never received a clean first frame → poster stuck).
    // Image backgrounds keep ?v= because admins overwrite the same path.
    var bgUrl       = client.middle_man_background_url || null;
    var bgType      = client.middle_man_background_type || 'image';
    if (bgUrl && bgType === 'image') bgUrl = bgUrl + '?v=' + Date.now();
    var businessName = client.business_name || '';
    var promoText   = client.middle_man_promo_text || '';
    var buttons     = [];

    var showWhatsOn = client.middle_man_show_whats_on === true;

    try {
      buttons = Array.isArray(client.middle_man_buttons)
        ? client.middle_man_buttons
        : JSON.parse(client.middle_man_buttons || '[]');
    } catch (_) { buttons = []; }

    // ── Full-screen background ────────────────────────────────────────────
    // #bgFixed is position:fixed z-index:0 — always covers the full screen.
    // Image bgUrl has ?v= cache-bust; video bgUrl is bare (videos are content-addressed).
    var bgFixed = document.getElementById('bgFixed');
    bgFixed.style.backgroundImage = 'none';
    bgFixed.style.backgroundColor = '#0E1419';

    if (bgUrl && bgType === 'video') {
      // ── Video background (iOS Safari requires all 6 attributes) ──────────
      console.log('[video] type=video detected | src (no cache-bust):', bgUrl);
      var vid = document.createElement('video');
      vid.setAttribute('autoplay', '');
      vid.setAttribute('muted', '');
      vid.setAttribute('playsinline', '');
      vid.setAttribute('webkit-playsinline', '');
      vid.setAttribute('loop', '');
      vid.setAttribute('preload', 'auto');
      vid.muted      = true;   // belt-and-suspenders: iOS ignores attr alone
      vid.playsInline = true;  // belt-and-suspenders
      // poster: shows the first frame while the video buffers — zero blank screen.
      // 1×1 black pixel GIF as ultimate fallback so the browser never shows white.
      var posterUrl = client.middle_man_background_poster_url ||
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      vid.setAttribute('poster', posterUrl);
      console.log('[video] poster attr:', client.middle_man_background_poster_url ? posterUrl : '(1×1 gif fallback)');
      var isMuxHls = bgUrl.includes('.m3u8');
      var vsrc = document.createElement('source');
      vsrc.src  = bgUrl;
      vsrc.type = isMuxHls ? 'application/x-mpegURL' : 'video/mp4';
      vid.appendChild(vsrc);

      // For non-Safari browsers load HLS.js to handle .m3u8 streams
      if (isMuxHls) {
        var hlsScript = document.createElement('script');
        hlsScript.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js';
        hlsScript.onload = function() {
          if (window.Hls && window.Hls.isSupported()) {
            var hls = new window.Hls();
            hls.loadSource(bgUrl);
            hls.attachMedia(vid);
            hls.on(window.Hls.Events.MANIFEST_PARSED, function() {
              vid.play().catch(function(err) {
                console.warn('[video] HLS play() blocked:', err.name);
                if (posterUrl && posterUrl.indexOf('data:image') === -1) {
                  bgFixed.style.backgroundImage = 'url(' + posterUrl + ')';
                  bgFixed.style.backgroundSize = 'cover';
                  bgFixed.style.backgroundPosition = 'center';
                } else {
                  bgFixed.style.backgroundColor = '#0E1419';
                }
              });
            });
          }
        };
        document.head.appendChild(hlsScript);
      }

      // ── Diagnostic event listeners (wired BEFORE load/play) ─────────────
      vid.addEventListener('loadedmetadata', function() {
        console.log('[video] loadedmetadata — dimensions:', vid.videoWidth, 'x', vid.videoHeight, '| readyState:', vid.readyState);
      });
      vid.addEventListener('canplay', function() {
        console.log('[video] canplay — browser can start playing');
      });
      vid.addEventListener('playing', function() {
        console.log('[video] playing — video is actively rendering frames');
      });
      vid.addEventListener('stalled', function() {
        console.log('[video] stalled — browser stopped fetching media data');
      });
      vid.addEventListener('suspend', function() {
        console.log('[video] suspend — browser suspended fetching (may be intentional)');
      });
      vid.addEventListener('error', function() {
        var code = vid.error ? vid.error.code : '?';
        var msg  = vid.error ? vid.error.message : 'unknown';
        console.log('[video] ERROR event — code:', code, '| message:', msg);
        if (posterUrl && posterUrl.indexOf('data:image') === -1) {
          bgFixed.style.backgroundImage = 'url(' + posterUrl + ')';
          bgFixed.style.backgroundSize = 'cover';
          bgFixed.style.backgroundPosition = 'center';
        } else {
          bgFixed.style.backgroundColor = '#0E1419';
        }
      });

      vid.addEventListener('canplay', function() {
        vid.play().catch(function(err) {
          console.warn('[video] play() blocked after canplay:', err.name);
          if (posterUrl && posterUrl.indexOf('data:image') === -1) {
            bgFixed.style.backgroundImage = 'url(' + posterUrl + ')';
            bgFixed.style.backgroundSize = 'cover';
            bgFixed.style.backgroundPosition = 'center';
          } else {
            bgFixed.style.backgroundColor = '#0E1419';
          }
        });
      }, { once: true });
      bgFixed.appendChild(vid);
      vid.load();
      bgFixed.classList.add('loaded');
      document.getElementById('contentSpacer').classList.add('expanded');

    } else if (bgUrl) {
      // ── Image background ─────────────────────────────────────────────────
      var img = new Image();
      img.onload = function() {
        bgFixed.style.backgroundImage = 'url(' + JSON.stringify(bgUrl) + ')';
        bgFixed.style.backgroundSize = 'cover';
        bgFixed.style.backgroundPosition = 'center top';
        bgFixed.classList.add('loaded');
        document.getElementById('contentSpacer').classList.add('expanded');
      };
      img.onerror = function() {
        bgFixed.style.backgroundColor = '#0E1419';
        bgFixed.classList.add('loaded');
      };
      img.src = bgUrl;

    } else {
      // No background — compact header, buttons close to business name
      bgFixed.classList.add('loaded');
      document.getElementById('pageHeader').classList.add('compact');
      document.getElementById('bgOverlay').style.background = 'none';
      document.getElementById('mainPage').classList.add('no-bg');
    }

    // ── Business name + promo ─────────────────────────────────────────────
    document.title = businessName || 'CallMagnet';

      // ── OG tags — set dynamically after client data loads ──────────────────
      function setMeta(property, content) {
        if (!content) return;
        var el = document.querySelector('meta[property="' + property + '"]')
              || document.querySelector('meta[name="' + property + '"]');
        if (!el) {
          el = document.createElement('meta');
          el.setAttribute(property.startsWith('og:') || property.startsWith('twitter:') ? 'property' : 'name', property);
          document.head.appendChild(el);
        }
        el.setAttribute('content', content);
      }
      var pageUrl = window.location.href;
      var ogImage = client.middle_man_logo_url
                  ? client.middle_man_logo_url.split('?')[0]
                  : (client.middle_man_background_poster_url
                  ? client.middle_man_background_poster_url.split('?')[0]
                  : '');
      setMeta('og:title',       businessName || 'CallMagnet');
      setMeta('og:description', 'Tap to connect with ' + (businessName || 'us'));
      setMeta('og:image',       ogImage);
      setMeta('og:url',         pageUrl);
      setMeta('og:type',        'website');
      setMeta('twitter:card',   'summary_large_image');
      setMeta('twitter:title',  businessName || 'CallMagnet');
      setMeta('twitter:image',  ogImage);

    // ── Logo ──────────────────────────────────────────────────────────────
    var logoUrl = client.middle_man_logo_url || null;
    if (logoUrl) {
      var logoImg = document.createElement('img');
      logoImg.src = logoUrl;
      logoImg.alt = businessName;
      document.getElementById('logoZone').appendChild(logoImg);
    }

    // ── Social icons ──────────────────────────────────────────────────────
    var SOCIAL_ICONS = [
      { key: 'instagram',  path: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z' },
      { key: 'facebook',   path: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z' },
      { key: 'tiktok',     path: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z' },
      { key: 'youtube',    path: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z' },
      { key: 'whatsapp',   path: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z' },
      { key: 'spotify',    path: 'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z' },
      { key: 'soundcloud', path: 'M11.56 8.87V17h8.76c1.47-.01 2.68-1.2 2.68-2.68 0-1.48-1.21-2.68-2.68-2.68-.1 0-.2.01-.3.02C19.7 9.95 18.27 9 16.6 9c-.6 0-1.16.14-1.66.39C14.28 7.97 12.79 7 11.07 7c-.67 0-1.31.17-1.87.47.22.4.36.86.36 1.4zM0 14.32C0 15.8 1.2 17 2.68 17h1.34V11.8a2.68 2.68 0 0 0-4.02 2.52zm5.36-5.45a2.68 2.68 0 0 0-2.68 2.68V17h2.68V8.87z' },
    ];
    if (client.social_enabled) {
      var hasAny = SOCIAL_ICONS.some(function(ic) { return !!client['social_' + ic.key]; });
      if (hasAny) {
        var iconRow = document.createElement('div');
        iconRow.id = 'social-icon-row';
        iconRow.style.cssText = 'display:flex;gap:16px;justify-content:center;align-items:center;margin:12px 0;';
        SOCIAL_ICONS.forEach(function(ic) {
          var url = client['social_' + ic.key];
          if (!url) return;
          var color = client['social_' + ic.key + '_color'] || '#ffffff';
          var a = document.createElement('a');
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.style.cssText = 'display:inline-flex;';
          a.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width:32px;height:32px;display:block;flex-shrink:0;" fill="' + color + '"><path d="' + ic.path + '"/></svg>';
          iconRow.appendChild(a);
        });
        document.getElementById('buttonsWrap').after(iconRow);
      }
    }

    // ── Buttons ───────────────────────────────────────────────────────────
    var enabled = buttons
      .filter(function(b) { return b && b.enabled !== false; })
      .sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); })
      .slice(0, 9);

    var wrap = document.getElementById('buttonsWrap');

    enabled.forEach(function(btn, idx) {
      var rawLabel  = (btn.label || '').trim();
      var formType  = classifyLabel(rawLabel);
      var emoji     = btn.emoji || '';
      var display   = emoji ? emoji + ' ' + rawLabel : rawLabel; // FIX 3: emoji prefix
      var btnKey    = 'btn' + idx;

      // Per-button URL drives navigation. No fallback to shared bookingUrl.
      var btnDestUrl = (btn.url && btn.url.trim()) ? btn.url.trim() : '';
      var effectiveUrl = btnDestUrl;
      var navigates = !!effectiveUrl;

      // Build button element
      var btnEl;
      if (navigates) {
        // <a> for graceful no-JS degradation
        btnEl = document.createElement('a');
        btnEl.href = effectiveUrl;
        btnEl.className = 'tap-btn';
        btnEl.textContent = display;
        btnEl.addEventListener('click', function(e) {
          e.preventDefault();
          handleTap(btnEl, btnKey, formType, effectiveUrl, display, btn.id || '');
        });
      } else {
        btnEl = document.createElement('button');
        btnEl.className = 'tap-btn';
        btnEl.type = 'button';
        btnEl.textContent = display;
        btnEl.addEventListener('click', function() {
          handleTap(btnEl, btnKey, formType, '', display, btn.id || '');
        });
      }

      // Wrap button (and its form) in a .btn-unit for slide animation + neon pill
      var unit = document.createElement('div');
      unit.className = 'btn-unit';
      unit.dataset.neonIdx = idx;
      unit.dataset.neon = btn.color || NEON[Math.min(idx, NEON.length - 1)];
      unit.appendChild(btnEl);

      // Form container (non-booking, non-navigating buttons only)
      if (formType !== 'booking' && !navigates) {
        // Close button — sibling of form-wrap, outside overflow:hidden so iOS Safari never clips it
        var closeBtn = document.createElement('button');
        closeBtn.className = 'form-close-btn';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', closeForm);
        unit.appendChild(closeBtn);

        var formWrap = document.createElement('div');
        formWrap.className = 'form-wrap';
        formWrap.id = 'form-' + btnKey;
        formWrap.dataset.neon = btn.color || NEON[Math.min(idx, NEON.length - 1)];
        formWrap.innerHTML = buildFormHtml(formType, businessName);
        unit.appendChild(formWrap);
        attachFormListeners(formWrap, formType, businessName, display, btnDestUrl);
      }

      wrap.appendChild(unit);

      // Apply neon colour — uses btn.color if set, else falls back to NEON[idx]
      applyNeon(btnEl, idx, btn.color || null);

      // Glow toggle: animate=false → hide glow. Default (true/undefined) → glow shows normally.
      if (btn.animate === false) {
        btnEl.classList.add('glow-off');
      } else {
        btnEl.classList.remove('glow-off');
      }

      // Sparkles: slow ambient floating dust particles drifting upward
      if (btn.sparkles === true) {
        applySparkles(unit, btn.color || NEON[Math.min(idx, NEON.length - 1)]);
      }

      // Shake effect — fires on tap
      if (btn.effect === 'shake') {
        btnEl.addEventListener('click', function() {
          btnEl.style.animation = 'shake 0.4s ease';
          setTimeout(function() { btnEl.style.animation = ''; }, 400);
        });
      }

    });

    if (enabled.length === 0) wrap.style.display = 'none';

    // ── "See what's on" ───────────────────────────────────────────────────
    if (showWhatsOn) {
      document.getElementById('whatsOnSection').style.display = 'block';
      var inner = document.getElementById('whatsOnInner');
      if (bgUrl) {
        var woImg = document.createElement('img');
        woImg.className = 'whats-on-img';
        woImg.src = bgUrl;
        woImg.alt = businessName;
        inner.appendChild(woImg);
      }
      if (promoText) {
        var p = document.createElement('p');
        p.className = 'whats-on-text';
        p.textContent = promoText;
        inner.appendChild(p);
      }
      var woBtn     = document.getElementById('whatsOnBtn');
      var woContent = document.getElementById('whatsOnContent');
      woBtn.addEventListener('click', function() {
        var open = woContent.classList.toggle('open');
        woBtn.textContent = open ? "See what’s on ↑" : "See what’s on ↓";
      });
    }

    // Wire tap-outside catcher → closeForm (only when catcher itself is tapped, not bubbled taps from form fields)
    var tapCatcherEl = document.getElementById('tapCatcher');
    if (tapCatcherEl) tapCatcherEl.addEventListener('click', function(e) {
      if (e.target === tapCatcherEl) closeForm();
    });

    // Close form when tapping anywhere outside a .btn-unit (background tap-to-dismiss)
    document.addEventListener('click', function(e) {
      if (gOpenFormKey === null) return;
      if (e.target.closest('.btn-unit')) return;
      closeForm();
    });

    showMain();

    // ── Wire "Stop these texts" to the opt-out page ──────────────────────────
    // Token visitors (/b/<slug>?u=<token>) go to /u/<token> — one-tap opt-out.
    // Non-token visitors (QR, direct link) go to /u/<slug> — phone entry form.
    var storedToken = sessionStorage.getItem('cm_unsub_token') || '';
    var stopLink = document.getElementById('stopTextsLink');
    if (stopLink) {
      var unsub = storedToken
        ? 'https://callmagnet.com.au/u/' + encodeURIComponent(storedToken)
        : 'https://callmagnet.com.au/u/' + encodeURIComponent(slug);
      stopLink.href = unsub;
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  async function boot() {
    var slug = extractSlug();
    if (!slug) { showNotFound(); return; }

    // ── Unsubscribe token (JOB 3) ──────────────────────────────────────────
    // If the caller arrived via an SMS link with ?u=<token>, persist it so
    // render() can wire the "Stop these texts" footer link to /u/<token>.
    var uToken = new URLSearchParams(window.location.search).get('u') || '';
    if (uToken) sessionStorage.setItem('cm_unsub_token', uToken);

    var client;
    try {
      client = await fetchClient(slug);
    } catch (err) {
      console.error('b.html: fetch error', err);
      showNotFound();
      return;
    }

    if (!client) { showNotFound(); return; }

    render(client, slug);

    // Fire logClick AFTER render — no concurrent fetch when iOS evaluates
    // the video autoplay decision.
    logClick(slug);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();