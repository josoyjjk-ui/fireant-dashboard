/* ANTINFO 이벤트 페이지 — 프로젝트 이벤트 모음 + 내 참여 정보
 * auth.js 가 만든 window.__sb 를 사용합니다.
 * 미션 인증·응모권·주간 추첨은 폐지되었습니다(2026-08). 이벤트 노출과 참여정보 관리만 남습니다.
 * 모든 Supabase 호출은 withTimeout() 으로 감싸고, boot 는 선렌더 후 진행합니다.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const safeURL = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : "#"; } catch { return "#"; } };
  const LOAD_TIMEOUT_MS = 7000;
  const errText = (err) => (err && (err.message || err.error_description || err.code)) || "오류";
  const withTimeout = (promise, label, ms = LOAD_TIMEOUT_MS) => Promise.race([
    Promise.resolve(promise),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} 시간초과`)), ms)),
  ]);
  const shortAddr = (a) => { const v = String(a || ""); return v.length > 12 ? v.slice(0, 6) + "…" + v.slice(-4) : v; };

  const state = {
    sb: null,
    user: null, uid: null, profile: null,
    events: [], _eventsErr: null, eventsLoaded: false,
    wallets: [],
  };

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
  async function ensureSession() {
    if (state.uid) return true;
    if (!state.sb) return false;
    try {
      const r = await withTimeout(state.sb.auth.getSession(), "세션 확인", 8000);
      const session = r && r.data ? r.data.session : null;
      if (session && session.user) { state.user = session.user; state.uid = session.user.id; }
    } catch (_) {}
    if (!state.uid) {
      try {
        const r2 = await withTimeout(state.sb.auth.refreshSession(), "세션 갱신", 6000);
        const s2 = r2 && r2.data ? r2.data.session : null;
        if (s2 && s2.user) { state.user = s2.user; state.uid = s2.user.id; }
      } catch (_) {}
    }
    if (!state.uid) return false;
    if (!state.profile) { try { await loadProfile(); } catch (_) {} }
    return true;
  }

  async function loadAuth() {
    // uid/user는 함부로 비우지 않는다. onAuthStateChange가 먼저 세션을 넣었을 수 있고,
    // getSession이 경합으로 느리면 그걸 null로 덮어 "로그인됐는데 비로그인 화면"이 뜬다.
    state.profile = null; state.wallets = [];
    if (!state.uid) {
      let session = null;
      for (let attempt = 0; attempt < 2 && !session; attempt++) {
        try {
          const r = await withTimeout(state.sb.auth.getSession(), "세션 확인", 10000);
          session = r && r.data ? r.data.session : null;
        } catch (_) { session = null; }
        if (!session && attempt === 0) await new Promise((res) => setTimeout(res, 400));
      }
      if (session && session.user) { state.user = session.user; state.uid = session.user.id; }
      if (!state.uid) {
        try {
          const rr = await withTimeout(state.sb.auth.refreshSession(), "세션 갱신", 6000);
          const rs = rr && rr.data ? rr.data.session : null;
          if (rs && rs.user) { state.user = rs.user; state.uid = rs.user.id; }
        } catch (_) {}
      }
    }
    if (!state.uid) { state.user = null; return; }
    await loadProfile();
  }
  async function loadProfile() {
    try {
      const { data: prof } = await withTimeout(
        state.sb.from("profiles").select("id,email,full_name,avatar_url,tier,is_admin,wallet_address,telegram_handle,twitter_handle,youtube_handle,nickname,phone").eq("id", state.uid).single(),
        "프로필 로드",
      );
      state.profile = prof || null;
    } catch (_) {
      try {
        const { data: prof } = await withTimeout(
          state.sb.from("profiles").select("id,email,full_name,avatar_url,tier,is_admin,nickname").eq("id", state.uid).single(),
          "프로필 폴백 로드",
        );
        state.profile = prof || null;
      } catch (_) {
        state.profile = null;
      }
    }
  }

  /* ── 이벤트 모음 ── */
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
    // 종료된 이벤트에 "참여하기"를 걸면 오해를 부른다 → 공지 원문 보기로 바꾼다.
    const linkLabel = evState === "ended" ? "공지 원문 보기 ↗" : "참여하기 →";
    const link = ev.link ? `<a class="go${evState === "ended" ? " ghost" : ""}" href="${safeURL(ev.link)}" target="_blank" rel="noopener">${linkLabel}</a>` : "";
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
    // 진행중·예정이 하나도 없으면(종료만 남은 경우) 페이지가 빈 화면처럼 보인다 → 안내 카드를 먼저 띄운다.
    const idle = !groups.active.length && !groups.soon.length;
    const idleCard = idle
      ? `<div class="idle-card"><div class="t">🕐 지금 진행중인 이벤트가 없습니다</div>
         <div class="s">새 프로젝트 이벤트는 준비되는 대로 이 페이지에 올라갑니다. 공지는 텔레그램 채널에서 가장 먼저 나갑니다.</div>
         <a class="go" href="https://t.me/fireant_crypto" target="_blank" rel="noopener">텔레그램 채널에서 알림 받기 →</a></div>`
      : "";
    const html = idleCard + sections.map(([key, label]) => {
      if (!groups[key].length) return "";
      if (key === "ended") {
        // 종료된 이벤트는 기본 접힘 — 진행중이 없을 때만 펼쳐서 지난 이벤트라도 보이게 한다.
        return `<details class="ended-fold"${idle ? " open" : ""}><summary class="event-group ended-summary">✅ 종료된 이벤트 ${groups[key].length}개 보기</summary>${groups[key].map((e) => eventCard(e, key)).join("")}</details>`;
      }
      return `<div class="event-group">${label}</div>${groups[key].map((e) => eventCard(e, key)).join("")}`;
    }).join("");
    wrap.innerHTML = html || `<div class="empty">현재 표시할 이벤트가 없습니다.</div>`;
  }

  /* ── 내 참여 정보 ── */
  const normHandle = (v) => (v || "").trim().replace(/^@+/, "");
  function renderProfile() {
    const wrap = $("profileBody");
    if (!wrap) return;
    if (!state.uid) {
      // 세션은 살아있는데 첫 렌더 때 복원이 늦은 경우: 클릭 없이도 자동으로 복원 시도.
      if (!state._pfAuto) {
        state._pfAuto = true;
        for (const delay of [400, 1500, 3500]) {
          setTimeout(async () => {
            if (state.uid) return;
            if (await ensureSession()) { await loadWallets(); renderProfile(); }
          }, delay);
        }
      }
      wrap.innerHTML = `<div class="ck-row"><div class="ck-meta">로그인하면 닉네임·연락처·텔레그램·X·유튜브 아이디·지갑 주소를 등록할 수 있습니다.<br>이벤트 당첨자 연락·보상 지급에 사용됩니다.</div><button class="btn-sub" id="pfLogin" type="button">로그인</button></div>`;
      const b = $("pfLogin"); if (b) b.onclick = doLogin;
      return;
    }
    const p = state.profile || {};
    const wallets = state.wallets || [];
    const walletRows = wallets.length
      ? wallets.map((w) => `<div class="ms-row" style="margin-bottom:6px;"><span class="ms-task" style="font-family:monospace;font-size:12.5px;">${esc(shortAddr(w.address))}</span><button class="mini-btn rej" type="button" data-wdel="${esc(w.id)}">삭제</button></div>`).join("")
      : `<div class="dim-sm" style="margin-bottom:6px;">등록된 지갑이 없습니다. 온체인 보상 지급에 사용됩니다.</div>`;
    const addBtn = wallets.length < 5 ? `<button class="btn-ghost" id="pfAddWallet" type="button" style="margin-top:2px;">＋ 지갑 추가</button>` : `<div class="dim-sm" style="margin-top:2px;">최대 5개까지 등록할 수 있습니다.</div>`;
    const RQ = '<span style="color:var(--accent);font-weight:900;">*</span>';
    wrap.innerHTML = `<div class="dim-sm" style="margin-bottom:12px;line-height:1.55;padding:10px 12px;background:rgba(255,181,71,.08);border:1px solid #3a2f14;border-radius:10px;">📌 지갑을 제외한 모든 항목은 <b style="color:var(--accent2)">이벤트 당첨 시 연락·보상 지급</b>에 사용됩니다. 비어 있으면 당첨되어도 지급이 어렵습니다. ${RQ} 표시는 필수입니다.</div>`
      + `<div class="af-row3"><div class="field"><label>닉네임 ${RQ} <span class="dim-sm">· 당첨자 표시</span></label><input type="text" id="pf_nick" maxlength="20" placeholder="표시될 닉네임" value="${esc(p.nickname || "")}"></div><div class="field"><label>휴대전화번호 ${RQ} <span class="dim-sm">· 보상 지급용</span></label><input type="tel" id="pf_phone" inputmode="numeric" placeholder="010-0000-0000" value="${esc(p.phone || "")}"></div><div class="field"><label>이메일 ${RQ} <span class="dim-sm">· 구글 로그인</span></label><input type="email" id="pf_email" value="${esc(p.email || "")}" readonly title="구글 로그인 이메일(수정 불가)"></div></div>`
      + `<div class="af-row3"><div class="field"><label>텔레그램 아이디 ${RQ}</label><input type="text" id="pf_tg" placeholder="@username" value="${esc(p.telegram_handle || "")}"></div><div class="field"><label>X(트위터) 아이디 ${RQ}</label><input type="text" id="pf_tw" placeholder="@username" value="${esc(p.twitter_handle || "")}"></div><div class="field"><label>유튜브 닉네임 ${RQ}</label><input type="text" id="pf_yt" placeholder="채널명 또는 @핸들" value="${esc(p.youtube_handle || "")}"></div></div>`
      + `<div class="field" style="margin-top:4px;margin-bottom:6px;"><label>보상 수령 지갑 주소 <span class="dim-sm">· 선택 · ${wallets.length}/5</span></label><div id="walletList">${walletRows}</div>${addBtn}</div>`
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
    let address = (prompt("등록할 EVM 지갑 주소를 입력해 주십시오. (0x로 시작, 42자)", "0x") || "").trim().toLowerCase();
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

  function renderAll() {
    renderProfile();
    renderAirdropEvents();
  }

  let bootToken = 0;
  async function boot() {
    const my = ++bootToken;
    renderAll();
    try {
      await loadAuth();
      if (my !== bootToken) return;
      renderAll();
      await loadWallets();
      if (my !== bootToken) return;
      renderAll();
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
      console.warn("[events] boot failed", err);
      if (my !== bootToken) return;
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
    state.sb.auth.onAuthStateChange((event, session) => {
      if (session && session.user) { state.user = session.user; state.uid = session.user.id; }
      else if (event === "SIGNED_OUT") { state.user = null; state.uid = null; }
      // ⚠️ 콜백 안에서 boot()(→getSession/쿼리)를 직접 await 경로에 태우면 navigator.locks 데드락.
      setTimeout(boot, 0);
    });
    boot();
  }

  let tries = 0;
  renderAll();
  loadAirdropEvents();
  (function waitForSb() {
    if (window.__sb) { state.sb = window.__sb; init(); return; }
    if (tries++ > 40) { renderAll(); return; }
    setTimeout(waitForSb, 150);
  })();
})();
