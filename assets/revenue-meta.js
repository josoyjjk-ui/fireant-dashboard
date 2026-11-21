(function () {
  'use strict';

  var ENDPOINT = 'data/v1/revenue_meta.json';
  var ASC_KEYS = { symbol: 1, rank: 1, fdv_bb_mult: 1, disposition: 1 }; // 첫 클릭 오름차순
  var NCOL = 8;
  var DISPO_CLS = {
    '소각': 'burn', '재무보관': 'treas', '락업': 'lock',
    '스테이커 분배': 'stake', '혼합': 'mix', '없음': 'none', '미확인': 'none'
  };
  var state = { data: null, rows: [], top: 20, key: 'buyback_all', dir: -1 };

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
  function pct(v) { return (v == null || !isFinite(v)) ? '—' : (v * 100).toFixed(1) + '%'; }
  function supplyPct(v) { // 10% 미만은 소수 2자리, 그 이상은 1자리
    if (v == null || !isFinite(v)) return null;
    var p = v * 100;
    return (p < 10 ? p.toFixed(2) : p.toFixed(1)) + '%';
  }
  function mult(v) { return (v == null || !isFinite(v)) ? '—' : (v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US')) + 'x'; }
  function na(s) { return '<span class="rm-na">' + s + '</span>'; }
  function ym(d) { return String(d).slice(0, 7).replace(/-/g, '.'); }
  function kst(iso) {
    try {
      return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) + ' (KST)';
    } catch (e) { return iso || '—'; }
  }

  // ---------- 정렬 ----------
  function sortRows(rows) {
    var k = state.key, d = state.dir;
    return rows.slice().sort(function (a, b) {
      var x = a[k], y = b[k];
      if (k === 'buyback_all') { if (x === 0) x = null; if (y === 0) y = null; } // 0은 없는 것으로 취급
      var xn = x == null, yn = y == null;
      if (xn || yn) return xn === yn ? (a.rank || 99) - (b.rank || 99) : (xn ? 1 : -1); // null은 항상 맨 뒤
      if (typeof x === 'string' || typeof y === 'string') return d * String(x).localeCompare(String(y), 'ko') || (a.rank || 99) - (b.rank || 99);
      return d * (x - y) || (a.rank || 99) - (b.rank || 99);
    });
  }
  function revRank(r) { return (typeof r.rank === 'number' && isFinite(r.rank)) ? r.rank : null; }
  function rankTip(r) { var k = revRank(r); return k == null ? '30일 매출 순위 —' : '30일 매출 ' + k + '위'; }
  function isRankAsc() { return state.key === 'rank' && state.dir === 1; }

  // ---------- 배지 ----------
  function dispoBadge(r, asLink) {
    var d = r.disposition || '미확인';
    var cls = DISPO_CLS[d] || 'none';
    var note = r.dispo_note || (d === '미확인' ? '처리 방식 미확인' : '');
    var title = [note, '확인 ' + (r.dispo_checked || '—')].filter(function (s) { return !!s; }).join(' ');
    var badge = '<i class="rm-dp ' + cls + '" title="' + esc(title) + '">' + esc(d) + '</i>';
    if (asLink && r.dispo_source && /^https:\/\//.test(r.dispo_source)) {
      return '<a class="rm-dplink" href="' + esc(r.dispo_source) + '" target="_blank" rel="noopener">' + badge + '</a>';
    }
    return badge;
  }

  function basisBadge(r) {
    var b = r.bb_basis || '없음';
    if (b === '실측') return '<i class="rm-bb ok" title="DefiLlama 바이백 라벨 실측' + (r.bb_labels && r.bb_labels.length ? ': ' + esc(r.bb_labels.join(', ')) : '') + '">실측</i>';
    if (b === '추정') return '<i class="rm-bb est" title="라벨 분해 없음 — 홀더 환원 전체를 바이백으로 가정한 추정치">추정<span class="rm-bb-l">(홀더 환원 전체)</span></i>';
    return '<i class="rm-bb none" title="' + (r.holders_30d ? '홀더 환원은 바이백이 아닌 분배·보상 형태' : '홀더 환원 없음') + '">없음</i>';
  }

  // ---------- 막대 ----------
  function barWidth(v, max) {
    if (!(v > 0) || !(max > 0)) return null;
    return 'max(3px,' + (v / max * 100).toFixed(2) + '%)';
  }

  function barTitle(r) {
    var aEst = r.alltime_basis === '추정' ? '≈' : '';
    var bEst = r.bb_basis === '추정' ? '≈' : '';
    var parts = [(r.name || r.symbol) + ' (' + rankTip(r) + ')'];
    parts.push('누적 바이백 ' + (r.buyback_all > 0 ? aEst + usd(r.buyback_all) : '없음'));
    if (r.alltime_note) parts.push(r.alltime_note);
    if (r.bb_first_date) parts.push('집계 ' + ym(r.bb_first_date) + '~');
    if (r.bb_tokens != null) parts.push('누적 수량 ' + tok(r.bb_tokens) + ' ' + r.symbol);
    parts.push('30일 매출 ' + usd(r.rev_30d));
    parts.push('30일 바이백 ' + (r.buyback_30d > 0 ? bEst + usd(r.buyback_30d) : '없음'));
    parts.push('30일 바이백률 ' + (r.bb_ratio == null ? '—' : bEst + pct(r.bb_ratio)));
    if (r.dispo_note) parts.push('처리: ' + r.dispo_note);
    return parts.join(' · ');
  }

  function barRowHtml(r, max, pos) {
    if (r.error) {
      return '<div class="rm-bar-row" title="' + esc(rankTip(r)) + '"><div class="rm-bar-l"><em>#' + pos + '</em>' + esc(r.symbol) + '</div>' +
        '<div class="rm-track"></div><div class="rm-bar-v"><div class="rm-v1"><span class="no">데이터 오류</span></div></div></div>';
    }
    var has = r.buyback_all > 0;
    var est = r.alltime_basis === '추정';
    var bw = barWidth(r.buyback_all, max);
    var bar = bw ? '<div class="rm-abar' + (est ? ' est' : '') + '" style="width:' + bw + '"></div>' : '';
    var line1 = (has
      ? '<b>누적 ' + (est ? '≈' : '') + usd(r.buyback_all) + '</b> · 공급 ' + (supplyPct(r.bb_supply_pct) || '—')
      : '<span class="no">바이백 없음</span>') + ' · ' + dispoBadge(r);
    var bb30 = r.buyback_30d > 0 ? (r.bb_basis === '추정' ? '≈' : '') + usd(r.buyback_30d) : '—';
    var line2 = '30일 매출 ' + usd(r.rev_30d) + ' · 바이백 ' + bb30;
    return '<div class="rm-bar-row" title="' + esc(barTitle(r)) + '">' +
      '<div class="rm-bar-l"><em>#' + pos + '</em>' + esc(r.symbol) + '</div>' +
      '<div class="rm-track">' + bar + '</div>' +
      '<div class="rm-bar-v"><div class="rm-v1">' + line1 + '</div><div class="rm-v2">' + line2 + '</div></div>' +
      '</div>';
  }

  function renderBars() {
    var box = $('rmBars');
    if (!box) return;
    var rows = state.rows.slice().sort(function (a, b) { // 누적 바이백 내림차순, 없으면 rank 순
      var x = a.buyback_all, y = b.buyback_all;
      var xn = !(x > 0), yn = !(y > 0);
      if (xn || yn) return xn === yn ? (a.rank || 99) - (b.rank || 99) : (xn ? 1 : -1);
      return (y - x) || (a.rank || 99) - (b.rank || 99);
    });
    if (!rows.length) {
      box.innerHTML = '<div class="rm-msg">표시할 데이터가 없습니다.</div>';
      return;
    }
    var max = 0;
    rows.forEach(function (r) { if (r.buyback_all > max) max = r.buyback_all; });
    box.innerHTML = rows.map(function (r, i) { return barRowHtml(r, max, i + 1); }).join('');
  }

  // ---------- 표 ----------
  function rowHtml(r, pos) { // pos = 현재 정렬 기준 1..N, 매출 순위는 툴팁
    var sym = '<td title="' + esc(rankTip(r)) + '"><div class="rm-sym"><em class="rm-rk">' + pos + '</em><b>' + esc(r.symbol) + '</b><span>' + esc(r.name) + '</span></div></td>';
    if (r.error) {
      return '<tr>' + sym + '<td colspan="' + (NCOL - 1) + '" class="rm-err">데이터 오류 · ' + esc(r.error) + '</td></tr>';
    }
    var bEst = r.bb_basis === '추정';
    var bPre = bEst ? '≈' : '';
    var aEst = r.alltime_basis === '추정';
    var aPre = aEst ? '≈' : '';

    // 3. 누적 바이백
    var aVal = r.buyback_all > 0 ? aPre + usd(r.buyback_all) : na('—');
    var aSub = r.bb_first_date ? '<span class="rm-sub">집계 ' + esc(ym(r.bb_first_date)) + '~</span>' : '';
    var aTitle = [r.alltime_note || '', r.bb_tokens != null ? '누적 수량 ' + tok(r.bb_tokens) + ' ' + r.symbol : '']
      .filter(function (s) { return !!s; }).join(' · ');

    // 4. 공급 대비
    var sup = supplyPct(r.bb_supply_pct);
    var burn = supplyPct(r.burn_supply_pct);
    var bTag = burn == null ? '' : (r.burn_basis === '실측' ? '<i class="rm-bt ok">실측</i>' : (r.burn_basis === '추정' ? '<i class="rm-bt est">추정</i>' : ''));
    var supTitle = [r.supply_basis ? '공급 기준: ' + r.supply_basis : '', r.burn_note || '']
      .filter(function (s) { return !!s; }).join(' · ');
    var supCell = (sup == null && burn == null)
      ? na('—')
      : '<span class="rm-cum">' + (sup == null ? '바이백 —' : '바이백 ' + sup) + '</span>' +
        '<span class="rm-cum2">' + (burn == null ? '소각 —' : '소각 ' + burn) + bTag + '</span>';

    // 6. 30일 바이백
    var bb = (r.buyback_30d == null || !(r.buyback_30d > 0)) ? na('—') : (bPre + usd(r.buyback_30d));
    var fdvCell = r.fdv == null ? na('—') : usd(r.fdv) + (r.fdv_basis === '시총대체' ? '<sup class="rm-fb" title="CoinGecko FDV 없음 → 시가총액으로 대체">시총</sup>' : '');
    var fm = r.fdv_bb_mult == null ? na('—') : (bPre + mult(r.fdv_bb_mult));

    return '<tr>' + sym +
      '<td>' + dispoBadge(r, true) + '</td>' +
      '<td class="rm-new"' + (aTitle ? ' title="' + esc(aTitle) + '"' : '') + '>' + aVal + aSub + '</td>' +
      '<td' + (supTitle ? ' title="' + esc(supTitle) + '"' : '') + '>' + supCell + '</td>' +
      '<td class="c-mopt">' + usd(r.rev_30d) + '</td>' +
      '<td class="rm-new"><div class="rm-bbc">' + bb + basisBadge(r) + '</div></td>' +
      '<td class="c-mopt">' + fdvCell + '</td>' +
      '<td class="c-mopt rm-new' + (r.fdv_bb_mult != null && r.fdv_bb_mult < 20 && !bEst ? ' rm-hi' : '') + '">' + fm + '</td>' +
      '</tr>';
  }

  function renderTable() {
    var html = '';
    if (isRankAsc()) {
      // 매출 순위 오름차순일 때만 10/11위 사이 구간 구분선
      var hi = [], lo = [];
      sortRows(state.rows).forEach(function (r) {
        if (r.rank != null && r.rank <= 10) hi.push(r); else lo.push(r);
      });
      html = hi.map(function (r, i) { return rowHtml(r, i + 1); }).join('');
      if (hi.length && lo.length) html += '<tr class="rm-div"><td colspan="' + NCOL + '">11–20위</td></tr>';
      html += lo.map(function (r, i) { return rowHtml(r, hi.length + i + 1); }).join('');
    } else {
      html = sortRows(state.rows).map(function (r, i) { return rowHtml(r, i + 1); }).join('');
    }
    $('rmBody').innerHTML = html || '<tr><td colspan="' + NCOL + '" class="rm-err" style="text-align:center">표시할 데이터가 없습니다.</td></tr>';
    $('rmCount').textContent = state.rows.length + '개 프로젝트';
    var btns = document.querySelectorAll('#rmTable th button');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-k') === state.key;
      btns[i].classList.toggle('on', on);
      btns[i].querySelector('.ar').textContent = on ? (state.dir < 0 ? '▼' : '▲') : '';
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
  function topRows(rows, top) {
    var out = rows.filter(function (r) { return r.rank != null && r.rank >= 1 && r.rank <= top; });
    out.sort(function (a, b) { return a.rank - b.rank; });
    return out;
  }

  function fail() {
    var b = $('rmBars');
    if (b) b.innerHTML = '<div class="rm-msg">데이터를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</div>';
    $('rmBody').innerHTML = '<tr><td colspan="' + NCOL + '" class="rm-err" style="text-align:center">데이터를 불러오지 못했습니다.</td></tr>';
  }

  function load() {
    fetch(ENDPOINT + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        state.data = d;
        state.top = d.display_top || 20;
        var all = (d.rows || []).slice();
        // 구버전 JSON 호환: rank가 없으면 매출순으로 부여
        if (all.some(function (r) { return r.rank == null && r.rev_30d != null; })) {
          all.sort(function (a, b) { return (b.rev_30d || -1) - (a.rev_30d || -1); })
            .forEach(function (r, i) { if (r.rev_30d != null) r.rank = i + 1; });
        }
        state.rows = topRows(all, state.top);

        $('rmAsOf').textContent = kst(d.generated_at || d.as_of);
        $('rmWindow').textContent = '30일 창 ' + d.window_start + '~' + d.window_end + ' (UTC) · 누적은 일 1회 갱신';
        $('rmUncovered').textContent = (d.uncovered || []).map(function (u) { return u.symbol; }).join(', ') || '없음';
        var cnt = { '실측': 0, '추정': 0, '없음': 0 };
        var acnt = { '실측': 0, '추정': 0, '없음': 0 };
        state.rows.forEach(function (r) {
          if (r.error) return;
          cnt[r.bb_basis || '없음']++;
          acnt[r.alltime_basis || '없음']++;
        });
        $('rmBasisCnt').textContent = '실측 ' + cnt['실측'] + ' · 추정 ' + cnt['추정'] + ' · 없음 ' + cnt['없음'];
        $('rmAllCnt').textContent = '실측 ' + acnt['실측'] + ' · 추정 ' + acnt['추정'] + ' · 없음 ' + acnt['없음'];
        var dc = $('rmDispoChecked');
        if (dc) dc.textContent = d.disposition_checked || '—';

        renderBars();
        renderTable();
      })
      .catch(fail);
  }

  function init() {
    bindSort();
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();