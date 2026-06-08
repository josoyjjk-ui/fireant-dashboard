/* 주요 주가지수 · 매크로 — data/v1/indices.json (Yahoo Finance, cron 수집) */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function fmtNum(v) {
  if (v == null) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function card(x) {
  const c = x.change_pct;
  const cls = c == null ? "" : c < 0 ? "down" : "up";
  const arr = c == null ? "" : c < 0 ? "▼" : "▲";
  const cTxt = c == null ? "—" : `${arr} ${Math.abs(c).toFixed(2)}%`;
  return `<div class="idx"><div class="n">${esc(x.name)}</div>
    <div class="p mono">${fmtNum(x.price)}</div>
    <div class="c ${cls}">${cTxt}</div></div>`;
}

async function getJSON(p) {
  const r = await fetch(`${p}?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${p} ${r.status}`);
  return r.json();
}

(async function main() {
  try {
    const d = await getJSON("../data/v1/indices.json");
    $("genAt").textContent = "최근 갱신 " + (d.generated_at || "").slice(0, 16) + " · 출처 Yahoo";
    const groups = {};
    (d.indices || []).forEach((x) => { (groups[x.group] = groups[x.group] || []).push(x); });
    const order = ["지수", "매크로", "원자재"];
    let html = "";
    order.forEach((g) => {
      if (!groups[g]) return;
      html += `<div class="seclabel">${g === "지수" ? "📊 주가지수" : g === "매크로" ? "🌐 매크로" : "🛢️ 원자재"}</div><div class="grid">${groups[g].map(card).join("")}</div>`;
    });
    $("wrap").innerHTML = html || '<div style="color:var(--dim)">데이터 없음</div>';
  } catch (e) {
    $("wrap").innerHTML = `<div style="color:var(--down)">⚠️ 로드 실패: ${e.message}</div>`;
  }
})();
