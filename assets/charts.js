(function(){
  "use strict";

  var INDEX_URL = "data/v1/charts/_index.json";
  var DATA_BASE = "data/v1/charts/";
  var DEFAULT_KEY = "BTC";
  var DEFAULT_TF = "6개월";
  var REFRESH_MS = 60000;
  var UP = "#ff5d6c";
  var DOWN = "#4d9bff";

  var state = {
    index: null,
    selectedKey: DEFAULT_KEY,
    selectedTf: DEFAULT_TF,
    cache: new Map(),
    chart: null,
    series: null,
    ro: null,
    timer: null
  };

  var el = {
    instruments: document.getElementById("instruments"),
    timeframes: document.getElementById("timeframes"),
    chart: document.getElementById("chart"),
    msg: document.getElementById("chartMsg"),
    qName: document.getElementById("qName"),
    qPrice: document.getElementById("qPrice"),
    qChange: document.getElementById("qChange")
  };

  function showMsg(text){
    if(!el.msg) return;
    el.msg.textContent = text || "";
    el.msg.classList.toggle("show", Boolean(text));
  }

  function fmtPrice(v){
    if(v == null || !isFinite(v)) return "—";
    var a = Math.abs(v);
    var digits = a >= 1000 ? 2 : a >= 10 ? 3 : 4;
    return Number(v).toLocaleString("en-US", {maximumFractionDigits: digits});
  }

  function pct(first, last){
    if(!first || !last || !isFinite(first.c) || !isFinite(last.c) || first.c === 0) return null;
    return ((last.c - first.c) / first.c) * 100;
  }

  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];
    });
  }

  async function fetchJSON(url, noStore){
    var res = await fetch(url, noStore ? {cache:"no-store"} : undefined);
    if(!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  function grouped(items){
    var groups = [];
    var byName = new Map();
    (items || []).forEach(function(item){
      var name = item.group || "기타";
      if(!byName.has(name)){
        byName.set(name, []);
        groups.push({name:name, items:byName.get(name)});
      }
      byName.get(name).push(item);
    });
    return groups;
  }

  function renderInstruments(){
    var html = grouped(state.index.instruments).map(function(group){
      var buttons = group.items.map(function(item){
        var on = item.key === state.selectedKey ? " on" : "";
        return '<button class="pill'+on+'" type="button" data-key="'+esc(item.key)+'">'+esc(item.name)+'</button>';
      }).join("");
      return '<div class="group-row"><div class="group-label">'+esc(group.name)+'</div><div class="pill-row">'+buttons+'</div></div>';
    }).join("");
    el.instruments.innerHTML = html;
  }

  function renderTimeframes(){
    var frames = state.index.timeframes || [];
    el.timeframes.innerHTML = frames.map(function(tf){
      var on = tf === state.selectedTf ? " on" : "";
      return '<button class="tf'+on+'" type="button" data-tf="'+esc(tf)+'">'+esc(tf)+'</button>';
    }).join("");
  }

  function updateButtons(){
    document.querySelectorAll("[data-key]").forEach(function(btn){
      btn.classList.toggle("on", btn.dataset.key === state.selectedKey);
    });
    document.querySelectorAll("[data-tf]").forEach(function(btn){
      btn.classList.toggle("on", btn.dataset.tf === state.selectedTf);
    });
  }

  function ensureChart(){
    if(state.chart) return true;
    if(!window.LightweightCharts){
      showMsg("차트 라이브러리를 불러오지 못했습니다");
      return false;
    }
    state.chart = LightweightCharts.createChart(el.chart, {
      width: el.chart.clientWidth,
      height: el.chart.clientHeight,
      layout: {background:{type:"solid", color:"transparent"}, textColor:"#8a94a3"},
      grid: {vertLines:{color:"rgba(28,35,48,.55)"}, horzLines:{color:"rgba(28,35,48,.55)"}},
      rightPriceScale: {visible:true, borderColor:"#232936"},
      timeScale: {visible:true, borderColor:"#232936", timeVisible:true, secondsVisible:false},
      crosshair: {mode: LightweightCharts.CrosshairMode.Normal}
    });
    state.series = state.chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceFormat: {type:"price", precision:4, minMove:0.0001}
    });
    if("ResizeObserver" in window){
      state.ro = new ResizeObserver(resizeChart);
      state.ro.observe(el.chart);
    }else{
      window.addEventListener("resize", resizeChart);
    }
    return true;
  }

  function resizeChart(){
    if(!state.chart || !el.chart) return;
    state.chart.applyOptions({width: el.chart.clientWidth, height: el.chart.clientHeight});
  }

  async function loadInstrument(key, noStore){
    if(!noStore && state.cache.has(key)) return state.cache.get(key);
    var data = await fetchJSON(DATA_BASE + encodeURIComponent(key) + ".json", noStore);
    state.cache.set(key, data);
    return data;
  }

  function currentInstrument(){
    return (state.index.instruments || []).find(function(x){ return x.key === state.selectedKey; }) || {key:state.selectedKey, name:state.selectedKey};
  }

  function updateHeader(inst, rows){
    var first = rows && rows[0];
    var last = rows && rows[rows.length - 1];
    var change = pct(first, last);
    el.qName.textContent = inst.name || inst.key;
    el.qPrice.textContent = last ? fmtPrice(last.c) : "—";
    if(change == null){
      el.qChange.textContent = "";
      el.qChange.className = "change mono";
      return;
    }
    el.qChange.textContent = (change >= 0 ? "▲ " : "▼ ") + Math.abs(change).toFixed(2) + "%";
    el.qChange.className = "change mono " + (change >= 0 ? "up" : "down");
  }

  function setData(instData){
    if(!ensureChart()) return;
    var rows = (instData.data && instData.data[state.selectedTf]) || [];
    var inst = currentInstrument();
    updateHeader(inst, rows);
    if(!rows.length){
      state.series.setData([]);
      showMsg("데이터 준비중입니다");
      return;
    }
    var candles = rows.map(function(d){
      return {time:d.t, open:d.o, high:d.h, low:d.l, close:d.c};
    }).filter(function(d){
      return d.time && isFinite(d.open) && isFinite(d.high) && isFinite(d.low) && isFinite(d.close);
    });
    state.series.setData(candles);
    state.chart.timeScale().fitContent();
    showMsg("");
  }

  async function selectInstrument(key){
    state.selectedKey = key;
    updateButtons();
    showMsg("데이터를 불러오는 중입니다");
    try{
      var data = await loadInstrument(key, false);
      setData(data);
    }catch(err){
      console.error(err);
      showMsg("차트 데이터를 불러오지 못했습니다");
    }
    restartRefresh();
  }

  function selectTimeframe(tf){
    state.selectedTf = tf;
    updateButtons();
    var data = state.cache.get(state.selectedKey);
    if(data) setData(data);
  }

  async function refreshCurrent(){
    if(document.hidden) return;
    try{
      var data = await loadInstrument(state.selectedKey, true);
      setData(data);
    }catch(err){
      console.warn("chart refresh failed", err);
    }
  }

  function stopRefresh(){
    if(state.timer){
      clearInterval(state.timer);
      state.timer = null;
    }
  }

  function restartRefresh(){
    stopRefresh();
    if(!document.hidden) state.timer = setInterval(refreshCurrent, REFRESH_MS);
  }

  function bind(){
    el.instruments.addEventListener("click", function(e){
      var btn = e.target.closest("[data-key]");
      if(btn && btn.dataset.key !== state.selectedKey) selectInstrument(btn.dataset.key);
    });
    el.timeframes.addEventListener("click", function(e){
      var btn = e.target.closest("[data-tf]");
      if(btn && btn.dataset.tf !== state.selectedTf) selectTimeframe(btn.dataset.tf);
    });
    document.addEventListener("visibilitychange", function(){
      if(document.hidden){
        stopRefresh();
      }else{
        refreshCurrent();
        restartRefresh();
      }
    });
  }

  async function init(){
    try{
      showMsg("데이터를 불러오는 중입니다");
      state.index = await fetchJSON(INDEX_URL, true);
      if((state.index.timeframes || []).indexOf(state.selectedTf) < 0){
        state.selectedTf = (state.index.timeframes || [DEFAULT_TF])[0];
      }
      renderInstruments();
      renderTimeframes();
      bind();
      await selectInstrument(state.selectedKey);
    }catch(err){
      console.error(err);
      showMsg("차트 인덱스를 불러오지 못했습니다");
    }
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  }else{
    init();
  }
})();
