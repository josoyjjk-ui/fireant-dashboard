(function () {
  var BG = "#0a0c10";
  var FADE_MS = 90;
  var armed = false;

  function isMobileHomeRedirect() {
    try {
      var ua = navigator.userAgent || "";
      var mobile = /Android|iPhone|iPod|iPad|IEMobile|BlackBerry|Opera Mini|Mobile/i.test(ua);
      var width = Math.min(window.innerWidth || 9999, (screen && screen.width) || 9999);
      return mobile && width <= 820 && location.search.indexOf("pc") < 0;
    } catch (e) {
      return false;
    }
  }

  function ensureOverlay() {
    if (!document.getElementById("ant-nav-transition-style")) {
      var style = document.createElement("style");
      style.id = "ant-nav-transition-style";
      style.textContent =
        "html.ant-nav-leaving,html.ant-nav-leaving body{background:" + BG + "!important;}" +
        "#ant-nav-transition-cover{position:fixed;inset:0;background:" + BG + ";opacity:0;pointer-events:none;z-index:2147483647;transition:opacity " + FADE_MS + "ms ease;}" +
        "html.ant-nav-leaving #ant-nav-transition-cover{opacity:1;}" +
        "@media(prefers-reduced-motion:reduce){#ant-nav-transition-cover{transition:none;}}";
      document.head.appendChild(style);
    }
    var cover = document.getElementById("ant-nav-transition-cover");
    if (!cover) {
      cover = document.createElement("div");
      cover.id = "ant-nav-transition-cover";
      cover.setAttribute("aria-hidden", "true");
      document.body.appendChild(cover);
    }
  }

  function samePageHash(url) {
    return url.origin === location.origin &&
      url.pathname === location.pathname &&
      url.search === location.search &&
      url.hash &&
      url.hash !== location.hash;
  }

  function shouldHandleClick(event, anchor) {
    if (!anchor || event.defaultPrevented || event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (anchor.target && anchor.target !== "_self") return false;
    if (anchor.hasAttribute("download")) return false;
    var href = anchor.getAttribute("href");
    if (!href || href[0] === "#") return false;
    if (/^(mailto:|tel:|javascript:)/i.test(href)) return false;
    var url;
    try {
      url = new URL(href, location.href);
    } catch (e) {
      return false;
    }
    if (url.origin !== location.origin) return false;
    if (samePageHash(url)) return false;
    return true;
  }

  function destinationFor(anchor) {
    var url = new URL(anchor.getAttribute("href"), location.href);
    if (isMobileHomeRedirect() && url.origin === location.origin && url.pathname === "/") {
      url.pathname = "/m";
      url.search = "";
    }
    return url.href;
  }

  document.addEventListener("click", function (event) {
    var anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!shouldHandleClick(event, anchor)) return;
    var href = destinationFor(anchor);
    if (href === location.href) return;
    event.preventDefault();
    if (armed) return;
    armed = true;
    ensureOverlay();
    document.documentElement.classList.add("ant-nav-leaving");
    window.setTimeout(function () {
      window.location.assign(href);
    }, FADE_MS);
  }, true);

  window.addEventListener("pageshow", function () {
    armed = false;
    document.documentElement.classList.remove("ant-nav-leaving");
  });
})();
