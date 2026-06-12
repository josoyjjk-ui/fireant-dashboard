(function(){
  "use strict";

  var INDEX_URL = "data/v1/charts/_index.json";
  var DATA_BASE = "data/v1/charts/";
  var DEFAULT_TF = "6개월";
  var REFRESH_MS = 45000;
  var UP = "#ff5d6c";
  var DOWN = "#4d9bff";
  var FALLBACK_TIMEFRAMES = ["1일","5일","1개월","3개월","6개월","1년","2년","5년"];

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

  function cardHtml(inst){
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

  function renderSkeleton(){
    var instruments = state.index.instruments || [];
    el.grid.innerHTML = instruments.map(cardHtml).join("");
    var roots = el.grid.querySelectorAll(".chart-card");
    instruments.forEach(function(inst, idx){
      var root = roots[idx];
      if(!root) return;
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
    card.series.setData(candles);
    if(candles.length){
      card.chart.timeScale().fitContent();
      setMsg(card, "");
    }else{
      setMsg(card, "데이터 준비중입니다");
    }
  }

  async function hydrateCard(card, noStore){
    if(card.loading) return;
    card.loading = true;
    setMsg(card, noStore ? "새 데이터 확인 중입니다" : "데이터를 불러오는 중입니다");
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
      }else{
        refreshVisible();
        startRefresh();
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
