/* 불개미 크립토 허브 — 대시보드 프론트 로직
 * Market Now : CoinGecko/Upbit 직접 fetch, 60초 실시간 폴링
 * Daily Signature : data/v1/*.json, 5분(300초) 갱신 (일1회 데이터지만 최신 배치 자동 반영)
 */
const BASE = "../data/v1";
const $ = (id) => document.getElementById(id);

const fmtUSD = (v) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "-" : "+";
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
};
const cls = (v) => (v == null ? "" : v < 0 ? "down" : "up");
const comma = (n, d = 0) => n == null ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

async function getJSON(url, opts) {
  const r = await fetch(url, { cache: "no-store", ...opts });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

function ageText(iso) {
  if (!iso) return "시각 미상";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return iso;
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "방금 전"; if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60); if (h < 24) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}

/* ---------------- Market Now (실시간 60초) ---------------- */
let prevPrices = {};
function nowCard(l, v, chg) {
  const c = chg == null ? "" : chg < 0 ? "down" : "up";
  const arr = chg == null ? "" : chg < 0 ? "▼" : "▲";
  const ctxt = chg == null ? "" : `<div class="c ${c}">${arr} ${Math.abs(chg).toFixed(2)}%</div>`;
  return `<div class="nowcard"><div class="l">${l}</div><div class="v mono">${v}</div>${ctxt}</div>`;
}

async function loadMarketLive() {
  try {
    // 1) CoinGecko: 가격(24h 변동) + 글로벌(도미넌스·시총)
    const [mk, gl, fg, kimchi] = await Promise.all([
      getJSON("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum&price_change_percentage=24h").catch(() => null),
      getJSON("https://api.coingecko.com/api/v3/global").catch(() => null),
      getJSON("https://api.alternative.me/fng/?limit=1").catch(() => null),
      calcKimchi().catch(() => null),
    ]);
    const btc = mk && mk.find((x) => x.id === "bitcoin");
    const eth = mk && mk.find((x) => x.id === "ethereum");
    const dom = gl && gl.data ? gl.data.market_cap_percentage.btc : null;
    const mcap = gl && gl.data ? gl.data.total_market_cap.usd : null;
    let fgv = null, fgc = null;
    if (fg && fg.data && fg.data[0]) { fgv = +fg.data[0].value; fgc = fg.data[0].value_classification; }

    let html = "";
    html += nowCard("BTC", btc ? "$" + comma(btc.current_price) : "—", btc ? btc.price_change_percentage_24h : null);
    html += nowCard("ETH", eth ? "$" + comma(eth.current_price) : "—", eth ? eth.price_change_percentage_24h : null);
    html += nowCard("BTC 도미넌스", dom != null ? dom.toFixed(1) + "%" : "—", null);
    html += nowCard("총 시총", mcap != null ? fmtUSD(mcap).replace("+", "") : "—", null);
    html += nowCard("김치 프리미엄", kimchi != null ? (kimchi >= 0 ? "+" : "") + kimchi.toFixed(2) + "%" : "—", null);
    let fgColor = "#3a1c1c", fgText = "#ff6b6b";
    if (fgv != null) { if (fgv >= 55) { fgColor = "#0f2a1c"; fgText = "#21d07a"; } else if (fgv >= 45) { fgColor = "#2a2410"; fgText = "#ffb547"; } }
    const fgLabel = fgv != null ? `${fgv} · ${fgKo(fgc)}` : "—";
    html += `<div class="nowcard"><div class="l">공포·탐욕</div><div class="v"><span class="fg" style="background:${fgColor};color:${fgText}">${fgLabel}</span></div></div>`;
    $("nowGrid").innerHTML = html;
    $("marketAge").textContent = "실시간 · 방금 갱신";
    // 국내수급(대략)
    if (btc) { $("btckrw").textContent = "—"; }
  } catch (e) {
    if ($("nowGrid").innerHTML.trim() === "" || $("nowGrid").querySelector(".skel"))
      $("nowGrid").innerHTML = `<div class="err">⚠️ 실시간 시세 일시 오류 (재시도 중)</div>`;
  }
}

function fgKo(c) {
  return { "Extreme Fear": "극단공포", "Fear": "공포", "Neutral": "중립", "Greed": "탐욕", "Extreme Greed": "극단탐욕" }[c] || c || "";
}

// 김치 프리미엄: Upbit(KRW) vs Binance(USD) × 환율. Upbit는 60초 폴링이라 10초제한 내.
async function calcKimchi() {
  const [up, bn, fx] = await Promise.all([
    getJSON("https://api.upbit.com/v1/ticker?markets=KRW-BTC"),
    getJSON("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"),
    getJSON("https://open.er-api.com/v6/latest/USD"),
  ]);
  const krw = up[0].trade_price;
  const usd = +bn.price;
  const rate = fx.rates.KRW;
  return (krw / (usd * rate) - 1) * 100;
}

/* ---------------- Daily Signature (5분) ---------------- */
function spark(id, hist, color) {
  const el = $(id);
  if (!el || !window.Chart || !hist || !hist.length) return;
  if (el._chart) el._chart.destroy();
  const data = hist.slice(-30).map((h) => h.value);
  el._chart = new Chart(el, {
    type: "line",
    data: { labels: data.map((_, i) => i), datasets: [{ data, borderColor: color, backgroundColor: color + "22", borderWidth: 2, fill: true, pointRadius: 0, tension: 0.35 }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } }, animation: false, responsive: true, maintainAspectRatio: false },
  });
}

