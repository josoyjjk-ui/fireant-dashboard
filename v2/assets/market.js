/* 마켓 — CoinGecko 코인 시세(top N) + 글로벌 요약, 60초 실시간 */
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

async function load() {
  try {
    const [coins, gl] = await Promise.all([
      getJSON("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=30&page=1&price_change_percentage=24h,7d"),
      getJSON("https://api.coingecko.com/api/v3/global").catch(() => null),
    ]);
    // 요약
    if (gl && gl.data) {
      const d = gl.data;
      $("summary").innerHTML = [
        ["총 시가총액", fmtUSD(d.total_market_cap.usd)],
        ["24h 거래량", fmtUSD(d.total_volume.usd)],
        ["BTC 도미넌스", d.market_cap_percentage.btc.toFixed(1) + "%"],
        ["ETH 도미넌스", d.market_cap_percentage.eth.toFixed(1) + "%"],
      ].map(([l, v]) => `<div class="sc"><div class="l">${l}</div><div class="v mono">${v}</div></div>`).join("");
    }
    // 테이블
    $("rows").innerHTML = coins.map((c, i) => `<tr>
      <td>${i + 1}</td>
      <td><div class="coin"><img src="${safeURL(c.image)}" alt="" loading="lazy"><span class="nm">${esc(c.name)}</span> <span class="sym">${esc(c.symbol)}</span></div></td>
      <td class="mono">${price(c.current_price)}</td>
      <td class="mono">${pct(c.price_change_percentage_24h_in_currency)}</td>
      <td class="mono">${pct(c.price_change_percentage_7d_in_currency)}</td>
      <td class="mono">${fmtUSD(c.market_cap)}</td>
      <td class="mono">${fmtUSD(c.total_volume)}</td></tr>`).join("");
    $("age").textContent = "실시간 · 방금 갱신";
  } catch (e) {
    if (!$("rows").children.length) $("rows").innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--down)">시세 일시 오류 (재시도 중) — ${e.message}</td></tr>`;
  }
}

$("summary").innerHTML = Array(4).fill('<div class="sc"><div class="l skel">··</div><div class="v skel">····</div></div>').join("");

if (!window.__marketInit) {
  window.__marketInit = true;
  let timer = null;
  const start = () => { stop(); load(); timer = setInterval(load, 60000); };
  const stop = () => clearInterval(timer);
  document.addEventListener("visibilitychange", () => { document.hidden ? stop() : start(); });
  start();
}
