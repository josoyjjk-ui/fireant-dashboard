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

const WD = ["일", "월", "화", "수", "목", "금", "토"];
function fmtMD(s, withTime) {
  const d = new Date(s);
  if (isNaN(d)) return s;
  let r = `${d.getMonth() + 1}/${d.getDate()} (${WD[d.getDay()]})`;
  if (withTime) {
    const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
    if (!(hh === "00" && mm === "00")) r += ` ${hh}:${mm}`;
  }
  return r;
}
function rangeStr(ev) {
  if (ev.startDate && ev.endDate) return `${fmtMD(ev.startDate, false)} ~ ${fmtMD(ev.endDate, true)}`;
  if (ev.endDate) return `~ ${fmtMD(ev.endDate, true)}`;
  if (ev.startDate) return `${fmtMD(ev.startDate, false)} ~`;
  return "";
}
function cdStr(ev, state) {
  if (state === "ended") return { txt: "종료됨", cls: "cd-end" };
  const target = state === "soon" ? ev.startDate : ev.endDate;
  if (!target) return null;
  const ms = new Date(target).getTime() - Date.now();
  if (isNaN(ms)) return null;
  if (ms <= 0) return state === "soon" ? { txt: "곧 시작", cls: "" } : { txt: "종료됨", cls: "cd-end" };
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5);
  const pre = state === "soon" ? "시작까지" : "종료까지";
  return { txt: `${pre} ${d}일 ${h}시간`, cls: "" };
}
function tagsHtml(ev) {
  let tags = Array.isArray(ev.tags) && ev.tags.length ? ev.tags : (ev.type === "official" ? ["공식 이벤트"] : []);
  return tags.map((t, i) => `<span class="tg ${i === 0 ? "tg-type" : "tg-proj"}">${esc(t)}</span>`).join("");
}

function evCard(ev, state) {
  const steps = ev.steps || ev.description || "";
  const cd = cdStr(ev, state);
  const tg = tagsHtml(ev);
  const range = rangeStr(ev);
  const link = ev.link ? `<a class="go" href="${safeURL(ev.link)}">참여하기 →</a>` : "";
  return `<div class="ev">
    ${tg ? `<div class="tags">${tg}</div>` : ""}
    <div class="ti">${esc(ev.title)}</div>
    ${(range || ev.rewards) ? `<div class="metarow">${range ? `<span class="m-date">🗓️ ${esc(range)}</span>` : ""}${ev.rewards ? `<span class="m-reward">🎁 ${esc(ev.rewards)}</span>` : ""}</div>` : ""}
    ${steps ? `<div class="step">• ${esc(steps)}</div>` : ""}
    ${cd ? `<div class="cd ${cd.cls}">⏰ ${esc(cd.txt)}</div>` : ""}
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
