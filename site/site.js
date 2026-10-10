(function () {
  'use strict';
  // Reviews and booked dates live on the repo's `data` branch, so updating them never costs a Netlify deploy.
  var DATA = 'https://raw.githubusercontent.com/blaiseculinarycreations/blaise-culinary-creations/data/';
  var getJSON = function (name) {
    return fetch(DATA + name, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .catch(function () { return fetch('/' + name, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }); });
  };
  var $ = function (id) { return document.getElementById(id); };

  // ---------- mobile nav ----------
  var toggle = document.querySelector('.nav-toggle'), nav = $('site-nav');
  if (toggle && nav) toggle.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Close' : 'Menu';
  });

  // ---------- shared helpers ----------
  function selectText(el) {
    var r = document.createRange(); r.selectNodeContents(el);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function copy(text, el, okMsg, target) {
    var done = function () { target.textContent = okMsg; };
    var fail = function () { selectText(el); target.textContent = 'Text selected. Press Copy to save it.'; };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
      else fail();
    } catch (e) { fail(); }
  }
  function post(form, extra) {
    var data = new URLSearchParams(new FormData(form));
    if (extra) Object.keys(extra).forEach(function (k) { data.set(k, extra[k]); });
    return fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: data.toString() })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r; });
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ---------- booking form ----------
  var form = $('inquiry');
  if (form) {
    var msg = $('msg'), sms = $('smsLink'), mail = $('mailLink'), status = $('status'), sendBtn = $('sendBtn'), svc = $('f-service');
    var g = function (id) { var el = $(id); return el ? el.value.trim() : ''; };
    var svcLabel = function () { var o = svc.selectedOptions && svc.selectedOptions[0]; return o ? o.textContent : g('f-service'); };
    var fmtDate = function (v) { if (!v) return ''; var d = new Date(v + 'T12:00:00'); return isNaN(d) ? v : d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); };
    // chef fee estimate from the selected tier: base covers data-incl guests, + data-extra each up to data-cap; extra hands from data-helpfrom
    var estimate = function () {
      var o = svc && svc.selectedOptions && svc.selectedOptions[0]; if (!o) return null;
      var base = +o.getAttribute('data-base') || 0, guests = parseInt(g('f-guests'), 10) || 0, pair = $('pairWrap') && !$('pairWrap').hidden ? g('f-pairing') : '';
      if (!base && !pair) return null;
      if (!base) { var m = /\$([0-9,]+)\s*$/.exec(o.value); base = m ? +m[1].replace(/,/g, '') : 0; }
      var total = base, over = false, cap = +o.getAttribute('data-cap') || 0, incl = +o.getAttribute('data-incl') || 0;
      if (incl && guests) {
        var gg = cap && guests > cap ? cap : guests; over = !!(cap && guests > cap);
        total += Math.max(0, gg - incl) * (+o.getAttribute('data-extra') || 0);
        var hf = +o.getAttribute('data-helpfrom') || 0; if (hf && gg >= hf) total += +o.getAttribute('data-help') || 0;
      }
      if (/each course/.test(pair)) total += 20 * (+o.getAttribute('data-courses') || 4);
      else if (pair) total += 40;
      return { total: total, over: over, cap: cap };
    };
    var showEst = function () {
      var el = $('estNote'); if (!el) return; var e = estimate();
      el.hidden = !e; if (!e) return;
      el.textContent = e.over ? 'That\'s more guests than this service seats (up to ' + e.cap + '). Send the request and I\'ll put together a custom quote.' : 'Estimated chef fee' + (g('f-guests') ? ' for ' + g('f-guests') + ' guests' : '') + ': $' + e.total.toLocaleString() + '. Groceries are billed separately at cost.';
    };
    var build = function () {
      var lines = ['Hi Chef Blaise, I\'d like to request: ' + svcLabel() + '.'];
      if (g('f-name')) lines.push('Name: ' + g('f-name'));
      if (g('f-phone')) lines.push('Phone: ' + g('f-phone'));
      if (g('f-email')) lines.push('Email: ' + g('f-email'));
      if (g('f-date')) lines.push('Date: ' + fmtDate(g('f-date')));
      if (g('f-guests')) lines.push('Guests: ' + g('f-guests'));
      if (g('f-pairing') && !$('pairWrap').hidden) lines.push('Wine pairing: ' + g('f-pairing'));
      var est = estimate(); if (est) lines.push('Estimated chef fee: $' + est.total.toLocaleString() + ' (groceries billed separately)');
      if (g('f-city')) lines.push('City: ' + g('f-city'));
      var pt = +g('f-pretaste') || 0;
      if (pt) lines.push('Pre-tastings: ' + pt + ' (+$' + (pt * 50) + ')');
      var call = form.querySelector('input[name=call]:checked');
      if (call && call.id !== 'c-no') lines.push('I\'d like a ' + call.value.toLowerCase() + (g('f-calldate') ? ' on ' + fmtDate(g('f-calldate')) : '') + (g('f-calltime') ? ', ' + g('f-calltime').toLowerCase() : '') + '.');
      if (g('f-notes')) lines.push('Notes: ' + g('f-notes'));
      return lines.join('\n');
    };
    var refresh = function () {
      var t = build(); showEst();
      if (msg) msg.textContent = t;
      if (sms) sms.href = 'sms:+16317101226?&body=' + encodeURIComponent(t);
      if (mail) mail.href = 'mailto:blaiseculinarycreations@gmail.com?subject=' + encodeURIComponent('Booking request') + '&body=' + encodeURIComponent(t);
    };
    var pick = function (sid, scroll) {
      if (!svc || !sid) return;
      var o = svc.querySelector('option[data-s="' + sid + '"]');
      if (o) { svc.value = o.value; if (typeof fillGuests === 'function') fillGuests(); refresh(); if (typeof adultToggle === 'function') adultToggle(); if (typeof checkDate === 'function') checkDate(); }
      if (scroll) { form.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(function () { svc.focus({ preventScroll: true }); }, 400); }
    };
    var callToggle = function () {
      var c = form.querySelector('input[name=call]:checked'); var want = c && c.id !== 'c-no';
      ['callWhen', 'callTime'].forEach(function (id) { var el = $(id); if (el) el.hidden = !want; });
    };
    form.addEventListener('change', callToggle); callToggle();
    var adultToggle = function () {
      var o = svc && svc.selectedOptions && svc.selectedOptions[0];
      var pw = $('pairWrap'), canPair = !!(o && o.getAttribute('data-pair')); if (pw) { pw.hidden = !canPair; if (!canPair && $('f-pairing')) $('f-pairing').value = ''; }
      var need = !!(o && (o.getAttribute('data-adult') || (canPair && g('f-pairing'))));
      var w = $('adultWrap'); if (w) w.hidden = !need;
      var dw = $('depWrap'); if (dw) dw.hidden = !!(o && /\| Free$/.test(o.value));
      return need;
    };
    if (svc) svc.addEventListener('change', adultToggle);
    // guest count dropdown sized to the selected service (its cap, or 1-20)
    var fillGuests = function () {
      var gs = $('f-guests'); if (!gs || gs.tagName !== 'SELECT') return;
      var o = svc && svc.selectedOptions && svc.selectedOptions[0], cap = o ? +o.getAttribute('data-cap') || 0 : 0, cur = gs.value, max = cap || 20, h = '<option value="">How many guests?</option>';
      for (var i = 1; i <= max; i++) h += '<option value="' + i + '">' + i + (i === 1 ? ' guest' : ' guests') + '</option>';
      h += '<option value="' + (max + 1) + '+">More than ' + max + (cap ? ' (custom quote)' : '') + '</option>';
      gs.innerHTML = h; if (cur && gs.querySelector('option[value="' + cur + '"]')) gs.value = cur;
    };
    if (svc) svc.addEventListener('change', function () { fillGuests(); refresh(); });
    if ($('f-pairing')) $('f-pairing').addEventListener('change', adultToggle);
    // ---- date rules: no past dates, two weeks' notice for dinners, booked/blocked days ----
    var dateEl = $('f-date'), dateMsg = $('dateMsg'), depNote = $('depNote'), taken = {};
    var iso = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    if (dateEl) dateEl.min = iso(tomorrow);
    getJSON('availability.json').then(function (a) { (a && a.unavailable || []).forEach(function (d) { taken[d] = 1; }); checkDate(); }).catch(function () {});
    var selOpt = function () { return svc && svc.selectedOptions && svc.selectedOptions[0]; };
    var checkDate = function () {
      var o = selOpt(), v = dateEl ? dateEl.value : '', msg = '', bad = false;
      var dep = o ? +o.getAttribute('data-dep') || 0 : 0;
      if (depNote) depNote.textContent = dep ? 'This service takes a ' + dep + '% deposit to hold the date (fully refundable 14 or more days before, half at 7 to 13 days; you can also reschedule). The balance and a grocery estimate are due 4 days before.' : '';
      if (v) {
        var days = Math.round((new Date(v + 'T12:00:00') - new Date(iso(new Date()) + 'T12:00:00')) / 86400000);
        if (days < 1) { msg = 'Please pick a future date.'; bad = true; }
        else if (taken[v]) { msg = 'That date is already booked. Please pick another.'; bad = true; }
        else if (o && o.getAttribute('data-dinner') && days < 14) msg = 'Dinners need about two weeks to plan. Send it anyway and I\'ll tell you if I can make it work.';
      }
      if (dateMsg) { dateMsg.textContent = msg; dateMsg.classList.toggle('bad', bad); }
      return !bad;
    };
    if (dateEl) dateEl.addEventListener('change', checkDate);
    if (svc) svc.addEventListener('change', checkDate);
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    try { pick(new URLSearchParams(location.search).get('s'), false); } catch (e) {}
    fillGuests(); adultToggle(); checkDate();
    refresh();
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pick]'); if (b) pick(b.getAttribute('data-pick'), true);
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!g('f-name')) { status.textContent = 'Please add your name.'; $('f-name').focus(); return; }
      if (!g('f-phone') && !g('f-email')) { status.textContent = 'Please add a phone number or email so I can reply.'; $('f-phone').focus(); return; }
      var free = /\| Free$/.test(g('f-service'));
      if (!free && $('f-deposit') && !$('f-deposit').checked) { status.textContent = 'Please confirm you understand the 50% non-refundable deposit.'; $('f-deposit').focus(); return; }
      if (!checkDate()) { status.textContent = dateMsg.textContent; dateEl.focus(); return; }
      if ($('f-agree') && !$('f-agree').checked) { status.textContent = 'Please confirm you\'ve read the booking terms.'; $('f-agree').focus(); return; }
      if (adultToggle() && !$('f-adult').checked) { status.textContent = 'Please confirm everyone served wine is 21 or older.'; $('f-adult').focus(); return; }
      sendBtn.disabled = true; status.textContent = 'Sending…';
      post(form).then(function () {
        status.textContent = 'Thank you! Your request was sent. I\'ll be in touch within a day.';
        form.reset(); fillGuests(); callToggle(); adultToggle(); checkDate(); refresh();
      }).catch(function () {
        copy(build(), msg, 'That didn\'t go through, so I copied your message. Text it to (631) 710-1226 or email blaiseculinarycreations@gmail.com.', status);
      }).then(function () { sendBtn.disabled = false; });
    });
  }

  var copyEmail = $('copyEmail');
  if (copyEmail) copyEmail.addEventListener('click', function () {
    copy('blaiseculinarycreations@gmail.com', $('email'), 'Copied', copyEmail);
    setTimeout(function () { copyEmail.textContent = 'Copy email'; }, 2200);
  });
  var copyPhone = $('copyPhone');
  if (copyPhone) copyPhone.addEventListener('click', function () {
    copy('6317101226', $('phone'), 'Copied', copyPhone);
    setTimeout(function () { copyPhone.textContent = 'Copy number'; }, 2200);
  });

  // ---------- Valse cloche ----------
  var liftBtn = $('liftBtn'), cover = $('valseCover'), vbody = $('valseBody'), coverBtn = $('coverBtn');
  if (liftBtn && cover && vbody) {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    liftBtn.addEventListener('click', function () {
      cover.classList.add('lifting'); liftBtn.setAttribute('aria-expanded', 'true');
      setTimeout(function () { cover.hidden = true; vbody.hidden = false; var v = $('valse'); if (v) v.style.alignContent = 'start'; }, reduce ? 0 : 650);
    });
    if (coverBtn) coverBtn.addEventListener('click', function () {
      vbody.hidden = true; cover.classList.remove('lifting'); cover.hidden = false;
      liftBtn.setAttribute('aria-expanded', 'false'); var v = $('valse'); if (v) v.style.alignContent = ''; liftBtn.focus();
    });
  }

  // ---------- review form ----------
  var rform = $('reviewForm');
  if (rform) {
    var rstatus = $('reviewStatus'), rbtn = $('reviewBtn');
    rform.addEventListener('submit', function (e) {
      e.preventDefault();
      var rating = rform.querySelector('input[name=rating]:checked');
      if (!rating) { rstatus.textContent = 'Please pick a star rating.'; return; }
      if (!$('rv-name').value.trim()) { rstatus.textContent = 'Please add your name.'; $('rv-name').focus(); return; }
      if (!$('rv-text').value.trim()) { rstatus.textContent = 'Please write a few words about your dinner.'; $('rv-text').focus(); return; }
      rbtn.disabled = true; rstatus.textContent = 'Sending…';
      post(rform, { publish: rform.querySelector('input[name=publish]').checked ? 'yes' : 'no' }).then(function () {
        rstatus.textContent = 'Thank you! Your review was sent. It will appear here once I\'ve confirmed it.';
        rform.reset();
      }).catch(function () {
        rstatus.textContent = 'That didn\'t go through. Please try again, or email blaiseculinarycreations@gmail.com.';
      }).then(function () { rbtn.disabled = false; });
    });
  }

  // Google / Yelp links from links.json (data branch): unhide only when a URL is set
  getJSON('links.json').then(function (L) {
    if (!L) return;
    document.querySelectorAll('[data-link]').forEach(function (a) {
      var u = L[a.getAttribute('data-link')];
      if (u && /^https:\/\//.test(u)) { a.href = u; a.hidden = false; }
    });
    document.querySelectorAll('[data-link-wrap]').forEach(function (w) {
      var u = L[w.getAttribute('data-link-wrap')];
      if (u && /^https:\/\//.test(u)) w.hidden = false;
    });
  });

  // ---------- published reviews ----------
  var lists = document.querySelectorAll('[data-reviews]');
  if (lists.length) {

    getJSON('reviews.json').then(function (rows) {
      if (!Array.isArray(rows) || !rows.length) return;
      rows.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
      lists.forEach(function (list) {
        var n = list.getAttribute('data-reviews'); var show = n === 'all' ? rows : rows.slice(0, +n || 3);
        list.innerHTML = show.map(function (r) {
          var st = Math.max(1, Math.min(5, +r.rating || 5));
          return '<figure class="review"><span class="rstars" aria-label="' + st + ' out of 5 stars">' + '★★★★★'.slice(0, st) + '</span><blockquote>' + esc(r.text) + '</blockquote><figcaption>' + esc(r.name) + (r.occasion ? ' · ' + esc(r.occasion) : '') + '</figcaption></figure>';
        }).join('');
      });
    }).catch(function () {});
  }
})();
