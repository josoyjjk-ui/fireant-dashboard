/* 시그널 보강 — 김치 프리미엄 + BTC 선물 거래량/가격 오버랩 + OI 추세 (무료 공개 API)
 * whale.js(고래 실시간 피드)와 독립. 고유 ID: fxLabel/kimchiBtc/kimchiEth/volChart/oiChart */
(function () {
  const $ = (id) => document.getElementById(id);
  const f2 = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const usd = (n) => "$" + (n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : f2(n));
  const pct = (n) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
  const ucls = (n) => (n >= 0 ? "up" : "down");
  async function J(u) { const r = await fetch(u, { cache: "no-store" }); if (!r.ok) throw 0; return r.json(); }
  let btcUsd = 0, ethUsd = 0;

  async function kimchi() {
    let fx = 1385;
    try { const e = await J("https://open.er-api.com/v6/latest/USD"); fx = e.rates.KRW || 1385; } catch (e) {}
    const fl = $("fxLabel"); if (fl) fl.textContent = "환율 ₩" + f2(fx);
    try {
      const [b, e] = await Promise.all([
        J("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"),
        J("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT")]);
      btcUsd = +b.price; ethUsd = +e.price;
    } catch (e) {}
    try {
      const u = await J("https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH");
      const ub = u.find((x) => x.market === "KRW-BTC"), ue = u.find((x) => x.market === "KRW-ETH");
      if (ub && btcUsd) { const k = (ub.trade_price / fx) / btcUsd - 1; const el = $("kimchiBtc"); if (el) { el.textContent = pct(k * 100); el.className = "v mono " + ucls(k); } const d = $("kimchiBtcD"); if (d) d.textContent = "업비트 ₩" + f2(ub.trade_price) + " · 바이낸스 $" + f2(btcUsd); }
      if (ue && ethUsd) { const k = (ue.trade_price / fx) / ethUsd - 1; const el = $("kimchiEth"); if (el) { el.textContent = pct(k * 100); el.className = "v mono " + ucls(k); } const d = $("kimchiEthD"); if (d) d.textContent = "업비트 ₩" + f2(ue.trade_price) + " · 바이낸스 $" + f2(ethUsd); }
    } catch (e) { const el = $("kimchiBtc"); if (el) el.textContent = "–"; }
  }

  let oiChart, volChart;
  const lbl = (ts, tf) => { const d = new Date(ts); return tf === "1D" ? String(d.getHours()).padStart(2, "0") + ":00" : (d.getMonth() + 1) + "/" + d.getDate(); };

  async function charts(tf) {
    const m = { "1D": { p: "1h", lim: 24 }, "1W": { p: "4h", lim: 42 }, "1M": { p: "1d", lim: 30 } }[tf] || { p: "1h", lim: 24 };
    try {
      const k = await J(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=${m.p}&limit=${m.lim}`);
      const labels = k.map((r) => lbl(r[0], tf)), vol = k.map((r) => +r[7]), price = k.map((r) => +r[4]);
      if (volChart) volChart.destroy();
      volChart = new Chart($("volChart"), { data: { labels, datasets: [
        { type: "bar", label: "거래대금", data: vol, backgroundColor: "rgba(77,155,255,.45)", borderColor: "#4d9bff", borderWidth: 0, borderRadius: 2, yAxisID: "y", order: 2 },
        { type: "line", label: "BTC 가격", data: price, borderColor: "#ff3b30", borderWidth: 2, pointRadius: 0, tension: .3, yAxisID: "y1", order: 1 }] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
          plugins: { legend: { display: true, position: "top", labels: { color: "#aeb8c4", boxWidth: 10, font: { size: 11 } } },
            tooltip: { callbacks: { label: (c) => c.dataset.label + " " + (c.dataset.yAxisID === "y1" ? "$" + f2(c.parsed.y) : usd(c.parsed.y)) } } },
          scales: { x: { grid: { display: false }, ticks: { color: "#5c6675", maxTicksLimit: 6, font: { size: 10 } } },
            y: { position: "left", grid: { color: "#1a1f28" }, ticks: { color: "#5c6675", font: { size: 10 }, callback: (v) => usd(v) } },
            y1: { position: "right", grid: { display: false }, ticks: { color: "#ff8b85", font: { size: 10 }, callback: (v) => "$" + (v / 1000).toFixed(0) + "k" } } } } });
    } catch (e) {}
    try {
      const oi = await J(`https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=${m.p}&limit=${m.lim}`);
      const labels = oi.map((x) => lbl(x.timestamp, tf)), data = oi.map((x) => +x.sumOpenInterestValue);
      if (oiChart) oiChart.destroy();
      oiChart = new Chart($("oiChart"), { type: "line", data: { labels, datasets: [{ data, borderColor: "#ff3b30", borderWidth: 2, fill: true, backgroundColor: "rgba(255,59,48,.10)", tension: .35, pointRadius: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => "OI " + usd(c.parsed.y) } } },
          scales: { x: { grid: { display: false }, ticks: { color: "#5c6675", maxTicksLimit: 6, font: { size: 10 } } }, y: { grid: { color: "#1a1f28" }, ticks: { color: "#5c6675", font: { size: 10 }, callback: (v) => usd(v) } } } } });
    } catch (e) {}
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest(".tf button"); if (!b) return;
    document.querySelectorAll(".tf button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on"); charts(b.dataset.tf);
  });

  function start() { kimchi(); charts("1D"); }
  if (document.readyState !== "loading") start(); else document.addEventListener("DOMContentLoaded", start);
  setInterval(kimchi, 30000);
})();
