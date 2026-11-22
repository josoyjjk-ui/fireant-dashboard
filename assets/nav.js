/* ANTINFO 공용 내비게이션 — 단일 소스.
   NAV/ICONS 를 고친 뒤 python3 scripts/sync_nav.py 를 실행하면 모든 페이지에 반영됩니다. */
(function () {
  'use strict';

  var NAV = /*NAV-START*/[
 {"label":"대시보드","short":"홈","href":"/","match":["/","/m"],"group":"main","bottom":true},
 {"label":"마켓","short":"마켓","href":"/market","group":"main","bottom":true},
 {"label":"매크로뉴스","short":"뉴스","href":"/macro-news","group":"main","bottom":true},
 {"label":"주요자산차트","short":"차트","href":"/charts","group":"main","bottom":true,"ov":1024},
 {"label":"K-거래소 현황","short":"거래소","href":"/kr-exchange/","match":["/kr-exchange"],"group":"main","bottom":true,"ov":1024},
 {"label":"바이백 보드","href":"/buyback","match":["/buyback","/revenue-meta"],"group":"main"},
 {"label":"시그널","href":"/signal","group":"more","sub":"ind"},
 {"label":"공포탐욕지수","href":"/fng","group":"more","sub":"ind"},
 {"label":"경제 캘린더","href":"/calendar","group":"more","sub":"ind"},
 {"label":"언락 캘린더","href":"/unlocks","group":"more","sub":"ind"},
 {"label":"이벤트 모음","href":"/events","group":"more","sub":"com"},
 {"label":"당첨자 확인","href":"/winners/","match":["/winners"],"group":"more","sub":"com"},
 {"label":"인사이트","href":"/posts/","match":["/posts"],"group":"more","sub":"com"},
 {"label":"코인과세유예 후원","href":"/donate","group":"more","sub":"com"}
]/*NAV-END*/;
  var NAV_VER = '2e149edb';
  var TG = { label: '텔레그램 채널', href: 'https://t.me/fireant_crypto' };
  var ICONS = /*ICONS-START*/{
 "/": "<path d='M3 10.5 12 3l9 7.5V21H3z'/><path d='M9 21v-7h6v7'/>",
 "/market": "<polyline points='3 17 9 11 13 15 21 7'/><polyline points='15 7 21 7 21 13'/>",
 "/macro-news": "<rect x='3' y='5' width='14' height='14' rx='2'/><path d='M17 9h4v8a2 2 0 0 1-2 2'/><path d='M7 9h6M7 13h6M7 16h4'/>",
 "/charts": "<path d='M7 3v4M7 17v4'/><rect x='5' y='7' width='4' height='10' rx='1'/><path d='M17 5v3M17 16v3'/><rect x='15' y='8' width='4' height='8' rx='1'/>",
 "/kr-exchange/": "<path d='M3 10 12 4l9 6'/><path d='M5 21v-8M9 21v-8M15 21v-8M19 21v-8M3 21h18'/>",
 "menu": "<path d='M4 6h16M4 12h16M4 18h16'/>"
}/*ICONS-END*/;

  var SVG_OPEN = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var SVG_CLOSE = '</svg>';

  var H_MAIN = '메인';
  var H_IND = '지표·캘린더';
  var H_COM = '커뮤니티·콘텐츠';

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  }

  function norm(p) {
    var s = String(p == null ? '' : p).toLowerCase();
    var q = s.indexOf('?');
    if (q > -1) s = s.slice(0, q);
    var h = s.indexOf('#');
    if (h > -1) s = s.slice(0, h);
    if (s.slice(-5) === '.html') s = s.slice(0, -5);
    if (s.slice(-6) === '/index') s = s.slice(0, -6);
    if (s.length > 1 && s.slice(-1) === '/') s = s.slice(0, -1);
    if (s === '') s = '/';
    return s;
  }

  function activeIndex(P) {
    var i, j, it, ms, m;
    for (i = 0; i < NAV.length; i++) {
      it = NAV[i];
      ms = it.match || [norm(it.href)];
      for (j = 0; j < ms.length; j++) {
        m = ms[j];
        if (m === '/') {
          if (P === '/') return i;
        } else if (P === m || P.indexOf(m + '/') === 0) {
          return i;
        }
      }
    }
    return -1;
  }

  function arrIndexOf(a, v) {
    for (var i = 0; i < a.length; i++) { if (a[i] === v) return i; }
    return -1;
  }

  function ovAttr(it) {
    return it.ov ? ' data-ov="' + esc(it.ov) + '"' : '';
  }

  /* --- markup builders --- */

  function tabLink(it, on) {
    if (on) return '<a class="tab on" href="' + esc(it.href) + '" aria-current="page"' + ovAttr(it) + '>' + esc(it.label) + '</a>';
    return '<a class="tab" href="' + esc(it.href) + '"' + ovAttr(it) + '>' + esc(it.label) + '</a>';
  }

  function plainLink(it, on) {
    if (on) return '<a class="on" href="' + esc(it.href) + '" aria-current="page">' + esc(it.label) + '</a>';
    return '<a href="' + esc(it.href) + '">' + esc(it.label) + '</a>';
  }

  function panelMainLink(it, on) {
    if (on) return '<a class="on" href="' + esc(it.href) + '" aria-current="page"' + ovAttr(it) + '>' + esc(it.label) + '</a>';
    return '<a href="' + esc(it.href) + '"' + ovAttr(it) + '>' + esc(it.label) + '</a>';
  }

  function bottomLink(it, on) {
    var icon = ICONS[it.href] || '';
    var inner = '<span class="ic">' + SVG_OPEN + icon + SVG_CLOSE + '</span>' + esc(it.short || it.label);
    if (on) return '<a class="on" href="' + esc(it.href) + '" aria-current="page">' + inner + '</a>';
    return '<a href="' + esc(it.href) + '">' + inner + '</a>';
  }

  function tabsHTML(P) {
    var act = activeIndex(P);
    var out = '<!--nav:tabs-->';
    var i, it;
    for (i = 0; i < NAV.length; i++) {
      it = NAV[i];
      if (it.group !== 'main') continue;
      out += tabLink(it, i === act);
    }
    var moreOn = act >= 0 && NAV[act].group === 'more';
    var cls = moreOn ? ' on' : '';
    var btnLabel = moreOn ? NAV[act].label : '더보기';
    out += '<div class="tab-more' + cls + '">' +
      '<button class="tab tab-more-btn' + cls + '" type="button" aria-expanded="false" aria-controls="nav-more">' +
      '<span class="tm-l">' + esc(btnLabel) + '</span></button>' +
      '<div class="more-panel" id="nav-more">';
    out += '<div class="mp-g mp-main"><div class="mp-h">' + esc(H_MAIN) + '</div>';
    for (i = 0; i < NAV.length; i++) {
      it = NAV[i];
      if (it.group !== 'main') continue;
      out += panelMainLink(it, i === act);
    }
    out += '</div>';
    out += '<div class="mp-g"><div class="mp-h">' + esc(H_IND) + '</div>';
    for (i = 0; i < NAV.length; i++) {
      it = NAV[i];
      if (it.group !== 'more' || it.sub !== 'ind') continue;
      out += plainLink(it, i === act);
    }
    out += '</div>';
    out += '<div class="mp-g"><div class="mp-h">' + esc(H_COM) + '</div>';
    for (i = 0; i < NAV.length; i++) {
      it = NAV[i];
      if (it.group !== 'more' || it.sub !== 'com') continue;
      out += plainLink(it, i === act);
    }
    out += '</div></div></div><!--/nav:tabs-->';
    return out;
  }

  function drawerHTML(P) {
    var act = activeIndex(P);
    var out = '<!--nav:drawer-->';
    var i, it;
    out += '<div class="dg-h">' + esc(H_MAIN) + '</div>';
    for (i = 0; i < NAV.length; i++) {
      it = NAV[i];
      if (it.group !== 'main') continue;
      out += plainLink(it, i === act);
    }
    out += '<div class="dg-h">' + esc(H_IND) + '</div>';
    for (i = 0; i < NAV.length; i++) {
      it = NAV[i];
      if (it.group !== 'more' || it.sub !== 'ind') continue;
      out += plainLink(it, i === act);
    }
    out += '<div class="dg-h">' + esc(H_COM) + '</div>';
    for (i = 0; i < NAV.length; i++) {
      it = NAV[i];
      if (it.group !== 'more' || it.sub !== 'com') continue;
      out += plainLink(it, i === act);
    }
    out += '<div class="ddiv"></div>';
    out += '<a class="sub" href="' + esc(TG.href) + '" target="_blank" rel="noopener">' + esc(TG.label) + '</a>';
    out += '<!--/nav:drawer-->';
    return out;
  }

  function bottomHTML(P) {
    var act = activeIndex(P);
    var out = '<!--nav:bottom-->';
    var i, it;
    for (i = 0; i < NAV.length; i++) {
      it = NAV[i];
      if (!it.bottom) continue;
      out += bottomLink(it, i === act);
    }
    out += '<button class="bn-menu" type="button" aria-controls="drawer" aria-expanded="false">' +
      '<span class="ic">' + SVG_OPEN + (ICONS.menu || '') + SVG_CLOSE + '</span>메뉴</button>';
    out += '<!--/nav:bottom-->';
    return out;
  }

  /* --- render (skip when version matches and marker is present) --- */

  function needsRewrite(el, marker) {
    if (!el) return false;
    if (el.getAttribute('data-nav-ver') === NAV_VER && el.innerHTML.indexOf(marker) !== -1) return false;
    return true;
  }

  function render() {
    var P = norm(location.pathname);
    var tabs = document.querySelector('div.nav .tabs');
    if (needsRewrite(tabs, '<!--nav:tabs-->')) {
      tabs.innerHTML = tabsHTML(P);
      tabs.setAttribute('data-nav-ver', NAV_VER);
    }

    var dr = document.querySelector('.drawer');
    if (needsRewrite(dr, '<!--nav:drawer-->')) {
      var dh = dr.querySelector('.dh');
      if (dh) {
        while (dh.nextSibling) dr.removeChild(dh.nextSibling);
      }
      dr.insertAdjacentHTML('beforeend', drawerHTML(P));
      dr.setAttribute('data-nav-ver', NAV_VER);
    }

    var bn = document.querySelector('nav.nav[aria-label="하단 메뉴"]');
    if (needsRewrite(bn, '<!--nav:bottom-->')) {
      bn.innerHTML = bottomHTML(P);
      bn.setAttribute('data-nav-ver', NAV_VER);
    }
  }

  /* --- priority+ overflow --- */

  function fit() {
    var tabs = document.querySelector('div.nav .tabs');
    if (!tabs) return;
    if (window.innerWidth <= 768) return;
    var panel = tabs.querySelector('.more-panel');
    var mpMain = tabs.querySelector('.mp-main');
    var i, list, lnk;

    list = tabs.querySelectorAll('a.tab');
    for (i = 0; i < list.length; i++) list[i].classList.remove('is-ov');
    if (mpMain) {
      lnk = mpMain.querySelectorAll('a');
      for (i = 0; i < lnk.length; i++) lnk[i].classList.remove('is-ov');
    }

    var guard = 0;
    while (tabs.scrollWidth > tabs.clientWidth + 1 && guard < 40) {
      guard++;
      var pick = null;
      var m = tabs.querySelectorAll('a.tab');
      for (i = m.length - 1; i >= 1; i--) {
        if (m[i].classList.contains('on')) continue;
        if (m[i].classList.contains('is-ov')) continue;
        pick = m[i];
        break;
      }
      if (!pick) break;
      pick.classList.add('is-ov');
      var href = pick.getAttribute('href');
      if (mpMain) {
        lnk = mpMain.querySelectorAll('a');
        for (i = 0; i < lnk.length; i++) {
          if (lnk[i].getAttribute('href') === href) lnk[i].classList.add('is-ov');
        }
      }
    }

    if (panel && mpMain) {
      if (mpMain.querySelector('a.is-ov')) panel.classList.add('has-ov');
      else panel.classList.remove('has-ov');
    }
  }

  /* --- dropdown (disclosure) --- */

  function setExpandedBtn(btn, on) {
    if (btn) btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  function openWrap(wrap) {
    if (!wrap) return;
    wrap.classList.add('open');
    setExpandedBtn(wrap.querySelector('.tab-more-btn'), true);
  }

  function closeWrap(wrap) {
    if (!wrap) return;
    wrap.classList.remove('open');
    setExpandedBtn(wrap.querySelector('.tab-more-btn'), false);
  }

  function closeAllPanels() {
    var open = document.querySelectorAll('.tab-more.open');
    for (var i = 0; i < open.length; i++) closeWrap(open[i]);
  }

  function panelLinks(panel) {
    var out = [];
    if (!panel) return out;
    var a = panel.querySelectorAll('a[href]');
    for (var i = 0; i < a.length; i++) {
      if (a[i].offsetParent !== null) out.push(a[i]);
    }
    return out;
  }

  /* --- drawer --- */

  var lastOpener = null;

  function drawerEl() {
    return document.querySelector('.drawer');
  }

  function setInert(el, on) {
    if (!el) return;
    try { el.inert = !!on; } catch (err) { /* older browsers */ }
    if (on) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }

  function isVisible(el) {
    if (!el || !el.getClientRects) return false;
    return el.getClientRects().length > 0;
  }

  function firstVisibleHam() {
    var h = document.querySelectorAll('.ham');
    for (var i = 0; i < h.length; i++) { if (isVisible(h[i])) return h[i]; }
    return null;
  }

  function firstDrawerLink(dr) {
    var a = dr.querySelectorAll('a[href]');
    for (var i = 0; i < a.length; i++) {
      if (a[i].closest('.dh')) continue;
      return a[i];
    }
    return null;
  }

  function setOpenersExpanded(on) {
    var o = document.querySelectorAll('.ham, .bn-menu');
    for (var i = 0; i < o.length; i++) o[i].setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  function openDrawer(opener) {
    var dr = drawerEl();
    if (!dr) return;
    lastOpener = opener || null;
    document.body.classList.add('navopen');
    setInert(dr, false);
    dr.removeAttribute('aria-hidden');
    setOpenersExpanded(true);
    document.body.style.overflow = 'hidden';
    var target = firstDrawerLink(dr) || dr.querySelector('.x');
    if (target) target.focus();
  }

  function closeDrawer(moveFocus) {
    var dr = drawerEl();
    if (dr) {
      document.body.classList.remove('navopen');
      setInert(dr, true);
      dr.setAttribute('aria-hidden', 'true');
    }
    setOpenersExpanded(false);
    document.body.style.overflow = '';
    if (moveFocus === false) return;
    var el = (lastOpener && isVisible(lastOpener)) ? lastOpener : firstVisibleHam();
    if (el) el.focus();
  }

  function trapTab(e) {
    var dr = drawerEl();
    if (!dr) return;
    var raw = dr.querySelectorAll('a[href], button, [tabindex]:not([tabindex="-1"])');
    var f = [];
    for (var i = 0; i < raw.length; i++) {
      if (raw[i].disabled) continue;
      if (!isVisible(raw[i])) continue;
      f.push(raw[i]);
    }
    if (!f.length) return;
    var first = f[0];
    var last = f[f.length - 1];
    var ae = document.activeElement;
    if (e.shiftKey) {
      if (ae === first || !dr.contains(ae)) { e.preventDefault(); last.focus(); }
    } else {
      if (ae === last || !dr.contains(ae)) { e.preventDefault(); first.focus(); }
    }
  }

  /* --- events (delegated on document) --- */

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var opener = t.closest('.ham') || t.closest('.bn-menu');
    if (opener) { openDrawer(opener); return; }

    if (t.closest('.drawer .x') || t.closest('.backdrop')) {
      closeDrawer();
      return;
    }

    var btn = t.closest('.tab-more-btn');
    if (btn) {
      var wrap = btn.parentNode;
      if (wrap.classList.contains('open')) closeWrap(wrap);
      else openWrap(wrap);
      return;
    }

    if (!t.closest('.tab-more')) closeAllPanels();
  });

  document.addEventListener('focusout', function (e) {
    var t = e.target;
    var wrap = t && t.closest ? t.closest('.tab-more') : null;
    if (!wrap || !wrap.classList.contains('open')) return;
    var rt = e.relatedTarget;
    if (rt && wrap.contains(rt)) return;
    setTimeout(function () {
      var ae = document.activeElement;
      if (ae && wrap.contains(ae)) return;
      if (wrap.classList.contains('open')) closeWrap(wrap);
    }, 0);
  });

  document.addEventListener('keydown', function (e) {
    var key = e.key || '';
    var code = e.keyCode || 0;

    if (document.body.classList.contains('navopen')) {
      if (key === 'Escape' || code === 27) { e.preventDefault(); closeDrawer(); return; }
      if (key === 'Tab' || code === 9) { trapTab(e); return; }
    }

    if (key === 'Escape' || code === 27) {
      var opened = document.querySelector('.tab-more.open');
      if (opened) {
        var ob = opened.querySelector('.tab-more-btn');
        var inside = document.activeElement && opened.contains(document.activeElement);
        closeAllPanels();
        if (inside && ob) ob.focus();
        e.preventDefault();
      }
      return;
    }

    var k = key;
    if (!k) {
      if (code === 40) k = 'ArrowDown';
      else if (code === 38) k = 'ArrowUp';
      else if (code === 36) k = 'Home';
      else if (code === 35) k = 'End';
    }

    var ae = document.activeElement;
    if (!ae || !ae.closest) return;
    var wrap2 = ae.closest('.tab-more');
    if (!wrap2) return;
    var btn2 = ae.closest('.tab-more-btn');

    if (k === 'ArrowDown' || k === 'ArrowUp') {
      if (btn2) {
        e.preventDefault();
        openWrap(wrap2);
        var links = panelLinks(wrap2.querySelector('.more-panel'));
        if (!links.length) return;
        links[k === 'ArrowDown' ? 0 : links.length - 1].focus();
        return;
      }
      if (ae.nodeName === 'A') {
        var ls = panelLinks(wrap2.querySelector('.more-panel'));
        var idx = arrIndexOf(ls, ae);
        if (idx < 0) return;
        e.preventDefault();
        var n = ls.length;
        var ni = k === 'ArrowDown' ? (idx + 1) % n : (idx - 1 + n) % n;
        ls[ni].focus();
      }
      return;
    }

    if ((k === 'Home' || k === 'End') && ae.nodeName === 'A') {
      var ls2 = panelLinks(wrap2.querySelector('.more-panel'));
      if (!ls2.length || arrIndexOf(ls2, ae) < 0) return;
      e.preventDefault();
      ls2[k === 'Home' ? 0 : ls2.length - 1].focus();
    }
  });

  /* --- init --- */

  var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
  var resizePending = false;

  function onResize() {
    if (window.innerWidth > 768 && document.body.classList.contains('navopen')) closeDrawer(false);
    fit();
  }

  function init() {
    var navBar = document.querySelector('div.nav');
    if (navBar) navBar.classList.add('js-ov');

    var dr = drawerEl();
    if (dr) {
      if (!dr.id) dr.id = 'drawer';
      if (!document.body.classList.contains('navopen')) {
        setInert(dr, true);
        dr.setAttribute('aria-hidden', 'true');
      }
      var op = document.querySelectorAll('.ham, .bn-menu');
      for (var i = 0; i < op.length; i++) {
        if (!op[i].getAttribute('aria-controls')) op[i].setAttribute('aria-controls', 'drawer');
        if (!op[i].getAttribute('aria-expanded')) op[i].setAttribute('aria-expanded', 'false');
      }
    }

    render();
    fit();

    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () { fit(); });
    }

    var slot = document.getElementById('authSlot');
    if (slot && window.MutationObserver) {
      new MutationObserver(function () { fit(); }).observe(slot, {
        childList: true, subtree: true, attributes: true
      });
    }

    window.addEventListener('resize', function () {
      if (resizePending) return;
      resizePending = true;
      raf(function () { resizePending = false; onResize(); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.ANTINFO_NAV = { items: NAV, render: render, fit: fit, version: NAV_VER };
})();