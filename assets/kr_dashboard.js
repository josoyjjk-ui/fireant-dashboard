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
    ['kr-shares', 'kr-kimchi', 'kr-vol-top', 'kr-gain-top', 'kr-arb', 'kr-perex'].forEach(function (id) {
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
    var root = document.getElementById('kr-kimchi');
    if (!root) return;
    var kp = data.kimchi_premium || {};
    var p = toNum(kp.btc_pct);
    if (p === null) {
      root.innerHTML = '<div class="kr-kimchi-val kr-flat">산출 불가</div>'
        + (kp.note ? '<div class="kr-kimchi-note">' + esc(kp.note) + '</div>' : '');
      return;
    }
    root.innerHTML = ''
      + '<div class="kr-kimchi-val ' + changeClass(p) + '">' + fmtPct(p, true) + '</div>'
      + (kp.note ? '<div class="kr-kimchi-note">' + esc(kp.note) + '</div>' : '');
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
        + '<td class="l sym">' + esc(r.symbol) + '</td>'
        + '<td>' + fmtPrice(r.price) + '</td>'
        + '<td class="' + changeClass(ch) + '">' + fmtPct(ch, true) + '</td>'
        + '<td>' + fmtVol(r.vol_krw) + '</td>'
        + '<td><span class="kr-exch-badge">' + esc(r.exchange) + '</span></td>'
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
      body += ''
        + '<tr' + hot + '>'
        +   '<td class="l sym">' + esc(r.symbol) + '</td>'
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
  function perexListHTML(items, kind) {
    if (!items || !items.length) return '<div class="kr-perex-empty">데이터 없음</div>';
    return items.slice(0, 3).map(function (it) {
      var sym = '<span class="sym">' + esc(it.symbol) + '</span>';
      if (kind === 'gainers') {
        var ch = toNum(it.change_pct);
        return '<div class="kr-perex-item">' + sym + '<span class="' + changeClass(ch) + '">' + fmtPct(ch, true) + '</span></div>';
      }
      return '<div class="kr-perex-item">' + sym + '<span class="vol">' + fmtVol(it.vol_krw) + '원</span></div>';
    }).join('');
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
        +     '<div class="kr-perex-list">' + perexListHTML(p.gainers_top10, 'gainers') + '</div></div>'
        +   '<div class="kr-perex-sub"><div class="kr-perex-sub-title">거래량 TOP3</div>'
        +     '<div class="kr-perex-list">' + perexListHTML(p.volume_top10, 'volume') + '</div></div>'
        + '</div>';
    });
    root.innerHTML = html + '</div>';
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

  function init() {
    var btn = document.getElementById('kr-refresh');
    if (btn) btn.addEventListener('click', load);
    load();
    setInterval(load, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
