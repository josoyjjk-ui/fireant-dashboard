/* 실시간 한국거래소 데이터 대시보드 — kr-exchange/index.html 전용
 * 데이터 소스: ../data/v1/kr_exchange.json (cache: no-store)
 * 색상: 기존 페이지 다크 테마 변수 재사용 + 거래소 브랜드 컬러
 * 국내 관습: 상승=빨강(var(--red)), 하락=파랑(var(--blue))
 */
(function () {
  'use strict';

  var REFRESH_MS = 60000; // 1분 자동 새로고침

  // 거래소 색상 (지시: 업비트=파랑, 빗썸=주황, 코인원=노랑, 코빗=청록, 고팍스=보라)
  var EX_COLORS = {
    upbit:   '#1499DA',
    bithumb: '#F7981C',
    coinone: '#FFD740',
    korbit:  '#00C4B4',
    gopax:   '#8B5CF6'
  };
  var EX_ORDER = ['upbit', 'bithumb', 'coinone', 'korbit', 'gopax'];
  var EX_NAMES = { upbit: '업비트', bithumb: '빗썸', coinone: '코인원', korbit: '코빗', gopax: '고팍스' };
  var EX_NAME2KEY = { '업비트': 'upbit', '빗썸': 'bithumb', '코인원': 'coinone', '코빗': 'korbit', '고팍스': 'gopax' };
  var EVENT_NOTICE = '💡 이벤트는 거래소 공식 공지에서 자동 수집됩니다(최신순). 상세·조건은 각 거래소 공식 채널 확인.';
  function exLogoHTML(name) {
    var key = EX_NAME2KEY[name];
    if (key) return '<img class="kr-exch-logo" src="logos/' + key + '.jpg" alt="' + esc(name) + '" title="' + esc(name) + '" loading="lazy">';
    return '<span class="kr-exch-badge">' + esc(name) + '</span>';
  }

  function coinLogoHTML(url) {
    if (!url) return '';
    return '<img class="kr-coin-logo" src="' + esc(url) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">';
  }

  /* ---------- 숫자 포맷 (한국식: 조/억/만) ---------- */
  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }
  // 거래대금: 조/억/만
  function fmtVol(v) {
    v = toNum(v); if (v === null) return '—';
    var abs = Math.abs(v);
    if (abs >= 1e12) return (v / 1e12).toFixed(2) + '조';
    if (abs >= 1e8)  return Math.round(v / 1e8).toLocaleString('ko-KR') + '억';
    if (abs >= 1e4)  return Math.round(v / 1e4).toLocaleString('ko-KR') + '만';
    return Math.round(v).toLocaleString('ko-KR');
  }
  // 현재가: 조/억원, 아니면 콤마 원
  function fmtPrice(v) {
    v = toNum(v); if (v === null) return '—';
    var abs = Math.abs(v);
    if (abs >= 1e12) return (v / 1e12).toFixed(2) + '조원';
    if (abs >= 1e8)  return (v / 1e8).toFixed(2) + '억원';
    if (abs >= 1)    return Math.round(v).toLocaleString('ko-KR') + '원';
    return v.toFixed(2) + '원';
  }
  // 등락률: 소수 1자리, 양수면 부호
  function fmtPct(v, withSign) {
    v = toNum(v); if (v === null) return '—';
    var s = v.toFixed(1) + '%';
    return (withSign && v > 0) ? '+' + s : s;
  }
  function changeClass(v) {
    v = toNum(v); if (v === null) return 'kr-flat';
    if (v > 0) return 'kr-up';
    if (v < 0) return 'kr-down';
    return 'kr-flat';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function setText(id, t) { var el = document.getElementById(id); if (el) el.textContent = t; }

  /* ---------- 에러 / 로딩 ---------- */
  function statusHTML(msg) { return '<div class="kr-status">' + esc(msg) + '</div>'; }
  function failAll(msg) {
    ['kr-shares', 'kr-kimchi', 'kr-kimchi-widget', 'kr-vol-top', 'kr-gain-top', 'kr-arb', 'kr-perex'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = statusHTML(msg);
    });
    var tot = document.getElementById('kr-total');
    if (tot) tot.textContent = '';
    setText('kr-updated', '로딩 실패');
  }

  /* ---------- 1. 거래대금 점유율 ---------- */
  function renderShares(data) {
    var root = document.getElementById('kr-shares');
    if (!root) return;
    var ex = data.exchanges || {};
    var maxPct = 0;
    EX_ORDER.forEach(function (k) {
      var p = toNum(ex[k] && ex[k].share_pct);
      if (p !== null && p > maxPct) maxPct = p;
    });
    var html = '';
    EX_ORDER.forEach(function (k) {
      var e = ex[k] || {};
      var pct = toNum(e.share_pct);
      var color = EX_COLORS[k];
      var w = (maxPct > 0 && pct !== null) ? Math.max(1.5, (pct / maxPct) * 100) : 0;
      html += ''
        + '<div class="kr-share-row">'
        +   '<div class="kr-share-info">'
        +     '<span class="kr-share-name" style="color:' + color + '">' + esc(e.name || k) + '</span>'
        +     '<span class="kr-share-vol">' + fmtVol(e.vol_24h_krw) + '원</span>'
        +     '<span class="kr-share-pct">' + (pct === null ? '—' : pct.toFixed(2) + '%') + '</span>'
        +   '</div>'
        +   '<div class="kr-share-track">'
        +     '<div class="kr-share-fill" style="width:' + w.toFixed(1) + '%;background:' + color + '"></div>'
        +   '</div>'
        + '</div>';
    });
    root.innerHTML = html;

    var tot = document.getElementById('kr-total');
    if (tot) {
      var tv = toNum(data.total_vol_krw);
      tot.innerHTML = '<span>합계 거래대금 (24h)</span><b>' + fmtVol(data.total_vol_krw) + '원</b>';
    }
  }

  /* ---------- 2. 김치 프리미엄 ---------- */
  function renderKimchi(data) {
    var kp = data.kimchi_premium || {};
    var p = toNum(kp.btc_pct);
    var note = kp.note ? '<div class="kr-kimchi-note">' + esc(kp.note) + '</div>' : '';
    var valHTML = (p === null)
      ? '<div class="kr-kimchi-val kr-flat">산출 불가</div>'
      : '<div class="kr-kimchi-val ' + changeClass(p) + '">' + fmtPct(p, true) + '</div>';
    var root = document.getElementById('kr-kimchi');
    if (root) root.innerHTML = valHTML + note;
    // 우측 위젯 카드에는 큰 수치만 렌더 (note 생략)
    var widget = document.getElementById('kr-kimchi-widget');
    if (widget) widget.innerHTML = valHTML;
  }

  /* ---------- 3. TOP 10 표 ---------- */
  function tableHTML(rows) {
    if (!rows || !rows.length) return statusHTML('데이터 없음');
    var body = '';
    rows.forEach(function (r) {
      var ch = toNum(r.change_pct);
      body += ''
        + '<tr>'
        + '<td class="rank">' + esc(r.rank != null ? r.rank : '') + '</td>'
        + '<td class="l sym">' + coinLogoHTML(r.logo) + esc(r.symbol) + '</td>'
        + '<td>' + fmtPrice(r.price) + '</td>'
        + '<td class="' + changeClass(ch) + '">' + fmtPct(ch, true) + '</td>'
        + '<td>' + fmtVol(r.vol_krw) + '</td>'
        + '<td>' + exLogoHTML(r.exchange) + '</td>'
        + '</tr>';
    });
    return ''
      + '<table class="kr-table">'
      + '<thead><tr>'
      + '<th class="l">#</th><th class="l">종목</th>'
      + '<th>현재가</th><th>등락</th><th>거래대금</th><th>거래소</th>'
      + '</tr></thead>'
      + '<tbody>' + body + '</tbody>'
      + '</table>';
  }
  function renderTops(data) {
    var v = document.getElementById('kr-vol-top');
    var g = document.getElementById('kr-gain-top');
    if (v) v.innerHTML = tableHTML(data.volume_top10);
    if (g) g.innerHTML = tableHTML(data.gainers_top10);
  }

  /* ---------- 4. 차익거래 기회 (거래소간 가격 이격) ---------- */
  // 차익 비교용 가격: 한국식 콤마, 초저가는 소수 유지 (단위 미표기)
  function fmtArbPrice(v) {
    v = toNum(v); if (v === null) return '—';
    var abs = Math.abs(v);
    if (abs >= 1) return Math.round(v).toLocaleString('ko-KR');
    if (abs >= 0.01) return v.toFixed(4);
    if (abs >= 0.0001) return v.toFixed(6);
    return v.toFixed(8);
  }
  function renderArbitrage(data) {
    var root = document.getElementById('kr-arb');
    if (!root) return;
    var rows = data.arbitrage;
    if (!rows || !rows.length) { root.innerHTML = statusHTML('데이터 준비중'); return; }
    var body = '';
    rows.slice(0, 10).forEach(function (r) {
      var gap = toNum(r.gap_pct);
      var kim = toNum(r.kimchi_pct);
      var hot = (gap !== null && gap >= 2) ? ' class="hot"' : '';
      var logo = r.logo ? '<img src="' + esc(r.logo) + '" alt="" width="18" height="18" loading="lazy" style="border-radius:50%;vertical-align:middle;margin-right:6px">' : '';
      body += ''
        + '<tr' + hot + '>'
        +   '<td class="l sym">' + logo + esc(r.symbol) + '</td>'
        +   '<td><span class="kr-arb-ex">' + esc(r.low_ex) + '</span><span class="kr-arb-px">' + fmtArbPrice(r.low_price) + '</span></td>'
        +   '<td><span class="kr-arb-ex">' + esc(r.high_ex) + '</span><span class="kr-arb-px">' + fmtArbPrice(r.high_price) + '</span></td>'
        +   '<td>' + fmtArbPrice(r.global_krw) + '</td>'
        +   '<td class="' + changeClass(gap) + '">' + fmtPct(gap, true) + '</td>'
        +   '<td class="' + changeClass(kim) + '">' + fmtPct(kim, true) + '</td>'
        + '</tr>';
    });
    root.innerHTML = ''
      + '<table class="kr-arb-table">'
      +   '<thead><tr>'
      +     '<th class="l">코인</th>'
      +     '<th>국내 최저가</th><th>국내 최고가</th><th>글로벌</th>'
      +     '<th>이격률</th><th>김프</th>'
      +   '</tr></thead>'
      +   '<tbody>' + body + '</tbody>'
      + '</table>'
      + '<div class="kr-arb-src">출처: CoinGecko</div>';
  }

  /* ---------- 5. 거래소별 TOP3 ---------- */
  function perexListHTML(items) {
    if (!items || !items.length) return '<div class="kr-perex-empty">데이터 없음</div>';
    var hdr = '<div class="kr-perex-item hdr"><span class="sym">종목</span><span class="px">가격</span><span class="vol">거래량</span></div>';
    var body = items.slice(0, 3).map(function (it) {
      return '<div class="kr-perex-item">'
        + '<span class="sym">' + coinLogoHTML(it.logo) + esc(it.symbol) + '</span>'
        + '<span class="px">' + fmtPrice(it.price) + '</span>'
        + '<span class="vol">' + fmtVol(it.vol_krw) + '원</span>'
        + '</div>';
    }).join('');
    return hdr + body;
  }
  function renderPerExTop3(data) {
    var root = document.getElementById('kr-perex');
    if (!root) return;
    var per = data.per_exchange;
    if (!per) { root.innerHTML = statusHTML('데이터 준비중'); return; }
    var hasAny = EX_ORDER.some(function (k) { return per[k]; });
    if (!hasAny) { root.innerHTML = statusHTML('데이터 준비중'); return; }
    var ex = data.exchanges || {};
    var html = '<div class="kr-perex-grid">';
    EX_ORDER.forEach(function (k) {
      var p = per[k];
      var name = (ex[k] && ex[k].name) || EX_NAMES[k] || k;
      var color = EX_COLORS[k];
      var logo = 'logos/' + k + '.jpg';
      var head = '<div class="kr-perex-head"><img class="kr-perex-logo" src="' + logo + '" alt="' + esc(name) + '" loading="lazy">'
        + '<span class="kr-perex-name" style="color:' + color + '">' + esc(name) + '</span></div>';
      if (!p) {
        html += '<div class="kr-perex-card">' + head + '<div class="kr-perex-empty">데이터 없음</div></div>';
        return;
      }
      html += ''
        + '<div class="kr-perex-card">' + head
        +   '<div class="kr-perex-sub"><div class="kr-perex-sub-title">상승률 TOP3</div>'
        +     '<div class="kr-perex-list">' + perexListHTML(p.gainers_top10) + '</div></div>'
        +   '<div class="kr-perex-sub"><div class="kr-perex-sub-title">거래량 TOP3</div>'
        +     '<div class="kr-perex-list">' + perexListHTML(p.volume_top10) + '</div></div>'
        + '</div>';
    });
    root.innerHTML = html + '</div>';
  }

  /* ---------- 거래소 이벤트 ---------- */
  function eventNoticeHTML() {
    return '<div class="notice">' + esc(EVENT_NOTICE) + '</div>';
  }

  function eventEmptyHTML() {
    return '<div class="ev-empty">현재 확인된 진행 중 이벤트가 없습니다 / 공식 채널 확인</div>';
  }

  function renderEventCards(events) {
    if (!events || !events.length) return eventEmptyHTML();
    return events.map(function (ev) {
      return ''
        + '<div class="ev-card">'
        +   '<div class="ev-title"><a href="' + esc(ev.url) + '" target="_blank" rel="noopener noreferrer">' + esc(ev.title) + '</a></div>'
        +   '<div class="ev-meta">'
        +     (ev.date ? '<span>등록 ' + esc(ev.date) + '</span>' : '')
        +     '<span>공식 공지</span>'
        +   '</div>'
        + '</div>';
    }).join('');
  }

  function bindEventToggles(root) {
    root.querySelectorAll('.section-head').forEach(function (head) {
      head.addEventListener('click', function () {
        var section = head.closest('.section');
        if (section) section.classList.toggle('open');
      });
    });
  }

  function renderEvents(data) {
    var root = document.getElementById('kr-events');
    if (!root) return;
    var exchanges = (data && data.exchanges) || {};
    var html = '<div class="ev-grid">';
    EX_ORDER.forEach(function (key) {
      var ex = exchanges[key] || {};
      var name = ex.name || EX_NAMES[key] || key;
      var source = ex.source || 'unavailable';
      var events = Array.isArray(ex.events) ? ex.events : [];
      var count = source === 'unavailable' ? 0 : events.length;
      var countClass = count > 0 ? 'ev-count' : 'ev-count zero';
      var openClass = 'section'; // 접힘 디폴트(클릭 시 펼침)
      html += ''
        + '<div class="' + openClass + '">'
        +   '<div class="section-head">'
        +     '<img class="exch-logo" src="logos/' + key + '.jpg" alt="' + esc(name) + '" loading="lazy">'
        +     '<h2 class="' + key + '">' + esc(name) + '</h2>'
        +     '<span class="exch-badge">' + esc(key.toUpperCase()) + '</span>'
        +     '<span class="' + countClass + '">' + count + '</span>'
        +   '</div>'
        +   '<div class="ev-body">' + renderEventCards(source === 'unavailable' ? [] : events) + '</div>'
        + '</div>';
    });
    root.innerHTML = html + '</div>' + eventNoticeHTML();
    bindEventToggles(root);
  }

  function failEvents(msg) {
    var root = document.getElementById('kr-events');
    if (root) root.innerHTML = statusHTML(msg) + eventNoticeHTML();
  }

  /* ---------- 갱신 시각 ---------- */
  function fmtUpdated(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------- 적용 / 로드 ---------- */
  function apply(data) {
    if (!data || !data.exchanges) { failAll('데이터 형식 오류'); return; }
    renderShares(data);
    renderKimchi(data);
    renderTops(data);
    renderArbitrage(data);
    renderPerExTop3(data);
    var upd = fmtUpdated(data.generated_at);
    setText('kr-updated', upd ? '업데이트: ' + upd : '업데이트됨');
  }

  function load() {
    fetch('../data/v1/kr_exchange.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(apply)
      .catch(function (e) {
        failAll('데이터 로딩 실패');
        console.error('[kr_dashboard] load error', e);
      });
  }

  function loadEvents() {
    fetch('../data/v1/kr_events.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(renderEvents)
      .catch(function (e) {
        failEvents('이벤트 로딩 실패');
        console.error('[kr_dashboard] event load error', e);
      });
  }

  /* ---------- 유의종목 ---------- */
  function renderCaution(data) {
    var root = document.getElementById('kr-caution-body');
    if (!root) return;
    var ex = (data && data.exchanges) || {};
    var html = '<div class="kr-caut-grid">';
    EX_ORDER.forEach(function (k) {
      var e = ex[k] || {};
      var name = e.name || EX_NAMES[k] || k;
      var items = Array.isArray(e.items) ? e.items : [];
      var body = items.length ? items.map(function (it) {
        var cls = (it.status && it.status.indexOf('상장폐지') >= 0) ? 'del' : 'warn';
        var coin = it.coin ? '<b>' + esc(it.coin) + '</b> ' : '';
        return '<div class="kr-caut-item"><a href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer">'
          + coin + esc(it.title) + '</a><div class="kr-caut-meta">'
          + '<span class="kr-caut-badge ' + cls + '">' + esc(it.status || '유의') + '</span>'
          + (it.date ? '<span class="kr-caut-date">지정 ' + esc(it.date) + '</span>' : '')
          + (it.deadline ? '<span class="kr-caut-deadline">⏳ 기한 ' + esc(it.deadline) + '</span>' : '')
          + '</div></div>';
      }).join('') : '<div class="kr-caut-empty">현재 확인된 유의종목 없음</div>';
      html += '<div class="kr-caut-col"><div class="kr-caut-ex">'
        + '<img src="logos/' + k + '.jpg" alt="' + esc(name) + '" loading="lazy">' + esc(name) + '</div>'
        + body + '</div>';
    });
    root.innerHTML = html + '</div>';
  }
  function loadCaution() {
    fetch('../data/v1/kr_caution.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(renderCaution)
      .catch(function (e) {
        var el = document.getElementById('kr-caution-body');
        if (el) el.innerHTML = statusHTML('유의종목 로딩 실패');
        console.error('[kr_dashboard] caution load error', e);
      });
  }

  function init() {
    var btn = document.getElementById('kr-refresh');
    if (btn) btn.addEventListener('click', function (e) { e.stopPropagation(); load(); loadEvents(); loadCaution(); });
    // 섹션 헤더 클릭 → 접기/펼치기 (기본 접힘: .kr-collapsed). 새로고침 버튼은 토글에서 제외.
    var head = document.getElementById('kr-data-head');
    if (head) head.addEventListener('click', function (e) {
      if (e.target.closest('#kr-refresh')) return;
      var sec = document.getElementById('kr-data');
      if (sec) sec.classList.toggle('kr-collapsed');
    });
    load();
    loadEvents();
    loadCaution();
    setInterval(function () { load(); loadEvents(); loadCaution(); }, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
