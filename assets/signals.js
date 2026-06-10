/* 시장지표(시그니처) — ETF·DAT·OI·CB 풀 추세 차트 */
const BASE = "../data/v1";
const $ = (id) => document.getElementById(id);

const DEFS = [
  { key: "btc_etf", hist: "btc_etf", title: "💵 BTC 현물 ETF 순유입", unit: "USD",
    desc: "미국 현물 비트코인 ETF의 일일 순유입/유출. 기관 자금 흐름의 핵심 지표. (D-1, NY close 기준)" },
  { key: "dat_weekly", hist: "dat_weekly", title: "🏦 DAT — 기업 트레저리 주간 순유입", unit: "USD",
    desc: "MSTR 등 기업의 비트코인 트레저리 주간 순매수. 기업 매집 동향. (주간 누계)" },
  { key: "btc_oi_24h", hist: "btc_oi_24h", title: "📊 BTC OI — 미결제약정 24h 변화", unit: "%",
    desc: "비트코인 선물 미결제약정의 24시간 변화율. 레버리지·청산 압력의 가늠자. (추세 참고)" },
  { key: "cb_premium", hist: "cb", title: "🇺🇸 코인베이스 프리미엄", unit: "%",
    desc: "코인베이스(미국) vs 바이낸스 가격차. 플러스=미국 기관 매수세, 마이너스=약세. (14:30 KST)" },
];

const fmtUSD = (v) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "-" : "+";
  if (a >= 1e12) return `${s}$${(a/1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a/1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a/1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a/1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
};
const cls = (v) => (v == null ? "" : v < 0 ? "down" : "up");

async function getJSON(p) {
  const r = await fetch(`${p}?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${p} ${r.status}`);
  return r.json();
}

function chart(canvas, hist, unit) {
  if (!window.Chart || !hist || hist.length === 0) return false;
  if (canvas._chart) canvas._chart.destroy();
  const labels = hist.map((h) => h.date);
  const data = hist.map((h) => h.value);
  const color = data[data.length - 1] < 0 ? "#ff4d5e" : "#21d07a";
  canvas._chart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets: [{ data, borderColor: color, backgroundColor: color + "22", borderWidth: 2, fill: true, pointRadius: hist.length <= 12 ? 3 : 0, tension: 0.3 }] },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => unit === "USD" ? fmtUSD(c.parsed.y) : c.parsed.y + "%" } } },
      scales: {
        x: { ticks: { color: "#8a94a3", font: { size: 10 }, maxTicksLimit: 6 }, grid: { color: "#1a2029" } },
        y: { ticks: { color: "#8a94a3", font: { size: 10 }, callback: (v) => unit === "USD" ? fmtUSD(v) : v + "%" }, grid: { color: "#1a2029" } },
      },
      maintainAspectRatio: false, responsive: true, animation: false,
    },
  });
  return true;
}

(async function main() {
  const grid = $("grid");
  // 시그니처 수급: 4개 지표를 하나의 박스에 compact rows로 렌더
  grid.innerHTML = `<div class="sig-box" style="grid-column:1/-1">` +
    DEFS.map((d, i) => `<div class="sig-row"><div class="sig-label">${d.title}</div><div class="sig-val"><span class="big sig-big" id="big${i}">···</span><span class="sig-basis" id="asof${i}"></span></div></div>`).join("") +
    `</div>`;
  try {
    const sig = await getJSON(`${BASE}/signature.json`).catch(() => null);
    if (sig) { $("genAt").textContent = `${sig.data_date || ""} 기준 · 생성 ${(sig.generated_at||"").slice(0,16)}`; }
    for (let i = 0; i < DEFS.length; i++) {
      const d = DEFS[i];
      const m = sig && sig.metrics ? sig.metrics[d.key] : null;
      if (m) {
        $(`big${i}`).textContent = d.unit === "USD" ? fmtUSD(m.value) : (m.raw ?? "—");
        $(`big${i}`).className = "big sig-big " + cls(m.value);
        $(`asof${i}`).textContent = m.basis || "";
      }
    }
  } catch (e) {
    grid.innerHTML = `<div class="err">⚠️ 데이터 로드 실패: ${e.message}</div>`;
  }
})();
