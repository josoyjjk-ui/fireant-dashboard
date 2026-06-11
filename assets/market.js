/* 마켓 — 서버 JSON(market_now.json)에서 시세·요약, 60초 갱신
   (CoinGecko 클라 직접호출이 일부 한국 모바일망에서 차단되어 서버 수집으로 전환) */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const safeURL = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };

const fmtUSD = (v) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${a.toLocaleString("en-US")}`;
};
const price = (v) => v == null ? "—" : "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: v < 1 ? 5 : 2 });
const pct = (v) => {
  if (v == null) return `<span class="dim">—</span>`;
  const c = v < 0 ? "down" : "up", a = v < 0 ? "▼" : "▲";
  return `<span class="${c}">${a} ${Math.abs(v).toFixed(2)}%</span>`;
};

async function getJSON(u) {
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

let ALL = [];
// 정렬 상태. 숫자형 기본 내림차순(큰값 먼저), rank/name은 오름차순 기본
let SORT = { key: "rank", dir: 1 };
let PAGE = 0;
const PAGE_SIZE = 100;

function renderPager(total) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (PAGE >= pages) PAGE = pages - 1;
  const from = total ? PAGE * PAGE_SIZE + 1 : 0, to = Math.min(total, (PAGE + 1) * PAGE_SIZE);
  let h = `<button data-p="prev" ${PAGE === 0 ? "disabled" : ""}>‹ 이전</button>`;
  for (let i = 0; i < pages; i++) h += `<button data-p="${i}" class="${i === PAGE ? "on" : ""}">${i * PAGE_SIZE + 1}–${Math.min(total, (i + 1) * PAGE_SIZE)}</button>`;
  h += `<button data-p="next" ${PAGE >= pages - 1 ? "disabled" : ""}>다음 ›</button>`;
  h += `<span class="rng">${from}–${to} / 총 ${total}</span>`;
  $("pager").innerHTML = pages > 1 || total ? h : "";
}

function render() {
  const q = ($("q").value || "").trim().toLowerCase();
  let rows = ALL.filter((c) => !q || (c.name || "").toLowerCase().includes(q) || (c.symbol || "").toLowerCase().includes(q));
  const { key, dir } = SORT;
  rows = rows.slice().sort((a, b) => {
    if (key === "name") {
      const av = (a.name || "").toLowerCase(), bv = (b.name || "").toLowerCase();
      return av < bv ? -dir : av > bv ? dir : 0;
    }
    let av = a[key], bv = b[key];
    av = (av == null ? (dir === 1 ? Infinity : -Infinity) : av);  // 결측은 항상 뒤로
    bv = (bv == null ? (dir === 1 ? Infinity : -Infinity) : bv);
    return (av - bv) * dir;
  });
  const total = rows.length;
  renderPager(total);
  rows = rows.slice(PAGE * PAGE_SIZE, (PAGE + 1) * PAGE_SIZE);  // 100개 단위 페이지
  $("rows").innerHTML = rows.map((c) => {
    const athTxt = c.athChg != null ? `<span class="down">${c.athChg.toFixed(1)}%</span>` : `<span class="dim">—</span>`;
    return `<tr>
      <td>${c.rank ?? "—"}</td>
      <td><div class="coin"><img src="${safeURL(c.image)}" alt="" loading="lazy" onerror="this.style.display='none'"><span class="nm">${esc(c.name)}</span> <span class="sym">${esc(c.symbol)}</span></div></td>
      <td class="mono">${price(c.price)}</td>
      <td class="mono">${pct(c.chg24h)}</td>
      <td class="mono">${pct(c.chg7d)}</td>
      <td class="mono">${athTxt}</td>
      <td class="mono">${fmtUSD(c.mcap)}</td>
      <td class="mono">${fmtUSD(c.fdv)}</td></tr>`;
  }).join("") || `<tr><td colspan="8" style="text-align:center;color:var(--dim);padding:24px">검색 결과 없음</td></tr>`;
  $("cnt").textContent = `${total} / ${ALL.length}개`;
  document.querySelectorAll("th[data-k]").forEach((th) => {
    const ar = th.querySelector(".ar");
    ar.textContent = th.dataset.k === SORT.key ? (SORT.dir === 1 ? "▲" : "▼") : "";
  });
}

async function load() {
  try {
    const d = await getJSON("../data/v1/market_now.json?t=" + Date.now());
    $("summary").innerHTML = [
      ["총 시가총액", d.total_mcap != null ? fmtUSD(d.total_mcap) : "—"],
      ["24h 거래량", d.total_vol != null ? fmtUSD(d.total_vol) : "—"],
      ["BTC 도미넌스", d.btc_dominance != null ? d.btc_dominance.toFixed(1) + "%" : "—"],
      ["ETH 도미넌스", d.eth_dominance != null ? d.eth_dominance.toFixed(1) + "%" : "—"],
    ].map(([l, v]) => `<div class="sc"><div class="l">${l}</div><div class="v mono">${v}</div></div>`).join("");
    ALL = d.markets || [];
    render();
    $("age").textContent = "갱신 " + (d.generated_at || "").slice(11, 16);
  } catch (e) {
    if (!$("rows").children.length) $("rows").innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--down)">시세 일시 오류 (재시도 중) — ${esc(e.message)}</td></tr>`;
  }
}

// 검색 (페이지 리셋)
$("q").addEventListener("input", () => { PAGE = 0; render(); });
// 헤더 클릭 정렬: 같은 컬럼이면 방향 토글, 다른 컬럼이면 숫자=내림/이름=오름 기본
document.querySelectorAll("th[data-k]").forEach((th) => th.addEventListener("click", () => {
  const k = th.dataset.k;
  if (SORT.key === k) { SORT.dir = -SORT.dir; }
  else { SORT.key = k; SORT.dir = (k === "name" || k === "rank") ? 1 : -1; }
  PAGE = 0; render();
}));
// 페이지 네비
$("pager").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-p]"); if (!b) return;
  const p = b.dataset.p;
  if (p === "prev") PAGE = Math.max(0, PAGE - 1);
  else if (p === "next") PAGE = PAGE + 1;
  else PAGE = +p;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

$("summary").innerHTML = Array(4).fill('<div class="sc"><div class="l skel">··</div><div class="v skel">····</div></div>').join("");

if (!window.__marketInit) {
  window.__marketInit = true;
  let timer = null;
  const start = () => { stop(); load(); timer = setInterval(load, 60000); };
  const stop = () => clearInterval(timer);
  document.addEventListener("visibilitychange", () => { document.hidden ? stop() : start(); });
  start();
}
