/* 유의종목 상세 조회 — kr-exchange/index.html 전용
 * 데이터 소스: ../data/v1/kr_caution_history.json (cache: no-store)
 * 기존 kr_dashboard.js 의 색 토큰·클래스 톤(.kr-card/.kr-status/.kr-cal-note)을 그대로 사용.
 * 값을 추정·생성하지 않는다. null 은 "-", 사유 null 은 "미공지".
 */
(function () {
  'use strict';

  var PAGE_SIZE = 30;
  var EX_ORDER = ['upbit', 'bithumb', 'coinone', 'korbit', 'gopax'];
  var EX_NAMES = { upbit: '업비트', bithumb: '빗썸', coinone: '코인원', korbit: '코빗', gopax: '고팍스' };

  var STATUS_CLASS = {
    '지정': 'designated',
    '연장': 'extended',
    '폐지확정': 'delist',
    '폐지완료': 'done',
    '해제': 'released'
  };
  var KIND_CLASS = {
    '지정': 'designated',
    '연장': 'extended',
    '해제': 'released',
    '거래지원종료': 'delist',
    '기타': 'etc'
  };

  var state = {
    cases: [],
    counts: {},
    exchanges: {},
    q: '',
    ex: '',
    status: '',
    sort: 'notice',
    limit: PAGE_SIZE,
    open: {},
    loaded: false
  };

  /* ---------- 유틸 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeHref(url) {
    if (!url) return '#';
    try {
      var u = new URL(String(url), window.location.href);
      return (/^https?:$/.test(u.protocol)) ? esc(u.href) : '#';
    } catch (_) {
      return '#';
    }
  }
  function setText(id, t) {
    var el = document.getElementById(id);
    if (el) el.textContent = t;
  }
  function dateOr(v) {
    return (v === null || v === undefined || v === '') ? '-' : String(v);
  }
  function endDate(c) {
    return c.delist_date || null;
  }
  // 결정기한 표시값: 정확한 날짜(deadline) 우선, 없으면 주차 등 원문 텍스트(deadline_text), 둘 다 없으면 null.
  function deadlineValue(c) {
    if (c.deadline) return c.deadline;
    if (c.deadline_text) return c.deadline_text;
    return null;
  }
  function fmtUpdatedShort(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    function p(n) { return String(n).padStart(2, '0'); }
    return '업데이트 ' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------- 필터 / 정렬 ---------- */
  // 거래소·검색어 필터만 적용 (상태 필터 제외). 칩 카운트 계산에도 사용.
  function matchesBase(c) {
    if (!c) return false;
    if (state.ex && c.ex !== state.ex) return false;
    var q = String(state.q || '').trim().toLowerCase();
    if (q) {
      var hay = (String(c.sym || '') + ' ' + String(c.name || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }
  function filtered() {
    return state.cases.filter(function (c) {
      if (!matchesBase(c)) return false;
      if (state.status) {
        var st = c.status || '';
        if (state.status === '진행중') {
          if (st !== '지정' && st !== '연장') return false;
        } else if (st !== state.status) {
          return false;
        }
      }
      return true;
    });
  }
  // YYYY-MM-DD 문자열 비교. 빈 값(null)은 정렬 방향과 무관하게 항상 뒤로.
  function cmpDate(x, y, desc) {
    var a = (x === null || x === undefined) ? '' : String(x);
    var b = (y === null || y === undefined) ? '' : String(y);
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    if (a === b) return 0;
    return desc ? (a < b ? 1 : -1) : (a < b ? -1 : 1);
  }
  function sortCases(list) {
    var arr = list.map(function (c, i) { return { c: c, i: i }; });
    var mode = state.sort;
    arr.sort(function (A, B) {
      var a = A.c, b = B.c, r = 0;
      if (mode === 'designated_desc') {
        r = cmpDate(a.designated_date, b.designated_date, true);
      } else if (mode === 'designated_asc') {
        r = cmpDate(a.designated_date, b.designated_date, false);
      } else if (mode === 'deadline_asc') {
        // 결정기한 정렬은 실제 날짜(deadline)만 사용. 주차 텍스트(deadline_text)는 cmpDate 가 맨 뒤로 보낸다.
        r = cmpDate(a.deadline, b.deadline, false);
      } else {
        r = cmpDate(a.last_date, b.last_date, true);
      }
      return r || (A.i - B.i);
    });
    return arr.map(function (o) { return o.c; });
  }

  /* ---------- 칩(요약 카운트) ---------- */
  // 칩 숫자는 거래소·검색어 필터를 반영하되 상태 필터는 제외한다.
  function countOf(st) {
    var c = 0;
    state.cases.forEach(function (x) {
      if (matchesBase(x) && x.status === st) c++;
    });
    return c;
  }
  function totalCount() {
    var c = 0;
    state.cases.forEach(function (x) { if (matchesBase(x)) c++; });
    return c;
  }
  function renderChips() {
    var root = document.getElementById('kcl-chips');
    if (!root || !state.loaded) return;
    var defs = [
      { v: '', label: '전체' },
      { v: '지정', label: '지정' },
      { v: '연장', label: '연장' },
      { v: '폐지확정', label: '폐지확정' },
      { v: '폐지완료', label: '폐지완료' },
      { v: '해제', label: '해제' }
    ];
    root.innerHTML = defs.map(function (d) {
      var n = (d.v === '') ? totalCount() : countOf(d.v);
      return '<button class="kcl-chip' + (state.status === d.v ? ' on' : '') + '" type="button" data-v="' + esc(d.v) + '"'
        + ' aria-pressed="' + (state.status === d.v ? 'true' : 'false') + '">'
        + esc(d.label) + '<b>' + esc(String(n)) + '</b></button>';
    }).join('');
  }

  /* ---------- 행 ---------- */
  function badgeHTML(label, cls) {
    return '<span class="kcl-badge ' + esc(cls) + '">' + esc(label) + '</span>';
  }
  function exLogoHTML(c) {
    var key = EX_ORDER.indexOf(c.ex) >= 0 ? c.ex : '';
    if (!key) return '';
    var name = EX_NAMES[key] || c.ex_name || key;
    return '<img class="kcl-logo" src="logos/' + key + '.jpg" alt="' + esc(name) + '" title="' + esc(name) + '" loading="lazy">';
  }
  function dateCell(label, v) {
    return '<div class="kcl-dl"><span class="kcl-dl-k">' + esc(label) + '</span>'
      + '<span class="kcl-dl-v">' + esc(dateOr(v)) + '</span></div>';
  }
  function rowHTML(c) {
    var key = c._kclKey;
    var open = !!state.open[key];
    var st = c.status || '';
    var cls = STATUS_CLASS[st] || 'etc';
    var exName = EX_NAMES[c.ex] || c.ex_name || c.ex || '';
    var reason = c.reason || c.designation_reason || '';
    return ''
      + '<div class="kcl-item' + (open ? ' open' : '') + '">'
      +   '<div class="kcl-row" role="button" tabindex="0" aria-expanded="' + (open ? 'true' : 'false') + '"'
      +     ' data-k="' + esc(key) + '">'
      +     '<div class="kcl-main">'
      +       '<div class="kcl-id">'
      +         exLogoHTML(c)
      +         '<span class="kcl-sym">' + esc(c.sym || '-') + '</span>'
      +         '<span class="kcl-name">' + esc(c.name || '') + '</span>'
      +         (st ? badgeHTML(st, cls) : '')
      +         (exName ? '<span class="kcl-ex">' + esc(exName) + '</span>' : '')
      +       '</div>'
      +       '<div class="kcl-reason">' + esc(reason || '미공지') + '</div>'
      +     '</div>'
      +     '<div class="kcl-dates">'
      +       dateCell('지정일', c.designated_date)
      +       dateCell('결정기한', deadlineValue(c))
      +       dateCell('해제일', c.released_date)
      +       dateCell('거래지원 종료일', endDate(c))
      +     '</div>'
      +   '</div>'
      +   detailHTML(c, open)
      + '</div>';
  }

  /* ---------- 상세 패널 ---------- */
  function drow(label, valueHTML) {
    return '<div class="kcl-drow"><span class="kcl-dk">' + esc(label) + '</span>'
      + '<span class="kcl-dv">' + valueHTML + '</span></div>';
  }
  function textOr(v, fallback) {
    var s = (v === null || v === undefined) ? '' : String(v);
    return esc(s ? s : (fallback || '-'));
  }
  function historySorted(c) {
    var h = (c && Array.isArray(c.history)) ? c.history.filter(Boolean) : [];
    var arr = h.map(function (it, i) { return { it: it, i: i }; });
    arr.sort(function (A, B) {
      var r = cmpDate(A.it.date, B.it.date, false);
      return r || (A.i - B.i);
    });
    return arr.map(function (o) { return o.it; });
  }
  function timelineHTML(c) {
    var h = historySorted(c);
    if (!h.length) return '';
    var items = h.map(function (it) {
      if (!it) return '';
      var kind = it.kind || '기타';
      var cls = KIND_CLASS[kind] || 'etc';
      var href = safeHref(it.url);
      var title = esc(it.title || '(제목 없음)');
      var titleHTML = (href && href !== '#')
        ? '<a class="kcl-tl-title" href="' + href + '" target="_blank" rel="noopener">' + title + '</a>'
        : '<span class="kcl-tl-title">' + title + '</span>';
      return '<div class="kcl-tl-item">'
        + '<span class="kcl-tl-date">' + esc(dateOr(it.date)) + '</span>'
        + badgeHTML(kind, cls)
        + titleHTML
        + (it.deadline ? '<span class="kcl-tl-dl">기한 ' + esc(it.deadline) + '</span>' : '')
        + '</div>';
    }).join('');
    if (!items) return '';
    return '<div class="kcl-tl"><div class="kcl-tl-h">이력</div>' + items + '</div>';
  }
  function detailHTML(c, open) {
    var st = c.status || '';
    var rows = [];
    rows.push(drow('진행현황', st ? badgeHTML(st, STATUS_CLASS[st] || 'etc') : '-'));
    var designatedHTML = textOr(c.designated_date)
      + (c.designated_date_source === 'delist_notice_body'
        ? ' <span class="kcl-dk">(종료 공지 본문 기재)</span>'
        : '');
    rows.push(drow('지정일', designatedHTML));

    var ext = Array.isArray(c.extended_dates) ? c.extended_dates.filter(function (x) {
      return x !== null && x !== undefined && x !== '';
    }).map(String) : [];
    if (ext.length) rows.push(drow('연장일', esc(ext.join(' · '))));
    var dl = deadlineValue(c);
    if (dl) rows.push(drow('결정기한', textOr(dl)));
    rows.push(drow('해제일', textOr(c.released_date)));
    if (c.delist_announced_date) rows.push(drow('거래지원 종료 공지일', textOr(c.delist_announced_date)));
    rows.push(drow('거래지원 종료일', textOr(endDate(c))));
    if (c.delist_cancelled_date) rows.push(drow('거래지원 종료 철회', textOr(c.delist_cancelled_date)));

    // 사유는 중복 표시하지 않되 "사유"는 항상 노출
    var reasonRaw = (c.reason === null || c.reason === undefined) ? '' : String(c.reason).trim();
    var shownReason = '';
    var dReason = (c.designation_reason === null || c.designation_reason === undefined) ? '' : String(c.designation_reason).trim();
    if (dReason && dReason !== reasonRaw) {
      rows.push(drow('지정 사유', esc(dReason)));
      shownReason = dReason;
    }
    var xReason = (c.delist_reason === null || c.delist_reason === undefined) ? '' : String(c.delist_reason).trim();
    if (xReason && xReason !== reasonRaw && xReason !== shownReason) {
      rows.push(drow('종료 사유', esc(xReason)));
    }
    rows.push(drow('사유', textOr(reasonRaw, '미공지')));

    return '<div class="kcl-detail"' + (open ? '' : ' hidden') + '>'
      + rows.join('')
      + timelineHTML(c)
      + '</div>';
  }

  /* ---------- 목록 렌더 ---------- */
  function render() {
    var root = document.getElementById('kcl-list');
    if (!root) return;
    var list = sortCases(filtered());
    var total = list.length;
    var shown = list.slice(0, state.limit);

    setText('kcl-count', total + '건');

    if (!total) {
      root.innerHTML = '<div class="kr-status">조건에 맞는 유의종목이 없습니다</div>';
    } else {
      root.innerHTML = shown.map(rowHTML).join('');
    }

    var more = document.getElementById('kcl-more');
    if (more) {
      var rest = total - shown.length;
      more.hidden = (rest <= 0);
      more.textContent = rest > 0 ? '더 보기 (' + rest + '건)' : '더 보기';
    }
    renderChips();
  }

  function renderNote() {
    var el = document.getElementById('kcl-note');
    if (!el) return;
    var base = "각 거래소 공지 기준 자동 수집 · 공지에 없는 값은 '-' 표시 · 투자 판단의 근거가 아닙니다";
    var delayed = [];
    EX_ORDER.forEach(function (k) {
      var e = state.exchanges && state.exchanges[k];
      if (e && e.ok === false) delayed.push(e.name || EX_NAMES[k] || k);
    });
    var extra = delayed.length ? ' · 일부 거래소 수집 지연: ' + delayed.join(', ') : '';
    el.textContent = base + extra;
  }

  /* ---------- 아코디언 ---------- */
  function toggleRow(rowEl) {
    var key = rowEl.getAttribute('data-k');
    if (!key) return;
    var item = rowEl.parentNode;
    var detail = item ? item.querySelector('.kcl-detail') : null;
    if (!detail) return;
    var open = !state.open[key];
    if (open) state.open[key] = 1; else delete state.open[key];
    detail.hidden = !open;
    rowEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (item && item.classList) item.classList.toggle('open', open);
  }

  /* ---------- 컨트롤 ---------- */
  function setStatus(v) {
    state.status = v || '';
    var sel = document.getElementById('kcl-status');
    if (sel) sel.value = state.status;
    state.limit = PAGE_SIZE;
    render();
  }
  function fillSelects() {
    var ex = document.getElementById('kcl-ex');
    if (ex) {
      ex.innerHTML = '<option value="">전체</option>' + EX_ORDER.map(function (k) {
        return '<option value="' + esc(k) + '">' + esc(EX_NAMES[k]) + '</option>';
      }).join('');
    }
    var st = document.getElementById('kcl-status');
    if (st) {
      st.innerHTML = [
        { v: '', t: '전체 진행현황' },
        { v: '진행중', t: '진행중(지정+연장)' },
        { v: '지정', t: '지정' },
        { v: '연장', t: '연장' },
        { v: '폐지확정', t: '폐지확정' },
        { v: '폐지완료', t: '폐지완료' },
        { v: '해제', t: '해제' }
      ].map(function (o) {
        return '<option value="' + esc(o.v) + '">' + esc(o.t) + '</option>';
      }).join('');
      st.value = state.status;
    }
    var so = document.getElementById('kcl-sort');
    if (so) {
      so.innerHTML = [
        { v: 'notice', t: '최근 공지순' },
        { v: 'designated_desc', t: '지정일 최신순' },
        { v: 'designated_asc', t: '지정일 오래된순' },
        { v: 'deadline_asc', t: '결정기한 임박순' }
      ].map(function (o) {
        return '<option value="' + esc(o.v) + '">' + esc(o.t) + '</option>';
      }).join('');
      so.value = state.sort;
    }
  }
  function bindControls() {
    var q = document.getElementById('kcl-q');
    if (q) {
      var timer = null;
      q.addEventListener('input', function () {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          timer = null;
          state.q = q.value || '';
          state.limit = PAGE_SIZE;
          render();
        }, 120);
      });
    }
    var ex = document.getElementById('kcl-ex');
    if (ex) {
      ex.addEventListener('change', function () {
        state.ex = ex.value || '';
        state.limit = PAGE_SIZE;
        render();
      });
    }
    var st = document.getElementById('kcl-status');
    if (st) {
      st.addEventListener('change', function () { setStatus(st.value); });
    }
    var so = document.getElementById('kcl-sort');
    if (so) {
      so.addEventListener('change', function () {
        state.sort = so.value || 'notice';
        state.limit = PAGE_SIZE;
        render();
      });
    }
    var chips = document.getElementById('kcl-chips');
    if (chips) {
      chips.addEventListener('click', function (e) {
        var b = (e.target && e.target.closest) ? e.target.closest('.kcl-chip') : null;
        if (!b) return;
        var v = b.getAttribute('data-v') || '';
        setStatus(state.status === v ? '' : v);
      });
    }
    var more = document.getElementById('kcl-more');
    if (more) {
      more.addEventListener('click', function () {
        state.limit += PAGE_SIZE;
        render();
      });
    }
  }
  function bindList() {
    var root = document.getElementById('kcl-list');
    if (!root) return;
    root.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('a')) return; // 원문 링크 클릭은 그대로
      if (e.target && e.target.closest && e.target.closest('.kcl-detail')) return; // 상세 패널 내부 클릭은 무시
      var row = (e.target && e.target.closest) ? e.target.closest('.kcl-row') : null;
      if (!row) return;
      if (window.getSelection && String(window.getSelection())) return; // 텍스트 선택 중엔 토글 안 함
      toggleRow(row);
    });
    root.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k !== 'Enter' && k !== ' ' && k !== 'Spacebar') return;
      var t = e.target;
      if (!t || !t.closest || !t.classList || !t.classList.contains('kcl-row')) return;
      e.preventDefault();
      toggleRow(t);
    });
  }

  /* ---------- 로드 ---------- */
  function fail() {
    var root = document.getElementById('kcl-list');
    if (root) root.innerHTML = '<div class="kr-status">유의종목 이력을 불러오지 못했습니다</div>';
    setText('kcl-count', '');
    setText('kcl-updated', '');
    var more = document.getElementById('kcl-more');
    if (more) more.hidden = true;
    renderNote();
    if (window.console && console.warn) console.warn('[kr_caution_lookup] load failed');
  }
  function apply(data) {
    if (!data || typeof data !== 'object') { fail(); return; }
    var raw = Array.isArray(data.cases) ? data.cases : [];
    var cases = [];
    raw.forEach(function (c, i) {
      if (!c || typeof c !== 'object') return;
      c._kclKey = (c.id !== null && c.id !== undefined && c.id !== '')
        ? String(c.id)
        : ((c.ex || '') + '|' + (c.sym || '') + '|' + (c.designated_date || '') + '|' + i);
      cases.push(c);
    });
    state.cases = cases;
    state.counts = (data.counts && typeof data.counts === 'object') ? data.counts : {};
    state.exchanges = (data.exchanges && typeof data.exchanges === 'object') ? data.exchanges : {};
    state.limit = PAGE_SIZE;
    state.loaded = true;

    setText('kcl-updated', fmtUpdatedShort(data.generated_at));
    renderNote();
    render();
  }
  function load() {
    fetch('../data/v1/kr_caution_history.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(apply)
      .catch(function () { fail(); });
  }

  function init() {
    fillSelects();
    bindControls();
    bindList();
    renderChips();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();