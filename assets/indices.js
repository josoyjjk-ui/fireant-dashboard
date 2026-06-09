/* 주요 주가지수 — 코인(CoinGecko 실시간) + 미국지수/한국증시/미국채/매크로/원자재(cron JSON)
   60초 자동갱신. 코인은 클라에서 CoinGecko 직접 호출(CORS OK)로 실시간. */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function fmtNum(v, unit) {
  if (v == null) return "—";
  const n = v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return unit === "%" ? n + "%" : n;
}

function card(x) {
  const c = x.change_pct;
  const cls = c == null ? "" : c < 0 ? "down" : "up";
  const arr = c == null ? "" : c < 0 ? "▼" : "▲";
  const cTxt = c == null ? "—" : `${arr} ${Math.abs(c).toFixed(2)}%`;
  const prefix = x.unit === "$" ? "$" : "";
  return `<div class="idx"><div class="n">${esc(x.name)}</div>
    <div class="p mono">${prefix}${fmtNum(x.price, x.unit)}</div>
    <div class="c ${cls}">${cTxt}</div></div>`;
}

async function getJSON(u) {
  const r = await fetch(`${u}${u.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

const COINS = "bitcoin,ethereum,solana,ripple,binancecoin";
const COIN_NAME = { bitcoin: "비트코인 (BTC)", ethereum: "이더리움 (ETH)", solana: "솔라나 (SOL)", ripple: "리플 (XRP)", binancecoin: "BNB" };

async function loadCoins() {
  try {
    const d = await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${COINS}&vs_currencies=usd&include_24hr_change=true`);
    return Object.keys(COIN_NAME).filter((id) => d[id]).map((id) => ({
      name: COIN_NAME[id], group: "코인", unit: "$",
      price: d[id].usd, change_pct: d[id].usd_24h_change,
    }));
  } catch { return []; }
}

const GROUP_META = {
  "코인": "🪙 코인 (24h)",
  "주가지수": "📊 미국 주가지수",
  "한국증시": "🇰🇷 한국 증시",
  "미국채 금리": "🏦 미국 국채 금리",
  "매크로": "🌐 매크로",
  "원자재": "🛢️ 원자재",
};
const ORDER = ["코인", "주가지수", "한국증시", "미국채 금리", "매크로", "원자재"];

async function load() {
  try {
    const [j, coins] = await Promise.all([
      getJSON("../data/v1/indices.json").catch(() => ({ indices: [] })),
      loadCoins(),
    ]);
    const all = [...coins, ...(j.indices || [])];
    if (!all.length) throw new Error("데이터 없음");
    const groups = {};
    all.forEach((x) => { (groups[x.group] = groups[x.group] || []).push(x); });
    let html = "";
    ORDER.forEach((g) => {
      if (!groups[g]) return;
      html += `<div class="seclabel">${GROUP_META[g] || g}</div><div class="grid">${groups[g].map(card).join("")}</div>`;
    });
    $("wrap").innerHTML = html || '<div style="color:var(--dim)">데이터 없음</div>';
    const t = (j.generated_at || "").slice(0, 16).replace("T", " ");
    $("genAt").textContent = `실시간 · 코인 CoinGecko / 지수 ${t} 기준 · 60초 자동갱신`;
  } catch (e) {
    if (!$("wrap").children.length) $("wrap").innerHTML = `<div style="color:var(--down)">⚠️ 로드 실패: ${esc(e.message)}</div>`;
  }
}

if (!window.__idxInit) {
  window.__idxInit = true;
  let timer = null;
  const start = () => { stop(); load(); timer = setInterval(load, 60000); };
  const stop = () => clearInterval(timer);
  document.addEventListener("visibilitychange", () => { document.hidden ? stop() : start(); });
  start();
}
