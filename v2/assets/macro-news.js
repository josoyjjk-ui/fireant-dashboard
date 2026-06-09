/* 매크로 뉴스 — data/v1/news.json (cron RSS 수집), 카테고리 필터 */
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

function render() {
  const items = FILTER === "all" ? ALL : ALL.filter((x) => x.category === FILTER);
  $("list").innerHTML = items.map((x) =>
    `<a class="item" href="${safeURL(x.link)}" target="_blank" rel="noopener">
      <div class="ti">${esc(x.title_ko || x.title)}</div>
      ${x.title_ko && x.title_ko !== x.title ? `<div style="font-size:11.5px;color:var(--dim);margin-top:3px;">${esc(x.title)}</div>` : ""}
      <div class="meta"><span class="cat ${x.category}">${x.category}</span><span>${esc(x.source)}</span><span>${ago(x.iso)}</span></div>
    </a>`).join("") || '<div style="color:var(--dim);padding:14px;">표시할 뉴스가 없습니다.</div>';
}

document.querySelectorAll(".fbtn").forEach((b) => b.onclick = () => {
  document.querySelectorAll(".fbtn").forEach((x) => x.classList.remove("on"));
  b.classList.add("on"); FILTER = b.dataset.f; render();
});

(async function () {
  try {
    const r = await fetch("../data/v1/news.json?t=" + Date.now(), { cache: "no-store" });
    const d = await r.json();
    ALL = d.items || [];
    $("age").textContent = "최근 갱신 " + (d.generated_at || "").slice(0, 16) + ` · ${ALL.length}건`;
    render();
  } catch (e) {
    $("list").innerHTML = `<div style="color:var(--down);padding:14px;">뉴스 로드 실패: ${e.message}</div>`;
  }
})();
