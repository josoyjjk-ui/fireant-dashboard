(function () {
  'use strict';

  var ENDPOINT = 'data/v1/revenue_meta.json';
  var TOP_N = 5; // 상위 순위 섹션에 항상 보이는 행 수
  var TEXT_KEYS = { symbol: 1, policy_note: 1 }; // 텍스트 컬럼: 사전순 정렬
  var ASC_KEYS = { symbol: 1, policy_note: 1, disp_simple: 1 }; // 첫 클릭 오름차순
  var NCOL = 9;
  var DISPO_CLS = { '소각': 'burn', '재단 보관': 'treas', '혼합': 'mix', '없음': 'none' };
  var DISPO_ORDER = { '소각': 0, '혼합': 1, '재단 보관': 2, '없음': 3 }; // 처리 방식 정렬 순서
  var state = { rows: [], top: 20, key: 'bb_supply_pct', dir: -1, open: false, max: 0, extra: 0 };
  var NOTE_FDV_ALL = "";

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
  function mult(v) { return (v == null || !isFinite(v)) ? '—' : (v < 10 ? v.toFixed(1) : String(Math.round(v))) + '배'; }
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
  function rankAsc(a, b) { return (a.rank == null ? 99 : a.rank) - (b.rank == null ? 99 : b.rank); } // 동률은 매출 순위 오름차순
  function fin(v) { return v != null && v !== '' && isFinite(Number(v)); }
  function sortVal(r, k) { // { n: null 여부, v: 비교값 }
    if (r.error) return { n: true, v: null }; // 오류 행은 전 지표 null → 항상 맨 뒤
    var v = r[k];
    if (k === 'fdv_rev_all_mult' && (r.fdv == null || !(r.rev_all > 0))) return { n: true, v: null }; // 셀이 '—'인 경우
    if (k === 'policy_note') {
      if (v == null || v === '' || v === '미확인') return { n: true, v: null };
      return { n: false, v: String(v) };
    }
    if (k === 'disp_simple') {
      if (v == null || v === '' || v === '—') return { n: true, v: null }; // '없음'은 실제 범주
      var o = DISPO_ORDER[v];
      return { n: false, v: o == null ? 4 : o, t: String(v) };
    }
    if (k === 'symbol') {
      if (v == null || v === '') return { n: true, v: null };
      return { n: false, v: String(v) };
    }
    return fin(v) ? { n: false, v: Number(v) } : { n: true, v: null };
  }
  function sortRows(rows) {
    var k = state.key, d = state.dir;
    return rows.slice().sort(function (a, b) {
      var x = sortVal(a, k), y = sortVal(b, k);
      if (x.n || y.n) return x.n === y.n ? rankAsc(a, b) : (x.n ? 1 : -1); // null은 방향과 무관하게 항상 맨 뒤
      var c;
      if (TEXT_KEYS[k]) c = x.v.localeCompare(y.v, 'ko', { sensitivity: 'base' });
      else if (k === 'disp_simple') c = (x.v - y.v) || x.t.localeCompare(y.t, 'ko', { sensitivity: 'base' });
      else c = x.v - y.v;
      return (d * c) || rankAsc(a, b);
    });
  }
  function sortRank(rows) { // FDV 내림차순, FDV 없으면 매출 순위
    return rows.slice().sort(function (a, b) {
      var x = a.fdv, y = b.fdv;
      var xn = !fin(x), yn = !fin(y);
      if (xn || yn) return xn === yn ? rankAsc(a, b) : (xn ? 1 : -1);
      return (Number(y) - Number(x)) || rankAsc(a, b);
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
    var mt = r.fdv == null ? na('—') : '<span class="rm-mult"><em>FDV</em>' + usd(r.fdv) + '</span>' +
      '<span class="rm-mult"><em>FDV/누적매출</em>' + mult(r.rev_all > 0 ? r.fdv_rev_all_mult : null) + '</span>';
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
    if (cnt && rows.length) cnt.textContent = rows.length + '개 · FDV 큰 순 · 막대는 최대 바이백 % 대비';
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

  function fdvCell(r) { // FDV
    return '<td>' + (r.fdv == null ? na('—') : usd(r.fdv)) + '</td>';
  }

  function m7Cell(r) {
    if (r.fdv == null) return '<td><span class="rm-na" title="FDV 미제공">—</span></td>';
    var v = r.rev_all > 0 ? r.fdv_rev_all_mult : null;
    var t = tip([NOTE_FDV_ALL, r.rev_first_date ? '누적매출 집계 ' + ym(r.rev_first_date) + '~' : '']);
    return '<td' + t + '>' + (v == null ? na('—') : mult(v)) + '</td>';
  }

  function rowHtml(r, pos) { // pos = 현재 정렬 기준 1..N, 매출 순위는 툴팁
    var sym = '<td' + tip([rankTip(r)]) + '><div class="rm-sym"><em class="rm-rk">' + pos + '</em><b>' + esc(r.symbol) + '</b><span>' + esc(r.name) + '</span></div></td>';
    if (r.error) {
      return '<tr>' + sym + '<td colspan="' + (NCOL - 1) + '" class="rm-err">데이터 오류 · ' + esc(r.error) + '</td></tr>';
    }
    return '<tr>' + sym + m1Cell(r) +
      '<td>' + usd(r.rev_30d) + '</td>' +
      m3Cell(r) + m4Cell(r) + m5Cell(r) +
      '<td>' + dispBadge(r) + '</td>' + fdvCell(r) + m7Cell(r) +
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
      var th = btns[i].parentNode;
      if (th && th.setAttribute) th.setAttribute('aria-sort', on ? (state.dir < 0 ? 'descending' : 'ascending') : 'none');
      var lbl = btns[i].textContent.replace(/[▼▲]/g, '').trim(); // '정렬' 접미사 제외한 헤더 텍스트
      btns[i].setAttribute('aria-label', lbl + ' 정렬');
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
        NOTE_FDV_ALL = d.fdv_rev_all_note || "";
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