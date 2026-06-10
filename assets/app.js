/* 불개미 크립토 허브 — 대시보드 프론트 로직
 * Market Now : CoinGecko/Upbit 직접 fetch, 60초 실시간 폴링
 * Daily Signature : data/v1/*.json, 5분(300초) 갱신 (일1회 데이터지만 최신 배치 자동 반영)
 */
const BASE = "../data/v1";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const safeURL = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };

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
const fmtKRW = (v) => { if (v == null) return "—"; const a = Math.abs(v); if (a >= 1e12) return (a / 1e12).toFixed(1) + "조"; if (a >= 1e8) return Math.round(a / 1e8).toLocaleString() + "억"; return comma(v); };

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

// Binance 24h(BTC/ETH) — 모바일 네트워크에서도 접근 가능. 실시간 오버레이용.
const BN_24H = 'https://api.binance.com/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22%2C%22ETHUSDT%22%5D';
let MN = null;  // 최신 market_now.json 보관(급등급락 공유)

async function loadMarketLive() {
  try {
    // 데이터는 서버 cron(market_now.json)에서 — CoinGecko/업비트 직접호출이 일부 한국 모바일망에서 차단되는 문제 회피
    const d = await getJSON(`${BASE}/market_now.json?t=${Date.now()}`);
    MN = d;
    // BTC/ETH는 Binance로 실시간 오버레이(접근 가능 시), 실패하면 JSON값
    let bnMap = {};
    try { const bn = await getJSON(BN_24H); if (Array.isArray(bn)) bn.forEach((x) => bnMap[x.symbol] = x); } catch {}
    const live = bnMap.BTCUSDT && bnMap.ETHUSDT;
    const btcP = bnMap.BTCUSDT ? +bnMap.BTCUSDT.lastPrice : (d.btc && d.btc.price);
    const btcC = bnMap.BTCUSDT ? +bnMap.BTCUSDT.priceChangePercent : (d.btc && d.btc.chg);
    const ethP = bnMap.ETHUSDT ? +bnMap.ETHUSDT.lastPrice : (d.eth && d.eth.price);
    const ethC = bnMap.ETHUSDT ? +bnMap.ETHUSDT.priceChangePercent : (d.eth && d.eth.chg);
    const fgv = d.fear_greed ? d.fear_greed.value : null;

    let html = "";
    html += nowCard("BTC", btcP != null ? "$" + comma(btcP) : "—", btcC);
    html += nowCard("ETH", ethP != null ? "$" + comma(ethP) : "—", ethC);
    html += nowCard("BTC 도미넌스", d.btc_dominance != null ? d.btc_dominance.toFixed(1) + "%" : "—", null);
    html += nowCard("총 시총", d.total_mcap != null ? fmtUSD(d.total_mcap).replace("+", "") : "—", null);
    html += nowCard("김치 프리미엄", d.kimchi != null ? (d.kimchi >= 0 ? "+" : "") + d.kimchi.toFixed(2) + "%" : "—", null);
    let fgColor = "#3a1c1c", fgText = "#ff6b6b";
    if (fgv != null) { if (fgv >= 55) { fgColor = "#0f2a1c"; fgText = "#21d07a"; } else if (fgv >= 45) { fgColor = "#2a2410"; fgText = "#ffb547"; } }
    const fgLabel = fgv != null ? `${fgv} · ${fgKo(d.fear_greed.class)}` : "—";
    html += `<div class="nowcard"><div class="l">공포·탐욕</div><div class="v"><span class="fg" style="background:${fgColor};color:${fgText}">${fgLabel}</span></div></div>`;
    $("nowGrid").innerHTML = html;
    $("marketAge").textContent = live ? "실시간 · 방금 갱신" : "준실시간 · " + (d.generated_at || "").slice(11, 16);
    // 국내수급 위젯
    const dm = d.domestic;
    if (dm) {
      const kp = $("kimchi");
      if (kp) { kp.textContent = d.kimchi != null ? (d.kimchi >= 0 ? "+" : "") + d.kimchi.toFixed(2) + "%" : "—"; kp.className = "mono " + (d.kimchi >= 0 ? "up" : "down"); }
      if ($("usdkrw")) $("usdkrw").textContent = dm.usdKrw ? "₩" + comma(dm.usdKrw) : "—";
      if ($("btckrw")) $("btckrw").textContent = dm.btcKrw ? "₩" + comma(dm.btcKrw) : "—";
      if ($("ethkrw")) $("ethkrw").textContent = dm.ethKrw ? "₩" + comma(dm.ethKrw) : "—";
      if ($("upbitVol")) $("upbitVol").textContent = dm.btcVol ? "₩" + fmtKRW(dm.btcVol) : "—";
    }
    loadMovers();  // 같은 데이터로 급등급락 렌더
  } catch (e) {
    if ($("nowGrid").innerHTML.trim() === "" || $("nowGrid").querySelector(".skel"))
      $("nowGrid").innerHTML = `<div class="err">⚠️ 시세 일시 오류 (재시도 중)</div>`;
  }
}

function fgKo(c) {
  return { "Extreme Fear": "극단공포", "Fear": "공포", "Neutral": "중립", "Greed": "탐욕", "Extreme Greed": "극단탐욕" }[c] || c || "";
}

