/* 디자인 시안 공유 로직 — 모든 /d/N.html 공통 (테마는 각 페이지 CSS) */
const $=(id)=>document.getElementById(id);
const esc=(s)=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const safe=(u)=>{try{const x=new URL(u,location.href);return /^https?:$/.test(x.protocol)?x.href:"";}catch{return"";}};
const comma=(n,d=0)=>n==null?"—":Number(n).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const usd=(v)=>{if(v==null)return"—";const a=Math.abs(v),s=v<0?"-":"";if(a>=1e12)return`${s}$${(a/1e12).toFixed(2)}T`;if(a>=1e9)return`${s}$${(a/1e9).toFixed(1)}B`;if(a>=1e6)return`${s}$${(a/1e6).toFixed(1)}M`;return`${s}$${comma(a)}`;};
const pc=(v)=>v==null?"—":`${v>=0?"▲":"▼"} ${Math.abs(v).toFixed(2)}%`;
const kl=(v)=>v<0?"down":"up";
let MN=null,MV="g";
async function getJSON(u){const r=await fetch(u+(u.includes("?")?"&":"?")+"t="+Date.now(),{cache:"no-store"});if(!r.ok)throw 0;return r.json();}
async function loadHome(){
  try{
    const d=await getJSON("../data/v1/market_now.json");MN=d;
    let bn={};try{const a=await getJSON('https://api.binance.com/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22%2C%22ETHUSDT%22%5D');if(Array.isArray(a))a.forEach(x=>bn[x.symbol]=x);}catch{}
    const bp=bn.BTCUSDT?+bn.BTCUSDT.lastPrice:(d.btc&&d.btc.price),bc=bn.BTCUSDT?+bn.BTCUSDT.priceChangePercent:(d.btc&&d.btc.chg);
    const ep=bn.ETHUSDT?+bn.ETHUSDT.lastPrice:(d.eth&&d.eth.price),ec=bn.ETHUSDT?+bn.ETHUSDT.priceChangePercent:(d.eth&&d.eth.chg);
    $("btcPx").classList.remove("skel");$("btcPx").textContent="$"+comma(bp);
    $("btcChg").textContent=pc(bc);$("btcChg").className="chg "+kl(bc);
    $("ethPx").classList.remove("skel");$("ethPx").textContent="$"+comma(ep);
    $("ethChg").textContent=pc(ec);$("ethChg").className="chg "+kl(ec);
    const fg=d.fear_greed||{};const fgko={"Extreme Fear":"극단공포","Fear":"공포","Neutral":"중립","Greed":"탐욕","Extreme Greed":"극단탐욕"};
    const fgc=fg.value==null?"":fg.value<25?"down":fg.value>=55?"up":"";
    $("stats").innerHTML=[
      ["공포·탐욕",fg.value!=null?`${fg.value} ${fgko[fg.class]||""}`:"—",fgc],
      ["김치 프리미엄",d.kimchi!=null?(d.kimchi>=0?"+":"")+d.kimchi.toFixed(2)+"%":"—",d.kimchi>=0?"up":"down"],
      ["BTC 도미넌스",d.btc_dominance!=null?d.btc_dominance.toFixed(1)+"%":"—",""],
      ["총 시가총액",usd(d.total_mcap),""],
    ].map(([l,v,c])=>`<div class="s"><div class="l">${l}</div><div class="v mono ${c}">${v}</div></div>`).join("");
    $("ageT").textContent="갱신 "+(d.generated_at||"").slice(11,16);
    renderMovers();
  }catch(e){if($("btcChg"))$("btcChg").textContent="재시도…";}
}
function renderMovers(){
  if(!MN)return;const list=(MV==="g"?MN.gainers:MN.losers)||[];
  $("movers").innerHTML=list.map((c,i)=>`<div class="mrow">
    <div class="rk">${i+1}</div>
    <img src="${safe(c.image)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
    <div class="mn"><div class="nm">${esc(c.name)}</div><div class="sy">${esc(c.symbol)}</div></div>
    <div class="pr"><div class="p1 mono">$${comma(c.price,c.price<1?4:2)}</div><div class="p2 mono ${kl(c.chg)}">${c.chg>=0?"+":""}${c.chg.toFixed(2)}%</div></div>
  </div>`).join("");
}
async function loadSig(){
  try{
    const s=await getJSON("../data/v1/signature.json"),M=s.metrics||{};
    const defs=[["btc_etf","💵 BTC ETF 순유입",1],["dat_weekly","🏦 DAT 트레저리",1],["btc_oi_24h","📊 BTC 미결제약정",0],["cb_premium","🇺🇸 코인베이스 프리미엄",0]];
    $("sig").innerHTML=defs.map(([k,t,money])=>{const m=M[k]||{},val=m.value;const disp=money?usd(val):(m.raw??(val!=null?val+"%":"—"));const cls=val==null?"":val<0?"down":"up";return `<div class="c"><div class="t">${t}</div><div class="big mono ${cls}">${disp}</div><div class="sub">${esc((m.basis||m.as_of||"").slice(0,24))}</div></div>`;}).join("");
  }catch(e){}
}
document.addEventListener("click",e=>{const b=e.target.closest(".toggle button");if(!b)return;document.querySelectorAll(".toggle button").forEach(x=>x.classList.remove("on"));b.classList.add("on");MV=b.dataset.m;renderMovers();});
$("sig").innerHTML=Array(4).fill('<div class="c"><div class="big skel">····</div></div>').join("");
let timer=null;
function start(){stop();loadHome();loadSig();timer=setInterval(loadHome,60000);}
function stop(){clearInterval(timer);}
document.addEventListener("visibilitychange",()=>document.hidden?stop():start());
start();
