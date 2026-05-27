(function () {
  'use strict';

  var SUPABASE_URL  = 'https://iskvvnhacqdxybpmwuni.supabase.co';
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlza3Z2bmhhY3FkeHlicG13dW5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTAyOTYsImV4cCI6MjA5MDA4NjI5Nn0.c3uR-CSQXsgfYMnzK8KOxZjoqRPwaMsUuGpMPwvCsk8';
  var FORM_FUNC_URL = SUPABASE_URL + '/functions/v1/submit-middle-man-form';
  var LOG_FUNC_URL  = SUPABASE_URL + '/functions/v1/log-middle-man-tap';

  // ── Neon colour palette — position 1-6 (index 0-5) ───────────────────────
  var NEON = ['#00D4FF','#FF6B00','#39FF14','#FF10F0','#FFE600','#BF00FF'];

  // ── Globals ───────────────────────────────────────────────────────────────
  var gSlug        = '';
  var gOpenFormKey = null;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function extractSlug() {
    var parts = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/');
    return (parts.length >= 2 && parts[0] === 'b') ? (parts[1] || '') : '';
  }

  function showMain() {
    document.getElementById('skeleton').style.display      = 'none';
    document.getElementById('stateNotFound').style.display = 'none';
    document.getElementById('mainPage').classList.add('visible');
  }
  function showNotFound() {
    document.getElementById('skeleton').style.display      = 'none';
    document.getElementById('mainPage').classList.remove('visible');
    document.getElementById('stateNotFound').style.display = 'flex';
  }

  // ── Convert #RRGGBB → rgba(r,g,b,a) ──────────────────────────────────────
  function hexRgba(hex, a) {
    var r = parseInt(hex.slice(1,3), 16);
    var g = parseInt(hex.slice(3,5), 16);
    var b = parseInt(hex.slice(5,7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  // ── Apply neon style to a button element by position index (0-based) ─────
  function applyNeon(el, idx) {
    var c = NEON[Math.min(idx, NEON.length - 1)];
    el.style.borderColor = c;
    el.style.color       = c;
    el.style.boxShadow   = '0 0 8px ' + hexRgba(c, 0.25) + ', 0 0 20px ' + hexRgba(c, 0.10);
  }

  // ── Fetch client from Supabase REST (anon key) ────────────────────────────
  async function fetchClient(slug) {
    var url = SUPABASE_URL + '/rest/v1/clients'
      + '?middle_man_slug=eq.' + encodeURIComponent(slug)
      + '&account_status=eq.active'
      + '&select=business_name,middle_man_background_url,middle_man_background_type,middle_man_background_poster_url,middle_man_promo_text,'
      + 'middle_man_buttons,middle_man_show_whats_on,booking_url,vertical'
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
  function buildFormHtml(formType) {
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
      + '<button class="form-close-btn" type="button" aria-label="Close">✕</button>'
      + '<div class="form-title">' + esc(titles[formType] || 'Send us a message') + '</div>'
      + inner
      + '<button class="submit-btn" type="button" data-submit>' + esc(submitLabels[formType] || 'Send') + '</button>'
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
      .then(function() { handleSuccess(formWrap, name, formType, businessName, bookingUrl); })
      .catch(function() { handleSuccess(formWrap, name, formType, businessName, bookingUrl); });
      // Always show success — never block the customer
    });
  }

  // ── Show success screen, then redirect to bookingUrl after 2s ────────────
  function handleSuccess(formWrap, name, formType, businessName, bookingUrl) {
    var formEl = formWrap.querySelector('.inline-form');
    if (formEl) formEl.style.display = 'none';

    var successEl = document.createElement('div');
    successEl.className = 'success-state visible';
    successEl.innerHTML = CHECK_SVG
      + '<div class="success-heading">Got it, ' + esc(name) + '</div>'
      + '<div class="success-msg">' + successMsg(formType, businessName) + '</div>';
    formWrap.appendChild(successEl);

    // Redirect to booking URL after 2 seconds (if set)
    if (bookingUrl) {
      setTimeout(function() { window.location.href = bookingUrl; }, 2000);
    }
  }

  // ── Close the currently open inline form ─────────────────────────────────
  function closeForm() {
    if (gOpenFormKey !== null) {
      var formEl = document.getElementById('form-' + gOpenFormKey);
      if (formEl) formEl.classList.remove('open');
      gOpenFormKey = null;
    }
    var overlay = document.getElementById('formOverlay');
    if (overlay) overlay.classList.remove('visible');
    // Release scroll lock (FIX 3)
    document.body.style.overflow = '';
  }

  // ── Handle button tap ─────────────────────────────────────────────────────
  // FIX 2: log-middle-man-tap fires here ONLY for booking buttons.
  //        For form buttons, the log fires on submit instead.
  function handleTap(btnEl, btnKey, formType, bookingUrl, intentLabel) {
    btnEl.classList.add('pressed');
    setTimeout(function() { btnEl.classList.remove('pressed'); }, 180);

    if (formType === 'booking') {
      // Log immediately + redirect
      fetch(LOG_FUNC_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: gSlug, intent: intentLabel }),
      }).catch(function() {});
      if (bookingUrl) {
        setTimeout(function() { window.location.href = bookingUrl; }, 220);
      }
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
      formWrap.classList.add('open');
      gOpenFormKey = btnKey;
      // Lock body scroll while modal form is visible (FIX 3)
      document.body.style.overflow = 'hidden';
      // Show tap-outside overlay
      var formOverlayEl = document.getElementById('formOverlay');
      if (formOverlayEl) formOverlayEl.classList.add('visible');
      // Apply neon border/glow to the inline form matching the button colour
      var neon = formWrap.dataset.neon;
      if (neon) {
        var inlineForm = formWrap.querySelector('.inline-form');
        if (inlineForm) {
          inlineForm.style.border = '1.5px solid ' + neon;
          inlineForm.style.boxShadow = '0 0 8px ' + hexRgba(neon, 0.3) + ', 0 0 16px ' + hexRgba(neon, 0.1);
        }
      }
    }
  }

  // ── Render the page ───────────────────────────────────────────────────────
  function render(client, slug) {
    gSlug = slug;

    var bgUrl       = client.middle_man_background_url
                        ? client.middle_man_background_url + '?v=' + Date.now()
                        : null;
    var bgType      = client.middle_man_background_type || 'image';
    var businessName = client.business_name || '';
    var promoText   = client.middle_man_promo_text || '';
    var buttons     = [];
    var bookingUrl  = (client.booking_url || '').trim();
    var showWhatsOn = client.middle_man_show_whats_on === true;

    try {
      buttons = Array.isArray(client.middle_man_buttons)
        ? client.middle_man_buttons
        : JSON.parse(client.middle_man_buttons || '[]');
    } catch (_) { buttons = []; }

    // ── Full-screen background ────────────────────────────────────────────
    // #app is position:fixed (scroll container) — body is just overflow:hidden.
    // #bgFixed is position:fixed z-index:0 — always covers the full screen.
    // bgUrl has a ?v= cache-bust so a re-uploaded file is never stale.
    var bgFixed = document.getElementById('bgFixed');
    bgFixed.style.backgroundImage = 'none';
    bgFixed.style.backgroundColor = '#0E1419';

    if (bgUrl && bgType === 'video') {
      // ── Video background (iOS Safari requires all 6 attributes) ──────────
      console.log('[video] type=video detected');
      console.log('[video] bgUrl (passed to <source>):', bgUrl);
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
      var vsrc = document.createElement('source');
      vsrc.src  = bgUrl;
      vsrc.type = 'video/mp4';
      vid.appendChild(vsrc);

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
        // code 1=ABORTED 2=NETWORK 3=DECODE 4=SRC_NOT_SUPPORTED
      });

      bgFixed.appendChild(vid);
      console.log('[video] element appended to #bgFixed — calling load()');
      vid.load();
      console.log('[video] load() called — calling play()');
      vid.play()
        .then(function() {
          console.log('[video] play() resolved — video IS playing');
        })
        .catch(function(err) {
          console.log('[video] play() FAILED:', (err && err.name) || 'unknown', '|', (err && err.message) || String(err));
          // Autoplay blocked (e.g. low-power mode) — hide video, keep dark bg
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
    }

    // ── Business name + promo ─────────────────────────────────────────────
    document.getElementById('heroBusinessName').textContent = businessName;
    document.title = businessName || 'CallMagnet';

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

      // Build button element
      var btnEl;
      if (formType === 'booking' && bookingUrl) {
        // <a> for graceful no-JS degradation
        btnEl = document.createElement('a');
        btnEl.href = bookingUrl;
        btnEl.className = 'tap-btn';
        btnEl.textContent = display;
        btnEl.addEventListener('click', function(e) {
          e.preventDefault();
          handleTap(btnEl, btnKey, formType, bookingUrl, display);
        });
      } else {
        btnEl = document.createElement('button');
        btnEl.className = 'tap-btn';
        btnEl.type = 'button';
        btnEl.textContent = display;
        btnEl.addEventListener('click', function() {
          handleTap(btnEl, btnKey, formType, bookingUrl, display);
        });
      }

      // FIX 1: Apply neon colour by position
      applyNeon(btnEl, idx);

      wrap.appendChild(btnEl);

      // Form container (non-booking only)
      if (formType !== 'booking') {
        var formWrap = document.createElement('div');
        formWrap.className = 'form-wrap';
        formWrap.id = 'form-' + btnKey;
        formWrap.dataset.neon = NEON[Math.min(idx, NEON.length - 1)];
        formWrap.innerHTML = buildFormHtml(formType);
        wrap.appendChild(formWrap);
        attachFormListeners(formWrap, formType, businessName, display, bookingUrl);
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

    // Wire tap-outside overlay → closeForm (once, after DOM is ready)
    var formOverlayEl = document.getElementById('formOverlay');
    if (formOverlayEl) formOverlayEl.addEventListener('click', closeForm);

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
    // ── Safari toolbar collapse (JOB 2) ────────────────────────────────────
    // Three-stage scroll sequence triggers Safari's auto-hide behaviour for
    // the URL bar and bottom toolbar — identical to news.com.au / Twitter.
    // The page has an invisible 100vh #scroll-spacer below #app (which is
    // position:fixed) making the document technically scrollable.
    // behavior:'instant' (via positional form) avoids any visible jank.
    // These run concurrently with the fetchClient() network request below.
    setTimeout(function() { window.scrollTo(0, 1);  },  50);
    setTimeout(function() { window.scrollTo(0, 80); }, 300);
    setTimeout(function() { window.scrollTo(0, 0);  }, 600);

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

    // ── Aggressive video preload hint (JOB 1) ──────────────────────────────
    // Injecting a <link rel="preload"> right after the fetch tells the browser
    // to buffer the MP4 at high priority before render() creates the <video>
    // element — shaves perceptible start-up latency on slow connections.
    if (client.middle_man_background_url &&
        (client.middle_man_background_type || 'image') === 'video') {
      var preloadLink  = document.createElement('link');
      preloadLink.rel  = 'preload';
      preloadLink.as   = 'video';
      preloadLink.href = client.middle_man_background_url;
      preloadLink.type = 'video/mp4';
      document.head.appendChild(preloadLink);
      console.log('[video] preload hint href (NO cache-bust):', client.middle_man_background_url);
      console.log('[video] NOTE: bgUrl in render() will have ?v=<timestamp> appended — these are different cache keys');
    }

    render(client, slug);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();