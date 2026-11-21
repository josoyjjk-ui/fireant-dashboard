(function () {
  'use strict';

  var ENDPOINT = 'data/v1/revenue_meta.json';
  var TOP_N = 5; // 상위 순위 섹션에 항상 보이는 행 수
  var TEXT_KEYS = { symbol: 1, policy_note: 1, disp_simple: 1 }; // 텍스트 컬럼: 사전순 정렬
  var ASC_KEYS = { rank: 1, policy_note: 1, disp_simple: 1 }; // 첫 클릭 오름차순
  var NCOL = 8;
  var DISPO_CLS = { '소각': 'burn', '재단 보관': 'treas', '혼합': 'mix', '없음': 'none' };
  var state = { rows: [], top: 20, key: 'bb_supply_pct', dir: -1, open: false, max: 0, extra: 0 };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function usd(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(v).toLocaleString('en-US');
  }
  function tok(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e8 ? 1 : 2) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return Math.round(v).toLocaleString('en-US');
  }
  function supplyPct(v) { // 10% 미만은 소수 2자리, 그 이상은 1자리
    if (v == null || !isFinite(v)) return null;
    var p = v * 100;
    return (p < 10 ? p.toFixed(2) : p.toFixed(1)) + '%';
  }
  function pct1(v) { return (v == null || !isFinite(v)) ? null : (v * 100).toFixed(1) + '%'; }
  function mult(v) { return (v == null || !isFinite(v)) ? '—' : (v < 10 ? v.toFixed(1) : String(Math.round(v))) + 'x'; }
  function na(s) { return '<span class="rm-na">' + s + '</span>'; }
  function ym(d) { return String(d).slice(0, 7).replace(/-/g, '.'); }
  function kst(iso) {
    try {
      return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) + ' (KST)';
    } catch (e) { return iso || '—'; }
  }
  function tip(parts) {
    parts = (parts || []).filter(function (s) { return !!s; });
    return parts.length ? ' title="' + esc(parts.join(' · ')) + '"' : '';
  }
  function isEst(r) { return r.alltime_basis === '추정'; }
  function safeUrl(u) { return (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : null; }
  function rankTip(r) { return r.rank == null ? '30일 매출 순위 —' : '30일 매출 ' + r.rank + '위'; }

  // ---------- 정렬 ----------
  function sortRows(rows) {
    var k = state.key, d = state.dir;
    return rows.slice().sort(function (a, b) {
      var x = a[k], y = b[k];
      var xn = (x == null || x === ''), yn = (y == null || y === '');
      if (xn || yn) return xn === yn ? ((a.rank || 99) - (b.rank || 99)) : (xn ? 1 : -1); // null은 항상 맨 뒤
      if (TEXT_KEYS[k]) return d * String(x).localeCompare(String(y), 'ko') || ((a.rank || 99) - (b.rank || 99));
      return d * (x - y) || ((a.rank || 99) - (b.rank || 99));
    });
  }
  function sortRank(rows) { // FDV 대비 누적 바이백 내림차순, 없으면 매출 순위
    return rows.slice().sort(function (a, b) {
      var x = a.bb_supply_pct, y = b.bb_supply_pct;
      var xn = !(x > 0), yn = !(y > 0);
      if (xn || yn) return xn === yn ? ((a.rank || 99) - (b.rank || 99)) : (xn ? 1 : -1);
      return (y - x) || ((a.rank || 99) - (b.rank || 99));
    });
  }

  // ---------- 처리 방식 배지 ----------
  function dispBadge(r) {
    var d = r.disp_simple || '—';
    var cls = DISPO_CLS[d] || 'none';
    var badge = '<i class="rm-dp ' + cls + '">' + esc(d) + '</i>';
    var url = safeUrl(r.dispo_source);
    if (url) {
      return '<a class="rm-dplink" href="' + esc(url) + '" target="_blank" rel="noopener"' + tip([r.dispo_note]) + '>' + badge + '</a>';
    }
    return '<span' + tip([r.dispo_note]) + '>' + badge + '</span>';
  }

  // ---------- 상위 순위 ----------
  function rankRowHtml(r, pos) {
    if (r.error) {
      return '<div class="rm-rank-row"><span class="rm-rank-n">' + pos + '</span>' +
        '<div class="rm-rank-id"><b>' + esc(r.symbol) + '</b><span>' + esc(r.name) + '</span></div>' +
        '<div class="rm-rank-track"></div>' +
        '<div class="rm-rank-val"><span class="rm-na">데이터 오류</span></div></div>';
    }
    var p = supplyPct(r.bb_supply_pct);
    var w = (r.bb_supply_pct > 0 && state.max > 0) ? Math.max(2, r.bb_supply_pct / state.max * 100) : 0;
    var bar = w ? '<i class="rm-rank-bar' + (isEst(r) ? ' est' : '') + '" style="width:' + w.toFixed(2) + '%"></i>' : '';
    var mt = r.fdv == null ? na('—') : '<span class="rm-mult"><em>FDV/매출</em>' + mult(r.fdv_rev_mult) + '</span>';
    return '<div class="rm-rank-row"' + tip([r.name + ' (' + rankTip(r) + ')', isEst(r) ? '누적 바이백 추정치(≈)' : '']) + '>' +
      '<span class="rm-rank-n">' + pos + '</span>' +
      '<div class="rm-rank-id"><b>' + esc(r.symbol) + '</b><span>' + esc(r.name) + '</span></div>' +
      '<div class="rm-rank-track">' + bar + '</div>' +
      '<div class="rm-rank-val"><b>' + (p == null ? na('—') : (isEst(r) ? '≈' : '') + p) + '</b>' + dispBadge(r) + mt + '</div>' +
      '</div>';
  }

  function renderRank() {
    var box = $('rmRank');
    if (!box) return;
    var tg = $('rmRankToggle');
    var rows = sortRank(state.rows);
    var cnt = $('rmCount');
    if (cnt && rows.length) cnt.textContent = rows.length + '개 중 상위 ' + Math.min(rows.length, TOP_N) + '개 · 막대는 1위 대비';
    if (!rows.length) {
      box.innerHTML = '<div class="rm-msg">표시할 데이터가 없습니다.</div>';
      if (cnt) cnt.textContent = '';
      if (tg) tg.hidden = true;
      return;
    }
    state.max = 0;
    rows.forEach(function (r) { if (r.bb_supply_pct > state.max) state.max = r.bb_supply_pct; });
    state.extra = Math.max(0, rows.length - TOP_N);
    box.innerHTML = rows.map(function (r, i) { return rankRowHtml(r, i + 1); }).join('');
    box.classList.toggle('open', state.open && state.extra > 0);
    if (tg) {
      tg.hidden = state.extra === 0;
      tg.textContent = (state.open && state.extra > 0) ? '접기' : '나머지 ' + state.extra + '개 펼치기';
    }
  }

  // ---------- 표 ----------
  function m1Cell(r) { // FDV 대비 누적 바이백 %
    var v = supplyPct(r.bb_supply_pct);
    var burn = supplyPct(r.burn_supply_pct);
    var t = tip([r.alltime_note,
      r.bb_tokens != null ? '누적 수량 ' + tok(r.bb_tokens) + ' ' + r.symbol : '',
      r.unminted_tokens > 0 ? '미발행 물량 有(최대발행량 대비 미발행 ' + tok(r.unminted_tokens) + ')' : '']);
    var main = v == null ? na('—') : (isEst(r) ? '≈' : '') + v;
    var sub = burn == null ? '' : '<span class="rm-sub">소각 ' + burn + '</span>';
    return '<td' + t + '>' + main + sub + '</td>';
  }

  function m3Cell(r) {
    var sub = r.rev_first_date ? '<span class="rm-sub">집계 ' + esc(ym(r.rev_first_date)) + '~</span>' : '';
    return '<td class="c-hide-sm">' + usd(r.rev_all) + sub + '</td>';
  }

  function m4Cell(r) { // 총매출 대비 바이백 / 소각
    var bb = pct1(r.bb_rev_pct);
    var bn = pct1(r.burn_rev_pct);
    var l1 = bb == null ? '<span class="rm-na">바이백 —</span>' : '바이백 ' + (isEst(r) ? '≈' : '') + bb;
    var l2 = bn == null ? '<span class="rm-na">소각 —</span>' : '소각 ' + bn;
    return '<td><span class="rm-cum">' + l1 + '</span><span class="rm-cum2">' + l2 + '</span></td>';
  }

  function m5Cell(r) { // 공식 정책
    var t = r.policy_note || '미확인';
    var unv = (t === '미확인');
    var inner = unv ? na('미확인') : esc(t);
    var ttl = tip(['확인일 ' + (r.policy_checked || '—')]);
    var url = safeUrl(r.policy_source);
    if (url) {
      inner = '<a class="rm-plink' + (unv ? ' unv' : '') + '" href="' + esc(url) + '" target="_blank" rel="noopener"' + ttl + '>' + inner + '</a>';
    } else {
      inner = '<span' + ttl + '>' + inner + '</span>';
    }
    return '<td class="c-hide-sm c-pol">' + inner + '</td>';
  }

  function m7Cell(r) {
    if (r.fdv == null) return '<td><span class="rm-na" title="FDV 미제공">—</span></td>';
    return '<td>' + (r.fdv_rev_mult == null ? na('—') : mult(r.fdv_rev_mult)) + '</td>';
  }

  function rowHtml(r, pos) { // pos = 현재 정렬 기준 1..N, 매출 순위는 툴팁
    var sym = '<td' + tip([rankTip(r)]) + '><div class="rm-sym"><em class="rm-rk">' + pos + '</em><b>' + esc(r.symbol) + '</b><span>' + esc(r.name) + '</span></div></td>';
    if (r.error) {
      return '<tr>' + sym + '<td colspan="' + (NCOL - 1) + '" class="rm-err">데이터 오류 · ' + esc(r.error) + '</td></tr>';
    }
    return '<tr>' + sym + m1Cell(r) +
      '<td>' + usd(r.rev_30d) + '</td>' +
      m3Cell(r) + m4Cell(r) + m5Cell(r) +
      '<td>' + dispBadge(r) + '</td>' + m7Cell(r) +
      '</tr>';
  }

  function renderTable() {
    var rows = sortRows(state.rows);
    var html = rows.map(function (r, i) { return rowHtml(r, i + 1); }).join('');
    $('rmBody').innerHTML = html || '<tr><td colspan="' + NCOL + '" class="rm-err" style="text-align:center">표시할 데이터가 없습니다.</td></tr>';
    var btns = document.querySelectorAll('#rmTable th button');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-k') === state.key;
      btns[i].classList.toggle('on', on);
      var ar = btns[i].querySelector('.ar');
      if (ar) ar.textContent = on ? (state.dir < 0 ? '▼' : '▲') : '';
    }
  }

  function bindSort() {
    var btns = document.querySelectorAll('#rmTable th button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var k = this.getAttribute('data-k');
        if (state.key === k) state.dir = -state.dir;
        else { state.key = k; state.dir = ASC_KEYS[k] ? 1 : -1; }
        renderTable();
      });
    }
  }

  // ---------- 로드 ----------
  function hasBuyback(r) { return !r.error && r.buyback_all > 0; } // 누적 바이백(실측·추정) > 0
  function topRows(rows, top) { // 바이백이 있는 프로토콜 중 30일 매출 상위 top개
    return rows.filter(function (r) { return r.rank != null && hasBuyback(r); })
      .sort(function (a, b) { return a.rank - b.rank; })
      .slice(0, top);
  }

  function fail() {
    var b = $('rmRank');
    if (b) b.innerHTML = '<div class="rm-msg">데이터를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</div>';
    var t = $('rmRankToggle');
    if (t) t.hidden = true;
    $('rmBody').innerHTML = '<tr><td colspan="' + NCOL + '" class="rm-err" style="text-align:center">데이터를 불러오지 못했습니다.</td></tr>';
  }

  function load() {
    fetch(ENDPOINT + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        state.top = d.display_top || 20;
        var all = (d.rows || []).slice();
        // 구버전 JSON 호환: rank가 없으면 매출순으로 부여
        if (all.some(function (r) { return r.rank == null && r.rev_30d != null; })) {
          all.sort(function (a, b) { return (b.rev_30d || -1) - (a.rev_30d || -1); })
            .forEach(function (r, i) { if (r.rev_30d != null) r.rank = i + 1; });
        }
        state.rows = topRows(all, state.top);
        var nob = all.filter(function (r) { return r.rank != null && !r.error && !(r.buyback_all > 0); })
          .sort(function (a, b) { return a.rank - b.rank; })
          .map(function (r) { return r.symbol; });
        var nb = $('rmNoBuyback');
        if (nb) {
          nb.parentNode.hidden = !nob.length;
          nb.textContent = nob.join(' · ');
        }

        $('rmAsOf').textContent = kst(d.generated_at || d.as_of);
        $('rmWindow').textContent = '30일 창 ' + d.window_start + '~' + d.window_end + ' (UTC) · 누적은 일 1회 갱신';
        $('rmUncovered').textContent = (d.uncovered || []).map(function (u) {
          return u.symbol + '(' + (u.reason || '사유 미상') + ')';
        }).join(', ') || '없음';

        renderRank();
        renderTable();
      })
      .catch(fail);
  }

  function init() {
    bindSort();
    var tg = $('rmRankToggle');
    if (tg) tg.addEventListener('click', function () { state.open = !state.open; renderRank(); });
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();