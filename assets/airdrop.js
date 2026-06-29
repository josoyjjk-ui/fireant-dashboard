/* ANTINFO 에어드랍 v2 — Supabase 실데이터 대시보드
 * auth.js 가 만든 window.__sb 를 사용합니다.
 * 모든 Supabase 호출은 withTimeout() 으로 감싸고, boot 는 선렌더 후 Promise.allSettled 로 진행합니다.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const multiline = (s) => esc(s).replace(/\n/g, "<br>");
  const safeURL = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : "#"; } catch { return "#"; } };
  const PROOF_BUCKET = "airdrop-proofs";
  // 저장된 proof_url(과거 public URL 또는 신규 경로)에서 스토리지 경로만 추출
  const proofPath = (u) => {
    if (!u) return "";
    const m = String(u).indexOf(`/${PROOF_BUCKET}/`);
    return m >= 0 ? String(u).slice(m + PROOF_BUCKET.length + 2).split("?")[0] : String(u);
  };
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

  // [라벨](https://url) -> 클릭 가능한 앵커. 그 외 텍스트는 모두 이스케이프, 일반 URL은 텍스트로 남깁니다.
  const mdLinks = (s, br) => {
    const str = String(s ?? "");
    const re = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
    let out = "", last = 0, m;
    while ((m = re.exec(str)) !== null) {
      out += esc(str.slice(last, m.index));
      out += `<a href="${safeURL(m[2])}" target="_blank" rel="noopener">${esc(m[1])}</a>`;
      last = m.index + m[0].length;
    }
    out += esc(str.slice(last));
    return br ? out.replace(/\n/g, "<br>") : out;
  };
  const shortAddr = (a) => { const v = String(a || ""); return v.length > 12 ? v.slice(0, 6) + "…" + v.slice(-4) : v; };
  const toLocalInput = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso); const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch { return ""; }
  };
  const hasWallet = () => !!(state.wallets && state.wallets.length);
  function flashProfile() {
    const card = $("profileCard");
    if (!card) return;
    card.classList.add("expanded");
    const head = $("profileHead"); if (head) head.setAttribute("aria-expanded", "true");
    try { card.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
    const prev = card.style.outline;
    card.style.outline = "2px solid var(--accent2)";
    setTimeout(() => { card.style.outline = prev; }, 2400);
  }
  // 참여 전 닉네임 필수 — OAuth 가입에는 입력 폼이 없어 여기서 강제합니다.
  function requireNickname() {
    if (state.uid && !(state.profile && state.profile.nickname)) {
      toast("먼저 프로필에서 닉네임을 설정해 주십시오.", "err");
      flashProfile();
      return false;
    }
    return true;
  }
  // 체크인 게이트: 지갑을 제외한 모든 참여정보가 채워져야 한다.
  function requireProfile() {
    if (!state.uid) return false;
    const p = state.profile || {};
    const need = [
      ["nickname", "닉네임"], ["phone", "휴대전화번호"], ["email", "이메일"],
      ["telegram_handle", "텔레그램 아이디"], ["twitter_handle", "트위터(X) 아이디"], ["youtube_handle", "유튜브 닉네임"],
    ];
    const missing = need.filter(([k]) => !(p[k] && String(p[k]).trim())).map((x) => x[1]);
    if (missing.length) {
      toast("체크인하려면 참여정보를 모두 입력해 주세요 (지갑 제외): " + missing.join(", "), "err");
      flashProfile();
      return false;
    }
    return true;
  }

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
  const joinEmail = (j) => {
    const o = Array.isArray(j) ? (j[0] || {}) : (j || {});
    return o.nickname || o.email || o.full_name || "";
  };

  const state = {
    sb: null,
    user: null, uid: null, profile: null, isAdmin: false,
    tasks: [], tasksLoaded: false, _tasksErr: null,
    mySubs: {}, mySubList: [],
    allSubs: [], _adminErr: null,
    checkins: [], streak: 0, checkedInToday: false,
    leaderboard: [], winners: [], _winnersErr: null, _winnerNicks: {},
    events: [], _eventsErr: null, eventsLoaded: false,
    lotEntrants: [], _lotErr: null, lotLoaded: false, lotResult: null, lotDrawing: false,
    wallets: [],
    visitStats: null, _vsErr: null, _vsClock: null,
    _subTask: null, _editSubId: null, _editTaskId: null, _clock: null,
  };
  const numfmt = (n) => String(Number(n) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  // 주간 고정 리워드 추첨 경품 구성 (순서대로 배정)
  const RAFFLE_PRIZES = [
    { tier: "🥇 1등", prize: "3만원권" },
    { tier: "🥈 2등", prize: "1만원권" },
    { tier: "🥉 3등", prize: "5천원권" },
    ...Array.from({ length: 10 }, () => ({ tier: "🎁 참여상", prize: "스타벅스 커피" })),
  ];

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
  function weekBounds(offsetWeeks) {
    const off = offsetWeeks || 0;
    const nowKst = kstDate();
    const day = nowKst.getUTCDay() || 7;
    const start = new Date(nowKst);
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - day + 1 + off * 7);
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

  // 이미 로그인된 사용자가 state.uid 미복원(세션 조회 경합/타임아웃)으로 재로그인을 강요받는 문제 방지.
  // getSession → refreshSession → getUser 순으로 기존 세션을 복구해 state.uid를 채운다. 진짜 세션이 없을 때만 false.
  async function ensureSession() {
    if (state.uid) return true;
    if (!state.sb) return false;
    // getSession()은 로컬스토리지 기반이라 빠르다. 로그인된 사용자는 여기서 즉시 복원된다.
    // refreshSession/getUser 같은 네트워크 체인은 핫패스에서 수십 초 먹통을 유발하므로 쓰지 않는다(짧은 3s 상한).
    try {
      const r = await withTimeout(state.sb.auth.getSession(), "세션 확인", 3000);
      const session = r && r.data ? r.data.session : null;
      if (session && session.user) { state.user = session.user; state.uid = session.user.id; return true; }
    } catch (_) {}
    // 폴백: 네비게이션바엔 로그인 표시인데 액세스 토큰만 만료된 경우 — refresh 토큰으로 세션 복원.
    try {
      const r2 = await withTimeout(state.sb.auth.refreshSession(), "세션 갱신", 6000);
      const s2 = r2 && r2.data ? r2.data.session : null;
      if (s2 && s2.user) { state.user = s2.user; state.uid = s2.user.id; return true; }
    } catch (_) {}
    return false;
  }

  async function loadAuth() {
    // uid/user는 함부로 비우지 않는다. onAuthStateChange가 먼저 세션을 넣었을 수 있고,
    // getSession이 경합으로 느리면 그걸 null로 덮어 "로그인됐는데 비로그인 화면"이 뜬다.
    state.profile = null; state.isAdmin = false; state.wallets = [];
    // 세션 조회는 navigator.locks/토큰 리프레시 경합으로 느릴 수 있어 넉넉한 타임아웃 + 1회 재시도로 false 로그아웃을 방지합니다.
    let session = null;
    for (let attempt = 0; attempt < 2 && !session; attempt++) {
      try {
        const r = await withTimeout(state.sb.auth.getSession(), "세션 확인", 10000);
        session = r && r.data ? r.data.session : null;
      } catch (_) { session = null; }
      if (!session && attempt === 0) await new Promise((res) => setTimeout(res, 400));
    }
    if (session && session.user) { state.user = session.user; state.uid = session.user.id; }
    // getSession 실패(액세스 토큰만 만료) 시 refresh 토큰으로 세션 복원 — 네비바 로그인 상태인데 체크인서 재로그인 강요 방지.
    if (!state.uid) {
      try {
        const rr = await withTimeout(state.sb.auth.refreshSession(), "세션 갱신", 6000);
        const rs = rr && rr.data ? rr.data.session : null;
        if (rs && rs.user) { state.user = rs.user; state.uid = rs.user.id; }
      } catch (_) {}
    }
    // getSession/refresh 모두 실패해도 리스너가 넣어둔 state.uid가 있으면 그대로 진행(거짓 로그아웃 방지).
    if (!state.uid) { state.user = null; return; }
    try {
      const { data: prof } = await withTimeout(
        state.sb.from("profiles").select("id,email,full_name,avatar_url,tier,is_admin,wallet_address,telegram_handle,twitter_handle,youtube_handle,nickname,phone").eq("id", state.uid).single(),
        "프로필 로드",
      );
      state.profile = prof || null;
      state.isAdmin = !!(prof && prof.is_admin);
    } catch (_) {
      try {
        const { data: prof } = await withTimeout(
          state.sb.from("profiles").select("id,email,full_name,avatar_url,tier,is_admin,nickname").eq("id", state.uid).single(),
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
      const { data, error } = await withTimeout(
        state.sb.rpc("streak_leaderboard", { p_limit: 10 }),
        "리더보드 로드",
      );
      if (error || !data) return;
      state.leaderboard = data.map((r) => ({ uid: r.user_id, streak: r.streak, name: r.nickname || "익명" }));
    } catch (_) {}
  }
  async function loadWinners() {
    state.winners = []; state._winnersErr = null; state._winnerNicks = {};
    try {
      const { data, error } = await withTimeout(
        state.sb.from("raffle_winners")
          .select("id,week_start,user_id,telegram,prize,entries,created_at, user:profiles(full_name,email)")
          .eq("week_start", lastWeekStart()).order("created_at", { ascending: true }),
        "당첨자 로드",
      );
      if (error) { state._winnersErr = error.message || "오류"; return; }
      state.winners = data || [];
      const ids = [...new Set(state.winners.map((w) => w.user_id).filter(Boolean))];
      if (ids.length) {
        try {
          const { data: nicks } = await withTimeout(
            state.sb.rpc("public_nicknames", { p_ids: ids }),
            "당첨자 닉네임 로드",
          );
          (nicks || []).forEach((n) => { state._winnerNicks[n.id] = n.nickname; });
        } catch (_) {}
      }
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
          .select("id,task_id,user_id,proof_url,proof_note,status,created_at, task:airdrop_tasks(title,verify_method), user:profiles!airdrop_submissions_user_id_fkey(email,full_name,nickname)")
          .order("created_at", { ascending: false }),
        "관리자 제출 로드",
      );
      if (error) { state._adminErr = error.message || "오류"; return; }
      state.allSubs = data || [];
      // 비공개 버킷: 관리자 열람용 서명 URL 생성(1시간 유효)
      await Promise.all((state.allSubs || []).map(async (s) => {
        if (!s.proof_url) return;
        try {
          const { data: sig } = await state.sb.storage.from(PROOF_BUCKET).createSignedUrl(proofPath(s.proof_url), 3600);
          if (sig && sig.signedUrl) s.signedUrl = sig.signedUrl;
        } catch (_) {}
      }));
    } catch (err) {
      state._adminErr = errText(err);
    }
  }
  async function loadEntrants() {
    state.lotEntrants = []; state._lotErr = null; state.lotLoaded = false;
    if (!state.isAdmin) return;
    // 추첨은 기본 '지난 완료주(월~일)' 기준. 월요일에 눌러도 직전 주를 집계한다.
    if (state.lotWeekOffset === undefined) state.lotWeekOffset = -1;
    const { startDate, endDate } = weekBounds(state.lotWeekOffset);
    try {
      const { data, error } = await withTimeout(
        state.sb.rpc("weekly_entrants", { p_start: startDate, p_end: endDate }),
        "응모자 집계",
      );
      if (error) { state._lotErr = error.message || "오류"; return; }
      state.lotEntrants = (data || []).map((r) => ({
        user_id: r.user_id,
        email: r.email,
        full_name: r.full_name,
        nickname: r.nickname,
        checkins: r.checkins,
        approved: r.approved,
        entries: Math.max(0, Number(r.entries) || 0),
      }));
    } catch (err) {
      state._lotErr = errText(err);
    } finally {
      state.lotLoaded = true;
    }
  }

  async function loadVisitStats() {
    state._vsErr = null;
    if (!state.isAdmin) { state.visitStats = null; return; }
    try {
      const { data, error } = await withTimeout(state.sb.rpc("visit_stats"), "방문 통계");
      if (error) { state._vsErr = error.message || "오류"; return; }
      state.visitStats = data || null;
    } catch (err) {
      state._vsErr = errText(err);
    }
  }
  function renderVisitStats() {
    const wrap = $("visitStats");
    if (!wrap || !state.isAdmin) return;
    if (state._vsErr) { wrap.innerHTML = `<div class="err">방문 통계 로드 실패: ${esc(state._vsErr)}</div>`; return; }
    const s = state.visitStats;
    if (!s) { wrap.innerHTML = `<div class="loading">로드 중…</div>`; return; }
    wrap.innerHTML = `
      <div class="vstat live"><div class="vlab"><span class="vdot"></span>실시간 접속</div><div class="vnum">${numfmt(s.realtime)}</div></div>
      <div class="vstat"><div class="vlab">오늘(일일)</div><div class="vnum">${numfmt(s.daily)}</div></div>
      <div class="vstat"><div class="vlab">최근 7일</div><div class="vnum">${numfmt(s.weekly)}</div></div>
      <div class="vstat"><div class="vlab">누적</div><div class="vnum">${numfmt(s.cumulative)}</div></div>`;
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
      const b = $("ckLogin"); if (b) b.onclick = async () => {
        b.disabled = true; const _o = b.textContent; b.textContent = "확인 중…";
        if (await ensureSession()) { await loadCheckins(); renderCheckin(); renderTickets(); doCheckin(); }
        else { b.disabled = false; b.textContent = _o; doLogin(); }
      };
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
    const editBtn = (sub && sub.status === "pending")
      ? `<button class="btn-ghost" type="button" data-editsub="${esc(t.id)}">수정</button>`
      : "";
    const action = sub ? "" : method === "onchain"
      ? `<button class="btn-wallet" type="button" data-auto="${esc(t.id)}">지갑 주소 등록 · 인증요청</button>`
      : method === "telegram"
        ? `<button class="btn-sub" type="button" data-auto="${esc(t.id)}">자동 인증요청</button>`
        : `<button class="btn-sub" type="button" data-sub="${esc(t.id)}">✅ 인증하기</button>`;
    return `<div class="task"><div class="task-head"><div><div class="task-title">${esc(t.title)}</div>${t.reward_note ? `<span class="reward">${esc(t.reward_note)}</span>` : `<span class="reward">응모권 +5장</span>`}</div><span class="vm ${vm.cls}">${vm.label}</span></div>${t.description ? `<div class="task-desc">${mdLinks(t.description)}</div>` : ""}${t.steps ? `<div class="task-steps">${mdLinks(t.steps, true)}</div>` : ""}<div class="task-foot">${t.link ? `<a class="btn-go ghost" href="${safeURL(t.link)}" target="_blank" rel="noopener">작업하러 가기 ↗</a>` : ""}${action}${editBtn}${statusBadge}</div></div>`;
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
      const es = wrap.querySelector(`[data-editsub="${cssEscape(t.id)}"]`);
      if (s) s.onclick = () => openSubModal(t);
      if (a) a.onclick = () => submitAutoTask(t);
      if (es) es.onclick = () => { const sub = state.mySubs[t.id]; if (sub) openSubModal(t, sub); };
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

  const EVENT_WD = ["일", "월", "화", "수", "목", "금", "토"];
  function classifyEvent(ev, now) {
    const start = ev.startDate ? new Date(ev.startDate).getTime() : null;
    const end = ev.endDate ? new Date(ev.endDate).getTime() : null;
    if (start && now < start) return "soon";
    if (end && now > end) return "ended";
    return "active";
  }
  function eventFmtMD(s, withTime) {
    const d = new Date(s);
    if (isNaN(d)) return s;
    let r = `${d.getMonth() + 1}/${d.getDate()} (${EVENT_WD[d.getDay()]})`;
    if (withTime) {
      const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
      if (!(hh === "00" && mm === "00")) r += ` ${hh}:${mm}`;
    }
    return r;
  }
  function eventRangeStr(ev) {
    if (ev.startDate && ev.endDate) return `${eventFmtMD(ev.startDate, false)} ~ ${eventFmtMD(ev.endDate, true)}`;
    if (ev.endDate) return `~ ${eventFmtMD(ev.endDate, true)}`;
    if (ev.startDate) return `${eventFmtMD(ev.startDate, false)} ~`;
    return "";
  }
  function eventCdStr(ev, evState) {
    if (evState === "ended") return { txt: "종료됨", cls: "cd-end" };
    const target = evState === "soon" ? ev.startDate : ev.endDate;
    if (!target) return null;
    const ms = new Date(target).getTime() - Date.now();
    if (isNaN(ms)) return null;
    if (ms <= 0) return evState === "soon" ? { txt: "곧 시작", cls: "" } : { txt: "종료됨", cls: "cd-end" };
    const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5);
    const pre = evState === "soon" ? "시작까지" : "종료까지";
    return { txt: `${pre} ${d}일 ${h}시간`, cls: "" };
  }
  function eventTagsHtml(ev) {
    const tags = Array.isArray(ev.tags) && ev.tags.length ? ev.tags : (ev.type === "official" ? ["공식 이벤트"] : []);
    return tags.map((t, i) => `<span class="tg ${i === 0 ? "tg-type" : "tg-proj"}">${esc(t)}</span>`).join("");
  }
  function eventCard(ev, evState) {
    const steps = ev.steps || ev.description || "";
    const cd = eventCdStr(ev, evState);
    const tg = eventTagsHtml(ev);
    const range = eventRangeStr(ev);
    const link = ev.link ? `<a class="go" href="${safeURL(ev.link)}" target="_blank" rel="noopener">참여하기 →</a>` : "";
    return `<div class="ev">
    ${tg ? `<div class="tags">${tg}</div>` : ""}
    <div class="ti">${esc(ev.title)}</div>
    ${(range || ev.rewards) ? `<div class="metarow">${range ? `<span class="m-date">🗓️ ${esc(range)}</span>` : ""}${ev.rewards ? `<span class="m-reward">🎁 ${esc(ev.rewards)}</span>` : ""}</div>` : ""}
    ${steps ? `<div class="step">• ${esc(steps)}</div>` : ""}
    ${cd ? `<div class="cd ${cd.cls}">⏰ ${esc(cd.txt)}</div>` : ""}
    ${link}</div>`;
  }
  async function loadAirdropEvents() {
    const wrap = $("airdropEventsWrap");
    if (!wrap || state.eventsLoaded) return;
    state._eventsErr = null;
    try {
      const r = await fetch(`/events.json?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`/events.json ${r.status}`);
      const data = await r.json();
      state.events = Array.isArray(data) ? data : [];
    } catch (err) {
      state.events = [];
      state._eventsErr = errText(err);
    } finally {
      state.eventsLoaded = true;
      renderAirdropEvents();
    }
  }
  function renderAirdropEvents() {
    const wrap = $("airdropEventsWrap");
    if (!wrap) return;
    if (state._eventsErr) { wrap.innerHTML = `<div class="empty">이벤트 로드 실패: ${esc(state._eventsErr)}</div>`; return; }
    if (!state.eventsLoaded) { wrap.innerHTML = `<div class="loading">이벤트를 불러오는 중…</div>`; return; }
    if (!state.events.length) { wrap.innerHTML = `<div class="empty">현재 표시할 이벤트가 없습니다.</div>`; return; }
    const now = Date.now();
    const groups = { active: [], soon: [], ended: [] };
    state.events.forEach((e) => { groups[classifyEvent(e, now)].push(e); });
    const sections = [
      ["active", "🔥 진행중"],
      ["soon", "🗓️ 예정"],
      ["ended", "✅ 종료"],
    ];
    const html = sections.map(([key, label]) => {
      if (!groups[key].length) return "";
      if (key === "ended") {
        // 종료된 이벤트는 기본 접힘 — 토글로 펼침
        return `<details class="ended-fold"><summary class="event-group ended-summary">✅ 종료된 이벤트 ${groups[key].length}개 보기</summary>${groups[key].map((e) => eventCard(e, key)).join("")}</details>`;
      }
      return `<div class="event-group">${label}</div>${groups[key].map((e) => eventCard(e, key)).join("")}`;
    }).join("");
    wrap.innerHTML = html || `<div class="empty">현재 표시할 이벤트가 없습니다.</div>`;
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
      const nick = (state._winnerNicks && state._winnerNicks[w.user_id]) || "";
      const name = nick || w.telegram || u.full_name || (u.email ? u.email.split("@")[0] : "당첨자");
      return `<div class="winrow"><span class="n">${i < 3 ? MEDALS[i] : ""} ${esc(name)}님</span><span class="c">${esc(w.prize || "기프티콘")} · ${Number(w.entries || 0)}장</span></div>`;
    }).join("");
  }
  function revRow(s) {
    const thumb = (s.proof_url && s.signedUrl)
      ? `<a class="rev-thumb-a" href="${safeURL(s.signedUrl)}" target="_blank" rel="noopener"><img class="rev-thumb" src="${safeURL(s.signedUrl)}" alt="인증 이미지"></a>`
      : s.proof_url
        ? `<div class="rev-thumb" style="display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--dim);text-align:center;">이미지<br>로드중</div>`
        : `<div class="rev-thumb" style="display:flex;align-items:center;justify-content:center;font-size:20px;">${(s.task && s.task.verify_method) === "telegram" ? "✈️" : "🔗"}</div>`;
    return `<div class="rev-row">${thumb}<div class="rev-body"><div class="rev-task">${esc(joinTitle(s.task))}</div><div class="rev-user">${esc(joinEmail(s.user) || "익명")} · ${esc(s.status)}</div>${s.proof_note ? `<div class="rev-note">${esc(s.proof_note)}</div>` : ""}</div><div class="rev-actions"><span class="rev-status ${st(s.status).cls}">${st(s.status).txt}</span><div style="display:flex;gap:6px;"><button class="mini-btn app" type="button" data-app="${esc(s.id)}">승인</button><button class="mini-btn rej" type="button" data-rej="${esc(s.id)}">반려</button></div></div></div>`;
  }
  function entrantName(e) {
    return (e && (e.nickname || e.full_name || (e.email ? e.email.split("@")[0] : e.user_id))) || "참여자";
  }
  // 응모권 가중 랜덤 추첨(복원 없음): 응모권이 많을수록 뽑힐 확률↑
  function weightedDrawN(pool, n) {
    const arr = pool.map((e) => ({ ...e }));
    const picked = [];
    for (let k = 0; k < n && arr.length; k++) {
      const total = arr.reduce((a, e) => a + Math.max(1, e.entries), 0);
      let r = Math.random() * total;
      let idx = arr.length - 1;
      for (let i = 0; i < arr.length; i++) {
        r -= Math.max(1, arr[i].entries);
        if (r <= 0) { idx = i; break; }
      }
      picked.push(arr[idx]);
      arr.splice(idx, 1);
    }
    return picked;
  }
  function drawWinners() {
    const pool = state.lotEntrants || [];
    if (!pool.length) { toast("추첨할 참여자가 없습니다.", "err"); return; }
    const n = Math.min(RAFFLE_PRIZES.length, pool.length);
    const picked = weightedDrawN(pool, n);
    state.lotResult = picked.map((e, i) => ({ ...e, tier: RAFFLE_PRIZES[i].tier, prize: RAFFLE_PRIZES[i].prize }));
    renderLottery();
    toast(`${picked.length}명을 추첨했습니다. 확인 후 기록하십시오.`, "ok");
  }
  function lotWeekLabel() {
    const off = state.lotWeekOffset === undefined ? -1 : state.lotWeekOffset;
    const wb = weekBounds(off);
    const range = `${wb.startDate.slice(5)}~${dateAdd(wb.endDate, -1).slice(5)}`;
    return { off, name: off === -1 ? "지난주" : off === 0 ? "이번주" : `${off}주`, range };
  }
  function renderLottery() {
    const wrap = $("lotteryWrap");
    if (!wrap || !state.isAdmin) return;
    const L = lotWeekLabel();
    // 추첨 대상 주 토글 (기본 지난주). 항상 노출.
    const toggle = `<div class="lot-wktoggle" style="display:flex;gap:6px;margin-bottom:10px;align-items:center;flex-wrap:wrap;">`
      + `<span class="dim-sm">추첨 대상:</span>`
      + `<button class="mini-btn ${L.off === -1 ? "app" : ""}" type="button" data-lotwk="-1">지난주(추첨)</button>`
      + `<button class="mini-btn ${L.off === 0 ? "app" : ""}" type="button" data-lotwk="0">이번주(현황)</button>`
      + `<span class="dim-sm">· ${L.name} (${L.range})</span></div>`;
    const bindToggle = () => wrap.querySelectorAll("[data-lotwk]").forEach((btn) => {
      btn.onclick = () => {
        const v = parseInt(btn.getAttribute("data-lotwk"), 10);
        if (v === (state.lotWeekOffset === undefined ? -1 : state.lotWeekOffset)) return;
        state.lotWeekOffset = v; state.lotResult = null; state.lotLoaded = false;
        renderLottery();
        loadEntrants().then(renderLottery);
      };
    });
    const entrants = state.lotEntrants || [];
    const count = $("lotCount"); if (count) count.textContent = entrants.length ? `(${entrants.length}명)` : "";
    if (state._lotErr) { wrap.innerHTML = toggle + `<div class="err">응모자 집계 실패: ${esc(state._lotErr)}</div>`; bindToggle(); return; }
    if (!state.lotLoaded) { wrap.innerHTML = toggle + `<div class="loading">응모자 집계 중…</div>`; bindToggle(); return; }
    if (!entrants.length) { wrap.innerHTML = toggle + `<div class="empty">${L.name} 응모권을 보유한 참여자가 없습니다.</div>`; bindToggle(); return; }
    const total = entrants.reduce((a, e) => a + e.entries, 0);
    const prizeLine = "🥇 1등 3만원 · 🥈 2등 1만원 · 🥉 3등 5천원 · 🎁 참여상 스타벅스 10명";
    let html = toggle + `<div class="draw-bar"><div class="txt">${L.name}(${L.range}) 총 응모권 <b>${total}장</b> · 참여자 <b>${entrants.length}명</b><br><span class="dim-sm">${prizeLine}</span></div><button class="btn-draw" type="button" id="drawBtn">🎲 가중 추첨 실행</button></div>`;
    if (state.lotResult && state.lotResult.length) {
      html += `<div class="draw-result"><div class="dr-head">🎉 추첨 결과 (${state.lotResult.length}명) <span class="dim-sm">· 확정 전 미저장</span></div>${state.lotResult.map((w) => `<div class="lot-row win"><span class="lot-title">${esc(w.tier)} · ${esc(entrantName(w))}</span><span class="dim-sm">${esc(w.prize)} · ${w.entries}장</span></div>`).join("")}<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;"><button class="btn-draw" type="button" id="confirmBtn">✅ 당첨자 확정 기록</button><button class="btn-ghost" type="button" id="redrawBtn">다시 뽑기</button></div></div>`;
    }
    html += `<div class="lot-divlbl">참여자 목록 (응모권순)</div><div>${entrants.slice(0, 30).map((e, i) => `<div class="lot-row"><span class="lot-title">${i + 1}. ${esc(entrantName(e))}</span><span class="dim-sm">${e.entries}장 <span style="opacity:.6">(체크인 ${e.checkins}·미션 ${e.approved})</span></span></div>`).join("")}${entrants.length > 30 ? `<div class="dim-sm" style="padding:8px 2px;">외 ${entrants.length - 30}명…</div>` : ""}</div>`;
    wrap.innerHTML = html;
    bindToggle();
    const b = $("drawBtn"); if (b) b.onclick = drawWinners;
    const c = $("confirmBtn"); if (c) c.onclick = () => recordWinners(state.lotResult);
    const rd = $("redrawBtn"); if (rd) rd.onclick = drawWinners;
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
      return `<div class="rev-row"><div class="rev-body"><div class="rev-task">${esc(t.title)}</div><div class="rev-user">${esc(t.category || "미분류")} · ${ends}</div></div><div class="rev-actions"><div style="display:flex;gap:6px;"><button class="mini-btn app" type="button" data-edittask="${esc(t.id)}">수정</button><button class="mini-btn rej" type="button" data-end="${esc(t.id)}">종료</button><button class="mini-btn" type="button" data-del="${esc(t.id)}" style="background:#3a2530;color:#ff8aa0;">삭제</button></div></div></div>`;
    }).join("");
    tasks.forEach((t) => {
      const et = wrap.querySelector(`[data-edittask="${cssEscape(t.id)}"]`);
      const e = wrap.querySelector(`[data-end="${cssEscape(t.id)}"]`);
      const d = wrap.querySelector(`[data-del="${cssEscape(t.id)}"]`);
      if (et) et.onclick = () => editTask(t);
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
    renderVisitStats();
    renderManage();
    renderLottery();
    renderReview();
  }
  const normHandle = (v) => (v || "").trim().replace(/^@+/, "");
  function renderProfile() {
    const wrap = $("profileBody");
    if (!wrap) return;
    if (!state.uid) {
      wrap.innerHTML = `<div class="ck-row"><div class="ck-meta">로그인하면 닉네임·텔레그램·X·유튜브 아이디·지갑 주소를 등록할 수 있습니다.<br>당첨자 연락·미션 검증에 사용됩니다.</div><button class="btn-sub" id="pfLogin" type="button">로그인</button></div>`;
      const b = $("pfLogin"); if (b) b.onclick = doLogin;
      return;
    }
    const p = state.profile || {};
    const wallets = state.wallets || [];
    const walletRows = wallets.length
      ? wallets.map((w) => `<div class="ms-row" style="margin-bottom:6px;"><span class="ms-task" style="font-family:monospace;font-size:12.5px;">${esc(shortAddr(w.address))}</span><button class="mini-btn rej" type="button" data-wdel="${esc(w.id)}">삭제</button></div>`).join("")
      : `<div class="dim-sm" style="margin-bottom:6px;">등록된 지갑이 없습니다. 온체인 미션 인증에 필요합니다.</div>`;
    const addBtn = wallets.length < 5 ? `<button class="btn-ghost" id="pfAddWallet" type="button" style="margin-top:2px;">＋ 지갑 추가</button>` : `<div class="dim-sm" style="margin-top:2px;">최대 5개까지 등록할 수 있습니다.</div>`;
    const RQ = '<span style="color:var(--accent);font-weight:900;">*</span>';
    wrap.innerHTML = `<div class="dim-sm" style="margin-bottom:12px;line-height:1.55;padding:10px 12px;background:rgba(255,181,71,.08);border:1px solid #3a2f14;border-radius:10px;">📌 지갑을 제외한 모든 항목을 입력해야 <b style="color:var(--accent2)">데일리 체크인</b>이 가능합니다. ${RQ} 표시는 필수입니다.</div>`
      + `<div class="af-row3"><div class="field"><label>닉네임 ${RQ} <span class="dim-sm">· 리더보드·당첨 표시</span></label><input type="text" id="pf_nick" maxlength="20" placeholder="표시될 닉네임" value="${esc(p.nickname || "")}"></div><div class="field"><label>휴대전화번호 ${RQ} <span class="dim-sm">· 보상 지급용</span></label><input type="tel" id="pf_phone" inputmode="numeric" placeholder="010-0000-0000" value="${esc(p.phone || "")}"></div><div class="field"><label>이메일 ${RQ} <span class="dim-sm">· 구글 로그인</span></label><input type="email" id="pf_email" value="${esc(p.email || "")}" readonly title="구글 로그인 이메일(수정 불가)"></div></div>`
      + `<div class="af-row3"><div class="field"><label>텔레그램 아이디 ${RQ}</label><input type="text" id="pf_tg" placeholder="@username" value="${esc(p.telegram_handle || "")}"></div><div class="field"><label>X(트위터) 아이디 ${RQ}</label><input type="text" id="pf_tw" placeholder="@username" value="${esc(p.twitter_handle || "")}"></div><div class="field"><label>유튜브 닉네임 ${RQ}</label><input type="text" id="pf_yt" placeholder="채널명 또는 @핸들" value="${esc(p.youtube_handle || "")}"></div></div>`
      + `<div class="field" style="margin-top:4px;margin-bottom:6px;"><label>에어드랍 지갑 주소 <span class="dim-sm">· 선택 · ${wallets.length}/5 · 온체인 인증용</span></label><div id="walletList">${walletRows}</div>${addBtn}</div>`
      + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;"><button class="btn-sub" id="pfSave" type="button">정보 저장</button></div>`;
    const s = $("pfSave"); if (s) s.onclick = saveProfile;
    const aw = $("pfAddWallet"); if (aw) aw.onclick = addWallet;
    wrap.querySelectorAll("[data-wdel]").forEach((b) => { b.onclick = () => removeWallet(b.getAttribute("data-wdel")); });
  }
  async function saveProfile() {
    if (!state.uid) { doLogin(); return; }
    const nickRaw = (($("pf_nick") && $("pf_nick").value) || "").trim();
    if (!nickRaw) { toast("닉네임은 필수입니다. 프로필에서 설정해 주십시오.", "err"); return; }
    const payload = {
      nickname: nickRaw,
      telegram_handle: normHandle($("pf_tg") && $("pf_tg").value) || null,
      twitter_handle: normHandle($("pf_tw") && $("pf_tw").value) || null,
      youtube_handle: (($("pf_yt") && $("pf_yt").value) || "").trim() || null,
      phone: (($("pf_phone") && $("pf_phone").value) || "").trim() || null,
    };
    const btn = $("pfSave"); if (btn) { btn.disabled = true; btn.textContent = "저장 중…"; }
    try {
      const { error } = await withTimeout(state.sb.from("profiles").update(payload).eq("id", state.uid), "정보 저장");
      if (error) {
        if (error.code === "23505" || /nickname|unique|이미/i.test(error.message || "")) toast("이미 사용 중인 닉네임입니다.", "err");
        else throw error;
      } else {
        state.profile = { ...(state.profile || {}), ...payload };
        toast("참여 정보를 저장했습니다.", "ok");
      }
    } catch (err) {
      toast("저장 실패: " + errText(err), "err");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "정보 저장"; }
      renderProfile();
    }
  }
  function renderAll() {
    renderProfile();
    renderCheckin();
    renderTickets();
    renderTasks();
    renderLeaderboard();
    renderAirdropEvents();
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
    if (!state.uid && !(await ensureSession())) { toast("로그인이 필요합니다.", "err"); doLogin(); return; }
    if (!requireProfile()) return;
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

  async function loadWallets() {
    state.wallets = [];
    if (!state.uid) return;
    try {
      const { data, error } = await withTimeout(
        state.sb.from("airdrop_wallets").select("id,address").eq("user_id", state.uid).order("created_at"),
        "지갑 로드",
      );
      if (error || !data) return;
      state.wallets = data;
    } catch (_) {}
  }
  async function addWallet() {
    if (!state.uid) { doLogin(); return; }
    if ((state.wallets || []).length >= 5) { toast("지갑은 계정당 최대 5개까지 등록할 수 있습니다.", "err"); return; }
    let address = (prompt("등록할 EVM 지갑 주소를 입력해 주십시오. (0x로 시작, 42자) 온체인 내역으로 검증합니다.", "0x") || "").trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/i.test(address)) { toast("올바른 EVM 지갑 주소(0x로 시작, 42자)를 입력해 주십시오.", "err"); return; }
    try {
      const { error } = await withTimeout(
        state.sb.from("airdrop_wallets").insert({ user_id: state.uid, address }),
        "지갑 추가",
      );
      if (error) throw error;
      toast("지갑을 추가했습니다.", "ok");
      await loadWallets();
      renderProfile();
    } catch (err) {
      const code = err && err.code;
      const msg = (err && err.message) || "";
      if (code === "23505" || /unique|duplicate|이미/i.test(msg)) toast("이미 등록된 지갑 주소입니다.", "err");
      else if (/5\s*개|최대\s*5|maximum of 5|5 wallet/i.test(msg)) toast("지갑은 계정당 최대 5개까지 등록할 수 있습니다.", "err");
      else toast("지갑 추가 실패: " + errText(err), "err");
    }
  }
  async function removeWallet(id) {
    if (!confirm("이 지갑 주소를 삭제하시겠습니까?")) return;
    try {
      const { error } = await withTimeout(state.sb.from("airdrop_wallets").delete().eq("id", id), "지갑 삭제");
      if (error) throw error;
      toast("지갑을 삭제했습니다.", "ok");
      await loadWallets();
      renderProfile();
    } catch (err) {
      toast("삭제 실패: " + errText(err), "err");
    }
  }

  function openSubModal(t, editSub) {
    if (!state.uid) { toast("인증하려면 먼저 로그인해 주십시오.", "err"); doLogin(); return; }
    if (!requireNickname()) return;
    state._subTask = t;
    state._editSubId = editSub ? editSub.id : null;
    const sub = $("subModalSub");
    if (editSub) {
      $("subModalTitle").textContent = "인증 수정 — " + t.title;
      if (sub) sub.textContent = "제출한 인증을 수정할 수 있습니다. 새 스크린샷을 올리면 기존 이미지가 교체되고 다시 검토 대기 상태가 됩니다.";
      $("subNote").value = editSub.proof_note || "";
      $("subFile").value = "";
      $("subFile").required = false;
      $("subPreview").innerHTML = editSub.proof_url ? `<div class="dim-sm" style="margin-top:8px;">📎 기존 인증 이미지가 있습니다. 새 파일을 선택하면 교체됩니다.</div>` : "";
      const sb = $("subSubmit"); if (sb) sb.textContent = "수정 저장";
    } else {
      $("subModalTitle").textContent = t.title;
      if (sub) sub.textContent = "완료 화면 스크린샷을 올려 주십시오. 운영진이 확인 후 승인합니다. 작업별 1회만 인증할 수 있습니다.";
      $("subFile").value = ""; $("subNote").value = ""; $("subPreview").innerHTML = "";
      $("subFile").required = true;
      const sb = $("subSubmit"); if (sb) sb.textContent = "인증 제출하기";
    }
    $("subModal").classList.add("on");
  }
  function closeSubModal() { $("subModal").classList.remove("on"); state._subTask = null; state._editSubId = null; }

  async function submitProof(e) {
    e.preventDefault();
    const t = state._subTask;
    if (!t) return;
    const editing = !!state._editSubId;
    const file = $("subFile").files[0];
    const note = $("subNote").value.trim();
    const checkFile = (f) => {
      if (!f.type.startsWith("image/")) { toast("이미지 파일만 업로드할 수 있습니다.", "err"); return false; }
      if (f.size > 10 * 1024 * 1024) { toast("이미지는 10MB 이하로 올려 주십시오.", "err"); return false; }
      return true;
    };
    if (!editing) {
      if (!file) { toast("스크린샷 이미지를 선택해 주십시오.", "err"); return; }
      if (!checkFile(file)) return;
    } else if (file && !checkFile(file)) {
      return;
    }
    const btn = $("subSubmit"); const orig = btn.textContent;
    btn.disabled = true; btn.textContent = editing ? "저장 중…" : "업로드 중…";
    try {
      let proof_url = null;
      if (file) {
        const ext = ((file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg").slice(0, 4);
        const path = `${state.uid}/${t.id}_${Date.now()}.${ext}`;
        const up = await withTimeout(
          state.sb.storage.from(PROOF_BUCKET).upload(path, file, { contentType: file.type, upsert: false }),
          "증빙 업로드",
        );
        if (up.error) throw up.error;
        // 비공개 버킷: 공개 URL 대신 스토리지 경로만 저장하고, 열람은 관리자 서명URL로 처리합니다.
        proof_url = path;
      }
      if (editing) {
        const patch = { proof_note: note || null };
        if (proof_url) patch.proof_url = proof_url;
        const { error } = await withTimeout(state.sb.from("airdrop_submissions").update(patch).eq("id", state._editSubId), "인증 수정");
        if (error) throw error;
        toast("인증을 수정했습니다.", "ok");
        closeSubModal();
      } else {
        const ins = await withTimeout(
          state.sb.from("airdrop_submissions").insert({ task_id: t.id, user_id: state.uid, proof_url, proof_note: note || null, status: "approved" }),
          "인증 제출",
        );
        if (ins.error) {
          if (ins.error.code === "23505" || /duplicate|unique/i.test(ins.error.message || "")) toast("이미 이 미션에 인증을 제출했습니다.", "err");
          else throw ins.error;
        } else {
          toast("인증 제출 완료! 응모권이 즉시 지급되었습니다.", "ok");
          closeSubModal();
        }
      }
      await loadMySubs();
      renderTasks(); renderTickets();
    } catch (err) {
      toast((editing ? "수정" : "제출") + " 실패: " + errText(err), "err");
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  }

  async function submitAutoTask(t) {
    if (!state.uid) { toast("인증하려면 먼저 로그인해 주십시오.", "err"); doLogin(); return; }
    if (!requireNickname()) return;
    if ((t.verify_method || "capture") === "onchain" && !hasWallet()) {
      toast("온체인 인증을 위해 먼저 프로필에서 에어드랍 지갑을 추가해 주십시오.", "err");
      flashProfile();
      return;
    }
    try {
      const note = (t.verify_method || "capture") === "onchain"
        ? `wallets:${(state.wallets || []).map((w) => w.address).join(",")}`
        : "telegram:auto-verify-requested";
      const { error } = await withTimeout(
        state.sb.from("airdrop_submissions").insert({ task_id: t.id, user_id: state.uid, proof_note: note, status: "approved" }),
        "자동 인증 요청",
      );
      if (error) {
        if (error.code === "23505" || /duplicate|unique/i.test(error.message || "")) toast("이미 이 미션에 인증을 제출했습니다.", "err");
        else throw error;
      } else {
        toast("인증 완료! 응모권이 즉시 지급되었습니다.", "ok");
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
      await Promise.allSettled([loadAllSubs(), loadMySubs(), loadEntrants()]);
      renderReview(); renderLottery(); renderTasks(); renderTickets();
    } catch (err) {
      toast("처리 실패: " + errText(err), "err");
    }
  }

  async function recordWinners(result) {
    if (!result || !result.length) { toast("먼저 추첨을 실행해 주십시오.", "err"); return; }
    const L = lotWeekLabel();
    if (!confirm(`추첨 결과 ${result.length}명을 ${L.name}(${L.range}) 당첨자로 확정 기록합니다. 진행하시겠습니까?`)) return;
    const week = weekBounds(state.lotWeekOffset).startDate;
    const rows = result.map((e) => ({
      week_start: week,
      user_id: e.user_id,
      telegram: e.full_name || (e.email ? e.email.split("@")[0] : null),
      prize: `${e.tier} ${e.prize}`,
      entries: e.entries,
    }));
    const btn = $("confirmBtn"); if (btn) { btn.disabled = true; btn.textContent = "기록 중…"; }
    try {
      const { error } = await withTimeout(state.sb.from("raffle_winners").insert(rows), "당첨자 기록");
      if (error) throw error;
      toast(`${rows.length}명의 당첨자를 확정 기록했습니다.`, "ok");
      state.lotResult = null;
      await loadWinners();
      renderWinners(); renderLottery();
    } catch (err) {
      toast("당첨자 기록 실패: " + errText(err), "err");
      if (btn) { btn.disabled = false; btn.textContent = "✅ 당첨자 확정 기록"; }
    }
  }

  function resetEdit() {
    state._editTaskId = null;
    const btn = $("taskSubmit"); if (btn) btn.textContent = "미션 등록";
    const cancel = $("taskCancel"); if (cancel) cancel.style.display = "none";
  }
  function cancelEdit() {
    resetEdit();
    const f = $("taskForm"); if (f) f.reset();
    toast("수정을 취소했습니다.", "");
  }
  function editTask(t) {
    state._editTaskId = t.id;
    $("f_title").value = t.title || "";
    $("f_verify").value = t.verify_method || "capture";
    $("f_desc").value = t.description || "";
    $("f_steps").value = t.steps || "";
    $("f_link").value = t.link || "";
    $("f_reward").value = t.reward_note || "";
    $("f_cat").value = t.category || "";
    $("f_sort").value = (t.sort_order != null ? t.sort_order : 0);
    $("f_ends").value = toLocalInput(t.ends_at);
    const btn = $("taskSubmit"); if (btn) btn.textContent = "미션 수정";
    const cancel = $("taskCancel"); if (cancel) cancel.style.display = "";
    const form = $("taskForm"); if (form) { try { form.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) {} }
    toast(`수정 모드입니다. "${t.title || ""}" 편집 후 저장하십시오.`, "");
  }
  async function submitTask(e) {
    e.preventDefault();
    const title = $("f_title").value.trim();
    if (!title) { toast("제목을 입력해 주십시오.", "err"); return; }
    const editing = !!state._editTaskId;
    const btn = $("taskSubmit");
    btn.disabled = true; btn.textContent = editing ? "수정 중…" : "등록 중…";
    const payload = {
      title,
      verify_method: $("f_verify").value || "capture",
      description: $("f_desc").value.trim() || null,
      steps: $("f_steps").value.trim() || null,
      link: $("f_link").value.trim() || null,
      reward_note: $("f_reward").value.trim() || "응모권 +5장",
      category: $("f_cat").value.trim() || null,
      sort_order: parseInt($("f_sort").value, 10) || 0,
      ends_at: $("f_ends").value ? new Date($("f_ends").value).toISOString() : null,
    };
    try {
      if (editing) {
        // 상태(status)는 변경하지 않고 필드만 갱신합니다.
        const { error } = await withTimeout(state.sb.from("airdrop_tasks").update(payload).eq("id", state._editTaskId), "미션 수정");
        if (error) throw error;
        toast("미션을 수정했습니다.", "ok");
      } else {
        const { error } = await withTimeout(
          state.sb.from("airdrop_tasks").insert({ ...payload, status: "active", created_by: state.uid }),
          "미션 등록",
        );
        if (error) throw error;
        toast("미션이 등록되었습니다.", "ok");
      }
      resetEdit();
      e.target.reset();
      await loadTasks();
      renderTasks(); renderManage();
    } catch (err) {
      toast((editing ? "수정" : "등록") + " 실패: " + errText(err), "err");
    } finally {
      btn.disabled = false;
      btn.textContent = state._editTaskId ? "미션 수정" : "미션 등록";
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
      await Promise.allSettled([loadMySubs(), loadCheckins(), loadAllSubs(), loadEntrants(), loadWallets(), loadVisitStats()]);
      if (my !== bootToken) return;
      renderAll();
      // 관리자: 실시간 방문 통계 30초마다 갱신
      clearInterval(state._vsClock);
      if (state.isAdmin) {
        state._vsClock = setInterval(async () => { await loadVisitStats(); renderVisitStats(); }, 30000);
      }
      // self-heal: 첫 부팅 때 세션이 늦게 복원돼(INITIAL_SESSION 누락/지연) uid가 비면,
      // 잠시 뒤 한 번 더 getSession 해서 세션이 있으면 자동 재부팅(거짓 비로그인 화면 제거).
      clearTimeout(state._authRetry);
      if (!state.uid) {
        state._authRetry = setTimeout(async () => {
          try {
            let r = await withTimeout(state.sb.auth.getSession(), "세션 재확인", 5000);
            let s = r && r.data ? r.data.session : null;
            if (!s) {
              try {
                const rr = await withTimeout(state.sb.auth.refreshSession(), "세션 갱신", 6000);
                s = rr && rr.data ? rr.data.session : null;
              } catch (_) {}
            }
            if (s && s.user && !state.uid) { state.user = s.user; state.uid = s.user.id; boot(); }
          } catch (_) {}
        }, 1800);
      }
    } catch (err) {
      console.warn("[airdrop] boot failed", err);
      if (my !== bootToken) return;
      state._tasksErr = state._tasksErr || errText(err);
      state.tasksLoaded = true;
      renderAll();
    }
  }

  function init() {
    if ($("profileHead")) {
      const toggleProfile = () => {
        const open = $("profileCard").classList.toggle("expanded");
        $("profileHead").setAttribute("aria-expanded", open ? "true" : "false");
      };
      $("profileHead").onclick = toggleProfile;
      $("profileHead").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleProfile(); } });
    }
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
    if ($("taskCancel")) $("taskCancel").onclick = cancelEdit;
    if ($("admToggle")) $("admToggle").onclick = () => $("adminCard").classList.toggle("admin-open");
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("subModal") && $("subModal").classList.contains("on")) closeSubModal(); });
    state.sb.auth.onAuthStateChange((event, session) => {
      // 이벤트가 주는 세션을 직접 반영(getSession 경합에 의존하지 않음) → 로그인 즉시 인증 뷰로.
      if (session && session.user) { state.user = session.user; state.uid = session.user.id; }
      else if (event === "SIGNED_OUT") { state.user = null; state.uid = null; }
      boot();
    });
    tickCountdown();
    clearInterval(state._clock);
    state._clock = setInterval(tickCountdown, 1000);
    boot();
  }

  let tries = 0;
  renderAll();
  tickCountdown();
  loadAirdropEvents();
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
