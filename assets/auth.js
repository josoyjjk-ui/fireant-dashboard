/* 불개미 크립토 허브 — 인증 (Supabase + 구글 OAuth)
 * anon(publishable) 키는 클라이언트 공개용. 실제 보호는 RLS로 처리.
 * supabase-js 는 self-host(assets/vendor/supabase.js)로 로드 — 한국망 CDN 차단 회피.
 * 데스크톱(.nav)·모바일(.top) 레이아웃 모두 대응.
 */
(function () {
  const SUPABASE_URL = "https://jcuuvazpexyinjjruplc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_mRNYq6Yq9UaYT3bydRhG1w_6wswYTd4";

  function boot() {
    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    window.__sb = sb;

    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const safeURL = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };

    // 슬롯 삽입: 모바일은 .top 헤더, 데스크톱은 .nav(텔레그램 버튼 앞)
    function ensureSlot() {
      let slot = document.getElementById("authSlot");
      if (slot) return slot;
      const top = document.querySelector(".top");   // 모바일 홈(m.html) 헤더
      const nav = document.querySelector(".nav");
      const host = top || nav;
      if (!host) return null;
      const mobile = !!top;
      slot = document.createElement("span");
      slot.id = "authSlot";
      slot.dataset.mobile = mobile ? "1" : "0";
      slot.style.cssText = mobile
        ? "display:inline-flex;align-items:center;gap:6px;margin-left:10px;flex-shrink:0;"
        : "display:inline-flex;align-items:center;gap:8px;margin-right:8px;";
      if (!mobile) {
        const tg = host.querySelector(".btn");
        if (tg && tg.parentNode) { tg.parentNode.insertBefore(slot, tg); return slot; }
      }
      host.appendChild(slot);
      return slot;
    }

    const gIcon = '<svg width="15" height="15" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 5 29.5 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.6 20-21 0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 5 29.5 3 24 3 16 3 9.1 7.6 6.3 14.7z"/><path fill="#4CAF50" d="M24 45c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 36 26.7 37 24 37c-5.3 0-9.7-2.6-11.3-7l-6.5 5C9 40.3 16 45 24 45z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C41.8 36.2 44 30.6 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>';

    function renderLoggedOut(slot) {
      const mobile = slot.dataset.mobile === "1";
      const pad = mobile ? "7px 11px" : "8px 14px";
      const label = mobile ? "로그인" : "Google 로그인";
      slot.innerHTML = `<button id="loginBtn" style="display:inline-flex;align-items:center;gap:7px;padding:${pad};border-radius:9px;border:1px solid #232936;background:#fff;color:#1f2937;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap;">
        ${gIcon}${label}</button>`;
      slot.querySelector("#loginBtn").onclick = () =>
        sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.href.split("#")[0] } });
    }

    function renderLoggedIn(slot, profile, user) {
      const mobile = slot.dataset.mobile === "1";
      const name = esc((profile && profile.full_name) || user.email || "회원");
      const avatar = safeURL((profile && profile.avatar_url) || (user.user_metadata && user.user_metadata.avatar_url) || "");
      const tier = (profile && profile.tier) || "free";
      const tierBadge = tier === "premium"
        ? '<span style="font-size:10px;font-weight:800;color:#ffb547;background:#2a1c0a;padding:2px 7px;border-radius:6px;">PREMIUM</span>'
        : '<span style="font-size:10px;font-weight:800;color:#8a94a3;background:#1c2330;padding:2px 7px;border-radius:6px;">FREE</span>';
      const nameTag = mobile ? "" :
        `<span style="font-size:13px;font-weight:700;color:#e7edf3;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>`;
      slot.innerHTML = `${avatar ? `<img src="${avatar}" style="width:${mobile ? 26 : 28}px;height:${mobile ? 26 : 28}px;border-radius:50%;border:1px solid #232936;">` : ""}
        ${nameTag}
        ${tierBadge}
        <button id="logoutBtn" style="padding:6px 10px;border-radius:8px;border:1px solid #232936;background:transparent;color:#8a94a3;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap;">로그아웃</button>`;
      slot.querySelector("#logoutBtn").onclick = async () => { await sb.auth.signOut(); location.reload(); };
    }

    async function refresh() {
      const slot = ensureSlot();
      if (!slot) return;
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { renderLoggedOut(slot); return; }
      const user = session.user;
      let profile = null;
      try {
        const { data } = await sb.from("profiles").select("full_name,avatar_url,tier").eq("id", user.id).single();
        profile = data;
      } catch (e) { /* 프로필 아직 없을 수 있음 */ }
      renderLoggedIn(slot, profile, user);
      window.__user = user; window.__profile = profile;
    }

    sb.auth.onAuthStateChange(() => refresh());
    if (document.readyState !== "loading") refresh();
    else document.addEventListener("DOMContentLoaded", refresh);
  }

  // supabase-js 로드 대기(최대 ~6초) — 느린 로드/지연에도 버튼이 사라지지 않게 폴링
  let tries = 0;
  (function waitForSupabase() {
    if (window.supabase && window.supabase.createClient) { boot(); return; }
    if (tries++ > 40) { console.warn("[auth] supabase-js 미로드(시간초과)"); return; }
    setTimeout(waitForSupabase, 150);
  })();
})();
