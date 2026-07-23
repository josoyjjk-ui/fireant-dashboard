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
  // 감사 스캔 메트릭 영속 캐시: 스토리지 경로(이미지 내용 불변) 기준으로 해시/밝기 등을
  // localStorage에 저장해, 재스캔 시 원본을 다시 다운로드하지 않도록 한다(egress 절감).
  const AUDIT_METRICS_KEY = "antinfo_audit_metrics_v1";
  let _auditMetricsCache = null;
  function auditMetricsLoad() {
    if (_auditMetricsCache) return _auditMetricsCache;
    try { _auditMetricsCache = JSON.parse(localStorage.getItem(AUDIT_METRICS_KEY) || "{}") || {}; }
    catch (_) { _auditMetricsCache = {}; }
    return _auditMetricsCache;
  }
  function auditMetricsGet(pathKey) {
    if (!pathKey) return null;
    const m = auditMetricsLoad()[pathKey];
    return (m && m.ok) ? m : null;
  }
  function auditMetricsSet(pathKey, m) {
    if (!pathKey || !m || !m.ok) return;
    const cache = auditMetricsLoad();
    cache[pathKey] = m;
    try { localStorage.setItem(AUDIT_METRICS_KEY, JSON.stringify(cache)); }
    catch (_) { /* 용량 초과 시 캐시 리셋 후 1회 재시도 */
      try { const fresh = {}; fresh[pathKey] = m; localStorage.setItem(AUDIT_METRICS_KEY, JSON.stringify(fresh)); _auditMetricsCache = fresh; }
      catch (__) {}
    }
  }
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
    allSubs: [], _adminErr: null, allSubsLoaded: false,
    checkins: [], streak: 0, checkedInToday: false,
    leaderboard: [], winners: [], _winnersErr: null, _winnerNicks: {},
    events: [], _eventsErr: null, eventsLoaded: false,
    lotEntrants: [], _lotErr: null, lotLoaded: false, lotResult: null, lotResultMode: null, lotPublishedAt: null, lotDrawing: false,
    wallets: [],
    visitStats: null, _vsErr: null, _vsClock: null,
    eventWinners: [], _ewErr: null, _editEventWinnerId: null,
    auditScan: null, auditVerdicts: {},
    _subTask: null, _editSubId: null, _editTaskId: null, _clock: null,
  };
  const numfmt = (n) => String(Number(n) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csvJson = (v) => {
    try { return JSON.stringify(v ?? null); } catch (_) { return ""; }
  };
  function downloadCsv(filename, rows) {
    const body = rows.map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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
  // ISO 타임스탬프 → KST 기준 'YYYY-MM-DD' (kstToday와 동일 방식: +9h 시프트)
  function kstDateOf(iso) {
    try { return fmtDate(new Date(new Date(iso).getTime() + 9 * 3600 * 1000)); } catch (_) { return ""; }
  }
  function submittedToday(sub) { return !!(sub && sub.created_at && kstDateOf(sub.created_at) === kstToday()); }
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
      const r = await withTimeout(state.sb.auth.getSession(), "세션 확인", 8000);
      const session = r && r.data ? r.data.session : null;
      if (session && session.user) { state.user = session.user; state.uid = session.user.id; }
    } catch (_) {}
    // 폴백: 네비게이션바엔 로그인 표시인데 액세스 토큰만 만료된 경우 — refresh 토큰으로 세션 복원.
    if (!state.uid) {
      try {
        const r2 = await withTimeout(state.sb.auth.refreshSession(), "세션 갱신", 6000);
        const s2 = r2 && r2.data ? r2.data.session : null;
        if (s2 && s2.user) { state.user = s2.user; state.uid = s2.user.id; }
      } catch (_) {}
    }
    if (!state.uid) return false;
    // 늦게 복원된 세션: 프로필이 비어 있으면 채워서 requireProfile/requireNickname 오탐 방지.
    if (!state.profile) { try { await loadProfile(); } catch (_) {} }
    return true;
  }

  async function loadAuth() {
    // uid/user는 함부로 비우지 않는다. onAuthStateChange가 먼저 세션을 넣었을 수 있고,
    // getSession이 경합으로 느리면 그걸 null로 덮어 "로그인됐는데 비로그인 화면"이 뜬다.
    state.profile = null; state.isAdmin = false; state.wallets = [];
    // 리스너(onAuthStateChange)가 이미 세션을 넣었으면 getSession 재호출 없이 프로필만 로드.
    if (!state.uid) {
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
    }
    // getSession/refresh 모두 실패해도 리스너가 넣어둔 state.uid가 있으면 그대로 진행(거짓 로그아웃 방지).
    if (!state.uid) { state.user = null; return; }
    await loadProfile();
  }
  // 프로필/관리자 여부 로드 — loadAuth·ensureSession 공용
  async function loadProfile() {
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
      state.winners = latestRafflePublishRows(data || []);
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
    state.allSubs = []; state._adminErr = null; state.allSubsLoaded = false;
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
          const { data: sig } = await state.sb.storage.from(PROOF_BUCKET).createSignedUrl(proofPath(s.proof_url), 21600);
          if (sig && sig.signedUrl) s.signedUrl = sig.signedUrl;
        } catch (_) {}
      }));
    } catch (err) {
      state._adminErr = errText(err);
    } finally {
      state.allSubsLoaded = true;
    }
  }
  async function loadEntrants() {
    state.lotEntrants = []; state._lotErr = null; state.lotLoaded = false;
    state.prevWinnerIds = new Set(); state.prevWinnerCount = 0;
    if (!state.isAdmin) return;
    // 추첨은 기본 '지난 완료주(월~일)' 기준. 월요일에 눌러도 직전 주를 집계한다.
    if (state.lotWeekOffset === undefined) state.lotWeekOffset = -1;
    const { startDate, endDate } = weekBounds(state.lotWeekOffset);
    const prevWeekStart = dateAdd(startDate, -7); // 추첨 대상 주의 직전 주(겹침 방지 제외 대상)
    try {
      // 직전주 당첨자 user_id 로드 → 이번 추첨 풀에서 제외(연속 당첨 방지)
      try {
        const { data: pw } = await withTimeout(
          state.sb.from("raffle_winners").select("user_id").eq("week_start", prevWeekStart),
          "직전주 당첨자 로드",
        );
        (pw || []).forEach((r) => { if (r.user_id) state.prevWinnerIds.add(r.user_id); });
        state.prevWinnerCount = state.prevWinnerIds.size;
      } catch (_) { /* 직전주 없으면 제외 없음 */ }
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
      // 미확정 추첨 미리보기 복원(새로고침에도 결과 유지). 현재 추첨 주차와 일치할 때만.
      if (!state.lotResult || !state.lotResult.length) {
        const draft = loadDraft(startDate);
        if (draft) {
          state.lotResult = draft;
          state.lotResultMode = "draft";
          state.lotPublishedAt = null;
        } else {
          await loadPublishedRaffleResult(startDate);
        }
      }
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
  async function loadEventWinners() {
    state.eventWinners = []; state._ewErr = null;
    if (!state.isAdmin) return;
    try {
      const { data, error } = await withTimeout(
        state.sb.from("event_winners")
          .select("id,event,tier,prize,telegram,twitter,note,created_at")
          .order("event", { ascending: true })
          .order("created_at", { ascending: false }),
        "이벤트 당첨자 로드",
      );
      if (error) { state._ewErr = error.message || "오류"; return; }
      state.eventWinners = data || [];
    } catch (err) {
      state._ewErr = errText(err);
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
      // 세션은 살아있는데 첫 렌더 때 복원이 늦은 경우: 클릭 없이도 자동으로 복원 시도 → 로그인 UI로 전환.
      if (!state._ckAuto) {
        state._ckAuto = true;
        for (const delay of [400, 1500, 3500]) {
          setTimeout(async () => {
            if (state.uid) return;
            if (await ensureSession()) { await loadCheckins(); renderCheckin(); renderTickets(); renderLeaderboard(); }
          }, delay);
        }
      }
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
    const doneToday = submittedToday(sub); // 1일 1회: 오늘 제출했으면 오늘은 잠금, 내일 다시 가능
    const statusBadge = doneToday ? `<span class="badge ${st(sub.status).cls}">오늘 ${st(sub.status).txt}</span>` : "";
    const editBtn = (doneToday && sub.status === "pending")
      ? `<button class="btn-ghost" type="button" data-editsub="${esc(t.id)}">수정</button>`
      : "";
    const action = doneToday ? "" : method === "onchain"
      ? `<button class="btn-wallet" type="button" data-auto="${esc(t.id)}">지갑 주소 등록 · 인증요청</button>`
      : method === "telegram"
        ? `<button class="btn-sub" type="button" data-auto="${esc(t.id)}">자동 인증요청</button>`
        : `<button class="btn-sub" type="button" data-sub="${esc(t.id)}">✅ 인증하기</button>`;
    const rewardTxt = t.reward_note ? esc(t.reward_note) : "응모권 +5장";
    return `<div class="task"><div class="task-head"><div><div class="task-title">${esc(t.title)}</div><span class="reward">${rewardTxt} · <b>1일 1회</b></span></div><span class="vm ${vm.cls}">${vm.label}</span></div>${t.description ? `<div class="task-desc">${mdLinks(t.description)}</div>` : ""}${t.steps ? `<div class="task-steps">${mdLinks(t.steps, true)}</div>` : ""}<div class="task-foot">${t.link ? `<a class="btn-go ghost" href="${safeURL(t.link)}" target="_blank" rel="noopener">작업하러 가기 ↗</a>` : ""}${action}${editBtn}${statusBadge}${doneToday ? `<span class="dim-sm">· 내일 다시 인증할 수 있습니다</span>` : ""}</div></div>`;
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
      ? `<a class="rev-thumb-a" href="${safeURL(s.signedUrl)}" target="_blank" rel="noopener"><img class="rev-thumb" loading="lazy" decoding="async" src="${safeURL(s.signedUrl)}" alt="인증 이미지"></a>`
      : s.proof_url
        ? `<div class="rev-thumb" style="display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--dim);text-align:center;">이미지<br>로드중</div>`
        : `<div class="rev-thumb" style="display:flex;align-items:center;justify-content:center;font-size:20px;">${(s.task && s.task.verify_method) === "telegram" ? "✈️" : "🔗"}</div>`;
    return `<div class="rev-row">${thumb}<div class="rev-body"><div class="rev-task">${esc(joinTitle(s.task))}</div><div class="rev-user">${esc(joinEmail(s.user) || "익명")} · ${esc(s.status)}</div>${s.proof_note ? `<div class="rev-note">${esc(s.proof_note)}</div>` : ""}</div><div class="rev-actions"><span class="rev-status ${st(s.status).cls}">${st(s.status).txt}</span><div style="display:flex;gap:6px;"><button class="mini-btn app" type="button" data-app="${esc(s.id)}">승인</button><button class="mini-btn rej" type="button" data-rej="${esc(s.id)}">반려</button></div></div></div>`;
  }
  function entrantName(e) {
    return (e && (e.nickname || e.full_name || (e.email ? e.email.split("@")[0] : e.user_id))) || "참여자";
  }
  function raffleWinnerRow(e, week) {
    return {
      week_start: week,
      user_id: e.user_id,
      telegram: entrantName(e),
      prize: `${e.tier} ${e.prize}`,
      entries: e.entries,
    };
  }
  function splitRafflePrizeLabel(label) {
    const s = String(label || "").trim();
    const m = s.match(/^(\S+\s*(?:\d+등|참여상))\s*(.*)$/);
    return {
      tier: m ? m[1].trim() : "🎁 참여상",
      prize: m ? (m[2].trim() || "기프티콘") : (s || "기프티콘"),
    };
  }
  function publishedWinnerToResult(w) {
    const p = splitRafflePrizeLabel(w.prize);
    const u = w.user || {};
    return {
      user_id: w.user_id,
      email: u.email || "",
      full_name: u.full_name || "",
      nickname: w.telegram || u.nickname || u.full_name || "",
      checkins: 0,
      approved: 0,
      entries: Math.max(0, Number(w.entries) || 0),
      tier: p.tier,
      prize: p.prize,
      _published: true,
    };
  }
  function latestRafflePublishRows(rows) {
    const list = (rows || []).filter((w) => w && w.week_start);
    if (!list.length) return [];
    const latest = list.reduce((max, w) => {
      const t = Date.parse(w.created_at || "");
      return Number.isFinite(t) && t > max ? t : max;
    }, -Infinity);
    if (!Number.isFinite(latest)) return list;
    return list.filter((w) => Date.parse(w.created_at || "") === latest);
  }
  async function loadPublishedRaffleResult(week) {
    if (!state.isAdmin || !week) return false;
    try {
      const { data, error } = await withTimeout(
        state.sb.from("raffle_winners")
          .select("week_start,user_id,telegram,prize,entries,created_at,user:profiles(full_name,email,nickname)")
          .eq("week_start", week)
          .order("created_at", { ascending: true })
          .limit(120),
        "게시 당첨자 로드",
      );
      if (error) throw error;
      const rows = latestRafflePublishRows(data || []);
      if (!rows.length) return false;
      state.lotResult = rows.map(publishedWinnerToResult);
      state.lotResultMode = "published";
      state.lotPublishedAt = rows[0] && rows[0].created_at ? rows[0].created_at : null;
      return true;
    } catch (err) {
      console.warn("[raffle] published result restore failed", err);
      return false;
    }
  }
  function saveRaffleWinnerRows(rows, label) {
    return withTimeout(
      state.sb.from("raffle_winners").upsert(rows, { onConflict: "week_start,user_id" }),
      label,
    );
  }
  async function restoreRaffleWinnerRows(rows) {
    const restores = await Promise.all((rows || []).filter((r) => r.id).map((r) => (
      state.sb.from("raffle_winners")
        .update({ week_start: r.week_start, user_id: r.user_id, telegram: r.telegram, prize: r.prize, entries: r.entries })
        .eq("id", r.id)
    )));
    const failed = restores.find((r) => r && r.error);
    if (failed) throw failed.error;
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
  // ── 미확정 추첨 미리보기 임시저장(새로고침 대비) ──
  const DRAFT_KEY = "antinfo_raffle_draft";
  function saveDraft(week, result) {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ week, result, savedAt: Date.now() })); } catch (_) {}
  }
  function loadDraft(week) {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (d && d.week === week && Array.isArray(d.result) && d.result.length) return d.result;
    } catch (_) {}
    return null;
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (_) {} }

  function resetDraw() {
    if (!state.lotResult || !state.lotResult.length) return;
    const published = state.lotResultMode === "published";
    const msg = published
      ? "게시된 현재 당첨자 표시를 이 화면에서만 비우고 새 추첨을 준비합니다.\n(/winners 게시 기록은 삭제되지 않습니다) 진행하시겠습니까?"
      : "현재 추첨 결과를 취소하고 초기화합니다.\n(아직 확정 기록 전이라 저장된 것은 없습니다) 진행하시겠습니까?";
    if (!confirm(msg)) return;
    try { console.warn("[raffle] draw reset by admin", { week: weekBounds(state.lotWeekOffset).startDate, at: new Date().toISOString() }); } catch (_) {}
    state.lotResult = null;
    state.lotResultMode = null;
    state.lotPublishedAt = null;
    clearDraft();
    renderLottery();
    toast(published ? "현재 게시 결과 표시를 비웠습니다. 새 추첨을 실행할 수 있습니다." : "추첨을 초기화했습니다. 다시 추첨할 수 있습니다.", "ok");
  }
  function drawWinners() {
    // 1회 추첨 잠금: 이미 뽑은 상태면 재추첨 차단(취소 후 재시작만 허용)
    if (state.lotResult && state.lotResult.length) {
      toast("이미 추첨했습니다. 다시 뽑으려면 '취소(초기화)'를 먼저 누르십시오.", "err");
      return;
    }
    const all = state.lotEntrants || [];
    if (!all.length) { toast("추첨할 참여자가 없습니다.", "err"); return; }
    // 직전주 당첨자 제외(연속 당첨 방지) 후 가중 추첨
    const prev = state.prevWinnerIds || new Set();
    const pool = all.filter((e) => !prev.has(e.user_id));
    const excluded = all.length - pool.length;
    if (!pool.length) { toast("직전주 당첨자를 제외하니 추첨 대상이 없습니다.", "err"); return; }
    const n = Math.min(RAFFLE_PRIZES.length, pool.length);
    const picked = weightedDrawN(pool, n);
    state.lotResult = picked.map((e, i) => ({ ...e, tier: RAFFLE_PRIZES[i].tier, prize: RAFFLE_PRIZES[i].prize }));
    state.lotResultMode = "draft";
    state.lotPublishedAt = null;
    saveDraft(weekBounds(state.lotWeekOffset).startDate, state.lotResult); // 새로고침 대비 임시저장
    renderLottery();
    toast(`${picked.length}명 추첨 완료${excluded ? ` · 직전주 당첨자 ${excluded}명 제외됨` : ""}. 확인 후 기록하십시오.`, "ok");
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
        state.lotWeekOffset = v; state.lotResult = null; state.lotResultMode = null; state.lotPublishedAt = null; state.lotLoaded = false;
        renderLottery();
        renderAudit();
        loadEntrants().then(() => { renderLottery(); renderAudit(); });
      };
    });
    const entrants = state.lotEntrants || [];
    const count = $("lotCount"); if (count) count.textContent = entrants.length ? `(${entrants.length}명)` : "";
    if (state._lotErr) { wrap.innerHTML = toggle + `<div class="err">응모자 집계 실패: ${esc(state._lotErr)}</div>`; bindToggle(); return; }
    if (!state.lotLoaded) { wrap.innerHTML = toggle + `<div class="loading">응모자 집계 중…</div>`; bindToggle(); return; }
    const drawn = state.lotResult && state.lotResult.length;
    if (!entrants.length && !drawn) { wrap.innerHTML = toggle + `<div class="empty">${L.name} 응모권을 보유한 참여자가 없습니다.</div>`; bindToggle(); return; }
    const total = entrants.reduce((a, e) => a + e.entries, 0);
    const prizeLine = "🥇 1등 3만원 · 🥈 2등 1만원 · 🥉 3등 5천원 · 🎁 참여상 스타벅스 10명";
    const exclNote = state.prevWinnerCount ? `<br><span class="dim-sm">🚫 직전주 당첨자 ${state.prevWinnerCount}명은 추첨에서 자동 제외(연속 당첨 방지)</span>` : "";
    // 1회 추첨 잠금: 뽑기 전에만 추첨 버튼 노출. 뽑은 뒤엔 확정/취소만.
    const published = state.lotResultMode === "published";
    const publishedWhen = state.lotPublishedAt ? new Date(state.lotPublishedAt).toLocaleString("ko-KR") : "";
    const resultNote = published
      ? `· 게시됨${publishedWhen ? ` · ${esc(publishedWhen)}` : ""} · 확인용`
      : "· 확정 전(임시저장됨 · 새로고침해도 유지)";
    const drawBtnHtml = drawn
      ? `<span class="dim-sm" style="align-self:center;">${published ? "✅ 현재 게시된 당첨자입니다 — 확인 후 필요하면 새 추첨 준비를 누르십시오" : "✅ 추첨 완료 — 아래에서 확정하거나 취소하십시오"}</span>`
      : `<button class="btn-draw" type="button" id="drawBtn">🎲 가중 추첨 실행 (1회)</button>`;
    let html = toggle + `<div class="draw-bar"><div class="txt">${L.name}(${L.range}) 총 응모권 <b>${total}장</b> · 참여자 <b>${entrants.length}명</b><br><span class="dim-sm">${prizeLine}</span>${exclNote}</div>${drawBtnHtml}</div>`;
    if (state.lotResult && state.lotResult.length) {
      html += `<div class="draw-result"><div class="dr-head">🎉 추첨 결과 (${state.lotResult.length}명) <span class="dim-sm">${resultNote}</span></div><div class="draw-result-grid"><div>${state.lotResult.map((w) => `<div class="lot-row win"><span class="lot-title">${esc(w.tier)} · ${esc(entrantName(w))}</span><span class="dim-sm">${esc(w.prize)} · ${w.entries}장</span></div>`).join("")}<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">${published ? "" : `<button class="btn-draw" type="button" id="confirmBtn">✅ 당첨자 확정 기록</button>`}<button class="btn-ghost" type="button" id="resetBtn">${published ? "새 추첨 준비" : "❌ 취소(초기화)"}</button></div></div><aside class="draw-side"><div class="side-title">당첨자 명단 · 등록정보 CSV</div><div class="side-copy">${published ? "현재 /winners에 게시된 최신 당첨자 명단 기준으로 프로필, 지갑, 체크인, 미션 제출, 게시 원본 정보를 추출합니다." : "현재 1회 추첨 결과 기준으로 프로필, 지갑, 체크인, 미션 제출, 게시 원본 정보를 추출합니다. 게시 버튼은 /winners 지난주 당첨자 영역에 바로 반영합니다."}</div>${published ? "" : `<button class="btn-draw" type="button" id="publishWinnersBtn">winners 페이지 게시</button>`}<button class="btn-ghost" type="button" id="drawCsvBtn">CSV 추출</button><div class="side-list">${state.lotResult.map((w) => `<div class="side-win"><span>${esc(w.tier.replace(/[^\d가-힣]/g, "") || w.tier)}</span><span class="nm">${esc(entrantName(w))}</span><span class="pz">${esc(w.prize)}</span></div>`).join("")}</div></aside></div></div>`;
    }
    html += `<div class="lot-divlbl">참여자 목록 (응모권순)</div><div>${entrants.slice(0, 30).map((e, i) => `<div class="lot-row"><span class="lot-title">${i + 1}. ${esc(entrantName(e))}</span><span class="dim-sm">${e.entries}장 <span style="opacity:.6">(체크인 ${e.checkins}·미션 ${e.approved})</span></span></div>`).join("")}${entrants.length > 30 ? `<div class="dim-sm" style="padding:8px 2px;">외 ${entrants.length - 30}명…</div>` : ""}</div>`;
    wrap.innerHTML = html;
    bindToggle();
    const b = $("drawBtn"); if (b) b.onclick = drawWinners;
    const c = $("confirmBtn"); if (c) c.onclick = () => recordWinners(state.lotResult);
    const pub = $("publishWinnersBtn"); if (pub) pub.onclick = () => recordWinners(state.lotResult, { publish: true });
    const rs = $("resetBtn"); if (rs) rs.onclick = resetDraw;
    const csv = $("drawCsvBtn"); if (csv) csv.onclick = () => exportDrawWinnersCsv(state.lotResult, csv);
  }

  async function exportDrawWinnersCsv(result, btn) {
    if (!result || !result.length) { toast("먼저 가중 추첨 1회를 실행해 주십시오.", "err"); return; }
    const week = weekBounds(state.lotWeekOffset === undefined ? -1 : state.lotWeekOffset);
    const ids = [...new Set(result.map((w) => w.user_id).filter(Boolean))];
    const prevText = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "CSV 생성 중…"; }
    try {
      let profiles = [];
      let subs = [];
      let checkins = [];
      let wallets = [];
      let winnerRows = [];
      const warnings = [];
      const optionalCsvQuery = async (label, query) => {
        try {
          const res = await withTimeout(query, label, 12000);
          if (res.error) throw res.error;
          return res.data || [];
        } catch (err) {
          warnings.push(`${label}: ${errText(err)}`);
          console.warn(`[raffle csv] ${label} failed`, err);
          return [];
        }
      };
      if (ids.length) {
        [profiles, subs, checkins, wallets, winnerRows] = await Promise.all([
          optionalCsvQuery(
            "당첨자 프로필 로드",
            state.sb.from("profiles")
              .select("*")
              .in("id", ids),
          ),
          optionalCsvQuery(
            "당첨자 전체 미션 제출 로드",
            state.sb.from("airdrop_submissions")
              .select("*, task:airdrop_tasks(*)")
              .in("user_id", ids)
              .order("created_at", { ascending: true }),
          ),
          optionalCsvQuery(
            "당첨자 전체 체크인 로드",
            state.sb.from("daily_checkins")
              .select("*")
              .in("user_id", ids)
              .order("checkin_date", { ascending: true }),
          ),
          optionalCsvQuery(
            "당첨자 등록 지갑 로드",
            state.sb.from("airdrop_wallets")
              .select("*")
              .in("user_id", ids)
              .order("created_at", { ascending: true }),
          ),
          optionalCsvQuery(
            "당첨자 게시 기록 로드",
            state.sb.from("raffle_winners")
              .select("*")
              .eq("week_start", week.startDate)
              .in("user_id", ids)
              .order("created_at", { ascending: true }),
          ),
        ]);
      }
      const profileById = new Map(profiles.map((p) => [p.id, p]));
      const subsByUser = new Map();
      subs.forEach((s) => {
        if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, []);
        subsByUser.get(s.user_id).push(s);
      });
      const checkinsByUser = new Map();
      checkins.forEach((c) => {
        if (!checkinsByUser.has(c.user_id)) checkinsByUser.set(c.user_id, []);
        checkinsByUser.get(c.user_id).push(c);
      });
      const walletsByUser = new Map();
      wallets.forEach((w) => {
        if (!walletsByUser.has(w.user_id)) walletsByUser.set(w.user_id, []);
        walletsByUser.get(w.user_id).push(w);
      });
      const winnersByUser = new Map();
      winnerRows.forEach((w) => {
        if (!winnersByUser.has(w.user_id)) winnersByUser.set(w.user_id, []);
        winnersByUser.get(w.user_id).push(w);
      });
      const header = [
        "rank", "week_start", "week_end", "tier", "prize", "entries", "checkins", "approved_missions",
        "닉네임", "휴대전화번호", "이메일", "텔레아이디", "트위터아이디", "유튜브아이디", "지갑주소",
        "user_id", "profile_id", "nickname", "full_name", "email", "phone", "telegram_handle", "twitter_handle", "youtube_handle", "wallet_address",
        "wallet_count", "wallet_addresses",
        "week_checkin_count", "week_checkin_dates", "all_checkin_count", "all_checkin_dates",
        "week_submission_count", "week_approved_count", "all_submission_count", "all_approved_count",
        "week_missions", "week_submission_statuses", "week_proof_urls", "week_proof_notes", "week_proof_signed_urls",
        "all_missions", "all_submission_statuses", "all_proof_urls", "all_proof_notes",
        "raffle_winner_records",
        "profile_json", "wallets_json", "week_checkins_json", "all_checkins_json", "week_submissions_json", "all_submissions_json", "raffle_winners_json",
      ];
      const rows = [header];
      for (const [i, w] of result.entries()) {
        const p = profileById.get(w.user_id) || {};
        const userSubs = subsByUser.get(w.user_id) || [];
        const weekSubs = userSubs.filter((s) => !s.created_at || (s.created_at >= week.startIso && s.created_at < week.endIso));
        const weekApprovedSubs = weekSubs.filter((s) => s.status === "approved");
        const allApprovedSubs = userSubs.filter((s) => s.status === "approved");
        const userCheckins = checkinsByUser.get(w.user_id) || [];
        const weekCheckins = userCheckins.filter((c) => c.checkin_date >= week.startDate && c.checkin_date < week.endDate);
        const userWallets = walletsByUser.get(w.user_id) || [];
        const userWinnerRows = winnersByUser.get(w.user_id) || [];
        const nickname = p.nickname || w.nickname || "";
        const phone = p.phone || w.phone || "";
        const email = p.email || w.email || "";
        const telegramId = p.telegram_handle || p.telegram || w.telegram_handle || w.telegram || "";
        const twitterId = p.twitter_handle || p.twitter || w.twitter_handle || w.twitter || "";
        const youtubeId = p.youtube_handle || p.youtube || w.youtube_handle || w.youtube || "";
        const walletAddresses = [
          p.wallet_address,
          ...userWallets.map((row) => row.address || row.wallet_address || ""),
        ].filter(Boolean);
        const signedProofUrls = [];
        for (const s of weekSubs) {
          if (!s.proof_url) continue;
          try {
            const { data: sig } = await state.sb.storage.from(PROOF_BUCKET).createSignedUrl(proofPath(s.proof_url), 21600);
            signedProofUrls.push((sig && sig.signedUrl) || "");
          } catch (_) {
            signedProofUrls.push("");
          }
        }
        rows.push([
          i + 1,
          week.startDate,
          dateAdd(week.endDate, -1),
          w.tier || "",
          w.prize || "",
          w.entries || 0,
          w.checkins || 0,
          w.approved || 0,
          nickname,
          phone,
          email,
          telegramId,
          twitterId,
          youtubeId,
          walletAddresses.join(" / "),
          w.user_id || "",
          p.id || "",
          nickname,
          p.full_name || w.full_name || "",
          email,
          phone,
          telegramId,
          twitterId,
          youtubeId,
          p.wallet_address || "",
          userWallets.length,
          userWallets.map((row) => row.address || row.wallet_address || "").filter(Boolean).join(" / "),
          weekCheckins.length,
          weekCheckins.map((c) => c.checkin_date || "").filter(Boolean).join(" / "),
          userCheckins.length,
          userCheckins.map((c) => c.checkin_date || "").filter(Boolean).join(" / "),
          weekSubs.length,
          weekApprovedSubs.length,
          userSubs.length,
          allApprovedSubs.length,
          weekSubs.map((s) => joinTitle(s.task)).join(" / "),
          weekSubs.map((s) => `${joinTitle(s.task)}:${s.status || ""}`).join(" / "),
          weekSubs.map((s) => s.proof_url || "").filter(Boolean).join(" / "),
          weekSubs.map((s) => s.proof_note || "").filter(Boolean).join(" / "),
          signedProofUrls.filter(Boolean).join(" / "),
          userSubs.map((s) => joinTitle(s.task)).join(" / "),
          userSubs.map((s) => `${joinTitle(s.task)}:${s.status || ""}`).join(" / "),
          userSubs.map((s) => s.proof_url || "").filter(Boolean).join(" / "),
          userSubs.map((s) => s.proof_note || "").filter(Boolean).join(" / "),
          userWinnerRows.length,
          csvJson(p),
          csvJson(userWallets),
          csvJson(weekCheckins),
          csvJson(userCheckins),
          csvJson(weekSubs),
          csvJson(userSubs),
          csvJson(userWinnerRows),
        ]);
      }
      downloadCsv(`antinfo-raffle-winners-${week.startDate}.csv`, rows);
      toast(warnings.length ? `CSV 생성 완료 · 일부 추가정보 누락 ${warnings.length}건` : "수집 가능한 당첨자 정보를 CSV로 생성했습니다.", warnings.length ? "err" : "ok");
    } catch (err) {
      toast("CSV 생성 실패: " + errText(err), "err");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = prevText || "CSV 추출"; }
    }
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
  function auditRows() {
    const { startIso, endIso } = weekBounds(state.lotWeekOffset === undefined ? -1 : state.lotWeekOffset);
    const entrants = (state.lotEntrants || []).slice(0, 100);
    const topIds = new Set(entrants.map((e) => e.user_id).filter(Boolean));
    const subs = (state.allSubs || []).filter((s) => (
      topIds.has(s.user_id)
      && s.status === "approved"
      && (!s.created_at || (s.created_at >= startIso && s.created_at < endIso))
    ));
    const byUser = new Map();
    subs.forEach((s) => {
      if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
      byUser.get(s.user_id).push(s);
    });
    const globalProofs = new Map();
    subs.forEach((s) => {
      const p = proofPath(s.proof_url || "");
      if (!p) return;
      globalProofs.set(p, (globalProofs.get(p) || 0) + 1);
    });
    return entrants.map((e, idx) => {
      const proofs = byUser.get(e.user_id) || [];
      const taskCounts = {};
      proofs.forEach((s) => { taskCounts[s.task_id || "unknown"] = (taskCounts[s.task_id || "unknown"] || 0) + 1; });
      const captureProofs = proofs.filter((s) => (s.task && s.task.verify_method) === "capture");
      const missingImages = captureProofs.filter((s) => !s.proof_url).length;
      const exactDupes = proofs.filter((s) => s.proof_url && globalProofs.get(proofPath(s.proof_url)) > 1).length;
      const repeatedTasks = Object.values(taskCounts).filter((n) => n > 1).length;
      const autoApproved = proofs.filter((s) => !s.proof_url && (s.task && s.task.verify_method) !== "capture").length;
      const flags = [];
      if (!proofs.length && e.approved > 0) flags.push({ cls: "bad", txt: "인증 원본 없음" });
      if (missingImages) flags.push({ cls: "bad", txt: `캡쳐 누락 ${missingImages}` });
      if (exactDupes) flags.push({ cls: "warn", txt: `동일 파일 ${exactDupes}` });
      if (repeatedTasks) flags.push({ cls: "warn", txt: `반복 미션 ${repeatedTasks}` });
      if (autoApproved) flags.push({ cls: "warn", txt: `자동승인 ${autoApproved}` });
      if (!flags.length) flags.push({ cls: "", txt: "원본 확인 필요" });
      return { entrant: e, rank: idx + 1, proofs, flags, missingImages, exactDupes, repeatedTasks, autoApproved };
    });
  }
  function auditWeekKey() {
    return weekBounds(state.lotWeekOffset === undefined ? -1 : state.lotWeekOffset).startDate;
  }
  function auditProofKey(s) {
    return [auditWeekKey(), s.user_id || "", s.id || proofPath(s.proof_url || "") || s.task_id || ""].join(":");
  }
  function auditVerdict(s) {
    return state.auditVerdicts[auditProofKey(s)] || { verdict: "", reason: "" };
  }
  function auditVerdictStoreKey() {
    return `antinfo_audit_verdicts_${auditWeekKey()}`;
  }
  function loadAuditVerdicts() {
    try { state.auditVerdicts = JSON.parse(localStorage.getItem(auditVerdictStoreKey()) || "{}") || {}; }
    catch (_) { state.auditVerdicts = {}; }
  }
  function saveAuditVerdicts() {
    try { localStorage.setItem(auditVerdictStoreKey(), JSON.stringify(state.auditVerdicts || {})); } catch (_) {}
  }
  function setAuditVerdict(key, verdict, reason) {
    state.auditVerdicts[key] = { verdict, reason: String(reason || "").trim(), at: new Date().toISOString() };
    saveAuditVerdicts();
    renderAudit();
  }
  function autoVerdictForProof(s) {
    const key = auditProofKey(s);
    const task = s.task || {};
    const method = task.verify_method || "capture";
    const scan = state.auditScan && state.auditScan.byId ? state.auditScan.byId[key] : null;
    const flags = scan && scan.flags ? scan.flags : [];
    if (method === "capture" && !s.proof_url) {
      return { verdict: "invalid", reason: "캡쳐 제출 미션인데 인증 이미지가 없음" };
    }
    if (s.proof_url && !s.signedUrl) {
      return { verdict: "hold", reason: "이미지 서명 URL을 만들 수 없어 원본 확인 불가" };
    }
    if (scan && !scan.ok) {
      return { verdict: "invalid", reason: `이미지 로드/분석 실패: ${scan.err || "오류"}` };
    }
    if (flags.some((f) => f.indexOf("거의동일") >= 0)) {
      return { verdict: "invalid", reason: "동일하거나 거의 동일한 인증 이미지를 반복 사용" };
    }
    if (flags.some((f) => f.indexOf("유사이미지") >= 0)) {
      return { verdict: "hold", reason: "다른 제출과 유사한 이미지라 중복 인증 가능성 있음" };
    }
    if (flags.some((f) => f.indexOf("저해상도") >= 0 || f.indexOf("단색/흐림") >= 0 || f.indexOf("노출이상") >= 0)) {
      return { verdict: "invalid", reason: `인증 이미지 품질 부적합: ${flags.join(" / ")}` };
    }
    if (method !== "capture" && !s.proof_url) {
      return { verdict: "valid", reason: `${vmInfo(method).label} 미션으로 이미지 제출 대상 아님` };
    }
    if (scan && scan.ok) {
      return { verdict: "valid", reason: "이미지 로드 및 기본 품질/중복 검사 통과" };
    }
    return { verdict: "hold", reason: "사진 내용 스캔 전이라 자동 판정 대기" };
  }
  function applyAutoAuditVerdicts(rows) {
    let changed = 0;
    rows.forEach((r) => {
      r.proofs.forEach((s) => {
        const key = auditProofKey(s);
        const next = autoVerdictForProof(s);
        const prev = state.auditVerdicts[key];
        if (!prev || prev.verdict !== next.verdict || prev.reason !== next.reason) {
          state.auditVerdicts[key] = { ...next, at: new Date().toISOString(), source: "auto" };
          changed += 1;
        }
      });
    });
    if (changed) saveAuditVerdicts();
    return changed;
  }
  function rowAutoVerdict(r) {
    if (!r.proofs.length && r.entrant.approved > 0) {
      return { verdict: "invalid", reason: "승인 미션 수는 있으나 확인 가능한 제출 원본이 없음" };
    }
    if (!r.proofs.length) return { verdict: "valid", reason: "사진 제출 미션 없음" };
    const verdicts = r.proofs.map((s) => auditVerdict(s).verdict || "hold");
    if (verdicts.includes("invalid")) return { verdict: "invalid", reason: "부적격 인증 이미지 포함" };
    if (verdicts.includes("hold")) return { verdict: "hold", reason: "확인 불가 또는 중복 의심 인증 포함" };
    return { verdict: "valid", reason: "상위 참여자 제출 이미지 자동 검사 통과" };
  }
  function hamming(a, b) {
    if (!a || !b || a.length !== b.length) return 999;
    let n = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) n += 1;
    return n;
  }
  function imageMetrics(url) {
    return new Promise((resolve) => {
      const img = new Image();
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const timer = setTimeout(() => finish({ ok: false, err: "로드 시간초과" }), 9000);
      img.crossOrigin = "anonymous";
      img.onload = () => {
        clearTimeout(timer);
        try {
          const c = document.createElement("canvas");
          c.width = 16; c.height = 16;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, 16, 16);
          const px = ctx.getImageData(0, 0, 16, 16).data;
          const gray = [];
          let sum = 0;
          for (let i = 0; i < px.length; i += 4) {
            const g = Math.round(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
            gray.push(g); sum += g;
          }
          const avg = sum / gray.length;
          const hash = gray.map((g) => (g >= avg ? "1" : "0")).join("");
          const variance = gray.reduce((a, g) => a + Math.pow(g - avg, 2), 0) / gray.length;
          let edge = 0;
          for (let y = 0; y < 16; y += 1) {
            for (let x = 1; x < 16; x += 1) edge += Math.abs(gray[y * 16 + x] - gray[y * 16 + x - 1]);
          }
          finish({ ok: true, w: img.naturalWidth, h: img.naturalHeight, hash, brightness: Math.round(avg), contrast: Math.round(Math.sqrt(variance)), edge: Math.round(edge / 240) });
        } catch (err) {
          finish({ ok: false, err: errText(err) });
        }
      };
      img.onerror = () => { clearTimeout(timer); finish({ ok: false, err: "이미지 로드 실패" }); };
      img.src = url;
    });
  }
  async function scanAuditImages(rows) {
    const proofs = [];
    rows.forEach((r) => r.proofs.forEach((s) => { if (s.signedUrl) proofs.push(s); }));
    state.auditScan = { running: true, done: 0, total: proofs.length, byId: {}, dupes: [] };
    renderAudit();
    const hashRows = [];
    const batch = 6;
    for (let i = 0; i < proofs.length; i += batch) {
      const part = proofs.slice(i, i + batch);
      await Promise.all(part.map(async (s) => {
        const key = auditProofKey(s);
        const pathKey = proofPath(s.proof_url || "");
        // 캐시에 있으면 원본 재다운로드 없이 재사용(egress 절감), 없을 때만 다운로드해 분석
        let m = auditMetricsGet(pathKey);
        if (!m) {
          m = await imageMetrics(s.signedUrl);
          if (m && m.ok) auditMetricsSet(pathKey, m);
        }
        const flags = [];
        if (!m.ok) flags.push(`분석불가:${m.err || "오류"}`);
        else {
          if (m.w < 320 || m.h < 240) flags.push("저해상도");
          if (m.contrast < 10) flags.push("단색/흐림");
          if (m.brightness < 18 || m.brightness > 238) flags.push("노출이상");
          hashRows.push({ key, hash: m.hash, user_id: s.user_id, task_id: s.task_id });
        }
        state.auditScan.byId[key] = { ...m, flags };
        state.auditScan.done += 1;
      }));
      renderAudit();
    }
    const dupes = [];
    for (let i = 0; i < hashRows.length; i += 1) {
      for (let j = i + 1; j < hashRows.length; j += 1) {
        const d = hamming(hashRows[i].hash, hashRows[j].hash);
        if (d <= 10) {
          dupes.push({ a: hashRows[i].key, b: hashRows[j].key, distance: d });
          const label = d <= 4 ? "거의동일" : "유사이미지";
          state.auditScan.byId[hashRows[i].key].flags.push(label);
          state.auditScan.byId[hashRows[j].key].flags.push(label);
        }
      }
    }
    Object.values(state.auditScan.byId).forEach((r) => { r.flags = Array.from(new Set(r.flags || [])); });
    state.auditScan.dupes = dupes;
    state.auditScan.running = false;
    const changed = applyAutoAuditVerdicts(rows);
    toast(`자동 판정 완료: ${changed}건 갱신`, "ok");
    renderAudit();
  }
  function renderAudit() {
    const wrap = $("auditWrap");
    if (!wrap || !state.isAdmin) return;
    loadAuditVerdicts();
    const count = $("auditCount");
    if (state._lotErr) { wrap.innerHTML = `<div class="err">응모자 집계 실패: ${esc(state._lotErr)}</div>`; return; }
    if (state._adminErr) { wrap.innerHTML = `<div class="err">제출 원본 로드 실패: ${esc(state._adminErr)}</div>`; return; }
    if (!state.lotLoaded) { wrap.innerHTML = `<div class="loading">상위 100명 집계 중...</div>`; return; }
    if (!state.allSubsLoaded) { wrap.innerHTML = `<div class="loading">인증 원본 로드 중...</div>`; return; }
    const rows = auditRows();
    if (count) count.textContent = rows.length ? `(${rows.length}명)` : "";
    if (!rows.length) { wrap.innerHTML = `<div class="empty">검증할 상위 참여자가 없습니다.</div>`; return; }
    const totalEntries = (state.lotEntrants || []).reduce((a, e) => a + e.entries, 0);
    const flagged = rows.filter((r) => r.flags.some((f) => f.cls === "bad" || f.cls === "warn")).length;
    const proofCount = rows.reduce((a, r) => a + r.proofs.length, 0);
    const captureMissing = rows.reduce((a, r) => a + r.missingImages, 0);
    const participantVerdicts = rows.map(rowAutoVerdict);
    const invalidCount = participantVerdicts.filter((v) => v.verdict === "invalid").length;
    const holdCount = participantVerdicts.filter((v) => v.verdict === "hold").length;
    const validCount = participantVerdicts.filter((v) => v.verdict === "valid").length;
    const scan = state.auditScan;
    const scanned = scan ? scan.done : 0;
    const autoFlags = scan ? Object.values(scan.byId || {}).filter((r) => (r.flags || []).length).length : 0;
    const L = lotWeekLabel();
    const summary = `<div class="audit-summary">`
      + `<div class="audit-stat"><div class="l">대상 주차</div><div class="v">${esc(L.range)}</div></div>`
      + `<div class="audit-stat"><div class="l">상위 검증</div><div class="v">${rows.length}명</div></div>`
      + `<div class="audit-stat ok"><div class="l">자동 적격</div><div class="v">${validCount}명</div></div>`
      + `<div class="audit-stat warn"><div class="l">부적격/보류</div><div class="v">${invalidCount + holdCount}명</div></div>`
      + `</div>`;
    const scanText = scan
      ? (scan.running ? `사진 스캔 중 ${scanned}/${scan.total}` : `사진 스캔 완료 ${scanned}/${scan.total} · 유사쌍 ${scan.dupes.length}건 · 자동플래그 ${autoFlags}건`)
      : "사진 스캔 미실행";
    const tools = `<div class="audit-tools"><div class="dim-sm">총 응모권 ${numfmt(totalEntries)}장 · 승인 제출 ${proofCount}건 · ${scanText} · 자동 부적격 ${invalidCount}명 · 자동 보류 ${holdCount}명${captureMissing ? ` · 캡쳐 누락 ${captureMissing}건` : ""}</div><div class="audit-actions"><button class="btn-ghost" type="button" id="auditScan"${scan && scan.running ? " disabled" : ""}>자동 판정 실행</button><button class="btn-ghost" type="button" id="auditCsv">판정 CSV</button></div></div>`;
    wrap.innerHTML = summary + tools + `<div class="audit-list">${rows.map((r) => auditRowHtml(r)).join("")}</div>`;
    const b = $("auditCsv"); if (b) b.onclick = () => exportAuditCsv(rows);
    const s = $("auditScan"); if (s) s.onclick = () => scanAuditImages(rows);
  }
  function auditRowHtml(r) {
    const e = r.entrant;
    const rowVerdict = rowAutoVerdict(r);
    const rowCls = rowVerdict.verdict === "valid" ? "ok" : rowVerdict.verdict === "invalid" ? "bad" : "warn";
    const flags = r.flags.map((f) => `<span class="audit-flag ${f.cls}">${esc(f.txt)}</span>`).join("");
    const proofs = r.proofs.slice(0, 12).map((s) => {
      const title = joinTitle(s.task);
      const key = auditProofKey(s);
      const verdict = auditVerdict(s);
      const scan = state.auditScan && state.auditScan.byId ? state.auditScan.byId[key] : null;
      const scanFlags = scan && scan.flags && scan.flags.length ? `<div class="pflags">${scan.flags.map((f) => `<span class="audit-flag ${f.indexOf("동일") >= 0 || f.indexOf("유사") >= 0 ? "warn" : "bad"}">${esc(f)}</span>`).join("")}</div>` : "";
      const vCls = verdict.verdict ? ` verdict-${verdict.verdict}` : "";
      const vLabel = verdict.verdict === "valid" ? "적격" : verdict.verdict === "invalid" ? "부적격" : verdict.verdict === "hold" ? "보류" : "미판정";
      const controls = `<div class="vbar${vCls}"><span>자동 ${esc(vLabel)}</span></div>${verdict.reason ? `<div class="vreason">${esc(verdict.reason)}</div>` : ""}${scanFlags}`;
      if (s.proof_url && s.signedUrl) {
        return `<div class="audit-proof"><a href="${safeURL(s.signedUrl)}" target="_blank" rel="noopener"><img src="${safeURL(s.signedUrl)}" alt="인증 이미지"><div class="pmeta">${esc(title)}</div></a>${controls}</div>`;
      }
      if (s.proof_url) return `<div class="audit-proof auto">이미지 서명 URL 없음<br>${esc(title)}${controls}</div>`;
      return `<div class="audit-proof auto">${esc((s.task && VM[s.task.verify_method] && VM[s.task.verify_method].label) || "자동/무이미지")}<br>${esc(title)}${controls}</div>`;
    }).join("");
    const more = r.proofs.length > 12 ? `<div class="audit-proof auto">외 ${r.proofs.length - 12}건<br>CSV 확인</div>` : "";
    return `<div class="audit-row"><div class="audit-head"><div class="audit-rank">${r.rank}</div><div class="audit-name"><div class="n">${esc(entrantName(e))}</div><div class="m">${esc(e.email || e.user_id || "")}</div></div><div class="audit-score"><b>${numfmt(e.entries)}</b>장 · 체크인 ${numfmt(e.checkins)} · 미션 ${numfmt(e.approved)}</div></div><div class="audit-flags"><span class="audit-flag ${rowCls}">참여자 자동 ${rowVerdict.verdict === "valid" ? "적격" : rowVerdict.verdict === "invalid" ? "부적격" : "보류"}</span><span class="audit-flag ${rowCls}">${esc(rowVerdict.reason)}</span>${flags}</div><div class="audit-proofs">${proofs || `<div class="audit-proof auto">표시할 승인 인증 없음</div>`}${more}</div></div>`;
  }
  function exportAuditCsv(rows) {
    const header = ["rank", "name", "email", "user_id", "entries", "checkins", "approved", "participant_verdict", "participant_reason", "approved_proofs", "row_flags", "proof_id", "task", "proof_url", "scan_flags", "auto_verdict", "auto_reason"];
    const lines = [header.join(",")];
    rows.forEach((r) => {
      const e = r.entrant;
      const rv = rowAutoVerdict(r);
      const rowFlags = r.flags.map((f) => f.txt).join(" / ");
      const proofList = r.proofs.length ? r.proofs : [null];
      proofList.forEach((p) => {
        const key = p ? auditProofKey(p) : "";
        const scan = key && state.auditScan && state.auditScan.byId ? state.auditScan.byId[key] : null;
        const verdict = p ? auditVerdict(p) : {};
        const vals = [
          r.rank, entrantName(e), e.email || "", e.user_id || "", e.entries || 0, e.checkins || 0, e.approved || 0, rv.verdict, rv.reason, r.proofs.length, rowFlags,
          p ? p.id : "", p ? joinTitle(p.task) : "", p ? (p.proof_url || "") : "", scan ? (scan.flags || []).join(" / ") : "",
          verdict.verdict || "", verdict.reason || "",
        ];
        lines.push(vals.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
      });
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `antinfo-top100-audit-${weekBounds(state.lotWeekOffset === undefined ? -1 : state.lotWeekOffset).startDate}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  function renderAdminSection(name, fn) {
    try {
      fn();
    } catch (err) {
      console.warn(`[admin] ${name} render failed`, err);
    }
  }
  function renderAdmin() {
    const wrap = $("adminWrap");
    const gate = $("adminGate");
    if (!wrap) return;
    if (!state.uid) {
      wrap.style.display = "none";
      if (gate) gate.innerHTML = `<div class="ck-row"><div class="ck-meta">관리자 전용 페이지입니다. 관리자 계정으로 로그인해 주십시오.</div><button class="btn-sub" id="adminLogin" type="button">로그인</button></div>`;
      const b = $("adminLogin"); if (b) b.onclick = doLogin;
      return;
    }
    if (!state.isAdmin) {
      wrap.style.display = "none";
      if (gate) gate.innerHTML = `<div class="empty">관리자 전용입니다. 현재 계정에는 관리자 권한이 없습니다.</div>`;
      return;
    }
    wrap.style.display = "";
    if (gate) gate.style.display = "none";
    renderAdminSection("visit stats", renderVisitStats);
    renderAdminSection("mission manage", renderManage);
    renderAdminSection("lottery", renderLottery);
    renderAdminSection("top 100 audit", renderAudit);
    renderAdminSection("review", renderReview);
    renderAdminSection("event winners", renderEventWinners);
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

  async function openSubModal(t, editSub) {
    // 세션은 살아있는데 state.uid 복원이 늦은 경우 재로그인 강요 방지 — 복원 시도 후 진짜 없을 때만 로그인 요구.
    if (!state.uid && !(await ensureSession())) { toast("인증하려면 먼저 로그인해 주십시오.", "err"); doLogin(); return; }
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
      if (sub) sub.textContent = "완료 화면 스크린샷을 올려 주십시오. 운영진이 확인 후 승인합니다. 미션당 하루 1회 인증할 수 있습니다.";
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
          if (ins.error.code === "23505" || /duplicate|unique/i.test(ins.error.message || "")) toast("오늘은 이미 이 미션을 인증했습니다. 내일 다시 인증할 수 있습니다.", "err");
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
    if (!state.uid && !(await ensureSession())) { toast("인증하려면 먼저 로그인해 주십시오.", "err"); doLogin(); return; }
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
        if (error.code === "23505" || /duplicate|unique/i.test(error.message || "")) toast("오늘은 이미 이 미션을 인증했습니다. 내일 다시 인증할 수 있습니다.", "err");
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

  async function recordWinners(result, opts = {}) {
    if (!result || !result.length) { toast("먼저 추첨을 실행해 주십시오.", "err"); return; }
    const L = lotWeekLabel();
    const week = weekBounds(state.lotWeekOffset).startDate;
    const publishAt = new Date().toISOString();
    const rows = result.map((e) => ({ ...raffleWinnerRow(e, week), created_at: publishAt }));
    const btn = opts.publish ? $("publishWinnersBtn") : $("confirmBtn");
    const prevText = btn ? btn.textContent : "";
    try {
      const [drawRes, winRes] = await Promise.all([
        withTimeout(state.sb.from("raffle_draws").select("winner_count,committed_at").eq("week_start", week).maybeSingle(), "확정 잠금 확인"),
        withTimeout(state.sb.from("raffle_winners").select("id").eq("week_start", week).limit(1), "기존 당첨자 확인"),
      ]);
      if (drawRes && drawRes.error) throw drawRes.error;
      if (winRes && winRes.error) throw winRes.error;
      const locked = drawRes && drawRes.data;
      const hasWinners = !!(winRes && winRes.data && winRes.data.length);
      const existingCount = locked && locked.winner_count != null ? locked.winner_count : (hasWinners ? "기존" : 0);
      const actionLabel = opts.publish ? "winners 페이지에 게시" : "당첨자로 확정 기록하고 /winners에 게시";
      const replaceExisting = opts.publish && (locked || hasWinners);
      let oldRows = [];
      let clearedExistingRows = false;

      if (!replaceExisting && (locked || hasWinners)) {
        const when = locked && locked.committed_at ? new Date(locked.committed_at).toLocaleString("ko-KR") : "확정됨";
        toast(`이미 확정/게시된 주차입니다 (${existingCount}명, ${when}). /winners를 새 추첨 결과로 바꾸려면 'winners 페이지 게시'를 눌러 정정 게시하십시오.`, "err");
        return;
      }

      const msg = replaceExisting
        ? `이미 ${L.name}(${L.range}) 당첨자 ${existingCount}명이 /winners에 게시되어 있습니다.\n\n현재 추첨 결과 ${result.length}명으로 기존 게시 명단을 교체합니다. 진행하시겠습니까?`
        : `추첨 결과 ${result.length}명을 ${L.name}(${L.range}) ${actionLabel}합니다.\n\n확정 후 /winners 지난주 당첨자 영역에 표시됩니다. 진행하시겠습니까?`;
      if (!confirm(msg)) return;
      if (btn) { btn.disabled = true; btn.textContent = opts.publish ? "게시 중…" : "기록 중…"; }

      if (replaceExisting) {
        const { data: existingRows, error: oldErr } = await withTimeout(
          state.sb.from("raffle_winners").select("id,week_start,user_id,telegram,prize,entries").eq("week_start", week),
          "기존 당첨자 백업",
        );
        if (oldErr) throw oldErr;
        oldRows = existingRows || [];
        const { error: delErr } = await withTimeout(state.sb.from("raffle_winners").delete().eq("week_start", week), "기존 당첨자 삭제");
        if (delErr) {
          const { error: clearErr } = await withTimeout(
            state.sb.from("raffle_winners").update({ week_start: null }).eq("week_start", week),
            "기존 당첨자 숨김 처리",
          );
          if (clearErr) throw clearErr;
          clearedExistingRows = true;
        }
      }

      const { error } = await saveRaffleWinnerRows(rows, "당첨자 기록");
      if (error) {
        if (replaceExisting && oldRows.length) {
          try {
            if (clearedExistingRows) await restoreRaffleWinnerRows(oldRows);
            else await saveRaffleWinnerRows(oldRows, "기존 당첨자 복구");
          } catch (_) {}
        }
        throw error;
      }

      if (replaceExisting && locked) {
        try {
          await withTimeout(
            state.sb.from("raffle_draws").update({ drawn_by: state.uid, winner_count: rows.length, committed_at: new Date().toISOString() }).eq("week_start", week),
            "확정 잠금 갱신",
          );
        } catch (_) {}
      } else {
        try {
          await withTimeout(state.sb.from("raffle_draws").insert({ week_start: week, drawn_by: state.uid, winner_count: rows.length }), "확정 잠금 기록");
        } catch (_) {}
      }

      toast(replaceExisting ? `${rows.length}명의 당첨자로 /winners 게시 명단을 교체했습니다.` : `${rows.length}명의 당첨자를 확정하고 /winners에 게시했습니다.`, "ok");
      state.lotResult = rows.map(publishedWinnerToResult);
      state.lotResultMode = "published";
      state.lotPublishedAt = publishAt;
      clearDraft(); // 확정됐으니 임시저장 미리보기 제거
      await loadWinners();
      renderWinners(); renderLottery();
    } catch (err) {
      const msg = errText(err);
      const hint = /permission|policy|rls|denied|delete/i.test(msg) ? " 관리자 삭제/게시 권한을 확인해 주십시오." : "";
      toast("당첨자 게시 실패: " + msg + hint, "err");
      if (btn) { btn.disabled = false; btn.textContent = prevText || (opts.publish ? "winners 페이지 게시" : "✅ 당첨자 확정 기록"); }
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

  function resetEventWinnerEdit() {
    state._editEventWinnerId = null;
    const form = $("ewForm"); if (form) form.reset();
    const id = $("ew_id"); if (id) id.value = "";
    const btn = $("ewSubmit"); if (btn) btn.textContent = "당첨자 추가";
    const cancel = $("ewCancel"); if (cancel) cancel.style.display = "none";
  }
  function eventWinnerPayload() {
    return {
      event: (($("ew_event") && $("ew_event").value) || "").trim(),
      tier: (($("ew_tier") && $("ew_tier").value) || "").trim(),
      prize: (($("ew_prize") && $("ew_prize").value) || "").trim(),
      telegram: (($("ew_telegram") && $("ew_telegram").value) || "").trim(),
      twitter: (($("ew_twitter") && $("ew_twitter").value) || "").trim(),
      note: (($("ew_note") && $("ew_note").value) || "").trim(),
    };
  }
  function editEventWinner(w) {
    state._editEventWinnerId = w.id;
    $("ew_id").value = w.id || "";
    $("ew_event").value = w.event || "";
    $("ew_tier").value = w.tier || "";
    $("ew_prize").value = w.prize || "";
    $("ew_telegram").value = w.telegram || "";
    $("ew_twitter").value = w.twitter || "";
    $("ew_note").value = w.note || "";
    const btn = $("ewSubmit"); if (btn) btn.textContent = "당첨자 수정";
    const cancel = $("ewCancel"); if (cancel) cancel.style.display = "";
    const form = $("ewForm"); if (form) { try { form.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {} }
  }
  async function deleteEventWinner(w) {
    if (!confirm(`"${w.event}" / "${w.telegram}" 당첨자 항목을 삭제하시겠습니까?`)) return;
    try {
      const { error } = await withTimeout(state.sb.from("event_winners").delete().eq("id", w.id), "이벤트 당첨자 삭제");
      if (error) throw error;
      toast("이벤트 당첨자를 삭제했습니다.", "ok");
      await loadEventWinners();
      renderEventWinners();
    } catch (err) {
      toast("삭제 실패: " + errText(err), "err");
    }
  }
  async function submitEventWinner(e) {
    e.preventDefault();
    const payload = eventWinnerPayload();
    if (!payload.event || !payload.telegram) { toast("이벤트와 텔레그램/닉은 필수입니다.", "err"); return; }
    const btn = $("ewSubmit"); const editing = !!state._editEventWinnerId;
    if (btn) { btn.disabled = true; btn.textContent = editing ? "수정 중..." : "추가 중..."; }
    try {
      const clean = {
        event: payload.event,
        tier: payload.tier || "",
        prize: payload.prize || "",
        telegram: payload.telegram,
        twitter: payload.twitter || "",
        note: payload.note || "",
      };
      const res = editing
        ? await withTimeout(state.sb.from("event_winners").update(clean).eq("id", state._editEventWinnerId), "이벤트 당첨자 수정")
        : await withTimeout(state.sb.from("event_winners").insert({ ...clean, created_by: state.uid }), "이벤트 당첨자 추가");
      if (res.error) throw res.error;
      toast(editing ? "이벤트 당첨자를 수정했습니다." : "이벤트 당첨자를 추가했습니다.", "ok");
      resetEventWinnerEdit();
      await loadEventWinners();
      renderEventWinners();
    } catch (err) {
      toast((editing ? "수정" : "추가") + " 실패: " + errText(err), "err");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = state._editEventWinnerId ? "당첨자 수정" : "당첨자 추가"; }
    }
  }
  function renderEventWinners() {
    const wrap = $("eventWinnersWrap");
    if (!wrap || !state.isAdmin) return;
    const count = $("ewCount"); if (count) count.textContent = state.eventWinners.length ? `(${state.eventWinners.length}건)` : "";
    if (state._ewErr) { wrap.innerHTML = `<div class="err">로드 실패: ${esc(state._ewErr)}</div>`; return; }
    if (!state.eventWinners.length) { wrap.innerHTML = `<div class="empty">등록된 웹 관리 당첨자가 없습니다.</div>`; return; }
    const byEvent = {};
    state.eventWinners.forEach((w) => { (byEvent[w.event] = byEvent[w.event] || []).push(w); });
    wrap.innerHTML = Object.keys(byEvent).sort((a, b) => a.localeCompare(b)).map((ev) => (
      `<div class="wkblock"><div class="wkhead">${esc(ev)} <span class="dim-sm">· ${byEvent[ev].length}명</span></div>`
      + byEvent[ev].map((w) => `<div class="rev-row"><div class="rev-body"><div class="rev-task">${esc(w.tier || "등수 없음")} · ${esc(w.telegram)}</div><div class="rev-user">${esc(w.prize || "상품 없음")}${w.twitter ? ` · X ${esc(w.twitter)}` : ""}</div>${w.note ? `<div class="rev-note">${esc(w.note)}</div>` : ""}</div><div class="rev-actions"><div style="display:flex;gap:6px;"><button class="mini-btn app" type="button" data-ewedit="${esc(w.id)}">수정</button><button class="mini-btn rej" type="button" data-ewdel="${esc(w.id)}">삭제</button></div></div></div>`).join("")
      + `</div>`
    )).join("");
    state.eventWinners.forEach((w) => {
      const e = wrap.querySelector(`[data-ewedit="${cssEscape(w.id)}"]`);
      const d = wrap.querySelector(`[data-ewdel="${cssEscape(w.id)}"]`);
      if (e) e.onclick = () => editEventWinner(w);
      if (d) d.onclick = () => deleteEventWinner(w);
    });
  }

  let bootToken = 0;
  async function boot() {
    const my = ++bootToken;
    renderAll();
    try {
      // 세션 복원을 최우선으로 — 공개 데이터 쿼리가 navigator.locks를 먼저 점유해 getSession이 밀리는 경합 방지.
      await loadAuth();
      if (my !== bootToken) return;
      renderAll();
      await Promise.allSettled([loadTasks(), loadWinners(), loadLeaderboard()]);
      if (my !== bootToken) return;
      renderAll();
      await Promise.allSettled([loadMySubs(), loadCheckins(), loadAllSubs(), loadEntrants(), loadWallets(), loadVisitStats(), loadEventWinners()]);
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
    if ($("ewForm")) $("ewForm").onsubmit = submitEventWinner;
    if ($("ewCancel")) $("ewCancel").onclick = resetEventWinnerEdit;
    if ($("admToggle")) $("admToggle").onclick = () => $("adminCard").classList.toggle("admin-open");
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("subModal") && $("subModal").classList.contains("on")) closeSubModal(); });
    state.sb.auth.onAuthStateChange((event, session) => {
      // 이벤트가 주는 세션을 직접 반영(getSession 경합에 의존하지 않음) → 로그인 즉시 인증 뷰로.
      if (session && session.user) { state.user = session.user; state.uid = session.user.id; }
      else if (event === "SIGNED_OUT") { state.user = null; state.uid = null; }
      // ⚠️ 콜백 안에서 boot()(→getSession/쿼리)를 직접 await 경로에 태우면 navigator.locks 데드락
      // → 이후 모든 getSession 타임아웃 → "네비=로그인, 체크인=재로그인" 어긋남. setTimeout으로 락 해제 후 실행.
      setTimeout(boot, 0);
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
