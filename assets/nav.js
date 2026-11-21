/* ANTINFO 공용 내비게이션 — 단일 소스.
   NAV/ICONS 를 고친 뒤 python3 scripts/sync_nav.py 를 실행하면 모든 페이지에 반영됩니다. */
(function () {
  'use strict';

  var NAV = /*NAV-START*/[
 {"label":"대시보드","href":"/","match":["/","/m"],"group":"main","bottom":true},
 {"label":"마켓","href":"/market","group":"main","bottom":true},
 {"label":"매크로뉴스","href":"/macro-news","group":"main","bottom":true},
 {"label":"주요자산차트","href":"/charts","group":"main","bottom":true},
 {"label":"K-거래소 현황","href":"/kr-exchange/","match":["/kr-exchange"],"group":"main","bottom":true},
 {"label":"바이백 보드","href":"/revenue-meta","group":"main"},
 {"label":"에어드랍","href":"/airdrop","group":"main","bottom":true},
 {"label":"시그널","href":"/signal","group":"more"},
 {"label":"공포탐욕지수","href":"/fng","group":"more"},
 {"label":"경제 캘린더","href":"/calendar","group":"more"},
 {"label":"언락 캘린더","href":"/unlocks","group":"more"},
 {"label":"이벤트 모음","href":"/events","group":"more"},
 {"label":"당첨자 확인","href":"/winners/","match":["/winners"],"group":"more"},
 {"label":"인사이트","href":"/posts/","match":["/posts"],"group":"more"},
 {"label":"코인과세유예 후원","href":"/donate","group":"more"}
]/*NAV-END*/;
  var TG = { label: '텔레그램 채널', href: 'https://t.me/fireant_crypto' };
  var ICONS = /*ICONS-START*/{
 "/": "<path d='M3 10.5 12 3l9 7.5V21H3z'/><path d='M9 21v-7h6v7'/>",
 "/market": "<polyline points='3 17 9 11 13 15 21 7'/><polyline points='15 7 21 7 21 13'/>",
 "/macro-news": "<rect x='3' y='5' width='14' height='14' rx='2'/><path d='M17 9h4v8a2 2 0 0 1-2 2'/><path d='M7 9h6M7 13h6M7 16h4'/>",
 "/charts": "<path d='M7 3v4M7 17v4'/><rect x='5' y='7' width='4' height='10' rx='1'/><path d='M17 5v3M17 16v3'/><rect x='15' y='8' width='4' height='8' rx='1'/>",
 "/kr-exchange/": "<path d='M3 10 12 4l9 6'/><path d='M5 21v-8M9 21v-8M15 21v-8M19 21v-8M3 21h18'/>",
 "/airdrop": "<rect x='3' y='8' width='18' height='13' rx='2'/><path d='M3 12h18M12 8v13'/><path d='M12 8H8.5a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8zM12 8h3.5a2.5 2.5 0 0 0 0-5C13 3 12 8 12 8z'/>"
}/*ICONS-END*/;

  var SVG_OPEN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var SVG_CLOSE = '</svg>';

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

  function tabLink(it, on) {
    if (on) return '<a class="tab on" href="' + esc(it.href) + '" aria-current="page">' + esc(it.label) + '</a>';
    return '<a class="tab" href="' + esc(it.href) + '">' + esc(it.label) + '</a>';
  }

  function plainLink(it, on) {
    if (on) return '<a class="on" href="' + esc(it.href) + '" aria-current="page">' + esc(it.label) + '</a>';
    return '<a href="' + esc(it.href) + '">' + esc(it.label) + '</a>';
  }

  function bottomLink(it, on) {
    var icon = ICONS[it.href] || '';
    var inner = '<span class="ic">' + SVG_OPEN + icon + SVG_CLOSE + '</span>' + esc(it.label);
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
    out += '<div class="tab-more"><button class="tab tab-more-btn' + (moreOn ? ' on' : '') + '" type="button" aria-haspopup="true" aria-expanded="false">더보기</button><div class="more-panel">';
    for (i = 0; i < NAV.length; i++) {
      it = NAV[i];
      if (it.group !== 'more') continue;
      out += plainLink(it, i === act);
    }
    out += '</div></div><!--/nav:tabs-->';
    return out;
  }

  function drawerHTML(P) {
    var act = activeIndex(P);
    var out = '<!--nav:drawer-->';
    var i, it;
    for (i = 0; i < NAV.length; i++) {
      it = NAV[i];
      if (it.group !== 'main') continue;
      out += plainLink(it, i === act);
    }
    out += '<div class="ddiv"></div>';
    for (i = 0; i < NAV.length; i++) {
      it = NAV[i];
      if (it.group !== 'more') continue;
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
    out += '<!--/nav:bottom-->';
    return out;
  }

  function render() {
    var P = norm(location.pathname);

    var tabs = document.querySelector('.nav .tabs');
    if (tabs) tabs.innerHTML = tabsHTML(P);

    var dr = document.querySelector('.drawer');
    if (dr) {
      var dh = dr.querySelector('.dh');
      if (dh) {
        while (dh.nextSibling) dr.removeChild(dh.nextSibling);
      }
      dr.insertAdjacentHTML('beforeend', drawerHTML(P));
    }

    var bn = document.querySelector('nav.nav[aria-label="하단 메뉴"]');
    if (bn) bn.innerHTML = bottomHTML(P);
  }

  function closeAll() {
    var open = document.querySelectorAll('.tab-more.open');
    for (var i = 0; i < open.length; i++) {
      open[i].classList.remove('open');
      var b = open[i].querySelector('.tab-more-btn');
      if (b) b.setAttribute('aria-expanded', 'false');
    }
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var btn = t && t.closest ? t.closest('.tab-more-btn') : null;
    if (btn) {
      var wrap = btn.parentNode;
      var on = !wrap.classList.contains('open');
      if (on) wrap.classList.add('open'); else wrap.classList.remove('open');
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
      return;
    }
    if (!(t && t.closest && t.closest('.tab-more'))) closeAll();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.keyCode === 27) closeAll();
  });

  if (document.readyState !== 'loading') render();
  else document.addEventListener('DOMContentLoaded', render);

  window.ANTINFO_NAV = { items: NAV, render: render };
})();