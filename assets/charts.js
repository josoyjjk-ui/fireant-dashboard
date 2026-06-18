(function(){
  "use strict";

  var INDEX_URL = "data/v1/charts/_index.json";
  var DATA_BASE = "data/v1/charts/";
  var DEFAULT_TF = "6개월";
  var REFRESH_MS = 20000;
  var UP = "#ff5d6c";
  var DOWN = "#4d9bff";
  var FALLBACK_TIMEFRAMES = ["1일","5일","1개월","3개월","6개월","1년","2년","5년"];

  // Yahoo Finance 실시간 스트리머
  var YF = {BTC:"BTC-USD",ETH:"ETH-USD",SOL:"SOL-USD",XRP:"XRP-USD",BNB:"BNB-USD",NQ:"NQ=F",ES:"ES=F",GSPC:"^GSPC",IXIC:"^IXIC",DJI:"^DJI",KOSPI:"^KS11",KOSDAQ:"^KQ11",IRX:"^IRX",FVX:"^FVX",TNX:"^TNX",TYX:"^TYX",DXY:"DX-Y.NYB",VIX:"^VIX",GC:"GC=F",CL:"CL=F"};
  var YF_REV = {};
  Object.keys(YF).forEach(function(k){ YF_REV[YF[k]] = k; });

  // 경량 protobuf 디코더 (Yahoo Finance 웹소켓 메시지용)
  function _yfDecode(b){
    var o = {}, i = 0, n = b.length;
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    function vint(){
      var s = 0, r = 0;
      while(true){
        var x = b[i++];
        r += (x & 0x7f) * Math.pow(2, s);
        if(!(x & 0x80)) break;
        s += 7;
      }
      return r;
    }
    while(i < n){
      var tag = vint(), f = tag >> 3, wt = tag & 7;
      if(wt === 0){
        o[f] = vint();
      }else if(wt === 5){
        o[f] = dv.getFloat32(i, true);
        i += 4;
      }else if(wt === 1){
        o[f] = dv.getFloat64(i, true);
        i += 8;
      }else if(wt === 2){
        var l = vint();
        if(f === 1) o[f] = new TextDecoder().decode(b.subarray(i, i + l));
        i += l;
      }else{
        break;
      }
    }
    return o;
  }

  var wsState = {
    ws: null,
    timer: null,
    connected: false,
    retryDelay: 3000
  };

  function startLiveWS(){
    if(wsState.ws) return;
    if(document.hidden) return;

    try{
      wsState.ws = new WebSocket("wss://streamer.finance.yahoo.com/?version=2");
      var ws = wsState.ws;

      ws.onopen = function(){
        wsState.connected = true;
        console.log("Yahoo Finance WebSocket connected");

        // 현재 cards에 있는 key들만 구독
        var symbols = [];
        state.cards.forEach(function(card){
          var sym = YF[card.key];
          if(sym) symbols.push(sym);
        });

        if(symbols.length > 0){
          ws.send(JSON.stringify({subscribe: symbols}));
        }
      };

      ws.onmessage = function(ev){
        try{
          var m = JSON.parse(ev.data);
          if(m.type === "pricing"){
            var bytes = Uint8Array.from(atob(m.message), function(c){ return c.charCodeAt(0); });
            var d = _yfDecode(bytes);
            var sym = d[1], price = d[2], chgPct = d[8];
            var key = YF_REV[sym];
            var card = key && state.cards.get(key);
            if(card && price != null){
              card.price.textContent = fmtPrice(price);
              if(chgPct != null){
                card.change.textContent = (chgPct >= 0 ? "+" : "") + chgPct.toFixed(2) + "%";
                card.change.className = "card-change mono " + (chgPct >= 0 ? "up" : "down");
              }
              if(card.lastBar && card.series){            // 실시간: 마지막 캔들 종가를 WS 가격으로 라이브 틱
                try{
                  var lb = card.lastBar;
                  lb.close = price;
                  if(price > lb.high) lb.high = price;
                  if(price < lb.low) lb.low = price;
                  card.series.update(lb);
                }catch(e){}
              }
              card.root.classList.add("live");
            }
          }
        }catch(err){
          console.warn("Yahoo WS message parse error", err);
        }
      };

      ws.onclose = function(){
        wsState.connected = false;
        wsState.ws = null;
        console.log("Yahoo Finance WebSocket closed, retrying in", wsState.retryDelay, "ms");
        if(!document.hidden){
          wsState.timer = setTimeout(startLiveWS, wsState.retryDelay);
        }
      };

      ws.onerror = function(err){
        console.warn("Yahoo Finance WebSocket error", err);
      };
    }catch(err){
      console.warn("Yahoo WebSocket init failed", err);
    }
  }

  function stopLiveWS(){
    if(wsState.timer){
      clearTimeout(wsState.timer);
      wsState.timer = null;
    }
    if(wsState.ws){
      wsState.ws.close();
      wsState.ws = null;
    }
    wsState.connected = false;
  }

  // 한국증시는 야간선물까지 24시간 갱신되는 TradingView 선물 위젯으로 대체
  // (Yahoo 무료 피드는 한국 선물 미제공 → 현물 지수는 15:30 이후 멈춤)
  // ⚠ 무료 TradingView 임베드 위젯은 KRX 선물/지수를 거래소 라이선스로 차단함
  // ("TradingView에서만 제공되는 심볼" 모달). → 비워서 기존 지수 카드로 렌더.
  var TV = {};

  var state = {
    index: null,
    timeframes: FALLBACK_TIMEFRAMES.slice(),
    cards: new Map(),
    cache: new Map(),
    io: null,
    timer: null
  };

  var el = {
    grid: document.getElementById("chartGrid"),
    generatedAt: document.getElementById("generatedAt")
  };

  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];
    });
  }

  function fmtGenerated(value){
    if(!value) return "업데이트 시간 확인 불가";
    var date = new Date(value);
    if(isNaN(date.getTime())) return String(value);
    return date.toLocaleString("ko-KR", {
      timeZone:"Asia/Seoul",
      month:"2-digit",
      day:"2-digit",
      hour:"2-digit",
      minute:"2-digit",
      hour12:false
    }) + " KST";
  }

  function fmtPrice(v){
    if(v == null || !isFinite(v)) return "-";
    var a = Math.abs(v);
    var digits = a >= 1000 ? 2 : a >= 10 ? 3 : a >= 1 ? 4 : 6;
    return Number(v).toLocaleString("en-US", {maximumFractionDigits:digits});
  }

  function calcPct(rows){
    if(!rows || rows.length < 2) return null;
    var first = rows[0];
    var last = rows[rows.length - 1];
    if(!first || !last || !isFinite(first.c) || !isFinite(last.c) || first.c === 0) return null;
    return ((last.c - first.c) / first.c) * 100;
  }

  async function fetchJSON(url, noStore){
    var res = await fetch(url, noStore ? {cache:"no-store"} : undefined);
    if(!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  function setMsg(card, text){
    if(!card.msg) return;
    card.msg.textContent = text || "";
    card.msg.classList.toggle("hide", !text);
  }

  function tvCardHtml(inst){
    var t = TV[inst.key];
    return ''+
      '<article class="chart-card tv-card" data-key="'+esc(inst.key)+'">'+
        '<div class="card-head">'+
          '<div class="card-title"><strong>'+esc(t.name)+'</strong><span class="badge">'+esc(inst.group || "한국증시")+' · TradingView</span></div>'+
          '<div class="card-quote"><span class="card-change mono" style="font-size:11px;color:#8a94a3;">야간선물 포함 24h</span></div>'+
        '</div>'+
        '<div class="tv-wrap"><div id="tv_'+esc(inst.key)+'" class="tv-widget"></div></div>'+
      '</article>';
  }

  function cardHtml(inst){
    if(TV[inst.key]) return tvCardHtml(inst);
    var buttons = state.timeframes.map(function(tf){
      var on = tf === DEFAULT_TF ? " on" : "";
      return '<button class="tf'+on+'" type="button" data-tf="'+esc(tf)+'">'+esc(tf)+'</button>';
    }).join("");
    return ''+
      '<article class="chart-card" data-key="'+esc(inst.key)+'">'+
        '<div class="card-head">'+
          '<div class="card-title"><strong>'+esc(inst.name || inst.key)+'</strong><span class="badge">'+esc(inst.group || "기타")+'</span></div>'+
          '<div class="card-quote"><span class="card-price mono">로딩 전</span><span class="card-change mono"></span></div>'+
        '</div>'+
        '<div class="tf-row">'+buttons+'</div>'+
        '<div class="mini-wrap"><div class="mini-chart"></div><div class="card-msg">스크롤하면 차트를 불러옵니다</div></div>'+
      '</article>';
  }

  var GROUP_ICON = {"코인":"🪙","선물":"📈","미국지수":"📊","한국증시":"🇰🇷","미국채 금리":"🏦","매크로":"🌐","원자재":"🛢️"};

  function renderSkeleton(){
    var instruments = state.index.instruments || [];
    // 섹터별로 묶어 그룹 헤더 + 그리드로 렌더(그룹 순서 = 등장 순서)
    var order = [], byGroup = {};
    instruments.forEach(function(inst){
      var g = inst.group || "기타";
      if(!byGroup[g]){ byGroup[g] = []; order.push(g); }
      byGroup[g].push(inst);
    });
    el.grid.innerHTML = order.map(function(g){
      var icon = GROUP_ICON[g] || "•";
      return '<section class="sector">'+
        '<h2 class="sector-hd">'+icon+' '+esc(g)+'</h2>'+
        '<div class="sector-grid">'+byGroup[g].map(cardHtml).join("")+'</div>'+
      '</section>';
    }).join("");
    // 카드 등록은 DOM 순서와 무관하게 data-key로 매칭
    var instByKey = {};
    instruments.forEach(function(i){ instByKey[i.key] = i; });
    el.grid.querySelectorAll(".chart-card").forEach(function(root){
      var inst = instByKey[root.dataset.key];
      if(!inst) return;
      if(TV[inst.key]) return; // TradingView 위젯 카드는 lightweight 등록/리프레시 제외
      var card = {
        key: inst.key,
        name: inst.name || inst.key,
        group: inst.group || "",
        tf: state.timeframes.indexOf(DEFAULT_TF) >= 0 ? DEFAULT_TF : state.timeframes[0],
        root: root,
        chartEl: root.querySelector(".mini-chart"),
        msg: root.querySelector(".card-msg"),
        price: root.querySelector(".card-price"),
        change: root.querySelector(".card-change"),
        chart: null,
        series: null,
        ro: null,
        loading: false,
        loaded: false,
        visible: false
      };
      state.cards.set(inst.key, card);
    });
    initTvWidgets();
  }

  function buildTvWidget(key){
    var t = TV[key];
    if(!t || !document.getElementById("tv_"+key)) return;
    new TradingView.widget({
      container_id: "tv_"+key,
      symbol: t.symbol,
      interval: "60",
      timezone: "Asia/Seoul",
      theme: "dark",
      style: "1",
      locale: "kr",
      autosize: true,
      hide_side_toolbar: true,
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      save_image: false,
      withdateranges: true,
      backgroundColor: "rgba(16,19,25,1)",
      gridColor: "rgba(35,41,54,0.5)"
    });
  }

  function initTvWidgets(){
    var keys = Object.keys(TV).filter(function(k){ return document.getElementById("tv_"+k); });
    if(!keys.length) return;
    function run(){ keys.forEach(buildTvWidget); }
    if(window.TradingView && window.TradingView.widget){ run(); return; }
    var s = document.createElement("script");
    s.src = "https://s3.tradingview.com/tv.js";
    s.async = true;
    s.onload = run;
    s.onerror = function(){
      keys.forEach(function(k){
        var b = document.getElementById("tv_"+k);
        if(b) b.innerHTML = '<div class="card-msg" style="position:static;background:none;">TradingView 로드 실패</div>';
      });
    };
    document.head.appendChild(s);
  }

  function chartOptions(card){
    return {
      width: Math.max(1, card.chartEl.clientWidth),
      height: 180,
      layout: {
        background: {type:"solid", color:"transparent"},
        textColor: "#8a94a3",
        fontSize: 10
      },
      grid: {
        vertLines: {color:"rgba(28,35,48,.48)"},
        horzLines: {color:"rgba(28,35,48,.48)"}
      },
      rightPriceScale: {
        visible: true,
        borderColor: "rgba(35,41,54,.75)",
        scaleMargins: {top:.12, bottom:.16}
      },
      timeScale: {
        visible: true,
        borderColor: "rgba(35,41,54,.75)",
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true
      },
      crosshair: {mode: LightweightCharts.CrosshairMode.Normal},
      localization: {locale:"ko-KR"}
    };
  }

  function ensureChart(card){
    if(card.chart) return true;
    if(!window.LightweightCharts){
      setMsg(card, "차트 라이브러리 오류");
      return false;
    }
    card.chart = LightweightCharts.createChart(card.chartEl, chartOptions(card));
    card.series = card.chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceLineVisible: false,
      lastValueVisible: true,
      priceFormat: {type:"price", precision:4, minMove:0.0001}
    });
    if("ResizeObserver" in window){
      card.ro = new ResizeObserver(function(){ resizeCard(card); });
      card.ro.observe(card.chartEl);
    }else{
      window.addEventListener("resize", function(){ resizeCard(card); });
    }
    return true;
  }

  function resizeCard(card){
    if(!card.chart || !card.chartEl) return;
    card.chart.applyOptions({width: Math.max(1, card.chartEl.clientWidth), height: 180});
  }

  async function loadData(key, noStore){
    if(!noStore && state.cache.has(key)) return state.cache.get(key);
    var data = await fetchJSON(DATA_BASE + encodeURIComponent(key) + ".json", noStore);
    state.cache.set(key, data);
    return data;
  }

  function validCandles(rows){
    return (rows || []).map(function(d){
      return {time:d.t, open:d.o, high:d.h, low:d.l, close:d.c};
    }).filter(function(d){
      return d.time && isFinite(d.open) && isFinite(d.high) && isFinite(d.low) && isFinite(d.close);
    });
  }

  function updateQuote(card, rows){
    var last = rows && rows[rows.length - 1];
    var change = calcPct(rows);
    card.price.textContent = last ? fmtPrice(last.c) : "-";
    if(change == null){
      card.change.textContent = "";
      card.change.className = "card-change mono";
      return;
    }
    card.change.textContent = (change >= 0 ? "+" : "") + change.toFixed(2) + "%";
    card.change.className = "card-change mono " + (change >= 0 ? "up" : "down");
  }

  function renderCardData(card, data){
    if(!ensureChart(card)) return;
    var rows = (data.data && data.data[card.tf]) || [];
    var candles = validCandles(rows);
    updateQuote(card, rows);
    if(!candles.length){
      setMsg(card, "데이터 준비중입니다");
      card.renderedTf = null; card.lastBar = null;
      return;
    }
    var last = candles[candles.length - 1];
    if(card.renderedTf === card.tf){
      card.series.update(last);                 // 증분 갱신 — 마지막 캔들만(점프·번쩍 없음)
    }else{
      card.series.setData(candles);             // 최초/타임프레임 변경
      card.chart.timeScale().fitContent();      // fitContent는 이때만(매 갱신 점프 제거)
      card.renderedTf = card.tf;
    }
    card.lastBar = {time:last.time, open:last.open, high:last.high, low:last.low, close:last.close};
    setMsg(card, "");
  }

  async function hydrateCard(card, noStore){
    if(card.loading) return;
    card.loading = true;
    if(!card.loaded) setMsg(card, "데이터를 불러오는 중입니다");   // 백그라운드 갱신 땐 오버레이 안 띄움(번쩍 방지)
    try{
      var data = await loadData(card.key, noStore);
      card.loaded = true;
      renderCardData(card, data);
    }catch(err){
      console.warn("chart card fetch failed", card.key, err);
      setMsg(card, "데이터 오류");
    }finally{
      card.loading = false;
    }
  }

  function setActiveTf(card, tf){
    card.tf = tf;
    card.root.querySelectorAll("[data-tf]").forEach(function(btn){
      btn.classList.toggle("on", btn.dataset.tf === tf);
    });
    var data = state.cache.get(card.key);
    if(data){
      renderCardData(card, data);
    }else{
      hydrateCard(card, false);
    }
  }

  function bindCards(){
    el.grid.addEventListener("click", function(e){
      var btn = e.target.closest("[data-tf]");
      if(!btn) return;
      var root = btn.closest("[data-key]");
      var card = root && state.cards.get(root.dataset.key);
      if(card && btn.dataset.tf !== card.tf) setActiveTf(card, btn.dataset.tf);
    });
  }

  function observeCards(){
    if("IntersectionObserver" in window){
      state.io = new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          var key = entry.target.dataset.key;
          var card = state.cards.get(key);
          if(!card) return;
          card.visible = entry.isIntersecting;
          if(entry.isIntersecting && !card.loaded) hydrateCard(card, false);
        });
      }, {root:null, rootMargin:"700px 0px", threshold:.01});
      state.cards.forEach(function(card){ state.io.observe(card.root); });
    }else{
      state.cards.forEach(function(card){
        card.visible = true;
        hydrateCard(card, false);
      });
    }
  }

  async function refreshVisible(){
    if(document.hidden) return;
    state.cards.forEach(function(card){
      if(card.visible && card.loaded && !card.loading) hydrateCard(card, true);
    });
  }

  function stopRefresh(){
    if(state.timer){
      clearInterval(state.timer);
      state.timer = null;
    }
  }

  function startRefresh(){
    stopRefresh();
    if(!document.hidden) state.timer = setInterval(refreshVisible, REFRESH_MS);
  }

  function bindVisibility(){
    document.addEventListener("visibilitychange", function(){
      if(document.hidden){
        stopRefresh();
        stopLiveWS();
      }else{
        refreshVisible();
        startRefresh();
        startLiveWS();
      }
    });
  }

  async function init(){
    try{
      state.index = await fetchJSON(INDEX_URL, true);
      state.timeframes = (state.index.timeframes && state.index.timeframes.length) ? state.index.timeframes : FALLBACK_TIMEFRAMES.slice();
      if(el.generatedAt) el.generatedAt.textContent = fmtGenerated(state.index.generated_at);
      renderSkeleton();
      bindCards();
      observeCards();
      bindVisibility();
      startRefresh();
      startLiveWS();
    }catch(err){
      console.error(err);
      if(el.generatedAt) el.generatedAt.textContent = "차트 인덱스를 불러오지 못했습니다";
      if(el.grid) el.grid.innerHTML = '<article class="chart-card"><div class="mini-wrap"><div class="card-msg">차트 인덱스 오류</div></div></article>';
    }
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  }else{
    init();
  }
})();
