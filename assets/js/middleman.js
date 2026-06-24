(function () {
  'use strict';

  var SUPABASE_URL  = 'https://iskvvnhacqdxybpmwuni.supabase.co';
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlza3Z2bmhhY3FkeHlicG13dW5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTAyOTYsImV4cCI6MjA5MDA4NjI5Nn0.c3uR-CSQXsgfYMnzK8KOxZjoqRPwaMsUuGpMPwvCsk8';
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
      + 'middle_man_buttons,middle_man_show_whats_on,vertical'
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

  // ── Emoji for a button label ──────────────────────────────────────────────
  function labelEmoji(label) {
    var l = label.toLowerCase();
    if (l.indexOf('change') !== -1 || l.indexOf('alter') !== -1 || l.indexOf('cancel') !== -1) return '✏️'; // ✏️
    if (l.indexOf('book') !== -1) return '🍽️'; // 🍽️
    if (l.indexOf('function') !== -1 || l.indexOf('event') !== -1) return '🎁'; // 🎁
    if (l.indexOf('lost') !== -1 || l.indexOf('found') !== -1) return '❓'; // ❓
    if (l.indexOf('late') !== -1 || l.indexOf('running') !== -1) return '🏃'; // 🏃
    if (l.indexOf('something else') !== -1 || l.indexOf('enquiry') !== -1 || l.indexOf('other') !== -1) return '📣'; // 📣
    return '📣'; // 📣 default
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

      // ── FIX 2: fire log-middle-man-tap on SUBMIT (not on button tap) ───────
      fetch(LOG_FUNC_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: gSlug, intent: intentLabel }),
      }).catch(function() {});

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
  // FIX 2: log-middle-man-tap fires here ONLY for booking buttons.
  //        For form buttons, the log fires on submit instead.
  function handleTap(btnEl, btnKey, formType, bookingUrl, intentLabel) {
    btnEl.classList.add('pressed');
    setTimeout(function() { btnEl.classList.remove('pressed'); }, 180);

    // bookingUrl here is the per-button effectiveUrl passed from the click handler.
    // Navigate if a URL is set — formType does not matter.
    if (bookingUrl) {
      fetch(LOG_FUNC_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: gSlug, intent: intentLabel }),
      }).catch(function() {});
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
      // Set src directly — more reliable than <source> on iOS Safari.
      // Explicit vid.load() is intentionally omitted: calling load() then
      // play() back-to-back resets the load pipeline on iOS and causes play()
      // to fire before the browser has accepted the src, rejecting the Promise.
      vid.src = bgUrl;

      bgFixed.appendChild(vid);
      vid.play()
        .then(function() {
          console.log('[video] play() resolved — video IS playing');
        })
        .catch(function(err) {
          console.log('[video] play() FAILED:', (err && err.name) || 'unknown', '|', (err && err.message) || String(err));
          vid.style.display = 'none';
          bgFixed.style.backgroundColor = '#0E1419';
        });
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
    document.getElementById('heroBusinessName').textContent = businessName;
    document.title = businessName || 'CallMagnet';

    // ── Logo: if set, insert above #heroBusinessName and hide the text ────
    var logoUrl = client.middle_man_logo_url || null;
    var heroName = document.getElementById('heroBusinessName');
    if (logoUrl && heroName) {
      var logoImg = document.createElement('img');
      logoImg.src = logoUrl;
      logoImg.alt = businessName;
      logoImg.style.cssText = 'width:auto;max-width:85%;max-height:90px;object-fit:contain;display:block;margin:0 auto 4px;';
      heroName.style.display = 'none';
      heroName.parentNode.insertBefore(logoImg, heroName);
    }

    // ── Buttons ───────────────────────────────────────────────────────────
    var enabled = buttons
      .filter(function(b) { return b && b.enabled !== false; })
      .sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); })
      .slice(0, 6);

    var wrap = document.getElementById('buttonsWrap');

    enabled.forEach(function(btn, idx) {
      var rawLabel  = (btn.label || '').trim();
      var formType  = classifyLabel(rawLabel);
      var emoji     = labelEmoji(rawLabel);
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
          handleTap(btnEl, btnKey, formType, effectiveUrl, display);
        });
      } else {
        btnEl = document.createElement('button');
        btnEl.className = 'tap-btn';
        btnEl.type = 'button';
        btnEl.textContent = display;
        btnEl.addEventListener('click', function() {
          handleTap(btnEl, btnKey, formType, '', display);
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

    // ── Wire unsubscribe token to "Stop these texts" link ────────────────────
    // If the SMS link contained ?u=<token>, middleman.js reads it here and
    // points the footer link to /u/<token> so the caller can opt out.
    var urlParams = new URLSearchParams(window.location.search);
    var unsubToken = urlParams.get('u');
    var stopLink = document.getElementById('stopTextsLink');
    if (unsubToken && stopLink) {
      stopLink.href = '/u/' + unsubToken;
    }

    showMain();

    // ── Wire "Stop these texts" to the opt-out page (JOB 3) ─────────────────
    // If the caller arrived via an SMS link with ?u=<token>, boot() stored the
    // token in sessionStorage. Re-read it here (in case render() is ever called
    // independently) and update the footer link href.
    var storedToken = sessionStorage.getItem('cm_unsub_token') || '';
    if (storedToken) {
      var stopLink = document.getElementById('stopTextsLink');
      if (stopLink) stopLink.href = 'https://callmagnet.com.au/u/' + encodeURIComponent(storedToken);
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  async function boot() {
    var slug = extractSlug();
    if (!slug) { showNotFound(); return; }
    logClick(slug);

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

    // NOTE: <link rel="preload" as="video"> was removed.
    // Chrome doesn't honour as="video" for preloading, and the URL mismatch
    // (preload: bare URL, <source>: URL+?v=timestamp) caused the browser to
    // download the MP4 twice — which stalled the GPU compositor and made the
    // poster image stick instead of the video frames showing through.

    render(client, slug);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();