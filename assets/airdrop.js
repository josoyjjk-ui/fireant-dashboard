/* ANTINFO 에어드랍 v2 — Supabase 실데이터 대시보드
 * auth.js 가 만든 window.__sb 를 사용합니다.
 * 모든 Supabase 호출은 withTimeout() 으로 감싸고, boot 는 선렌더 후 Promise.allSettled 로 진행합니다.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const multiline = (s) => esc(s).replace(/\n/g, "<br>");
  const safeURL = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : "#"; } catch { return "#"; } };
  const cssEscape = (s) => {
    const v = String(s ?? "");
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(v);
    return v.replace(/["\\\]\[]/g, "\\$&");
  };
  const LOAD_TIMEOUT_MS = 7000;
  const errText = (err) => (err && (err.message || err.error_description || err.code)) || "오류";
  const withTimeout = (promise, label, ms = LOAD_TIMEOUT_MS) => Promise.race([
    Promise.resolve(promise),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} 시간초과`)), ms)),
  ]);

  const STATUS = {
    pending: { txt: "대기중", cls: "st-pending" },
    approved: { txt: "인증완료", cls: "st-approved" },
    rejected: { txt: "반려", cls: "st-rejected" },
    rewarded: { txt: "🎁 지급완료", cls: "st-rewarded" },
  };
  const VM = {
    onchain: { label: "온체인 자동확인", cls: "vm-chain" },
    telegram: { label: "텔레그램 자동확인", cls: "vm-tg" },
    capture: { label: "캡쳐 제출", cls: "vm-cap" },
  };
  const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
  const MEDALS = ["🥇", "🥈", "🥉"];
  const st = (k) => STATUS[k] || { txt: esc(k || "대기중"), cls: "st-pending" };
  const joinTitle = (j) => (j && (j.title || (Array.isArray(j) && j[0] && j[0].title))) || "미션";
  const joinEmail = (j) => (j && (j.email || (Array.isArray(j) && j[0] && j[0].email) || j.full_name)) || "";

  const state = {
    sb: null,
    user: null, uid: null, profile: null, isAdmin: false,
    tasks: [], tasksLoaded: false, _tasksErr: null,
    mySubs: {}, mySubList: [],
    allSubs: [], _adminErr: null,
    checkins: [], streak: 0, checkedInToday: false,
    leaderboard: [], winners: [], _winnersErr: null,
    _subTask: null, _clock: null,
  };

  function kstDate(offsetDays = 0) {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d;
  }
  function fmtDate(d) { return d.toISOString().slice(0, 10); }
  function kstToday() { return fmtDate(kstDate()); }
  function dateAdd(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return fmtDate(d);
  }
  function weekBounds() {
    const nowKst = kstDate();
    const day = nowKst.getUTCDay() || 7;
    const start = new Date(nowKst);
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - day + 1);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return {
      startDate: fmtDate(start),
      endDate: fmtDate(end),
      startIso: new Date(start.getTime() - 9 * 3600 * 1000).toISOString(),
      endIso: new Date(end.getTime() - 9 * 3600 * 1000).toISOString(),
      endMs: end.getTime() - 9 * 3600 * 1000,
    };
  }
  function lastWeekStart() {
    return dateAdd(weekBounds().startDate, -7);
  }
  function computeStreak(dates) {
    const set = new Set(dates || []);
    let base = kstToday();
    if (!set.has(base)) base = dateAdd(base, -1);
    let streak = 0;
    while (set.has(base)) {
      streak += 1;
      base = dateAdd(base, -1);
    }
    return streak;
  }
  function thisWeekCheckins() {
    const { startDate, endDate } = weekBounds();
    return state.checkins.filter((d) => d >= startDate && d < endDate).length;
  }
  function thisWeekApprovedSubs() {
    const { startIso, endIso } = weekBounds();
    return state.mySubList.filter((s) => s.status === "approved" && (!s.created_at || (s.created_at >= startIso && s.created_at < endIso))).length;
  }
  function ticketStats() {
    const checkins = thisWeekCheckins();
    const checkinMul = state.streak >= 7 ? 2 : 1;
    const checkinEntries = checkins * checkinMul;
    const approved = thisWeekApprovedSubs();
    const missionEntries = approved * 5;
    return { checkins, checkinMul, checkinEntries, approved, missionEntries, total: checkinEntries + missionEntries };
  }

  let toastTimer;
  function toast(msg, kind) {
    const t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.className = "toast on" + (kind ? " " + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = "toast" + (kind ? " " + kind : ""); }, 3200);
  }
  function doLogin() {
    try { if (state.sb) state.sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.href.split("#")[0] } }); } catch (_) {}
  }

  async function loadAuth() {
    state.user = null; state.uid = null; state.profile = null; state.isAdmin = false;
    let session = null;
    try {
      const r = await withTimeout(state.sb.auth.getSession(), "세션 확인", 4000);
      session = r && r.data ? r.data.session : null;
    } catch (_) { session = null; }
    if (!session) return;
    state.user = session.user; state.uid = session.user.id;
    try {
      const { data: prof } = await withTimeout(
        state.sb.from("profiles").select("id,email,full_name,avatar_url,tier,is_admin,wallet_address").eq("id", state.uid).single(),
        "프로필 로드",
      );
      state.profile = prof || null;
      state.isAdmin = !!(prof && prof.is_admin);
    } catch (_) {
      try {
        const { data: prof } = await withTimeout(
          state.sb.from("profiles").select("id,email,full_name,avatar_url,tier,is_admin").eq("id", state.uid).single(),
          "프로필 폴백 로드",
        );
        state.profile = prof || null;
        state.isAdmin = !!(prof && prof.is_admin);
      } catch (_) {
        state.profile = null;
        state.isAdmin = false;
      }
    }
  }
  async function loadTasks() {
    try {
      const { data, error } = await withTimeout(
        state.sb.from("airdrop_tasks")
          .select("*").eq("status", "active")
          .order("sort_order", { ascending: true }).order("created_at", { ascending: false }),
        "미션 로드",
      );
      if (error) { state._tasksErr = error.message || "오류"; state.tasks = []; return; }
      state._tasksErr = null;
      state.tasks = data || [];
    } catch (err) {
      state._tasksErr = errText(err);
      state.tasks = [];
    } finally {
      state.tasksLoaded = true;
    }
  }
  async function loadMySubs() {
    state.mySubs = {}; state.mySubList = [];
    if (!state.uid) return;
    try {
      const { data, error } = await withTimeout(
        state.sb.from("airdrop_submissions")
          .select("id,task_id,status,proof_url,proof_note,created_at, task:airdrop_tasks(title,verify_method)")
          .eq("user_id", state.uid).order("created_at", { ascending: false }),
        "내 인증 로드",
      );
      if (error || !data) return;
      data.forEach((s) => { state.mySubs[s.task_id] = s; });
      state.mySubList = data;
    } catch (_) {}
  }
  async function loadCheckins() {
    state.checkins = []; state.streak = 0; state.checkedInToday = false;
    if (!state.uid) return;
    try {
      const { data, error } = await withTimeout(
        state.sb.from("daily_checkins")
          .select("checkin_date").eq("user_id", state.uid).order("checkin_date", { ascending: false }),
        "체크인 로드",
      );
      if (error || !data) return;
      state.checkins = data.map((r) => r.checkin_date);
      state.checkedInToday = state.checkins.includes(kstToday());
      state.streak = computeStreak(state.checkins);
    } catch (_) {}
  }
  async function loadLeaderboard() {
    state.leaderboard = [];
    try {
      const since = dateAdd(kstToday(), -90);
      const { data, error } = await withTimeout(
        state.sb.from("daily_checkins").select("user_id,checkin_date").gte("checkin_date", since),
        "리더보드 체크인 로드",
      );
      if (error || !data) return;
      const byUser = {};
      data.forEach((r) => {
        if (!byUser[r.user_id]) byUser[r.user_id] = [];
        byUser[r.user_id].push(r.checkin_date);
      });
      const rows = Object.entries(byUser).map(([uid, dates]) => ({ uid, streak: computeStreak(dates) })).filter((r) => r.streak > 0).sort((a, b) => b.streak - a.streak).slice(0, 10);
      if (!rows.length) return;
      const { data: profiles } = await withTimeout(
        state.sb.from("profiles").select("id,email,full_name").in("id", rows.map((r) => r.uid)),
        "리더보드 프로필 로드",
      );
      const names = {};
      (profiles || []).forEach((p) => { names[p.id] = p.full_name || (p.email ? p.email.split("@")[0] : "회원"); });
      state.leaderboard = rows.map((r) => ({ ...r, name: names[r.uid] || "회원" }));
    } catch (_) {}
  }
  async function loadWinners() {
    state.winners = []; state._winnersErr = null;
    try {
      const { data, error } = await withTimeout(
        state.sb.from("raffle_winners")
          .select("id,week_start,user_id,telegram,prize,entries,created_at, user:profiles(full_name,email)")
          .eq("week_start", lastWeekStart()).order("created_at", { ascending: true }),
        "당첨자 로드",
      );
      if (error) { state._winnersErr = error.message || "오류"; return; }
      state.winners = data || [];
    } catch (err) {
      state._winnersErr = errText(err);
    }
  }
  async function loadAllSubs() {
    state.allSubs = []; state._adminErr = null;
    if (!state.isAdmin) return;
    try {
      const { data, error } = await withTimeout(
        state.sb.from("airdrop_submissions")
          .select("id,task_id,user_id,proof_url,proof_note,status,created_at, task:airdrop_tasks(title,verify_method), user:profiles!airdrop_submissions_user_id_fkey(email,full_name)")
          .order("created_at", { ascending: false }),
        "관리자 제출 로드",
      );
      if (error) { state._adminErr = error.message || "오류"; return; }
      state.allSubs = data || [];
    } catch (err) {
      state._adminErr = errText(err);
    }
  }

  function renderCheckin() {
    const wrap = $("checkinBody");
    if (!wrap) return;
    const todayIdx = (kstDate().getUTCDay() + 6) % 7;
    const { startDate } = weekBounds();
    const set = new Set(state.checkins);
    let boxes = "";
    for (let i = 0; i < 7; i++) {
      const date = dateAdd(startDate, i);
      const done = set.has(date);
      const cls = "sq" + (done ? " done" : "") + (i === todayIdx && !done ? " today" : "");
      boxes += `<div class="${cls}"><span class="d">${DAY_LABELS[i]}</span><span class="v">${done ? "✓" : (i === todayIdx ? "·" : i + 1)}</span></div>`;
    }
    if (!state.uid) {
      wrap.innerHTML = `<div class="streak-strip">${boxes}</div><div class="ck-row"><div class="ck-meta">로그인하고 매일 체크인하면 응모권을 받을 수 있습니다.<br>체크인 1회마다 응모권 <b>+1장</b>입니다.</div><button class="btn-sub" id="ckLogin" type="button">로그인하고 체크인</button></div><div class="note">🎁 7일 연속 달성 시 이번 주 체크인 응모권이 <b style="color:var(--accent2)">2배</b> 적립됩니다.</div>`;
      const b = $("ckLogin"); if (b) b.onclick = doLogin;
      return;
    }
    const done = state.checkedInToday;
    wrap.innerHTML = `<div class="streak-strip">${boxes}</div><div class="ck-row"><div class="ck-meta"><b>${state.streak}</b>일 연속 출석 중입니다.${done ? "<br>오늘 체크인은 완료했습니다." : `<br>오늘 체크인하면 <b>${state.streak + 1}일</b> 연속 출석입니다.`}<br>체크인 1회마다 응모권 <b>+1장</b>입니다.</div>${done ? `<button class="btn-sub" disabled>오늘 체크인 완료 ✓</button>` : `<button class="btn-sub" id="ckBtn" type="button">오늘 체크인 ✅ (+1)</button>`}</div><div class="note">🎁 7일 연속 달성 시 이번 주 체크인 응모권이 <b style="color:var(--accent2)">2배</b> 적립됩니다.</div>`;
    const b = $("ckBtn"); if (b) b.onclick = doCheckin;
  }
  function renderTickets() {
    const total = $("ticketTotal");
    const foot = $("ticketFoot");
    const bd = $("ticketBreakdown");
    if (!total || !foot || !bd) return;
    if (!state.uid) {
      total.textContent = "0";
      foot.textContent = "🎟️ 로그인하면 이번 주 응모권을 계산합니다.";
      bd.innerHTML = `<span class="eq-chip"><span class="lab">체크인</span><span class="val">0</span><span class="mul">×1장</span></span><span class="eq-op">+</span><span class="eq-chip"><span class="lab">미션 인증</span><span class="val">0건</span><span class="mul">×5장</span></span><span class="eq-op">=</span><span class="eq-chip sum"><span class="lab">총 응모권</span><span class="val">0장</span></span>`;
      return;
    }
    const x = ticketStats();
    total.textContent = x.total;
    foot.textContent = `🎟️ 추첨 가중치 ${x.total}장 · 7일 스트릭 ${state.streak >= 7 ? "달성" : "미달성"}입니다.`;
    bd.innerHTML = `<span class="eq-chip"><span class="lab">체크인</span><span class="val">${x.checkins}</span><span class="mul">×${x.checkinMul}장</span></span><span class="eq-op">+</span><span class="eq-chip"><span class="lab">미션 인증</span><span class="val">${x.approved}건</span><span class="mul">×5장</span></span><span class="eq-op">=</span><span class="eq-chip sum"><span class="lab">총 응모권</span><span class="val">${x.total}장</span></span>`;
  }
  function vmInfo(method) { return VM[method] || VM.capture; }
  function taskCard(t) {
    const method = t.verify_method || "capture";
    const vm = vmInfo(method);
    const sub = state.mySubs[t.id];
    const statusBadge = sub ? `<span class="badge ${st(sub.status).cls}">${st(sub.status).txt}</span>` : "";
    const action = sub ? "" : method === "onchain"
      ? `<button class="btn-wallet" type="button" data-auto="${esc(t.id)}">지갑 연결 · 인증요청</button>`
      : method === "telegram"
        ? `<button class="btn-sub" type="button" data-auto="${esc(t.id)}">자동 인증요청</button>`
        : `<button class="btn-sub" type="button" data-sub="${esc(t.id)}">✅ 인증하기</button>`;
    return `<div class="task"><div class="task-head"><div><div class="task-title">${esc(t.title)}</div>${t.reward_note ? `<span class="reward">${esc(t.reward_note)}</span>` : `<span class="reward">응모권 +5장</span>`}</div><span class="vm ${vm.cls}">${vm.label}</span></div>${t.description ? `<div class="task-desc">${esc(t.description)}</div>` : ""}${t.steps ? `<div class="task-steps">${multiline(t.steps)}</div>` : ""}<div class="task-foot">${t.link ? `<a class="btn-go ghost" href="${safeURL(t.link)}" target="_blank" rel="noopener">작업하러 가기 ↗</a>` : ""}${action}${statusBadge}</div></div>`;
  }
  function renderTasks() {
    const wrap = $("tasksWrap");
    if (!wrap) return;
    if (state._tasksErr) { wrap.innerHTML = `<div class="card err">미션을 불러오지 못했습니다: ${esc(state._tasksErr)}</div>`; return; }
    if (!state.tasksLoaded) { wrap.innerHTML = `<div class="card empty">미션 정보를 확인 중입니다.</div>`; return; }
    if (!state.tasks.length) { wrap.innerHTML = `<div class="card empty">현재 진행중인 에어드랍 미션이 없습니다.</div>`; return; }
    wrap.innerHTML = state.tasks.map(taskCard).join("");
    state.tasks.forEach((t) => {
      const s = wrap.querySelector(`[data-sub="${cssEscape(t.id)}"]`);
      const a = wrap.querySelector(`[data-auto="${cssEscape(t.id)}"]`);
      if (s) s.onclick = () => openSubModal(t);
      if (a) a.onclick = () => submitAutoTask(t);
    });
  }
  function renderLeaderboard() {
    const wrap = $("lbWrap");
    if (!wrap) return;
    if (!state.leaderboard.length) { wrap.innerHTML = `<div class="empty">아직 리더보드에 표시할 출석 데이터가 없습니다.</div>`; return; }
    wrap.innerHTML = state.leaderboard.map((l, i) => {
      const rank = i < 3 ? MEDALS[i] : i + 1;
      const cls = "lb-row" + (i === 0 ? " top1" : i === 1 ? " top2" : i === 2 ? " top3" : "");
      return `<div class="${cls}"><div class="lb-rank">${rank}</div><div class="lb-name"><span class="h">${esc(l.name)}님</span></div><div class="lb-days"><b>${l.streak}</b>일 연속</div></div>`;
    }).join("");
  }
  function renderWinners() {
    const title = $("winnersTitle");
    const wrap = $("winnersWrap");
    if (!wrap) return;
    if (title) title.textContent = `🏆 지난주 당첨자${state.winners.length ? ` (${state.winners.length}명)` : ""}`;
    if (state._winnersErr) { wrap.innerHTML = `<div class="empty">아직 당첨자 테이블이 준비되지 않았거나 당첨자가 없습니다.</div>`; return; }
    if (!state.winners.length) { wrap.innerHTML = `<div class="empty">지난주 당첨자 기록이 아직 없습니다.</div>`; return; }
    wrap.innerHTML = state.winners.map((w, i) => {
      const u = w.user || {};
      const name = w.telegram || u.full_name || (u.email ? u.email.split("@")[0] : "당첨자");
      return `<div class="winrow"><span class="n">${i < 3 ? MEDALS[i] : ""} ${esc(name)}님</span><span class="c">${esc(w.prize || "기프티콘")} · ${Number(w.entries || 0)}장</span></div>`;
    }).join("");
  }
  function revRow(s) {
    const thumb = s.proof_url
      ? `<a class="rev-thumb-a" href="${safeURL(s.proof_url)}" target="_blank" rel="noopener"><img class="rev-thumb" src="${safeURL(s.proof_url)}" alt="인증 이미지"></a>`
      : `<div class="rev-thumb" style="display:flex;align-items:center;justify-content:center;font-size:20px;">${(s.task && s.task.verify_method) === "telegram" ? "✈️" : "🔗"}</div>`;
    return `<div class="rev-row">${thumb}<div class="rev-body"><div class="rev-task">${esc(joinTitle(s.task))}</div><div class="rev-user">${esc(joinEmail(s.user) || "익명")} · ${esc(s.status)}</div>${s.proof_note ? `<div class="rev-note">${esc(s.proof_note)}</div>` : ""}</div><div class="rev-actions"><span class="rev-status ${st(s.status).cls}">${st(s.status).txt}</span><div style="display:flex;gap:6px;"><button class="mini-btn app" type="button" data-app="${esc(s.id)}">승인</button><button class="mini-btn rej" type="button" data-rej="${esc(s.id)}">반려</button></div></div></div>`;
  }
  function buildEntrants() {
    const { startIso, endIso } = weekBounds();
    const byUser = {};
    (state.allSubs || []).forEach((s) => {
      if (s.status !== "approved") return;
      if (s.created_at && (s.created_at < startIso || s.created_at >= endIso)) return;
      if (!byUser[s.user_id]) byUser[s.user_id] = { user_id: s.user_id, entries: 0, user: s.user };
      byUser[s.user_id].entries += 5;
    });
    return Object.values(byUser).sort((a, b) => b.entries - a.entries);
  }
  function renderLottery() {
    const wrap = $("lotteryWrap");
    if (!wrap || !state.isAdmin) return;
    const entrants = buildEntrants();
    const count = $("lotCount"); if (count) count.textContent = entrants.length ? `(${entrants.length}명)` : "";
    if (state._adminErr) { wrap.innerHTML = `<div class="err">${esc(state._adminErr)}</div>`; return; }
    if (!entrants.length) { wrap.innerHTML = `<div class="empty">이번 주 추첨 가능한 인증완료 제출이 없습니다.</div>`; return; }
    const total = entrants.reduce((a, e) => a + e.entries, 0);
    wrap.innerHTML = `<div class="draw-bar"><div class="txt">이번 주 미션 응모권 <b>${total}장</b> · 참여자 <b>${entrants.length}명</b><br>v1은 목록 확인 후 수동 추첨하며, 전체 가중 랜덤 추첨은 TODO입니다.</div><button class="btn-draw" type="button" id="drawBtn">🎲 당첨자 기록</button></div><div style="margin-top:12px;">${entrants.slice(0, 20).map((e) => `<div class="lot-row"><span class="lot-title">${esc(joinEmail(e.user) || e.user_id)}</span><span class="dim-sm">${e.entries}장</span></div>`).join("")}</div>`;
    const b = $("drawBtn"); if (b) b.onclick = () => recordWinners(entrants);
  }
  function renderReview() {
    const list = $("revList");
    if (!list || !state.isAdmin) return;
    const pending = (state.allSubs || []).filter((s) => s.status === "pending");
    const count = $("revCount"); if (count) count.textContent = pending.length ? `(${pending.length}건 대기)` : "";
    if (state._adminErr) { list.innerHTML = `<div class="err">로드 실패: ${esc(state._adminErr)}</div>`; return; }
    if (!pending.length) { list.innerHTML = `<div class="empty">검토할 대기 제출이 없습니다.</div>`; return; }
    list.innerHTML = pending.map(revRow).join("");
    pending.forEach((s) => {
      const a = list.querySelector(`[data-app="${cssEscape(s.id)}"]`);
      const r = list.querySelector(`[data-rej="${cssEscape(s.id)}"]`);
      if (a) a.onclick = () => reviewSub(s, "approved");
      if (r) r.onclick = () => reviewSub(s, "rejected");
    });
  }
  function renderManage() {
    const wrap = $("manageWrap");
    if (!wrap || !state.isAdmin) return;
    const tasks = state.tasks || [];
    const count = $("mgmtCount"); if (count) count.textContent = tasks.length ? `(${tasks.length}건 진행중)` : "";
    if (state._tasksErr) { wrap.innerHTML = `<div class="err">로드 실패: ${esc(state._tasksErr)}</div>`; return; }
    if (!tasks.length) { wrap.innerHTML = `<div class="empty">진행중인 미션이 없습니다.</div>`; return; }
    wrap.innerHTML = tasks.map((t) => {
      const ends = t.ends_at ? `<span class="dim-sm">~ ${esc(String(t.ends_at).slice(0, 10))}</span>` : `<span class="dim-sm">기한 없음</span>`;
      return `<div class="rev-row"><div class="rev-body"><div class="rev-task">${esc(t.title)}</div><div class="rev-user">${esc(t.category || "미분류")} · ${ends}</div></div><div class="rev-actions"><div style="display:flex;gap:6px;"><button class="mini-btn rej" type="button" data-end="${esc(t.id)}">종료</button><button class="mini-btn" type="button" data-del="${esc(t.id)}" style="background:#3a2530;color:#ff8aa0;">삭제</button></div></div></div>`;
    }).join("");
    tasks.forEach((t) => {
      const e = wrap.querySelector(`[data-end="${cssEscape(t.id)}"]`);
      const d = wrap.querySelector(`[data-del="${cssEscape(t.id)}"]`);
      if (e) e.onclick = () => endTask(t);
      if (d) d.onclick = () => deleteTask(t);
    });
  }
  async function endTask(t) {
    if (!confirm(`"${t.title}" 미션을 지금 종료합니다. (기한과 무관하게 목록에서 내려갑니다)`)) return;
    try {
      const { error } = await withTimeout(state.sb.from("airdrop_tasks").update({ status: "ended" }).eq("id", t.id), "미션 종료");
      if (error) throw error;
      toast("미션을 종료했습니다.", "ok");
      await loadTasks();
      renderTasks(); renderManage();
    } catch (err) {
      toast("종료 실패: " + errText(err), "err");
    }
  }
  async function deleteTask(t) {
    if (!confirm(`"${t.title}" 미션을 완전히 삭제합니다. 되돌릴 수 없습니다.`)) return;
    try {
      const { error } = await withTimeout(state.sb.from("airdrop_tasks").delete().eq("id", t.id), "미션 삭제");
      if (error) throw error;
      toast("미션을 삭제했습니다.", "ok");
      await loadTasks();
      renderTasks(); renderManage();
    } catch (err) {
      toast("삭제 실패: " + errText(err), "err");
    }
  }
  function renderAdmin() {
    const wrap = $("adminWrap");
    if (!wrap) return;
    wrap.style.display = state.isAdmin ? "" : "none";
    renderManage();
    renderLottery();
    renderReview();
  }
  function renderAll() {
    renderCheckin();
    renderTickets();
    renderTasks();
    renderLeaderboard();
    renderWinners();
    renderAdmin();
  }

  function tickCountdown() {
    const { endMs } = weekBounds();
    const diff = Math.max(0, endMs - Date.now());
    const d = Math.floor(diff / 86400000);
    const h = Math.floor(diff / 3600000) % 24;
    const m = Math.floor(diff / 60000) % 60;
    const s = Math.floor(diff / 1000) % 60;
    if ($("cdD")) $("cdD").textContent = String(d);
    if ($("cdH")) $("cdH").textContent = String(h).padStart(2, "0");
    if ($("cdM")) $("cdM").textContent = String(m).padStart(2, "0");
    if ($("cdS")) $("cdS").textContent = String(s).padStart(2, "0");
    if ($("countdownLabel")) $("countdownLabel").textContent = `⏰ 이번 주 마감까지 (D-${d})`;
  }

  async function doCheckin() {
    if (!state.uid) { doLogin(); return; }
    const btn = $("ckBtn");
    if (btn) { btn.disabled = true; btn.textContent = "처리 중…"; }
    try {
      const { error } = await withTimeout(
        state.sb.from("daily_checkins").insert({ user_id: state.uid, checkin_date: kstToday() }),
        "체크인 저장",
      );
      if (error) {
        if (error.code === "23505" || /duplicate|unique/i.test(error.message || "")) toast("이미 오늘 체크인했습니다.", "ok");
        else throw error;
      } else {
        toast("오늘 체크인 완료 · 응모권 +1장입니다.", "ok");
      }
      await loadCheckins();
      renderCheckin(); renderTickets(); renderLeaderboard();
    } catch (err) {
      toast("체크인 실패: " + errText(err), "err");
      if (btn) { btn.disabled = false; btn.textContent = "오늘 체크인 ✅ (+1)"; }
    }
  }

  async function bindWallet() {
    if (!state.uid) { doLogin(); return null; }
    if (state.profile && state.profile.wallet_address) return state.profile.wallet_address;
    let address = "";
    try {
      if (window.ethereum && typeof window.ethereum.request === "function") {
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        address = accounts && accounts[0] ? accounts[0] : "";
      }
    } catch (_) {}
    if (!address) address = prompt("연결할 EVM 지갑 주소를 입력해 주십시오. 1계정 1지갑만 사용할 수 있습니다.", "") || "";
    address = address.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) { toast("올바른 EVM 지갑 주소를 입력해 주십시오.", "err"); return null; }
    try {
      const { error } = await withTimeout(
        state.sb.from("profiles").update({ wallet_address: address }).eq("id", state.uid),
        "지갑 저장",
      );
      if (error) throw error;
      state.profile = { ...(state.profile || {}), wallet_address: address };
      toast("지갑이 연결되었습니다.", "ok");
      return address;
    } catch (err) {
      toast("지갑 연결 실패: 이미 다른 계정에 연결됐거나 저장 권한이 없습니다.", "err");
      return null;
    }
  }

  function openSubModal(t) {
    if (!state.uid) { toast("인증하려면 먼저 로그인해 주십시오.", "err"); doLogin(); return; }
    state._subTask = t;
    $("subModalTitle").textContent = t.title;
    $("subFile").value = ""; $("subNote").value = ""; $("subPreview").innerHTML = "";
    $("subModal").classList.add("on");
  }
  function closeSubModal() { $("subModal").classList.remove("on"); state._subTask = null; }

  async function submitProof(e) {
    e.preventDefault();
    const t = state._subTask;
    if (!t) return;
    const file = $("subFile").files[0];
    const note = $("subNote").value.trim();
    if (!file) { toast("스크린샷 이미지를 선택해 주십시오.", "err"); return; }
    if (!file.type.startsWith("image/")) { toast("이미지 파일만 업로드할 수 있습니다.", "err"); return; }
    if (file.size > 10 * 1024 * 1024) { toast("이미지는 10MB 이하로 올려 주십시오.", "err"); return; }
    const btn = $("subSubmit"); const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "업로드 중…";
    try {
      const ext = ((file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg").slice(0, 4);
      const path = `${state.uid}/${t.id}_${Date.now()}.${ext}`;
      const up = await withTimeout(
        state.sb.storage.from("airdrop-proofs").upload(path, file, { contentType: file.type, upsert: false }),
        "증빙 업로드",
      );
      if (up.error) throw up.error;
      const proof_url = state.sb.storage.from("airdrop-proofs").getPublicUrl(path).data.publicUrl;
      const ins = await withTimeout(
        state.sb.from("airdrop_submissions").insert({ task_id: t.id, user_id: state.uid, proof_url, proof_note: note || null, status: "pending" }),
        "인증 제출",
      );
      if (ins.error) {
        if (ins.error.code === "23505" || /duplicate|unique/i.test(ins.error.message || "")) toast("이미 이 미션에 인증을 제출했습니다.", "err");
        else throw ins.error;
      } else {
        toast("인증 제출 완료했습니다. 검토 후 승인됩니다.", "ok");
        closeSubModal();
      }
      await loadMySubs();
      renderTasks(); renderTickets();
    } catch (err) {
      toast("제출 실패: " + errText(err), "err");
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  }

  async function submitAutoTask(t) {
    if (!state.uid) { toast("인증하려면 먼저 로그인해 주십시오.", "err"); doLogin(); return; }
    if ((t.verify_method || "capture") === "onchain") {
      const wallet = await bindWallet();
      if (!wallet) return;
    }
    try {
      // TODO: onchain/telegram 자동 검증 서버 작업이 붙으면 여기서 status 를 approved 로 전환합니다.
      const note = (t.verify_method || "capture") === "onchain" ? `wallet:${state.profile && state.profile.wallet_address}` : "telegram:auto-verify-requested";
      const { error } = await withTimeout(
        state.sb.from("airdrop_submissions").insert({ task_id: t.id, user_id: state.uid, proof_note: note, status: "pending" }),
        "자동 인증 요청",
      );
      if (error) {
        if (error.code === "23505" || /duplicate|unique/i.test(error.message || "")) toast("이미 이 미션에 인증을 제출했습니다.", "err");
        else throw error;
      } else {
        toast("자동 인증 요청을 접수했습니다. 검증 대기 상태입니다.", "ok");
      }
      await loadMySubs();
      renderTasks();
    } catch (err) {
      toast("인증 요청 실패: " + errText(err), "err");
    }
  }

  async function reviewSub(s, status) {
    try {
      const { error } = await withTimeout(
        state.sb.from("airdrop_submissions").update({ status, reviewed_by: state.uid, reviewed_at: new Date().toISOString() }).eq("id", s.id),
        "제출 검토",
      );
      if (error) throw error;
      toast(`${st(status).txt} 처리 완료했습니다.`, "ok");
      await Promise.allSettled([loadAllSubs(), loadMySubs()]);
      renderReview(); renderLottery(); renderTasks(); renderTickets();
    } catch (err) {
      toast("처리 실패: " + errText(err), "err");
    }
  }

  async function recordWinners(entrants) {
    const nRaw = prompt(`참여자 ${entrants.length}명 중 기록할 당첨자 수를 입력해 주십시오.`, "5");
    if (nRaw == null) return;
    const n = Math.max(1, Math.min(parseInt(nRaw, 10) || 1, entrants.length));
    const prize = prompt("기록할 경품명을 입력해 주십시오.", "기프티콘") || "기프티콘";
    const picked = entrants.slice(0, n);
    const rows = picked.map((e) => ({ week_start: weekBounds().startDate, user_id: e.user_id, telegram: null, prize, entries: e.entries }));
    try {
      // TODO: 전체 weighted-random 추첨은 서버/Edge Function에서 감사 로그와 함께 구현합니다.
      const { error } = await withTimeout(state.sb.from("raffle_winners").insert(rows), "당첨자 기록");
      if (error) throw error;
      toast(`${n}명의 당첨자를 기록했습니다.`, "ok");
      await loadWinners();
      renderWinners();
    } catch (err) {
      toast("당첨자 기록 실패: " + errText(err), "err");
    }
  }

  async function submitTask(e) {
    e.preventDefault();
    const title = $("f_title").value.trim();
    if (!title) { toast("제목을 입력해 주십시오.", "err"); return; }
    const btn = $("taskSubmit"); const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "등록 중…";
    const payload = {
      title,
      verify_method: $("f_verify").value || "capture",
      description: $("f_desc").value.trim() || null,
      steps: $("f_steps").value.trim() || null,
      link: $("f_link").value.trim() || null,
      reward_note: $("f_reward").value.trim() || "응모권 +5장",
      category: $("f_cat").value.trim() || null,
      status: "active",
      sort_order: parseInt($("f_sort").value, 10) || 0,
      ends_at: $("f_ends").value ? new Date($("f_ends").value).toISOString() : null,
      created_by: state.uid,
    };
    try {
      const { error } = await withTimeout(state.sb.from("airdrop_tasks").insert(payload), "미션 등록");
      if (error) throw error;
      toast("미션이 등록되었습니다.", "ok");
      e.target.reset();
      await loadTasks();
      renderTasks();
    } catch (err) {
      toast("등록 실패: " + errText(err), "err");
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  }

  let bootToken = 0;
  async function boot() {
    const my = ++bootToken;
    renderAll();
    try {
      await Promise.allSettled([loadTasks(), loadWinners(), loadLeaderboard()]);
      if (my !== bootToken) return;
      renderAll();
      await loadAuth();
      if (my !== bootToken) return;
      renderAll();
      await Promise.allSettled([loadMySubs(), loadCheckins(), loadAllSubs()]);
      if (my !== bootToken) return;
      renderAll();
    } catch (err) {
      console.warn("[airdrop] boot failed", err);
      if (my !== bootToken) return;
      state._tasksErr = state._tasksErr || errText(err);
      state.tasksLoaded = true;
      renderAll();
    }
  }

  function init() {
    if ($("subForm")) $("subForm").onsubmit = submitProof;
    if ($("subClose")) $("subClose").onclick = closeSubModal;
    if ($("subModal")) $("subModal").addEventListener("click", (e) => { if (e.target === $("subModal")) closeSubModal(); });
    if ($("subFile")) $("subFile").onchange = () => {
      const f = $("subFile").files[0]; const p = $("subPreview");
      if (!f) { p.innerHTML = ""; return; }
      if (!f.type.startsWith("image/")) { p.innerHTML = `<div class="err" style="margin-top:8px;">이미지 파일만 가능합니다.</div>`; return; }
      p.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="" style="max-height:140px;border-radius:10px;border:1px solid var(--line);margin-top:8px;display:block;">`;
    };
    if ($("taskForm")) $("taskForm").onsubmit = submitTask;
    if ($("admToggle")) $("admToggle").onclick = () => $("adminCard").classList.toggle("admin-open");
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("subModal") && $("subModal").classList.contains("on")) closeSubModal(); });
    state.sb.auth.onAuthStateChange(() => boot());
    tickCountdown();
    clearInterval(state._clock);
    state._clock = setInterval(tickCountdown, 1000);
    boot();
  }

  let tries = 0;
  renderAll();
  tickCountdown();
  (function waitForSb() {
    if (window.__sb) { state.sb = window.__sb; init(); return; }
    if (tries++ > 40) {
      state._tasksErr = "인증 모듈을 불러오지 못했습니다. 새로고침해 주십시오.";
      state.tasksLoaded = true;
      renderAll();
      return;
    }
    setTimeout(waitForSb, 150);
  })();
})();
