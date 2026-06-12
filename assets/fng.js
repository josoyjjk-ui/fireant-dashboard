(function() {
    'use strict';

    const ENDPOINT = 'data/v1/fng.json';
    let refreshInterval = null;
    let chartInstance = null;

    const utils = {
        kstFmt: function(isoStr) {
            try {
                const d = new Date(isoStr);
                return d.toLocaleString('ko-KR', {
                    timeZone: 'Asia/Seoul',
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', hour12: false
                }) + ' (KST)';
            } catch(e) {
                return '';
            }
        },
        dateLabel: function(ts) {
            const d = new Date(ts * 1000);
            return (d.getMonth()+1) + '/' + d.getDate();
        },
        getBand: function(val, bands) {
            if (val == null || !bands) return null;
            for (let b of bands) {
                if (val >= b.min && val <= b.max) return b;
            }
            return null;
        },
        polarToCart: function(cx, cy, r, deg) {
            const rad = ((deg - 90) * Math.PI) / 180;
            return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
        },
        describeArc: function(cx, cy, r, start, end) {
            const s = this.polarToCart(cx, cy, r, end);
            const e = this.polarToCart(cx, cy, r, start);
            const large = (end - start <= 180) ? 0 : 1;
            return 'M ' + s.x + ' ' + s.y + ' A ' + r + ' ' + r + ' 0 ' + large + ' 0 ' + e.x + ' ' + e.y;
        }
    };

    function renderGauge(value, band, bands) {
        const container = document.getElementById('gaugeContainer');
        if (!container) return;

        const R = 120, cx = 200, cy = 155, sw = 30;
        const pad = 1.5; 
        const step = (180 - pad * (bands.length - 1)) / bands.length;
        
        let arcs = '';
        let startAngle = 0;

        bands.forEach(function(b) {
            const endAngle = startAngle + step;
            const innerR = R - sw / 2;
            
            const s1 = utils.polarToCart(cx, cy, innerR, startAngle);
            const e1 = utils.polarToCart(cx, cy, innerR, endAngle);
            const e2 = utils.polarToCart(cx, cy, innerR + sw, endAngle);
            const s2 = utils.polarToCart(cx, cy, innerR + sw, startAngle);
            
            const diff = endAngle - startAngle;
            const largeArc = (diff > 180) ? 1 : 0;
            
            const d = [
                'M ' + s1.x + ' ' + s1.y, 
                'A ' + innerR + ' ' + innerR + ' 0 ' + largeArc + ' 1 ' + e1.x + ' ' + e1.y, 
                'L ' + e2.x + ' ' + e2.y, 
                'A ' + (innerR + sw) + ' ' + (innerR + sw) + ' 0 ' + largeArc + ' 0 ' + s2.x + ' ' + s2.y, 
                'Z'
            ].join(' ');

            arcs += '<path d="' + d + '" fill="' + b.color + '" />';
            startAngle = endAngle + pad;
        });

        const needleAngle = (Math.min(100, Math.max(0, value)) / 100) * 180;
        const needleTip = utils.polarToCart(cx, cy, R - 1, needleAngle);
        const nL = utils.polarToCart(cx, cy, 6, needleAngle - 90);
        const nR = utils.polarToCart(cx, cy, 6, needleAngle + 90);

        const svg = [
            '<svg viewBox="0 0 400 210" xmlns="http://www.w3.org/2000/svg">',
            '<defs>',
                '<filter id="nShd" x="-20%" y="-20%" width="140%" height="140%">',
                    '<feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000" flood-opacity="0.6"/>',
                '</filter>',
            '</defs>',
            arcs,
            '<g filter="url(#nShd)">',
                '<polygon points="' + needleTip.x + ',' + needleTip.y + ' ' + nL.x + ',' + nL.y + ' ' + nR.x + ',' + nR.y + '" fill="#fff"/>',
                '<circle cx="' + cx + '" cy="' + cy + '" r="9" fill="#fff"/>',
                '<circle cx="' + cx + '" cy="' + cy + '" r="5" fill="' + (band ? band.color : '#333') + '"/>',
            '</g>',
            '</svg>'
        ].join('');

        const clsColor = band ? band.color : '#8a94a3';
        const clsText = band ? band.ko : '-';

        container.innerHTML = svg 
            + '<div class="gauge-value">' + value + '</div>' 
            + '<div class="gauge-class" style="color:' + clsColor + ';">' + clsText + '</div>';
    }

    function renderCompare(now, yesterday, lastWeek, lastMonth, bands) {
        const grid = document.getElementById('fngCompare');
        if (!grid) return;

        const items = [
            { label: '지금', data: now },
            { label: '어제', data: yesterday },
            { label: '지난주', data: lastWeek },
            { label: '지난달', data: lastMonth }
        ];

        grid.innerHTML = items.map(function(item) {
            if (!item.data || item.data.value == null) {
                return '<div class="compare-item">' 
                    + '<div class="compare-label">' + item.label + '</div>' 
                    + '<div class="compare-val" style="color:var(--dim)">-</div>' 
                    + '<div class="compare-class" style="color:var(--dim)">데이터 없음</div>' 
                    + '</div>';
            }
            const b = utils.getBand(item.data.value, bands);
            const color = b ? b.color : '#8a94a3';
            const text = b ? b.ko : item.data.classification || '-';
            return '<div class="compare-item">' 
                + '<div class="compare-label">' + item.label + '</div>' 
                + '<div class="compare-val" style="color:' + color + ';">' + item.data.value + '</div>' 
                + '<div class="compare-class" style="color:' + color + ';">' + text + '</div>' 
                + '</div>';
        }).join('');
    }

    function renderChart(history, bands) {
        const ctx = document.getElementById('fngChart');
        if (!ctx || !window.Chart || !Array.isArray(history)) return;

        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }

        const labels = history.map(function(h) { return utils.dateLabel(h.t); });
        const data = history.map(function(h) { return h.v; });

        const yLines = [25, 45, 55, 75];
        const bgColors = ['rgba(231, 76, 60, 0.06)', 'rgba(232, 131, 58, 0.06)', 'rgba(241, 196, 15, 0.06)', 'rgba(154, 205, 50, 0.06)'];

        const datasets = yLines.map(function(y, i) {
            return {
                data: Array(history.length).fill(y),
                borderColor: 'rgba(255,255,255,0.06)',
                borderWidth: 1,
                pointRadius: 0,
                fill: false,
            };
        });

        datasets.unshift({
            label: '공포·탐욕 지수',
            data: data,
            borderColor: '#ffb547',
            backgroundColor: 'rgba(255, 181, 71, 0.1)',
            borderWidth: 2,
            pointRadius: 0,
            pointHitRadius: 10,
            fill: true,
            tension: 0.3
        });

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#13161c',
                        titleColor: '#e7edf3',
                        bodyColor: '#ffb547',
                        borderColor: '#232936',
                        borderWidth: 1,
                        padding: 12,
                        displayColors: false,
                        titleFont: { family: 'Pretendard Variable', weight: '600' },
                        bodyFont: { family: 'Pretendard Variable', size: 16, weight: '800' },
                        callbacks: {
                            title: function(ctx) { return ctx[0].label; },
                            label: function(ctx) {
                                if (ctx.datasetIndex !== 0) return null;
                                const val = ctx.parsed.y;
                                const b = utils.getBand(val, bands);
                                return val + '  ' + (b ? b.ko : '');
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            color: '#8a94a3',
                            maxTicksLimit: 8,
                            font: { family: 'Pretendard Variable', size: 11 }
                        },
                        grid: { display: false },
                        border: { color: '#232936' }
                    },
                    y: {
                        min: 0,
                        max: 100,
                        ticks: {
                            stepSize: 25,
                            color: '#8a94a3',
                            font: { family: 'Pretendard Variable', size: 11 }
                        },
                        grid: { color: 'rgba(35, 41, 54, 0.5)' },
                        border: { display: false }
                    }
                }
            }
        });
    }

    function renderError(msg) {
        const main = document.getElementById('fng-main');
        if (!main) return;
        main.innerHTML = '<div class="fng-error-state">데이터를 불러오는 중 오류가 발생했습니다.<br><small style="color:var(--dim);font-weight:400;">' + (msg || '') + '</small></div>';
    }

    async function init() {
        try {
            const url = ENDPOINT + '?t=' + Date.now();
            const res = await fetch(url);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            
            const bands = data.bands;
            const nowBand = utils.getBand(data.now.value, bands);

            if (data.generated_at) {
                const el = document.getElementById('fngGenAt');
                if (el) el.textContent = '업데이트: ' + utils.kstFmt(data.generated_at);
            }

            renderGauge(data.now.value, nowBand, bands);
            renderCompare(data.now, data.yesterday, data.last_week, data.last_month, bands);
            
            if (window.Chart && data.history) {
                renderChart(data.history, bands);
            }

        } catch (err) {
            console.error('FnG Fetch Error:', err);
            renderError(err.message);
        }
    }

    function startPolling() {
        stopPolling();
        init();
        refreshInterval = setInterval(function() {
            if (!document.hidden) {
                init();
            }
        }, 60000);
    }

    function stopPolling() {
        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startPolling);
    } else {
        startPolling();
    }

})();