/* ---------------- 실시간 급등·급락 TOP 10 (market_now.json 공유) ---------------- */
function moverRow(c, i) {
  const v = c.chg;
  return `<div class="li mv"><div class="mvn"><span class="rk">${i + 1}</span><img src="${safeURL(c.image)}" alt="" loading="lazy" onerror="this.style.display='none'"><span class="nm">${esc(c.name)}</span><span class="sym">${esc(c.symbol)}</span></div>
    <div class="mvp"><span class="mono">$${comma(c.price, c.price < 1 ? 4 : 2)}</span><span class="${cls(v)} chg">${v >= 0 ? "+" : ""}${v.toFixed(2)}%</span></div></div>`;
}
function loadMovers() {
  if (!MN) return;
  if ($("topGainers") && MN.gainers) $("topGainers").innerHTML = MN.gainers.map(moverRow).join("");
  if ($("topLosers") && MN.losers) $("topLosers").innerHTML = MN.losers.map(moverRow).join("");
  if ($("moversAge")) $("moversAge").textContent = "갱신 " + (MN.generated_at || "").slice(11, 16);
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
    if (!sig) return;
    const sigT = (sig.generated_at || "").slice(11, 16);
    $("genAt").textContent = "시그니처 갱신: " + sigT + " KST";
    const M = sig.metrics || {};
    const defs = [
      { k: "btc_etf", t: "💵 BTC 현물 ETF 순유입", hist: "btc_etf", money: true },
      { k: "eth_etf", t: "💵 ETH 현물 ETF 순유입", hist: "eth_etf", money: true },
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
    $("sigAsof").textContent = `🟢 ${sigT} 갱신 · OI·CB 실시간 / ETF·DAT ${sig.data_date || ""} 기준`;
    $("dailySum").textContent = sig.summary || "시황 요약 준비중";
    $("dailyMeta").textContent = sig.data_date || "—";
  } catch (e) { /* 유지 */ }
}

/* ---------------- 캘린더(이벤트 / 언락 분리) ---------------- */
const CAL_ICON = { unlock: "🔓", macro: "📊", ipo: "🚀", event: "🎉" };
function calRowHTML(x, today) {
  const dd = Math.round((x._d - today) / 86400000);
  const dlabel = dd === 0 ? "D-DAY" : `D-${dd}`;
  const amt = x.amount ? ` <span style="color:var(--dim)">· ${esc(x.amount)}</span>` : "";
  const hot = x.importance === "high" ? "color:#ff4d5e;" : "";
  const md = x.date.slice(5).replace("-", ".");
  const when = x.time ? `${md} ${esc(x.time)} KST` : md;
  return `<div class="li"><div>${CAL_ICON[x.type] || "•"} ${esc(x.title)}${amt}<div style="font-size:11px;color:var(--dim);margin-top:2px;">🕐 ${when}</div></div><span class="when" style="${hot}">${dlabel}</span></div>`;
}
async function loadCalendar() {
  const ev = $("calEvent"), ul = $("calUnlock");
  if (!ev && !ul) return;
  try {
    const cal = await getJSON(`${BASE}/calendar.json?t=${Date.now()}`);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const all = (cal.items || [])
      .map((x) => ({ ...x, _d: new Date(x.date + "T00:00:00+09:00") }))
      .filter((x) => !isNaN(x._d) && x._d >= today)
      .sort((a, b) => a._d - b._d);
    const empty = '<div class="li"><div style="color:var(--dim)">예정된 일정이 없습니다.</div></div>';
    if (ev) {
      const evItems = all.filter((x) => x.type !== "unlock").slice(0, 6);
      ev.innerHTML = evItems.length ? evItems.map((x) => calRowHTML(x, today)).join("") : empty;
    }
    if (ul) {
      const ulItems = all.filter((x) => x.type === "unlock").slice(0, 6);
      ul.innerHTML = ulItems.length ? ulItems.map((x) => calRowHTML(x, today)).join("") : empty;
    }
  } catch (e) {
    if (ev) ev.innerHTML = `<div class="li"><div style="color:var(--down)">캘린더 로드 실패</div></div>`;
    if (ul) ul.innerHTML = `<div class="li"><div style="color:var(--down)">캘린더 로드 실패</div></div>`;
  }
}

/* ---------------- init ---------------- */
$("nowGrid").innerHTML = Array(6).fill('<div class="nowcard"><div class="l skel">···</div><div class="v skel">····</div></div>').join("");
$("sigGrid").innerHTML = Array(4).fill('<div class="sigcard"><div class="big skel">·····</div></div>').join("");

// 타이머 가드 — 중복 로드 방지 + 탭 비활성 시 폴링 정지(누수·rate-limit 방지)
if (!window.__hubInit) {
  window.__hubInit = true;
  let mTimer = null, sTimer = null, vTimer = null;
  function start() {
    stop();
    loadMarketLive(); mTimer = setInterval(loadMarketLive, 60000);   // 실시간 60초
    loadMovers();     vTimer = setInterval(loadMovers, 60000);       // 급등급락 60초
    loadSignature();  sTimer = setInterval(loadSignature, 300000);   // 5분
    loadCalendar();   // 캘린더(저빈도, 1회면 충분)
  }
  function stop() { clearInterval(mTimer); clearInterval(sTimer); clearInterval(vTimer); }
  document.addEventListener("visibilitychange", () => { document.hidden ? stop() : start(); });
  start();
}
