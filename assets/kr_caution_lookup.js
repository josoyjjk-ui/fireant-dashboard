/* 유의종목 상세 조회 — kr-exchange/index.html 전용
 * 데이터 소스: ../data/v1/kr_caution_history.json (cache: no-store)
 * cases(거래소×코인×회차)를 sym 기준 프로젝트로 묶어 카드로 표시한다.
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
  var GROUP_CLASS = {
    '진행중': 'designated',
    '폐지확정': 'delist',
    '폐지완료': 'done',
    '해제': 'released'
  };
  // 회차 종료일이 무한대가 되는 상태
  var OPEN_STATUS = { '지정': 1, '연장': 1, '폐지확정': 1 };
  var GROUPS = ['진행중', '폐지확정', '해제', '폐지완료'];
  var INF = '9999-99-99';

  var state = {
    cases: [],
    exchanges: {},
    projects: [],
    q: '',
    ex: '',
    group: '진행중',
    sort: 'recent',
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
  function arrv(v) { return Array.isArray(v) ? v : []; }
  function strv(v) { return (v === null || v === undefined) ? '' : String(v); }
  function trim(v) { return strv(v).trim(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function dateOr(v) {
    var s = trim(v);
    return s ? s : '-';
  }
  function exName(c) {
    return EX_NAMES[c.ex] || c.ex_name || c.ex || '';
  }
  // YYYY-MM-DD 문자열 비교. 빈 값은 방향과 무관하게 항상 뒤로.
  function cmpDate(x, y, desc) {
    var a = trim(x), b = trim(y);
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    if (a === b) return 0;
    return desc ? (a < b ? 1 : -1) : (a < b ? -1 : 1);
  }
  function minDate(values) {
    var out = '';
    values.forEach(function (v) {
      var s = trim(v);
      if (!s) return;
      if (!out || s < out) out = s;
    });
    return out;
  }
  function maxDate(values) {
    var out = '';
    values.forEach(function (v) {
      var s = trim(v);
      if (!s) return;
      if (!out || s > out) out = s;
    });
    return out;
  }
  function fmtUpdatedShort(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return '업데이트 ' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
      + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function avatarFor(sym) {
    return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(String(sym || '').slice(0, 4))
      + '&background=1f2937&color=fff&size=44&bold=true&length=4';
  }

  /* ---------- 회차 계산 ---------- */
  function historySorted(c) {
    var h = arrv(c && c.history).filter(Boolean);
    var a = h.map(function (it, i) { return { it: it, i: i }; });
    a.sort(function (A, B) { return cmpDate(A.it.date, B.it.date, false) || (A.i - B.i); });
    return a.map(function (o) { return o.it; });
  }
  function caseStart(c) {
    if (trim(c.designated_date)) return trim(c.designated_date);
    var h = historySorted(c);
    for (var i = 0; i < h.length; i++) {
      if (trim(h[i].date)) return trim(h[i].date);
    }
    return '';
  }
  function caseEnd(c) {
    return trim(c.released_date) || trim(c.delist_date)
      || trim(c.withdrawal_end_notice_date) || trim(c.last_date);
  }
  function isOpenCase(c) { return !!OPEN_STATUS[c && c.status]; }

  // 시작일 오름차순 정렬된 cases 를 회차로 분할.
  function buildRounds(sortedCases) {
    var rounds = [];
    var cur = null;
    sortedCases.forEach(function (c) {
      var start = caseStart(c);
      if (cur && start && cur.end && start > cur.end) {
        cur = null;
      }
      if (!cur) {
        cur = { cases: [], end: '' };
        rounds.push(cur);
      }
      cur.cases.push(c);
      var open = false;
      var ends = [];
      cur.cases.forEach(function (x) {
        if (isOpenCase(x)) open = true;
        ends.push(caseEnd(x));
      });
      cur.end = open ? INF : maxDate(ends);
    });
    return rounds;
  }
  function sortCasesByStart(list) {
    return list.map(function (c, i) { return { c: c, i: i }; }).sort(function (A, B) {
      return cmpDate(caseStart(A.c), caseStart(B.c), false)
        || cmpDate(caseEnd(A.c), caseEnd(B.c), false)
        || (A.i - B.i);
    }).map(function (o) { return o.c; });
  }

  /* ---------- 프로젝트 ---------- */
  function exStatusOf(cases) {
    var latest = {};
    cases.forEach(function (c) {
      var ex = trim(c.ex);
      if (!ex) return;
      if (!latest[ex] || cmpDate(caseStart(c), caseStart(latest[ex]), false) >= 0) latest[ex] = c;
    });
    var out = {};
    Object.keys(latest).forEach(function (ex) { out[ex] = trim(latest[ex].status); });
    return out;
  }
  function groupOf(exStatus) {
    var vals = [];
    Object.keys(exStatus).forEach(function (k) { if (exStatus[k]) vals.push(exStatus[k]); });
    if (vals.indexOf('지정') >= 0 || vals.indexOf('연장') >= 0) return '진행중';
    if (vals.indexOf('폐지확정') >= 0) return '폐지확정';
    if (vals.indexOf('폐지완료') >= 0) return '폐지완료';
    return '해제';
  }
  function buildProject(key, list) {
    var cases = sortCasesByStart(list);
    var p = { key: key, sym: key, cases: cases };

    var name = '';
    for (var i = cases.length - 1; i >= 0; i--) {
      if (trim(cases[i].name)) { name = trim(cases[i].name); break; }
    }
    p.name = name;

    // 로고는 원본 cases 배열 순서에서 첫 non-null 값.
    p.logo = null;
    for (var j = 0; j < list.length; j++) {
      if (trim(list[j].logo)) { p.logo = trim(list[j].logo); break; }
    }

    p.rounds = buildRounds(cases);
    p.exStatus = exStatusOf(cases);
    p.group = groupOf(p.exStatus);

    p.exKeys = EX_ORDER.filter(function (k) { return has(p.exStatus, k); })
      .concat(Object.keys(p.exStatus).filter(function (k) { return k && EX_ORDER.indexOf(k) < 0; }));
    p.exCount = p.exKeys.length;

    var desig = [], lastDates = [];
    cases.forEach(function (c) {
      if (trim(c.designated_date)) desig.push(trim(c.designated_date));
      if (trim(c.last_date)) lastDates.push(trim(c.last_date));
    });
    p.firstDesignated = minDate(desig);
    p.recentDate = maxDate(desig);
    p.noticeDate = maxDate(lastDates);

    // 결정기한은 최신 회차의 진행중(지정/연장) case 기준.
    var deadlines = [];
    var textCase = null;
    var latest = p.rounds.length ? p.rounds[p.rounds.length - 1].cases : [];
    latest.forEach(function (c) {
      if (c.status !== '지정' && c.status !== '연장') return;
      if (trim(c.deadline)) deadlines.push(trim(c.deadline));
      // deadline 원문이 없는 진행중 case 중 시작일이 가장 늦은 것의 원문 기한.
      if (trim(c.deadline_text) && (!textCase || cmpDate(caseStart(c), caseStart(textCase), false) >= 0)) {
        textCase = c;
      }
    });
    p.deadlineSoon = minDate(deadlines);
    p.deadlineText = textCase ? trim(textCase.deadline_text) : '';
    return p;
  }
  function buildProjects(cases) {
    var map = {}, order = [];
    cases.forEach(function (c, i) {
      // 티커가 비면 합치지 않고 개별 프로젝트(key ?i)로 둔다.
      var key = trim(c.sym).toUpperCase() || ('?' + i);
      c._kclId = trim(c.id) || (key + '|' + trim(c.ex) + '|' + caseStart(c) + '|' + i);
      if (!map[key]) { map[key] = []; order.push(key); }
      map[key].push(c);
    });
    state.projects = order.map(function (key) { return buildProject(key, map[key]); });
  }

  /* ---------- 필터 / 정렬 ---------- */
  function matchesBase(p) {
    if (!p) return false;
    if (state.ex && !has(p.exStatus, state.ex)) return false;
    var q = trim(state.q).toLowerCase();
    if (q) {
      var hay = (p.sym + ' ' + p.name).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }
  function filtered() {
    return state.projects.filter(function (p) {
      if (!matchesBase(p)) return false;
      return !state.group || p.group === state.group;
    });
  }
  function sortProjects(list) {
    var a = list.map(function (p, i) { return { p: p, i: i }; });
    var mode = state.sort;
    a.sort(function (A, B) {
      var x = A.p, y = B.p, r = 0;
      if (mode === 'excount') {
        r = (y.exCount - x.exCount) || cmpDate(x.recentDate, y.recentDate, true);
      } else if (mode === 'deadline') {
        r = cmpDate(x.deadlineSoon, y.deadlineSoon, false);
      } else if (mode === 'notice') {
        r = cmpDate(x.noticeDate, y.noticeDate, true);
      } else if (mode === 'name') {
        r = (x.sym < y.sym ? -1 : (x.sym > y.sym ? 1 : 0));
      } else {
        r = cmpDate(x.recentDate, y.recentDate, true) || cmpDate(x.noticeDate, y.noticeDate, true);
      }
      return r || (A.i - B.i);
    });
    return a.map(function (o) { return o.p; });
  }
  function groupCount(g) {
    var n = 0;
    state.projects.forEach(function (p) { if (matchesBase(p) && p.group === g) n++; });
    return n;
  }
  function baseCount() {
    var n = 0;
    state.projects.forEach(function (p) { if (matchesBase(p)) n++; });
    return n;
  }

  /* ---------- 조각 ---------- */
  function badgeHTML(label, cls) {
    return '<span class="kcl-badge ' + esc(cls) + '">' + esc(label) + '</span>';
  }
  function coinHTML(p) {
    var fb = avatarFor(p.sym);
    var src = p.logo ? p.logo : fb;
    // 폴백은 data-fb 에 두고 인라인 핸들러에서 속성값으로만 읽는다(문자열 리터럴 주입 방지).
    return '<img class="kcl-coin" src="' + esc(src) + '" data-fb="' + esc(fb) + '" alt="" loading="lazy"'
      + ' onerror="this.onerror=null;this.src=this.getAttribute(\'data-fb\')">';
  }
  function exBadgeHTML(ex, status) {
    var name = EX_NAMES[ex] || ex;
    var cls = STATUS_CLASS[status] || 'etc';
    return '<span class="kcl-exb ' + esc(cls) + '" title="' + esc(name + (status ? ' · ' + status : '')) + '">'
      + '<img class="kcl-exb-img" src="logos/' + esc(ex) + '.jpg" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
      + '<span class="kcl-exb-n">' + esc(name) + '</span>'
      + (status ? '<span class="kcl-exb-s">' + esc(status) + '</span>' : '')
      + '</span>';
  }
  // 최신 회차를 기준으로 카드 요약값 계산 (값이 없으면 빈 문자열).
  function summaryOf(p) {
    var last = p.rounds.length ? p.rounds[p.rounds.length - 1] : { cases: [] };
    var released = [], ended = [];
    last.cases.forEach(function (c) {
      if (trim(c.released_date)) released.push(trim(c.released_date));
      if (trim(c.delist_date)) ended.push(trim(c.delist_date));
      else if (trim(c.withdrawal_end_notice_date)) ended.push(trim(c.withdrawal_end_notice_date));
    });
    var reason = null, reasonEx = '';
    last.cases.forEach(function (c) {
      var r = trim(c.designation_reason) || trim(c.reason);
      if (!r) return;
      var start = caseStart(c);
      if (!reason || start < caseStart(reason)) { reason = c; reasonEx = exName(c); }
    });
    return {
      released: maxDate(released),
      ended: maxDate(ended),
      reason: reason ? (trim(reason.designation_reason) || trim(reason.reason)) : '',
      reasonEx: reasonEx
    };
  }

  /* ---------- 카드 ---------- */
  function cardHTML(p) {
    var open = !!state.open[p.key];
    var sum = summaryOf(p);
    var exBadges = p.exKeys.map(function (k) { return exBadgeHTML(k, p.exStatus[k]); }).join('');
    var dl = p.deadlineSoon || p.deadlineText;
    var dates = '<div class="kcl-dl"><span class="kcl-dl-k">최초 지정일</span>'
      + '<span class="kcl-dl-v">' + esc(dateOr(p.firstDesignated)) + '</span></div>';
    if (dl) {
      dates += '<div class="kcl-dl"><span class="kcl-dl-k">결정기한</span>'
        + '<span class="kcl-dl-v">' + esc(dl) + '</span></div>';
    }
    if (sum.released) {
      dates += '<div class="kcl-dl"><span class="kcl-dl-k">해제일</span>'
        + '<span class="kcl-dl-v">' + esc(sum.released) + '</span></div>';
    } else if (sum.ended) {
      dates += '<div class="kcl-dl"><span class="kcl-dl-k">종료일</span>'
        + '<span class="kcl-dl-v">' + esc(sum.ended) + '</span></div>';
    }
    var reason = sum.reason
      ? ('[' + sum.reasonEx + '] ' + sum.reason)
      : '미공지';

    return '<div class="kcl-item' + (open ? ' open' : '') + '" data-sym="' + esc(p.sym) + '"'
      + ' data-cases="' + esc(String(p.cases.length)) + '" data-group="' + esc(p.group) + '">'
      + '<div class="kcl-row" role="button" tabindex="0" aria-expanded="' + (open ? 'true' : 'false') + '"'
      + ' data-k="' + esc(p.key) + '">'
      +   coinHTML(p)
      +   '<div class="kcl-main">'
      +     '<div class="kcl-id">'
      +       '<span class="kcl-sym">' + esc(p.sym || '-') + '</span>'
      +       (p.name ? '<span class="kcl-name">' + esc(p.name) + '</span>' : '')
      +       badgeHTML(p.group, GROUP_CLASS[p.group] || 'etc')
      +     '</div>'
      +     '<div class="kcl-exbs">' + exBadges + '</div>'
      +     '<div class="kcl-reason">' + esc(reason) + '</div>'
      +     '<div class="kcl-dates">' + dates + '</div>'
      +   '</div>'
      + '</div>'
      + '<div class="kcl-detail"' + (open ? '' : ' hidden') + '>'
      +   detailHTML(p)
      + '</div>'
      + '</div>';
  }

  /* ---------- 상세 ---------- */
  function drow(label, valueHTML) {
    return '<div class="kcl-drow"><span class="kcl-dk">' + esc(label) + '</span>'
      + '<span class="kcl-dv">' + valueHTML + '</span></div>';
  }
  function timelineHTML(c) {
    var h = historySorted(c);
    if (!h.length) return '';
    var items = h.map(function (it) {
      if (!it) return '';
      var kind = it.kind || '기타';
      var href = safeHref(it.url);
      var title = esc(it.title || '(제목 없음)');
      var titleHTML = (href && href !== '#')
        ? '<a class="kcl-tl-title" href="' + href + '" target="_blank" rel="noopener">' + title + '</a>'
        : '<span class="kcl-tl-title">' + title + '</span>';
      return '<div class="kcl-tl-item">'
        + '<span class="kcl-tl-date">' + esc(dateOr(it.date)) + '</span>'
        + badgeHTML(kind, KIND_CLASS[kind] || 'etc')
        + titleHTML
        + (it.deadline ? '<span class="kcl-tl-dl">기한 ' + esc(it.deadline) + '</span>' : '')
        + '</div>';
    }).join('');
    return '<div class="kcl-tl"><div class="kcl-tl-h">공지 이력</div>' + items + '</div>';
  }
  function exCardHTML(c) {
    var st = trim(c.status);
    var rows = [];

    var desig = esc(dateOr(c.designated_date));
    if (c.designated_date_source === 'delist_notice_body' && trim(c.designated_date)) {
      desig += ' <span class="kcl-note-inline">(종료 공지 본문 기재)</span>';
    }
    rows.push(drow('지정일', desig));

    var ext = arrv(c.extended_dates).map(trim).filter(Boolean);
    if (ext.length) rows.push(drow('연장일', esc(ext.join(', '))));

    var dl = trim(c.deadline) || trim(c.deadline_text);
    if (dl) rows.push(drow('결정기한', esc(dl)));

    if (trim(c.released_date)) rows.push(drow('해제일', esc(c.released_date)));
    if (trim(c.delist_announced_date)) rows.push(drow('거래지원 종료 결정일', esc(c.delist_announced_date)));
    if (trim(c.delist_date)) rows.push(drow('거래지원 종료일', esc(c.delist_date)));
    if (trim(c.delist_cancelled_date)) rows.push(drow('종료 철회일', esc(c.delist_cancelled_date)));
    if (trim(c.withdrawal_end_notice_date)) rows.push(drow('출금 종료일', esc(c.withdrawal_end_notice_date)));

    var dReason = trim(c.designation_reason);
    var xReason = trim(c.delist_reason);
    var reason = dReason || trim(c.reason);
    if (reason) rows.push(drow(dReason ? '지정 사유' : '사유', esc(reason)));
    else rows.push(drow('지정 사유', '미공지'));
    if (xReason && xReason !== reason) rows.push(drow('종료 사유', esc(xReason)));

    return '<div class="kcl-excard">'
      + '<div class="kcl-excard-h">'
      +   '<img class="kcl-exb-img" src="logos/' + esc(c.ex) + '.jpg" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
      +   '<span class="kcl-excard-n">' + esc(exName(c)) + '</span>'
      +   (st ? badgeHTML(st, STATUS_CLASS[st] || 'etc') : '')
      + '</div>'
      + rows.join('')
      + timelineHTML(c)
      + '</div>';
  }
  function detailHTML(p) {
    var total = p.rounds.length;
    var out = [];
    for (var i = total - 1; i >= 0; i--) {
      var round = p.rounds[i];
      var ordered = round.cases.map(function (c, idx) { return { c: c, idx: idx }; }).sort(function (A, B) {
        var ai = EX_ORDER.indexOf(A.c.ex), bi = EX_ORDER.indexOf(B.c.ex);
        if (ai < 0) ai = 99;
        if (bi < 0) bi = 99;
        return (ai - bi) || (A.idx - B.idx);
      }).map(function (o) { return o.c; });
      if (total > 1) {
        out.push('<div class="kcl-round-h">' + esc(String(i + 1)) + '회차'
          + (i === total - 1 ? ' <span class="kcl-round-now">최근</span>' : '') + '</div>');
      }
      out.push('<div class="kcl-round">' + ordered.map(exCardHTML).join('') + '</div>');
    }
    return out.join('');
  }

  /* ---------- 목록 ---------- */
  function renderChips() {
    var root = document.getElementById('kcl-chips');
    if (!root || !state.loaded) return;
    var defs = GROUPS.concat(['']).map(function (g) {
      var n = (g === '') ? baseCount() : groupCount(g);
      var on = (state.group === g);
      return '<button class="kcl-chip' + (on ? ' on' : '') + '" type="button" data-v="' + esc(g) + '"'
        + ' aria-pressed="' + (on ? 'true' : 'false') + '">'
        + esc(g || '전체') + '<b>' + esc(String(n)) + '</b></button>';
    });
    root.innerHTML = defs.join('');
  }
  function render() {
    var root = document.getElementById('kcl-list');
    if (!root) return;
    var list = sortProjects(filtered());
    var shown = list.slice(0, state.limit);
    // 거래소 필터가 있으면 필터 결과 프로젝트 안에서 그 거래소 case만 센다.
    var caseCount = 0;
    var exFilter = state.ex;
    list.forEach(function (p) {
      p.cases.forEach(function (c) {
        if (exFilter && trim(c.ex) !== exFilter) return;
        caseCount++;
      });
    });

    setText('kcl-count', '프로젝트 ' + list.length + '개 · 건 ' + caseCount + '건');
    root.innerHTML = list.length
      ? shown.map(cardHTML).join('')
      : '<div class="kr-status">조건에 맞는 유의종목이 없습니다</div>';

    var more = document.getElementById('kcl-more');
    if (more) {
      var rest = list.length - shown.length;
      more.hidden = (rest <= 0);
      more.textContent = rest > 0 ? '더 보기 (' + rest + '개)' : '더 보기';
    }
    renderChips();
  }
  function renderNote() {
    var el = document.getElementById('kcl-note');
    if (!el) return;
    var base = "각 거래소 공지 기준 자동 수집 · 공지에 없는 값은 '-' 표시 · 투자 판단의 근거가 아닙니다";
    var parts = EX_ORDER.map(function (k) {
      var e = state.exchanges && state.exchanges[k];
      if (!e) return '';
      return (e.name || EX_NAMES[k]) + ' ' + (e.ok === false ? '수집 지연' : '정상');
    }).filter(Boolean);
    el.textContent = base + (parts.length ? ' · 수집 상태: ' + parts.join(', ') : '');
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
  function setGroup(v) {
    state.group = (v === undefined || v === null) ? state.group : v;
    var sel = document.getElementById('kcl-status');
    if (sel) sel.value = state.group;
    state.limit = PAGE_SIZE;
    render();
  }
  function fillSelects() {
    var ex = document.getElementById('kcl-ex');
    if (ex) {
      ex.innerHTML = '<option value="">전체 거래소</option>' + EX_ORDER.map(function (k) {
        return '<option value="' + esc(k) + '">' + esc(EX_NAMES[k]) + '</option>';
      }).join('');
    }
    var st = document.getElementById('kcl-status');
    if (st) {
      st.innerHTML = [{ v: '', t: '전체' }].concat(GROUPS.map(function (g) {
        return { v: g, t: g };
      })).map(function (o) {
        return '<option value="' + esc(o.v) + '">' + esc(o.t) + '</option>';
      }).join('');
      st.value = state.group;
    }
    var so = document.getElementById('kcl-sort');
    if (so) {
      so.innerHTML = [
        { v: 'recent', t: '최근 지정일순' },
        { v: 'excount', t: '거래소 수순' },
        { v: 'deadline', t: '결정기한 임박순' },
        { v: 'notice', t: '최근 공지순' },
        { v: 'name', t: '티커순' }
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
      st.addEventListener('change', function () { setGroup(st.value || ''); });
    }
    var so = document.getElementById('kcl-sort');
    if (so) {
      so.addEventListener('change', function () {
        state.sort = so.value || 'recent';
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
        setGroup(state.group === v ? '' : v);
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
      if (e.target && e.target.closest && e.target.closest('a')) return;
      if (e.target && e.target.closest && e.target.closest('.kcl-detail')) return;
      var row = (e.target && e.target.closest) ? e.target.closest('.kcl-row') : null;
      if (!row) return;
      if (window.getSelection && String(window.getSelection())) return;
      toggleRow(row);
    });
    root.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k !== 'Enter' && k !== ' ' && k !== 'Spacebar') return;
      var t = e.target;
      if (!t || !t.classList || !t.classList.contains('kcl-row')) return;
      e.preventDefault();
      toggleRow(t);
    });
  }

  /* ---------- 정합성 ---------- */
  function audit(raw, projects) {
    // case id 가 몇 개의 project 에 등장하는지 세어, 2개 이상이면 중복으로 집계.
    var owners = {}, sum = 0;
    projects.forEach(function (p, pi) {
      sum += p.cases.length;
      var seenHere = {};
      p.cases.forEach(function (c) {
        var id = c._kclId;
        if (seenHere[id]) return;
        seenHere[id] = 1;
        if (!owners[id]) owners[id] = {};
        owners[id][pi] = 1;
      });
    });
    var dup = 0;
    Object.keys(owners).forEach(function (id) {
      if (Object.keys(owners[id]).length > 1) dup++;
    });
    return { projectTotal: projects.length, caseSum: sum, caseTotal: raw.length, dup: dup };
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
    var raw = arrv(data.cases).filter(function (c) { return c && typeof c === 'object'; });
    state.cases = raw;
    state.exchanges = (data.exchanges && typeof data.exchanges === 'object') ? data.exchanges : {};
    buildProjects(raw);
    state.limit = PAGE_SIZE;
    state.loaded = true;

    var info = audit(raw, state.projects);
    var root = document.getElementById('kcl-list');
    if (root) {
      root.setAttribute('data-project-total', String(info.projectTotal));
      root.setAttribute('data-case-sum', String(info.caseSum));
      root.setAttribute('data-case-total', String(info.caseTotal));
      root.setAttribute('data-case-dup', String(info.dup));
    }

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