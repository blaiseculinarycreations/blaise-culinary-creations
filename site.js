(function () {
  'use strict';
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
    var build = function () {
      var lines = ['Hi Chef Blaise, I\'d like to request: ' + svcLabel() + '.'];
      if (g('f-name')) lines.push('Name: ' + g('f-name'));
      if (g('f-phone')) lines.push('Phone: ' + g('f-phone'));
      if (g('f-email')) lines.push('Email: ' + g('f-email'));
      if (g('f-date')) lines.push('Date: ' + fmtDate(g('f-date')));
      if (g('f-guests')) lines.push('Guests: ' + g('f-guests'));
      if (g('f-city')) lines.push('City: ' + g('f-city'));
      var call = form.querySelector('input[name=call]:checked');
      if (call && call.id !== 'c-no') lines.push('I\'d like a ' + call.value.toLowerCase() + (g('f-calldate') ? ' on ' + fmtDate(g('f-calldate')) : '') + (g('f-calltime') ? ', ' + g('f-calltime').toLowerCase() : '') + '.');
      if (g('f-notes')) lines.push('Notes: ' + g('f-notes'));
      return lines.join('\n');
    };
    var refresh = function () {
      var t = build();
      if (msg) msg.textContent = t;
      if (sms) sms.href = 'sms:+16317101226?&body=' + encodeURIComponent(t);
      if (mail) mail.href = 'mailto:blaiseculinarycreations@gmail.com?subject=' + encodeURIComponent('Booking request') + '&body=' + encodeURIComponent(t);
    };
    var pick = function (sid, scroll) {
      if (!svc || !sid) return;
      var o = svc.querySelector('option[data-s="' + sid + '"]');
      if (o) { svc.value = o.value; refresh(); }
      if (scroll) { form.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(function () { svc.focus({ preventScroll: true }); }, 400); }
    };
    var callToggle = function () {
      var c = form.querySelector('input[name=call]:checked'); var want = c && c.id !== 'c-no';
      ['callWhen', 'callTime'].forEach(function (id) { var el = $(id); if (el) el.hidden = !want; });
    };
    form.addEventListener('change', callToggle); callToggle();
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    try { pick(new URLSearchParams(location.search).get('s'), false); } catch (e) {}
    refresh();
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pick]'); if (b) pick(b.getAttribute('data-pick'), true);
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!g('f-name')) { status.textContent = 'Please add your name.'; $('f-name').focus(); return; }
      if (!g('f-phone') && !g('f-email')) { status.textContent = 'Please add a phone number or email so I can reply.'; $('f-phone').focus(); return; }
      sendBtn.disabled = true; status.textContent = 'Sending…';
      post(form).then(function () {
        status.textContent = 'Thank you! Your request was sent. I\'ll be in touch within a day.';
        form.reset(); callToggle(); refresh();
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

  // ---------- published reviews ----------
  var lists = document.querySelectorAll('[data-reviews]');
  if (lists.length) {
    fetch('/reviews.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
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
