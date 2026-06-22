/* ANTINFO 사이트 전체 누적 방문 카운터 — 의존성 없이 자체 동작합니다.
 * 세션당 1회 bump_visit 로 총합을 증가시키고, get_visits 로 총합을 표시합니다.
 * 어떤 오류도 조용히 무시합니다(페이지 동작에 영향을 주지 않습니다).
 */
(function () {
  var BASE = "https://jcuuvazpexyinjjruplc.supabase.co";
  var KEY = "sb_publishable_mRNYq6Yq9UaYT3bydRhG1w_6wswYTd4";
  var HDRS = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
  var FLAG = "antinfo_visit_counted";

  function fmt(n) { return String(Number(n) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function paint(v) {
    var txt = fmt(v);
    var a = document.getElementById("visitCount"); if (a) a.textContent = txt;
    var b = document.getElementById("visitCountAdmin"); if (b) b.textContent = txt;
  }
  function post(path) {
    try { fetch(BASE + path, { method: "POST", headers: HDRS, body: "{}" }).catch(function () {}); } catch (_) {}
  }
  function run() {
    try {
      if (!sessionStorage.getItem(FLAG)) { sessionStorage.setItem(FLAG, "1"); post("/rest/v1/rpc/bump_visit"); }
      fetch(BASE + "/rest/v1/rpc/get_visits", { method: "POST", headers: HDRS, body: "{}" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (v) { if (v !== null && v !== undefined) paint(v); })
        .catch(function () {});
    } catch (_) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