async function loadSignature() {
  try {
    const sig = await getJSON(`${BASE}/signature.json?t=${Date.now()}`).catch(() => null);
    const manifest = await getJSON(`${BASE}/manifest.json?t=${Date.now()}`).catch(() => null);
    if (manifest) $("genAt").textContent = "시그니처 생성: " + (manifest.generated_at || "");
    if (!sig) return;
    const M = sig.metrics || {};
    const defs = [
      { k: "btc_etf", t: "💵 BTC 현물 ETF 순유입", hist: "btc_etf", money: true },
      { k: "dat_weekly", t: "🏦 DAT (기업 트레저리)", hist: "dat_weekly", money: true },
      { k: "btc_oi_24h", t: "📊 BTC OI (미결제약정)", hist: "btc_oi_24h", money: false },
      { k: "cb_premium", t: "🇺🇸 코인베이스 프리미엄", hist: "cb", money: false },
    ];
    let html = "";
    defs.forEach((d, i) => {
      const m = M[d.k] || {};
      const v = m.value;
      const disp = d.money ? fmtUSD(v) : (m.raw ?? (v != null ? v + "%" : "—"));
      const pill = v == null ? "" : `<span class="pill ${v < 0 ? "d" : "u"}">${v < 0 ? "유출/감소" : "유입/증가"}</span>`;
      html += `<div class="sigcard">${pill}<span class="asof">${m.basis || "—"}</span><div class="t">${d.t}</div><div class="big ${cls(v)}">${disp}</div><div class="sub">${(m.as_of || "").slice(0, 60) || "기준 미상"}</div><canvas id="sk${i}" height="54"></canvas></div>`;
    });
    $("sigGrid").innerHTML = html;
    for (let i = 0; i < defs.length; i++) {
      const hist = await getJSON(`${BASE}/history/${defs[i].hist}.json?t=${Date.now()}`).catch(() => []);
      const v = (M[defs[i].k] || {}).value;
      spark(`sk${i}`, hist, v != null && v < 0 ? "#ff4d5e" : "#21d07a");
    }
    $("sigAsof").textContent = `일일 · ${sig.data_date || ""} 기준 (5분마다 최신 확인)`;
    $("dailySum").textContent = sig.summary || "시황 요약 준비중";
    $("dailyMeta").textContent = sig.data_date || "—";
  } catch (e) { /* 유지 */ }
}

/* ---------------- 이벤트·언락 캘린더 ---------------- */
async function loadCalendar() {
  const wrap = $("calWrap");
  if (!wrap) return;
  const ICON = { unlock: "🔓", macro: "📊", ipo: "🚀", event: "🎉" };
  try {
    const cal = await getJSON(`${BASE}/calendar.json?t=${Date.now()}`);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const items = (cal.items || [])
      .map((x) => ({ ...x, _d: new Date(x.date + "T00:00:00+09:00") }))
      .filter((x) => !isNaN(x._d) && x._d >= today)
      .sort((a, b) => a._d - b._d)
      .slice(0, 6);
    if (!items.length) { wrap.innerHTML = '<div class="li"><div style="color:var(--dim)">예정된 일정이 없습니다.</div></div>'; return; }
    wrap.innerHTML = items.map((x) => {
      const dd = Math.round((x._d - today) / 86400000);
      const dlabel = dd === 0 ? "D-DAY" : `D-${dd}`;
      const amt = x.amount ? ` <span style="color:var(--dim)">· ${x.amount}</span>` : "";
      const hot = x.importance === "high" ? "color:#ff4d5e;" : "";
      return `<div class="li"><div>${ICON[x.type] || "•"} ${x.title}${amt}</div><span class="when" style="${hot}">${dlabel}</span></div>`;
    }).join("");
  } catch (e) {
    wrap.innerHTML = `<div class="li"><div style="color:var(--down)">캘린더 로드 실패</div></div>`;
  }
}

/* ---------------- init ---------------- */
$("nowGrid").innerHTML = Array(6).fill('<div class="nowcard"><div class="l skel">···</div><div class="v skel">····</div></div>').join("");
$("sigGrid").innerHTML = Array(4).fill('<div class="sigcard"><div class="big skel">·····</div></div>').join("");

// 타이머 가드 — 중복 로드 방지 + 탭 비활성 시 폴링 정지(누수·rate-limit 방지)
if (!window.__hubInit) {
  window.__hubInit = true;
  let mTimer = null, sTimer = null;
  function start() {
    stop();
    loadMarketLive(); mTimer = setInterval(loadMarketLive, 60000);   // 실시간 60초
    loadSignature();  sTimer = setInterval(loadSignature, 300000);   // 5분
    loadCalendar();   // 캘린더(저빈도, 1회면 충분)
  }
  function stop() { clearInterval(mTimer); clearInterval(sTimer); }
  document.addEventListener("visibilitychange", () => { document.hidden ? stop() : start(); });
  start();
}
