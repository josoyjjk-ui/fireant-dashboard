/* ANTINFO PWA service worker
 * 원칙: 셸(HTML/CSS/JS/아이콘)만 캐시. 데이터 JSON(/data/**, *.json)은 절대 캐시하지 않음(시황·가격 고정 방지).
 * 전략: 네트워크 우선 → 실패 시(오프라인) 캐시 폴백. 등록/캐시 실패해도 사이트 동작에 영향 없음. */
var CACHE = "antinfo-shell-v1";
var SHELL = [
  "/m",
  "/manifest.json",
  "/assets/favicon-32.png",
  "/assets/apple-touch-icon.png",
  "/assets/antinfo-logo.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () {}); // 개별 실패 무시
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return; // CDN 등 외부 리소스는 관여하지 않음
  var p = url.pathname;
  // 데이터는 항상 네트워크(캐시 금지): /data/**, manifest 제외 모든 .json
  if (p.indexOf("/data/") === 0 || (p.slice(-5) === ".json" && p !== "/manifest.json")) return;

  // 셸: 네트워크 우선, 성공 시 캐시 갱신, 실패(오프라인) 시 캐시 폴백
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok && res.type === "basic") {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (m) {
        if (m) return m;
        if (req.mode === "navigate") return caches.match("/m");
        return Response.error();
      });
    })
  );
});
