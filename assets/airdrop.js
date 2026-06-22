/* 에어드랍 작업 — Supabase(airdrop_tasks / airdrop_submissions / daily_checkins)
 * 인증은 assets/auth.js 가 만든 window.__sb 를 사용(150ms 폴링, 최대 ~6초 대기).
 * 모든 사용자 입력은 esc() 로 이스케이프(XSS 방어).
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const multiline = (s) => esc(s).replace(/\n/g, "<br>");
  const safeURL = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : "#"; } catch { return "#"; } };

  // 제출 상태 → 표기/클래스
  const STATUS = {
    pending: { txt: "대기중", cls: "st-pending" },
    approved: { txt: "승인됨", cls: "st-approved" },
    rejected: { txt: "거절", cls: "st-rejected" },
    rewarded: { txt: "🎁 리워드", cls: "st-rewarded" },
  };
  const st = (k) => STATUS[k] || { txt: esc(k || "—"), cls: "st-pending" };
  // join 결과가 객체(단일 FK) 또는 배열(다중 FK)일 수 있어 둘 다 처리
  const joinTitle = (j) => (j && (j.title || (Array.isArray(j) && j[0] && j[0].title))) || "작업";
  const joinEmail = (j) => (j && (j.email || (Array.isArray(j) && j[0] && j[0].email) || (j.full_name))) || "";

  const state = {
    sb: null,
    user: null, uid: null, isAdmin: false,
    tasks: [], _tasksErr: null,
    mySubs: {}, mySubList: [],
    allSubs: [], _adminErr: null,
    checkins: [], streak: 0, checkedInToday: false,
    _subTask: null,
  };

  // ── KST 오늘(YYYY-MM-DD) ──────────────────────────────────────────
  function kstToday() {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    return kst.toISOString().slice(0, 10);
  }
  // 연속 출석: 오늘 체크인이면 오늘부터, 아니면 어제부터 거꾸로 연속 카운트.
  function computeStreak(dates) {
    const set = new Set(dates || []);
    let streak = 0;
    const base = new Date(Date.now() + 9 * 3600 * 1000); // KST 기준
    if (!set.has(base.toISOString().slice(0, 10))) base.setUTCDate(base.getUTCDate() - 1); // 어제로 이동
    while (set.has(base.toISOString().slice(0, 10))) {
      streak++;
      base.setUTCDate(base.getUTCDate() - 1);
    }
    return streak;
  }

  // ── 토스트 ────────────────────────────────────────────────────────
  let toastTimer;
  function toast(msg, kind) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast on" + (kind ? " " + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = "toast" + (kind ? " " + kind : ""); }, 3400);
  }

  // ── 로그인 트리거 (auth.js 와 동일 옵션) ──────────────────────────
  function doLogin() {
    try { if (state.sb) state.sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.href.split("#")[0] } }); } catch (_) {}
  }

  // ── 데이터 로드 ───────────────────────────────────────────────────
  async function loadAuth() {
    state.user = null; state.uid = null; state.isAdmin = false;
    let session = null;
    try {
      // getSession 이 navigator.locks 로 hang 날 수 있어 4초 타임아웃 레이스
      const r = await Promise.race([
        state.sb.auth.getSession(),
        new Promise((res) => setTimeout(() => res(null), 4000)),
      ]);
      session = r && r.data ? r.data.session : null;
    } catch (_) { session = null; }
    if (!session) return;
    state.user = session.user; state.uid = session.user.id;
    try {
      const { data: prof } = await state.sb.from("profiles").select("full_name,is_admin").eq("id", state.uid).single();
      state.isAdmin = !!(prof && prof.is_admin);
    } catch (_) { state.isAdmin = false; }
  }

  async function loadTasks() {
    const { data, error } = await state.sb.from("airdrop_tasks")
      .select("*").eq("status", "active")
      .order("sort_order", { ascending: true }).order("created_at", { ascending: false });
    if (error) { state._tasksErr = error.message || "오류"; return; }
    state._tasksErr = null;
    state.tasks = data || [];
  }

  async function loadMySubs() {
    state.mySubs = {}; state.mySubList = [];
    if (!state.uid) return;
    const { data, error } = await state.sb.from("airdrop_submissions")
      .select("id,task_id,status,proof_url,proof_note,created_at, task:airdrop_tasks(title)")
      .eq("user_id", state.uid).order("created_at", { ascending: false });
    if (error || !data) return;
    (data).forEach((s) => { state.mySubs[s.task_id] = s; });
    state.mySubList = data;
  }

  async function loadCheckins() {
    state.checkins = []; state.streak = 0; state.checkedInToday = false;
    if (!state.uid) return;
    const { data, error } = await state.sb.from("daily_checkins")
      .select("checkin_date").eq("user_id", state.uid).order("checkin_date", { ascending: false });
    if (error || !data) return;
    state.checkins = data.map((r) => r.checkin_date);
    state.checkedInToday = state.checkins.includes(kstToday());
    state.streak = computeStreak(state.checkins);
  }

  async function loadAllSubs() {
    state.allSubs = []; state._adminErr = null;
    if (!state.isAdmin) return;
    const { data, error } = await state.sb.from("airdrop_submissions")
      .select("id,task_id,user_id,proof_url,proof_note,status,created_at, task:airdrop_tasks(title), user:profiles(email,full_name)")
      .order("created_at", { ascending: false });
    if (error) { state._adminErr = error.message || "오류"; return; }
    state.allSubs = data || [];
  }

  // ── 렌더링 ────────────────────────────────────────────────────────
  function renderCheckin() {
    const wrap = $("checkinBody");
    if (!state.uid) {
      wrap.innerHTML = `<div class="checkin"><div class="ck-info"><div><span class="streak-big">–</span></div><div class="streak-label">로그인하고 매일 출석하세요.<br>기프티콘 추첨에도 참여돼요 🎁</div></div><button class="btn-sub" id="ckLogin" type="button">로그인하고 체크인하기</button></div>`;
      const b = $("ckLogin"); if (b) b.onclick = doLogin;
      return;
    }
    const done = state.checkedInToday;
    wrap.innerHTML = `<div class="checkin">
      <div class="ck-info"><div><span class="streak-big">${state.streak}</span><span class="streak-unit">일</span></div>
      <div class="streak-label">${done ? "오늘 출석 완료! 🔥 내일도 만나요." : "오늘 아직 출석 안 하셨어요.<br>지금 체크인하고 연속 출석을 이어가세요!"}</div></div>
      ${done ? `<button class="btn-sub" disabled>오늘 출석 완료 ✅</button>` : `<button class="btn-sub" id="ckBtn" type="button">오늘 체크인 ✅</button>`}
    </div>`;
    const b = $("ckBtn"); if (b) b.onclick = doCheckin;
  }

  function taskCard(t) {
    const sub = state.mySubs[t.id];
    const subHtml = sub
      ? `<span class="badge ${st(sub.status).cls}">${st(sub.status).txt}</span>`
      : `<button class="btn-sub" type="button" data-sub="${esc(t.id)}">✅ 인증하기</button>`;
    return `<div class="card task">
      <div class="task-head"><div class="task-title">${esc(t.title)}</div>${t.reward_note ? `<span class="reward">🎁 ${esc(t.reward_note)}</span>` : ""}</div>
      ${t.description ? `<div class="task-desc">${esc(t.description)}</div>` : ""}
      ${t.steps ? `<div class="task-steps">${multiline(t.steps)}</div>` : ""}
      <div class="task-foot">${t.link ? `<a class="btn-go" href="${safeURL(t.link)}" target="_blank" rel="noopener">작업하러 가기 ↗</a>` : ""}${subHtml}</div>
    </div>`;
  }

  function renderTasks() {
    const wrap = $("tasksWrap");
    if (state._tasksErr) { wrap.innerHTML = `<div class="err">작업을 불러오지 못했습니다: ${esc(state._tasksErr)}</div>`; return; }
    if (!state.tasks.length) { wrap.innerHTML = `<div class="card empty">현재 진행중인 에어드랍 작업이 없습니다. 곧 새 작업이 올라옵니다! 🚀</div>`; return; }
    wrap.innerHTML = state.tasks.map(taskCard).join("");
    state.tasks.forEach((t) => {
      const b = wrap.querySelector(`[data-sub="${CSS.escape(t.id)}"]`);
      if (b) b.onclick = () => openSubModal(t);
    });
  }

  function renderMyStatus() {
    const wrap = $("myStatusWrap");
    if (!state.uid) { wrap.innerHTML = ""; return; }
    const subs = state.mySubList || [];
    const subsHtml = subs.length
      ? subs.map((s) => `<div class="ms-row"><span class="ms-task">${esc(joinTitle(s.task))}</span><span class="badge ${st(s.status).cls}">${st(s.status).txt}</span></div>`).join("")
      : `<div class="empty">아직 제출한 인증이 없어요. 작업을 완료하고 인증해보세요!</div>`;
    wrap.innerHTML = `<div class="seclabel">📌 내 인증 현황</div>
      <div class="card">
        <div class="ms-streak">🔥 연속 출석 <b>${state.streak}일</b> · 제출한 인증 <b>${subs.length}건</b></div>
        <div class="ms-list">${subsHtml}</div>
      </div>`;
  }

  function revRow(s) {
    const thumb = s.proof_url
      ? `<a class="rev-thumb-a" href="${safeURL(s.proof_url)}" target="_blank" rel="noopener"><img class="rev-thumb" src="${safeURL(s.proof_url)}" alt="인증 이미지"></a>`
      : `<div class="rev-thumb"></div>`;
    const uname = joinEmail(s.user);
    return `<div class="rev-row">
      ${thumb}
      <div class="rev-body">
        <div class="rev-task">${esc(joinTitle(s.task))}</div>
        <div class="rev-user">${uname ? esc(uname) : "익명"}</div>
        ${s.proof_note ? `<div class="rev-note">${esc(s.proof_note)}</div>` : ""}
      </div>
      <div class="rev-actions">
        <span class="rev-status ${st(s.status).cls}">${st(s.status).txt}</span>
        <div style="display:flex;gap:6px;">
          <button class="mini-btn app" type="button" data-app="${esc(s.id)}">승인</button>
          <button class="mini-btn rej" type="button" data-rej="${esc(s.id)}">거절</button>
          <button class="mini-btn rwd" type="button" data-rwd="${esc(s.id)}">🎁리워드</button>
        </div>
      </div>
    </div>`;
  }

  function renderReview() {
    const list = $("revList");
    const subs = state.allSubs || [];
    $("revCount").textContent = subs.length ? `(${subs.length}건)` : "";
    if (!state.isAdmin) return;
    if (state._adminErr) { list.innerHTML = `<div class="err">로드 실패: ${esc(state._adminErr)}</div>`; return; }
    if (!subs.length) { list.innerHTML = `<div class="empty">검토할 제출이 없습니다.</div>`; return; }
    list.innerHTML = subs.map(revRow).join("");
    subs.forEach((s) => {
      const a = list.querySelector(`[data-app="${CSS.escape(s.id)}"]`);
      const r = list.querySelector(`[data-rej="${CSS.escape(s.id)}"]`);
      const w = list.querySelector(`[data-rwd="${CSS.escape(s.id)}"]`);
      if (a) a.onclick = () => reviewSub(s, "approved");
      if (r) r.onclick = () => reviewSub(s, "rejected");
      if (w) w.onclick = () => reviewSub(s, "rewarded");
    });
  }

  function renderLottery() {
    const wrap = $("lotteryWrap");
    if (!state.isAdmin) return;
    const byTask = {};
    (state.allSubs || []).forEach((s) => {
      if (!byTask[s.task_id]) byTask[s.task_id] = { title: joinTitle(s.task), approved: 0 };
      if (s.status === "approved") byTask[s.task_id].approved++;
    });
    const entries = Object.entries(byTask).filter(([, v]) => v.approved > 0);
    $("lotCount").textContent = entries.length ? `(${entries.length}개 작업)` : "";
    if (state._adminErr) { wrap.innerHTML = `<div class="err">${esc(state._adminErr)}</div>`; return; }
    if (!entries.length) { wrap.innerHTML = `<div class="empty">추첨 가능한 승인 제출이 없습니다.</div>`; return; }
    wrap.innerHTML = entries.map(([tid, v]) => `<div class="lot-row"><span class="lot-title">${esc(v.title)}</span><span class="dim-sm">승인 ${v.approved}명</span><button class="mini-btn rwd" type="button" data-lot="${esc(tid)}">승인자 중 추첨 🎁</button></div>`).join("");
    entries.forEach(([tid]) => {
      const b = wrap.querySelector(`[data-lot="${CSS.escape(tid)}"]`);
      if (b) b.onclick = () => doLottery(tid);
    });
  }

  function renderAdmin() {
    $("adminWrap").style.display = state.isAdmin ? "" : "none";
    renderLottery();
    renderReview();
  }

  function renderAll() {
    renderCheckin();
    renderTasks();
    renderMyStatus();
    renderAdmin();
  }

  // ── 액션: 체크인 ──────────────────────────────────────────────────
  async function doCheckin() {
    const btn = $("ckBtn");
    if (btn) { btn.disabled = true; btn.textContent = "처리 중…"; }
    const { error } = await state.sb.from("daily_checkins").insert({ user_id: state.uid, checkin_date: kstToday() });
    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(error.message || "")) {
        toast("이미 오늘 출석하셨어요!", "ok");
      } else {
        toast("출석 실패: " + (error.message || "오류"), "err");
        if (btn) { btn.disabled = false; btn.textContent = "오늘 체크인 ✅"; }
        return;
      }
    } else {
      toast("출석 완료! 🔥", "ok");
    }
    await loadCheckins();
    renderCheckin(); renderMyStatus();
  }

  // ── 액션: 인증 모달 ───────────────────────────────────────────────
  function openSubModal(t) {
    if (!state.uid) { toast("인증하려면 먼저 로그인해주세요.", "err"); doLogin(); return; }
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
    if (!file) { toast("스크린샷 이미지를 선택해주세요.", "err"); return; }
    if (!file.type.startsWith("image/")) { toast("이미지 파일만 업로드할 수 있어요.", "err"); return; }
    if (file.size > 10 * 1024 * 1024) { toast("이미지가 너무 큽니다 (10MB 이하).", "err"); return; }

    const btn = $("subSubmit"); const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "업로드 중…";
    try {
      const ext = ((file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg").slice(0, 4);
      const path = `${state.uid}/${t.id}_${Date.now()}.${ext}`;
      const up = await state.sb.storage.from("airdrop-proofs").upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw up.error;
      const proof_url = state.sb.storage.from("airdrop-proofs").getPublicUrl(path).data.publicUrl;

      const ins = await state.sb.from("airdrop_submissions").insert({
        task_id: t.id, user_id: state.uid, proof_url, proof_note: note || null,
      });
      if (ins.error) {
        if (ins.error.code === "23505" || /duplicate|unique/i.test(ins.error.message || "")) {
          toast("이미 이 작업에 인증을 제출하셨어요.", "err");
        } else throw ins.error;
      } else {
        toast("인증 제출 완료! 검토 후 승인됩니다 🎉", "ok");
        closeSubModal();
      }
      await loadMySubs();
      renderTasks(); renderMyStatus();
    } catch (err) {
      toast("제출 실패: " + (err && err.message || "오류"), "err");
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  }

  // ── 액션: 관리자 검토 ─────────────────────────────────────────────
  async function reviewSub(s, status) {
    const { error } = await state.sb.from("airdrop_submissions").update({
      status, reviewed_by: state.uid, reviewed_at: new Date().toISOString(),
    }).eq("id", s.id);
    if (error) { toast("처리 실패: " + (error.message || "오류"), "err"); return; }
    toast(`${st(status).txt} 처리 완료`, "ok");
    await Promise.all([loadAllSubs(), loadMySubs()]);
    renderReview(); renderLottery(); renderTasks(); renderMyStatus();
  }

  async function doLottery(taskId) {
    const approved = (state.allSubs || []).filter((s) => s.task_id === taskId && s.status === "approved");
    if (!approved.length) { toast("승인된 제출이 없습니다.", "err"); return; }
    const input = prompt(`승인자(${approved.length}명) 중 몇 명을 추첨할까요?`, "1");
    if (input == null) return;
    let n = parseInt(input, 10);
    if (!n || n < 1) { toast("1 이상의 숫자를 입력해주세요.", "err"); return; }
    if (n > approved.length) { toast(`승인자는 ${approved.length}명이에요. 전원 추첨합니다.`, "ok"); n = approved.length; }

    const pool = approved.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const ids = pool.slice(0, n).map((w) => w.id);

    const { error } = await state.sb.from("airdrop_submissions").update({
      status: "rewarded", reviewed_by: state.uid, reviewed_at: new Date().toISOString(),
    }).in("id", ids);
    if (error) { toast("추첨 실패: " + (error.message || "오류"), "err"); return; }
    toast(`🎉 ${n}명 추첨 완료 — 리워드 지정!`, "ok");
    await Promise.all([loadAllSubs(), loadMySubs()]);
    renderReview(); renderLottery(); renderTasks(); renderMyStatus();
  }

  // ── 액션: 작업 등록 (관리자) ──────────────────────────────────────
  async function submitTask(e) {
    e.preventDefault();
    const title = $("f_title").value.trim();
    if (!title) { toast("제목을 입력해주세요.", "err"); return; }
    const btn = $("taskSubmit"); const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "등록 중…";
    const payload = {
      title,
      description: $("f_desc").value.trim() || null,
      steps: $("f_steps").value.trim() || null,
      link: $("f_link").value.trim() || null,
      reward_note: $("f_reward").value.trim() || null,
      category: $("f_cat").value.trim() || null,
      status: "active",
      sort_order: parseInt($("f_sort").value, 10) || 0,
      ends_at: $("f_ends").value ? new Date($("f_ends").value).toISOString() : null,
      created_by: state.uid,
    };
    const { error } = await state.sb.from("airdrop_tasks").insert(payload);
    btn.disabled = false; btn.textContent = orig;
    if (error) { toast("등록 실패: " + (error.message || "오류"), "err"); return; }
    toast("작업이 등록되었습니다.", "ok");
    e.target.reset();
    await loadTasks(); renderTasks();
  }

  // ── 부트 (직렬화: 가장 최근 부트만 렌더) ──────────────────────────
  let bootToken = 0;
  async function boot() {
    const my = ++bootToken;
    // 1) 인증과 무관한 작업 목록 먼저 로드·렌더 → auth가 늦거나 hang 나도 페이지는 뜬다
    await loadTasks(); if (my !== bootToken) return;
    renderTasks(); renderCheckin();
    // 2) 인증 (getSession hang 대비 타임아웃 내장)
    await loadAuth(); if (my !== bootToken) return;
    // 3) 유저별 데이터
    await Promise.all([loadMySubs(), loadCheckins(), loadAllSubs()]); if (my !== bootToken) return;
    renderAll();
  }

  // ── 초기화 ────────────────────────────────────────────────────────
  function init() {
    // 정적 이벤트 연결(한 번)
    $("subForm").onsubmit = submitProof;
    $("subClose").onclick = closeSubModal;
    $("subModal").addEventListener("click", (e) => { if (e.target === $("subModal")) closeSubModal(); });
    $("subFile").onchange = () => {
      const f = $("subFile").files[0]; const p = $("subPreview");
      if (!f) { p.innerHTML = ""; return; }
      if (!f.type.startsWith("image/")) { p.innerHTML = `<div class="err" style="margin-top:8px;">이미지 파일만 가능합니다.</div>`; return; }
      p.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="" style="max-height:140px;border-radius:10px;border:1px solid var(--line);margin-top:8px;display:block;">`;
    };
    $("taskForm").onsubmit = submitTask;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("subModal").classList.contains("on")) closeSubModal(); });

    // 인증 상태 변화(로그인/로그아웃/OAuth 복귀)마다 재부트
    state.sb.auth.onAuthStateChange(() => boot());
    boot(); // INITIAL_SESSION 보험
  }

  // window.__sb 대기(150ms × 40 ≈ 6초)
  let tries = 0;
  (function waitForSb() {
    if (window.__sb) { state.sb = window.__sb; init(); return; }
    if (tries++ > 40) {
      $("checkinBody").innerHTML = `<div class="err">인증 모듈 로드 실패. 새로고침해주세요.</div>`;
      $("tasksWrap").innerHTML = `<div class="err">데이터를 불러올 수 없습니다.</div>`;
      return;
    }
    setTimeout(waitForSb, 150);
  })();
})();
