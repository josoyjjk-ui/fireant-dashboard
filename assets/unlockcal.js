(function() {
    var MAX_CELL_ITEMS = 3;
    var BIG_THRESHOLD = 10000000;
    var MAX_UPCOMING = 20;
    var WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토'];

    var data = null;
    var dateMap = {};
    var range = null;
    var navState = { year: 0, month: 0, minY: 0, minM: 0, maxY: 0, maxM: 0 };

    function formatUSD(n) {
        if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
        if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
        return '$' + n;
    }

    function isBig(item) {
        return item.usd && item.usd >= BIG_THRESHOLD;
    }

    function getAmount(item) {
        if (item.usd && item.usd > 0) return formatUSD(item.usd);
        if (item.amount_label) return item.amount_label;
        return '—';
    }

    function parseISOLocal(str) {
        var p = str.split('-');
        return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
    }

    function fmtDate(d) {
        return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
    }

    function fmtDateShort(d) {
        return (d.getMonth() + 1) + '/' + d.getDate();
    }

    function dateKey(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function todayStr() {
        var t = new Date();
        return dateKey(t);
    }

    function monthLabel(y, m) {
        return y + '년 ' + (m + 1) + '월';
    }

    function processItems(items) {
        dateMap = {};
        items.forEach(function(item) {
            if (!dateMap[item.date]) dateMap[item.date] = [];
            dateMap[item.date].push(item);
        });
        Object.keys(dateMap).forEach(function(k) {
            dateMap[k].sort(function(a, b) { return (b.usd || 0) - (a.usd || 0); });
        });
    }

    function setNavRange() {
        if (!range) return;
        var s = parseISOLocal(range.start);
        var e = parseISOLocal(range.end);
        navState.minY = s.getFullYear();
        navState.minM = s.getMonth();
        navState.maxY = e.getFullYear();
        navState.maxM = e.getMonth();
    }

    function setInitialMonth() {
        var now = new Date();
        var ny = now.getFullYear(), nm = now.getMonth();
        var inRange = (ny > navState.minY || (ny === navState.minY && nm >= navState.minM)) &&
                      (ny < navState.maxY || (ny === navState.maxY && nm <= navState.maxM));
        if (inRange) {
            navState.year = ny;
            navState.month = nm;
        } else {
            navState.year = navState.minY;
            navState.month = navState.minM;
        }
    }

    function canPrev() {
        return !(navState.year === navState.minY && navState.month === navState.minM);
    }

    function canNext() {
        return !(navState.year === navState.maxY && navState.month === navState.maxM);
    }

    function renderGrid() {
        var grid = document.getElementById('calGrid');
        grid.innerHTML = '';
        document.getElementById('curM').textContent = monthLabel(navState.year, navState.month);

        document.getElementById('prevM').disabled = !canPrev();
        document.getElementById('nextM').disabled = !canNext();

        var first = new Date(navState.year, navState.month, 1);
        var startDow = first.getDay();
        var daysInMonth = new Date(navState.year, navState.month + 1, 0).getDate();
        var today = todayStr();

        for (var i = 0; i < startDow; i++) {
            var ec = document.createElement('div');
            ec.className = 'cell empty';
            grid.appendChild(ec);
        }

        for (var d = 1; d <= daysInMonth; d++) {
            var dt = new Date(navState.year, navState.month, d);
            var key = dateKey(dt);
            var cell = document.createElement('div');
            cell.className = 'cell';
            if (key === today) cell.className += ' today';

            var numDiv = document.createElement('div');
            numDiv.className = 'num';
            numDiv.textContent = d;
            cell.appendChild(numDiv);

            var items = dateMap[key] || [];

            // Desktop badges
            var shown = 0;
            items.forEach(function(item) {
                if (shown >= MAX_CELL_ITEMS) return;
                var badge = document.createElement('div');
                badge.className = 'badge ' + (isBig(item) ? 'big' : 'small');
                badge.textContent = '🔓 ' + item.project + ' ' + getAmount(item);
                badge.title = item.project + ' — ' + getAmount(item);
                cell.appendChild(badge);
                shown++;
            });

            // Mobile dots container
            var dotsDiv = document.createElement('div');
            dotsDiv.className = 'dots';
            items.forEach(function(item) {
                var dot = document.createElement('span');
                dot.className = isBig(item) ? 'big' : 'small';
                dotsDiv.appendChild(dot);
            });
            cell.appendChild(dotsDiv);

            // More indicator
            if (items.length > MAX_CELL_ITEMS) {
                var moreDiv = document.createElement('div');
                moreDiv.className = 'more';
                moreDiv.textContent = '+' + (items.length - MAX_CELL_ITEMS) + ' 더보기';
                cell.appendChild(moreDiv);
            }

            (function(k, dayNum) {
                cell.addEventListener('click', function() {
                    showDetail(k, dayNum);
                });
            })(key, d);

            grid.appendChild(cell);
        }

        hideDetail();
    }

    function showDetail(key, dayNum) {
        var el = document.getElementById('dayDetail');
        var items = dateMap[key] || [];
        if (!items.length) { hideDetail(); return; }

        var dow = new Date(parseISOLocal(key)).getDay();
        var html = '<h3>' + key + ' (' + WEEK_DAYS[dow] + ') 언락 일정</h3>';
        items.forEach(function(item) {
            var cls = isBig(item) ? 'big' : 'small';
            html += '<div class="detail-row">' +
                '<span class="project">🔓 ' + item.project + '</span>' +
                '<span class="amount ' + cls + '">' + getAmount(item) + '</span>' +
                '</div>';
        });
        el.innerHTML = html;
        el.style.display = 'block';
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function hideDetail() {
        var el = document.getElementById('dayDetail');
        el.style.display = 'none';
        el.innerHTML = '';
    }

    function renderUpcoming() {
        var el = document.getElementById('upcList');
        var now = new Date();
        var nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var upcoming = [];

        if (!data || !data.items) return;
        data.items.forEach(function(item) {
            var d = parseISOLocal(item.date);
            if (d >= nowDate) {
                upcoming.push({ date: d, dateStr: item.date, project: item.project, usd: item.usd, amount_label: item.amount_label });
            }
        });

        upcoming.sort(function(a, b) { return a.date - b.date; });
        upcoming = upcoming.slice(0, MAX_UPCOMING);

        if (!upcoming.length) {
            el.innerHTML = '<div style="color:var(--dim);padding:20px 0;">다가오는 언락 일정이 없습니다.</div>';
            return;
        }

        var html = '';
        upcoming.forEach(function(item) {
            var cls = (item.usd && item.usd >= BIG_THRESHOLD) ? 'big' : 'small';
            var amt = (item.usd && item.usd > 0) ? formatUSD(item.usd) : (item.amount_label || '—');
            html += '<div class="upc-item">' +
                '<span class="upc-date">' + fmtDateShort(item.date) + ' (' + WEEK_DAYS[item.date.getDay()] + ')</span>' +
                '<span class="upc-icon">🔓</span>' +
                '<span class="upc-proj">' + item.project + '</span>' +
                '<span class="upc-amt ' + cls + '">' + amt + '</span>' +
                '</div>';
        });
        el.innerHTML = html;
    }

    function updateGenTime() {
        if (!data || !data.generated_at) return;
        var el = document.getElementById('calGenAt');
        var d = new Date(data.generated_at);
        el.textContent = '갱신: ' + fmtDate(d) + ' ' +
            String(d.getHours()).padStart(2, '0') + ':' +
            String(d.getMinutes()).padStart(2, '0') + ' KST';
    }

    function init() {
        fetch('data/v1/unlocks.json?t=' + Date.now(), { cache: 'no-store' })
            .then(function(r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function(json) {
                data = json;
                range = data.range;
                processItems(data.items);
                setNavRange();
                setInitialMonth();
                renderGrid();
                renderUpcoming();
                updateGenTime();
            })
            .catch(function(e) {
                var grid = document.getElementById('calGrid');
                grid.innerHTML = '<div class="fetch-err">데이터를 불러오지 못했습니다.<br>' + e.message + '</div>';
                document.getElementById('upcList').innerHTML = '';
            });

        document.getElementById('prevM').addEventListener('click', function() {
            if (!canPrev()) return;
            navState.month--;
            if (navState.month < 0) { navState.month = 11; navState.year--; }
            renderGrid();
        });
        document.getElementById('nextM').addEventListener('click', function() {
            if (!canNext()) return;
            navState.month++;
            if (navState.month > 11) { navState.month = 0; navState.year++; }
            renderGrid();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();