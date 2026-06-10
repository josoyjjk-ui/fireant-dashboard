/* 이벤트 모음 — events.json(진행/예정/종료 자동분류) + winners.json(당첨자 요약) */
const $ = (id) => document.getElementById(id);

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const safeURL = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : "#"; } catch { return "#"; } };

function classify(ev, now) {
  const start = ev.startDate ? new Date(ev.startDate).getTime() : null;
  const end = ev.endDate ? new Date(ev.endDate).getTime() : null;
  if (start && now < start) return "soon";
  if (end && now > end) return "ended";
  return "active";
}

function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d)) return s;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function evCard(ev, state) {
  const label = { active: "진행중", soon: "예정", ended: "종료" }[state];
  const cls = { active: "b-active", soon: "b-soon", ended: "b-ended" }[state];
  const link = ev.link ? `<a class="go" href="${safeURL(ev.link)}">바로가기 →</a>` : "";
  return `<div class="ev">
    <div class="top"><div class="ti">${esc(ev.title)}</div><span class="badge ${cls}">${label}</span></div>
    ${ev.description ? `<div class="desc">${esc(ev.description)}</div>` : ""}
    ${ev.rewards ? `<div class="reward">🎁 ${esc(ev.rewards)}</div>` : ""}
    ${link}</div>`;
}

async function getJSON(p) {
  const r = await fetch(`${p}?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${p} ${r.status}`);
  return r.json();
}

(async function main() {
  const now = Date.now();
  // 이벤트
  try {
    const evs = await getJSON("../events.json");
    const groups = { active: [], soon: [], ended: [] };
    evs.forEach((e) => groups[classify(e, now)].push(e));
    const actHtml = [...groups.active.map((e) => evCard(e, "active")), ...groups.soon.map((e) => evCard(e, "soon"))].join("");
    $("activeWrap").innerHTML = actHtml || '<div class="empty">현재 진행중·예정 이벤트가 없습니다.</div>';
    // 종료된 이벤트 섹션 제거 — endedWrap이 없으면 스킵
    if ($("endedWrap")) $("endedWrap").innerHTML = "";
  } catch (e) {
    $("activeWrap").innerHTML = `<div class="empty">이벤트 로드 실패: ${e.message}</div>`;
  }
  // 당첨자 (winners.json event별 집계) — 섹션 제거 시 스킵
  if ($("winnersWrap")) try {
    const wins = await getJSON("../winners.json");
    const byEvent = {};
    wins.forEach((w) => { const k = w.event || "기타"; byEvent[k] = (byEvent[k] || 0) + 1; });
    const rows = Object.entries(byEvent).sort((a, b) => b[1] - a[1]).map(([ev, n]) =>
      `<div class="winrow"><div class="n">${esc(ev)}</div><div style="display:flex;gap:14px;align-items:center"><span class="c">${n}명</span><a href="../winners/?event=${encodeURIComponent(ev)}">명단 보기 →</a></div></div>`
    ).join("");
    $("winnersWrap").innerHTML = rows || '<div class="empty">당첨자 발표가 없습니다.</div>';
  } catch (e) {
    $("winnersWrap").innerHTML = `<div class="empty">당첨자 로드 실패: ${e.message}</div>`;
  }
})();
