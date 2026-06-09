/* 🐋 파생·고래 시그널 — Binance 선물 공개 API + 웹소켓 (무료 실시간, 키 불필요)
 * REST: 펀딩비율·미결제약정(30초) / WS: 청산(forceOrder)·고래체결(aggTrade)
 * sigbtc.pro 레퍼런스. 탭 비활성 시 WS 종료(누수 방지), 활성 시 재연결.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  if (!$("derivGrid")) return;  // 대시보드에서만 동작

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const comma = (n, d = 0) => n == null ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtUSD = (v) => {
    if (v == null) return "—";
    const a = Math.abs(v), s = v < 0 ? "-" : "";
    if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
    return `${s}$${a.toFixed(0)}`;
  };
  const hhmmss = (ms) => { const d = new Date(ms); return d.toTimeString().slice(0, 8); };

  const WHALE_TRADE = 500000;   // 고래 체결 기준 ($)
  const WHALE_LIQ = 100000;     // 고래 청산 기준 ($)
  const MAXROW = 30;

  /* ---- REST: 펀딩비율 · 미결제약정 (30초) ---- */
  let fundTimer = null;
  async function loadDeriv() {
    try {
      const get = (u) => fetch(u, { cache: "no-store" }).then((r) => r.json());
      const [fB, fE, oiB, oiE] = await Promise.all([
        get("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT"),
        get("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=ETHUSDT"),
        get("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT"),
        get("https://fapi.binance.com/fapi/v1/openInterest?symbol=ETHUSDT"),
      ]);
      const bMark = +fB.markPrice, eMark = +fE.markPrice;
      const frB = +fB.lastFundingRate * 100, frE = +fE.lastFundingRate * 100;
      const oiBUsd = +oiB.openInterest * bMark, oiEUsd = +oiE.openInterest * eMark;
      const mins = Math.max(0, Math.round((fB.nextFundingTime - Date.now()) / 60000));
      const nextTxt = `다음 정산 ${Math.floor(mins / 60)}시간 ${mins % 60}분 후`;
      const fcard = (label, fr, sub) => {
        const c = fr >= 0 ? "up" : "down";
        return `<div class="nowcard"><div class="l">${label}</div><div class="v mono ${c}">${fr >= 0 ? "+" : ""}${fr.toFixed(4)}%</div><div class="c" style="color:var(--dim)">${sub}</div></div>`;
      };
      const ocard = (label, usd, coin, sym) => `<div class="nowcard"><div class="l">${label}</div><div class="v mono">${fmtUSD(usd)}</div><div class="c" style="color:var(--dim)">${comma(coin, 0)} ${sym}</div></div>`;
      $("derivGrid").innerHTML =
        fcard("BTC 펀딩비율", frB, nextTxt) +
        fcard("ETH 펀딩비율", frE, nextTxt) +
        ocard("BTC 미결제약정", oiBUsd, +oiB.openInterest, "BTC") +
        ocard("ETH 미결제약정", oiEUsd, +oiE.openInterest, "ETH");
      $("derivAge").textContent = "실시간 · 방금 갱신";
    } catch (e) {
      if ($("derivGrid").querySelector(".skel")) $("derivGrid").innerHTML = `<div class="err">⚠️ 선물 지표 일시 오류 (재시도 중)</div>`;
    }
  }

  /* ---- WS: 청산 · 고래체결 ---- */
  let ws = null, reconnect = null;
  const liq = [], whaleLiq = [], trades = [];
  let longLiq = 0, shortLiq = 0;  // 세션 누적(청산 분포용)

  function pushRow(arr, row) { arr.unshift(row); if (arr.length > MAXROW) arr.pop(); }

  function renderLiq() {
    const el = $("liqFeed"); if (!el) return;
    el.innerHTML = liq.length ? liq.map((x) => {
      const side = x.long ? "롱 청산" : "숏 청산";  // SELL forceOrder=롱청산
      const c = x.long ? "down" : "up";
      return `<div class="feedrow"><span class="ftime">${x.t}</span><span class="fsym">${x.sym}</span><span class="${c} fside">${side}</span><span class="mono famt">${fmtUSD(x.usd)}</span></div>`;
    }).join("") : '<div class="feedempty">청산 대기중… (실시간 수신)</div>';
  }
  function renderWhaleLiq() {
    const el = $("whaleLiq"); if (!el) return;
    el.innerHTML = whaleLiq.length ? whaleLiq.map((x) => {
      const side = x.long ? "롱 청산" : "숏 청산";
      const c = x.long ? "down" : "up";
      return `<div class="feedrow"><span class="ftime">${x.t}</span><span class="fsym">${x.sym}</span><span class="${c} fside">🐋 ${side}</span><span class="mono famt">${fmtUSD(x.usd)}</span></div>`;
    }).join("") : `<div class="feedempty">≥ ${fmtUSD(WHALE_LIQ)} 대형 청산 대기중…</div>`;
  }
  function renderTrades() {
    const el = $("whaleTrades"); if (!el) return;
    el.innerHTML = trades.length ? trades.map((x) => {
      const side = x.buy ? "매수" : "매도";
      const c = x.buy ? "up" : "down";
      return `<div class="feedrow"><span class="ftime">${x.t}</span><span class="fsym">${x.sym}</span><span class="${c} fside">🐋 ${side}</span><span class="mono famt">${fmtUSD(x.usd)}</span></div>`;
    }).join("") : `<div class="feedempty">≥ ${fmtUSD(WHALE_TRADE)} 고래 체결 대기중…</div>`;
  }
  function renderMap() {
    const el = $("liqMap"); if (!el) return;
    const tot = longLiq + shortLiq;
    const lp = tot ? (longLiq / tot * 100) : 50;
    el.innerHTML = `
      <div class="mapbar"><div class="mapseg down" style="width:${lp}%"></div><div class="mapseg up" style="width:${100 - lp}%"></div></div>
      <div class="maplabels"><span class="down">롱 청산 ${fmtUSD(longLiq)}</span><span class="up">숏 청산 ${fmtUSD(shortLiq)}</span></div>
      <div class="mapnote">세션 누적 청산 분포 · 롱/숏 비율</div>`;
  }

  function onMsg(raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const d = m.data || m; const ev = d.e;
    if (ev === "forceOrder") {
      const o = d.o; const sym = (o.s || "").replace("USDT", "");
      const usd = (+o.p) * (+o.q); const long = o.S === "SELL";  // SELL=롱청산
      const row = { t: hhmmss(o.T || Date.now()), sym, usd, long };
      pushRow(liq, row); renderLiq();
      if (long) longLiq += usd; else shortLiq += usd; renderMap();
      if (usd >= WHALE_LIQ) { pushRow(whaleLiq, row); renderWhaleLiq(); }
    } else if (ev === "aggTrade") {
      const usd = (+d.p) * (+d.q);
      if (usd >= WHALE_TRADE) {
        const sym = (d.s || "").replace("USDT", "");
        pushRow(trades, { t: hhmmss(d.T || Date.now()), sym, usd, buy: !d.m });  // m=true→매수자 메이커→매도공격
        renderTrades();
      }
    }
  }

  function wsOpen() {
    wsClose();
    const streams = ["btcusdt@forceOrder", "ethusdt@forceOrder", "btcusdt@aggTrade", "ethusdt@aggTrade"].join("/");
    try { ws = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams}`); }
    catch { return; }
    ws.onmessage = (e) => onMsg(e.data);
    ws.onclose = () => { if (!document.hidden) { clearTimeout(reconnect); reconnect = setTimeout(wsOpen, 3000); } };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  function wsClose() { clearTimeout(reconnect); if (ws) { try { ws.onclose = null; ws.close(); } catch {} ws = null; } }

  /* ---- 생명주기 ---- */
  function start() {
    stopT();
    loadDeriv(); fundTimer = setInterval(loadDeriv, 30000);
    renderLiq(); renderWhaleLiq(); renderTrades(); renderMap();
    wsOpen();
  }
  function stopT() { clearInterval(fundTimer); wsClose(); }

  if (!window.__whaleInit) {
    window.__whaleInit = true;
    document.addEventListener("visibilitychange", () => { document.hidden ? stopT() : start(); });
    start();
  }
})();
