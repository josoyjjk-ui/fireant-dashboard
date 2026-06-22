/* ANTINFO 방문 집계 — 의존성 없이 자체 동작합니다.
 * 세션당 1회 방문 기록(bump_visit) + 45초마다 접속 핑(ping_visit)으로 실시간 집계.
 * 통계는 관리자만 에어드랍 페이지에서 확인합니다(여기서는 표시하지 않습니다).
 * 어떤 오류도 조용히 무시합니다.
 */
(function () {
  var BASE = "https://jcuuvazpexyinjjruplc.supabase.co";
  var KEY = "sb_publishable_mRNYq6Yq9UaYT3bydRhG1w_6wswYTd4";
  var HDRS = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

  function sid() {
    try {
      var s = localStorage.getItem("antinfo_sid");
      if (!s) {
        s = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
        localStorage.setItem("antinfo_sid", s);
      }
      return s;
    } catch (_) { return "anon-" + Math.random().toString(36).slice(2, 10); }
  }
  function rpc(fn, body) {
    try { fetch(BASE + "/rest/v1/rpc/" + fn, { method: "POST", headers: HDRS, body: JSON.stringify(body || {}) }).catch(function () {}); } catch (_) {}
  }
  function run() {
    var s = sid();
    try {
      if (!sessionStorage.getItem("antinfo_visit_counted")) {
        sessionStorage.setItem("antinfo_visit_counted", "1");
        rpc("bump_visit", { p_session: s });
      } else {
        rpc("ping_visit", { p_session: s });
      }
    } catch (_) { rpc("bump_visit", { p_session: s }); }
    // 접속 유지 핑(실시간 방문자 집계)
    setInterval(function () { rpc("ping_visit", { p_session: s }); }, 45000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
