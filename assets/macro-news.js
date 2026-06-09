/* 매크로 뉴스 — data/v1/news.json (고속 cron 수집), 카테고리 필터 + 60초 자동갱신 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const safeURL = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : "#"; } catch { return "#"; } };
let ALL = [], FILTER = "all";

function ago(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "방금"; if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60); if (h < 24) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}

function matchFilter(x) {
  if (FILTER === "all") return true;
  if (FILTER === "high") return x.importance === "high";
  return x.category === FILTER;
}
function render() {
  const items = ALL.filter(matchFilter);
  $("list").innerHTML = items.map((x) => {
    const fresh = x.iso && (Date.now() - new Date(x.iso).getTime()) < 600000; // 10분 내 = 🔴
    const hi = x.importance === "high";
    const sum = (x.summary && x.summary.length)
      ? `<ul class="sum">${x.summary.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : "";
    return `<a class="item${hi ? " hi" : ""}" href="${safeURL(x.link)}" target="_blank" rel="noopener">
      <div class="ti">${fresh ? '<span class="dot"></span>' : ""}${hi ? '<span class="impbadge">속보</span>' : ""}${esc(x.title_ko || x.title)}</div>
      ${sum}
      ${x.title_ko && x.title_ko !== x.title ? `<div class="orig">${esc(x.title)}</div>` : ""}
      <div class="meta"><span class="cat ${esc(x.category)}">${esc(x.category)}</span><span>${esc(x.source)}</span><span>${ago(x.iso)}</span></div>
    </a>`;
  }).join("") || '<div style="color:var(--dim);padding:14px;">표시할 뉴스가 없습니다.</div>';
}

document.querySelectorAll(".fbtn").forEach((b) => b.onclick = () => {
  document.querySelectorAll(".fbtn").forEach((x) => x.classList.remove("on"));
  b.classList.add("on"); FILTER = b.dataset.f; render();
});

async function load() {
  try {
    const r = await fetch("../data/v1/news.json?t=" + Date.now(), { cache: "no-store" });
    const d = await r.json();
    ALL = d.items || [];
    $("age").textContent = "최근 갱신 " + (d.generated_at || "").slice(0, 16).replace("T", " ") + ` · ${ALL.length}건 · 60초 자동갱신`;
    render();
  } catch (e) {
    if (!ALL.length) $("list").innerHTML = `<div style="color:var(--down);padding:14px;">뉴스 로드 실패: ${esc(e.message)}</div>`;
  }
}

if (!window.__newsInit) {
  window.__newsInit = true;
  let timer = null;
  const start = () => { stop(); load(); timer = setInterval(load, 60000); };
  const stop = () => clearInterval(timer);
  document.addEventListener("visibilitychange", () => { document.hidden ? stop() : start(); });
  start();
}
