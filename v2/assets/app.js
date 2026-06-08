/* 불개미 크립토 허브 — Phase 0/1 프론트 로직
 * 원칙(GPT 검수): manifest 먼저 → 동일 run_id 배치만 신뢰, 카드별 as_of·실패상태 표시,
 * 브라우저는 우리 data/v1/*.json 만 읽는다(제3자 API 직접호출 X).
 */
const BASE = "../data/v1";
const $ = (id) => document.getElementById(id);

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
const arrow = (v) => (v == null ? "" : v < 0 ? "▼" : "▲");

async function getJSON(path) {
  const r = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

function ageText(iso) {
  if (!iso) return "시각 미상";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return iso;
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}

function spark(canvasId, hist, color) {
  const el = $(canvasId);
  if (!el || !window.Chart || !hist || !hist.length) return;
  const data = hist.slice(-30).map((h) => h.value);
  new Chart(el, {
    type: "line",
    data: { labels: data.map((_, i) => i), datasets: [{ data, borderColor: color, backgroundColor: color + "22", borderWidth: 2, fill: true, pointRadius: 0, tension: 0.35 }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } }, animation: false, responsive: true, maintainAspectRatio: false },
  });
}

function renderMarket(m) {
  const d = m.data || {};
  const fgVal = d.fear_greed_value;
  let fgColor = "#3a1c1c", fgText = "#ff6b6b";
  if (fgVal != null) {
    if (fgVal >= 55) { fgColor = "#0f2a1c"; fgText = "#21d07a"; }
    else if (fgVal >= 45) { fgColor = "#2a2410"; fgText = "#ffb547"; }
  }
  const cards = [
    ["BTC", d.btc_usd ?? "—", ""],
    ["ETH", d.eth_usd ?? "—", ""],
    ["BTC 도미넌스", d.btc_dominance ?? "—", ""],
    ["총 시총", d.global_market_cap ?? "—", ""],
    ["김치 프리미엄", d.kimchi_premium ?? "—", ""],
  ];
  let html = cards.map(([l, v]) => `<div class="nowcard"><div class="l">${l}</div><div class="v mono">${v}</div></div>`).join("");
  html += `<div class="nowcard"><div class="l">공포·탐욕</div><div class="v"><span class="fg" style="background:${fgColor};color:${fgText}">${d.fear_greed ?? "—"}</span></div></div>`;
  $("nowGrid").innerHTML = html;
  $("marketAge").textContent = "준실시간 · " + ageText(m.generated_at);
  // 국내수급
  $("kimchi").textContent = d.kimchi_premium ?? "—";
  $("kimchi").className = "mono " + (String(d.kimchi_premium).startsWith("+") ? "up" : String(d.kimchi_premium).startsWith("-") ? "down" : "");
  $("usdkrw").textContent = d.usd_krw ?? "—";
  $("btckrw").textContent = d.btc_krw ?? "—";
  $("ethkrw").textContent = d.eth_krw ?? "—";
}

function renderSignature(sig, histMap) {
  const M = sig.metrics || {};
  const defs = [
    { k: "btc_etf", t: "💵 BTC 현물 ETF 순유입", hist: histMap.btc_etf, money: true },
    { k: "dat_weekly", t: "🏦 DAT (기업 트레저리)", hist: histMap.dat_weekly, money: true },
    { k: "btc_oi_24h", t: "📊 BTC OI (미결제약정)", hist: histMap.btc_oi_24h, money: false },
    { k: "cb_premium", t: "🇺🇸 코인베이스 프리미엄", hist: histMap.cb, money: false },
  ];
  let html = "";
  defs.forEach((def, i) => {
    const m = M[def.k] || {};
    const v = m.value;
    const disp = def.money ? fmtUSD(v) : (m.raw ?? (v != null ? v + "%" : "—"));
    const pill = v == null ? "" : `<span class="pill ${v < 0 ? "d" : "u"}">${v < 0 ? "유출/감소" : "유입/증가"}</span>`;
    html += `<div class="sigcard">${pill}<span class="asof">${m.basis || "—"}</span>
      <div class="t">${def.t}</div>
      <div class="big ${cls(v)}">${disp}</div>
      <div class="sub">${(m.as_of || "").slice(0, 60) || "기준 미상"}</div>
      <canvas id="sk${i}" height="54"></canvas></div>`;
  });
  $("sigGrid").innerHTML = html;
  defs.forEach((def, i) => {
    const v = (M[def.k] || {}).value;
    spark(`sk${i}`, def.hist, v != null && v < 0 ? "#ff4d5e" : "#21d07a");
  });
  $("sigAsof").textContent = `일일 · ${sig.data_date || ""} 기준`;
  $("dailySum").textContent = sig.summary || "시황 요약 준비중";
  $("dailyMeta").textContent = sig.data_date || "—";
}

function fail(msg) {
  $("nowGrid").innerHTML = `<div class="err">⚠️ 데이터 로드 실패: ${msg}</div>`;
}

(async function main() {
  // skeleton
  $("nowGrid").innerHTML = Array(6).fill('<div class="nowcard"><div class="l skel">···</div><div class="v skel">····</div></div>').join("");
  $("sigGrid").innerHTML = Array(4).fill('<div class="sigcard"><div class="big skel">·····</div></div>').join("");
  try {
    const manifest = await getJSON(`${BASE}/manifest.json`);
    $("genAt").textContent = "생성: " + (manifest.generated_at || "");
    const [market, signature] = await Promise.all([
      getJSON(`${BASE}/market.json`).catch(() => null),
      getJSON(`${BASE}/signature.json`).catch(() => null),
    ]);
    // 배치 일관성 경고(run_id 불일치)
    if (market && signature && market.run_id !== signature.run_id) {
      const b = $("staleBanner"); b.style.display = "block";
      b.textContent = "⚠️ 일부 데이터 배치가 일치하지 않습니다(갱신 중일 수 있음).";
    }
    if (market) renderMarket(market);
    const histMap = {};
    for (const m of ["cb", "btc_etf", "dat_weekly", "btc_oi_24h"]) {
      histMap[m] = await getJSON(`${BASE}/history/${m}.json`).catch(() => []);
    }
    if (signature) renderSignature(signature, histMap);
    if (!market && !signature) fail("manifest는 있으나 데이터 없음");
  } catch (e) {
    fail(e.message || String(e));
  }
})();
