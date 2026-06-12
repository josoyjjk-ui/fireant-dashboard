(function(){
  var DATA_URL='data/v1/econ_calendar.json';
  var MIN_Y=2026,MIN_M=6,MAX_Y=2026,MAX_M=8;
  var TYPE_META={
    macro:{icon:'📊',color:'var(--accent2)',label:'매크로'},
    fomc:{icon:'🏦',color:'var(--accent)',label:'FOMC'},
    labor:{icon:'👷',color:'#4d9bff',label:'고용'},
    ipo:{icon:'🚀',color:'#9acd32',label:'IPO'}
  };
  var DOW=['일','월','화','수','목','금','토'];
  var MAX_EV=3;  // 셀당 최대 표시 이벤트 수(초과분은 +N) — 모듈 스코프(cellHTML에서 참조)

  var items=[],dataRange={start:'2026-06-01',end:'2026-08-31'};
  var curYear=2026,curMonth=6;
  var today=new Date();
  var todayStr=fmtDate(today.getFullYear(),today.getMonth()+1,today.getDate());
  var selDate=null;

  var $grid=document.getElementById('calGrid');
  var $curM=document.getElementById('curM');
  var $prev=document.getElementById('prevM');
  var $next=document.getElementById('nextM');
  var $det=document.getElementById('dayDetail');
  var $upc=document.getElementById('upcoming');
  var $gen=document.getElementById('calGenAt');

  function pad(n){return n<10?'0'+n:''+n;}
  function fmtDate(y,m,d){return y+'-'+pad(m)+'-'+pad(d);}
  function fmtKST(iso){
    if(!iso)return'-';
    var d=new Date(iso);
    return d.getFullYear()+'.'+pad(d.getMonth()+1)+'.'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes())+' KST';
  }
  function fmtMD(ds){
    var p=ds.split('-');
    return parseInt(p[1])+'/'+parseInt(p[2]);
  }
  function shortTitle(t){return t.length>12?t.substring(0,11)+'…':t;}
  function daysIn(y,m){return new Date(y,m,0).getDate();}
  function parseDS(ds){var p=ds.split('-');return new Date(+p[0],+p[1]-1,+p[2]);}
  function inRange(y,m){
    var t=y*12+m-1;
    return t>=MIN_Y*12+MIN_M-1&&t<=MAX_Y*12+MAX_M-1;
  }

  function fetchCal(){
    fetch(DATA_URL+'?t='+Date.now(),{cache:'no-store'})
    .then(function(r){if(!r.ok)throw new Error(r.status);return r.json();})
    .then(function(d){
      items=d.items||[];
      if(d.range)dataRange=d.range;
      var rp=d.range&&d.range.start?d.range.start.split('-'):null;
      if(rp){MIN_Y=+rp[0];MIN_M=+rp[1];}
      var re=d.range&&d.range.end?d.range.end.split('-'):null;
      if(re){MAX_Y=+re[0];MAX_M=+re[1];}
      var now=new Date();
      var cy=now.getFullYear(),cm=now.getMonth()+1;
      if(inRange(cy,cm)){curYear=cy;curMonth=cm;}
      else{curYear=MIN_Y;curMonth=MIN_M;}
      if(d.generated_at)$gen.textContent=fmtKST(d.generated_at);
      render();
    })
    .catch(function(e){
      console.error('Calendar fetch error:',e);
      $grid.innerHTML='<div class="no-data">데이터를 불러오지 못했습니다. 잠시 후 새로고침해주세요.<br><small style="opacity:.5">'+e.message+'</small></div>';
    });
  }

  function buildMap(y,m){
    var map={};
    var ds=fmtDate(y,m,1),de=fmtDate(y,m,daysIn(y,m));
    for(var i=0;i<items.length;i++){
      var it=items[i];
      if(it.date>=ds&&it.date<=de){
        if(!map[it.date])map[it.date]=[];
        map[it.date].push(it);
      }
    }
    return map;
  }

  function render(){
    $curM.textContent=curYear+'년 '+curMonth+'월';
    $prev.disabled=!inRange(curYear,curMonth-1);
    $next.disabled=!inRange(curYear,curMonth+1);
    renderGrid();
    renderUpcoming();
    $det.innerHTML='';
    selDate=null;
  }

  function renderGrid(){
    var h='';
    for(var i=0;i<7;i++)h+='<div class="wh">'+DOW[i]+'</div>';

    var first=new Date(curYear,curMonth-1,1).getDay();
    var dim=daysIn(curYear,curMonth);
    var prevDim=curMonth>1?daysIn(curYear,curMonth-1):daysIn(curYear-1,12);

    var map=buildMap(curYear,curMonth);
    var MAX_EV=3;

    // Previous month fill
    for(var i=0;i<first;i++){
      var dn=prevDim-first+1+i;
      h+=cellHTML(dn,'oth',false,null,fmtDate(curMonth>1?curYear:curYear-1,curMonth>1?curMonth-1:12,dn),i===0);
    }
    // Current month
    for(var d=1;d<=dim;d++){
      var ds=fmtDate(curYear,curMonth,d);
      var isToday=ds===todayStr;
      var dow=(first+d-1)%7;
      var isWE=dow===0||dow===6;
      var evs=map[ds]||[];
      h+=cellHTML(d,'cur',isToday,evs,ds,isWE);
    }
    // Next month fill
    var total=first+dim;
    var rows=Math.ceil(total/7);
    var rem=rows*7-total;
    for(var i=1;i<=rem;i++){
      h+=cellHTML(i,'oth',false,null,fmtDate(curMonth<12?curYear:curYear+1,curMonth<12?curMonth+1:1,i),(total+i)%7===0||(total+i)%7===6);
    }
    $grid.innerHTML=h;
  }

  function cellHTML(dn,cls,isToday,evs,dateStr,isWE){
    var c='dc';
    if(cls==='oth')c+=' oth';
    if(isToday)c+=' today';
    if(isWE)c+=' weekend';
    if(selDate===dateStr)c+=' sel';

    var h='<div class="'+c+'" data-d="'+dateStr+'">';
    h+='<div class="dn">'+dn+'</div>';

    if(evs&&evs.length>0){
      h+='<div class="evs">';
      var mobile=window.innerWidth<=640;
      var show=Math.min(evs.length,MAX_EV);
      for(var j=0;j<show;j++){
        var ev=evs[j];
        var tm=TYPE_META[ev.type]||TYPE_META.macro;
        var hc=ev.importance==='high'?' high':'';
        if(mobile){
          h+='<div class="eb t-'+ev.type+hc+'" title="'+ev.time+' '+ev.title+'"><span class="ed t-'+ev.type+'"></span></div>';
        }else{
          h+='<div class="eb t-'+ev.type+hc+'" title="'+ev.time+' '+ev.title+'"><span class="et">'+tm.icon+'</span> '+shortTitle(ev.title)+'</div>';
        }
      }
      if(evs.length>MAX_EV)h+='<div class="em">+'+( evs.length-MAX_EV)+'</div>';
      h+='</div>';
    }
    h+='</div>';
    return h;
  }

  // Delegate clicks on grid
  $grid.addEventListener('click',function(e){
    var cell=e.target.closest('.dc');
    if(!cell)return;
    var ds=cell.getAttribute('data-d');
    if(!ds)return;
    selDate=ds;
    // Update selection highlight
    var all=$grid.querySelectorAll('.dc');
    for(var i=0;i<all.length;i++)all[i].classList.remove('sel');
    cell.classList.add('sel');
    renderDetail(ds);
  });

  function renderDetail(ds){
    var map=buildMap(curYear,curMonth);
    var evs=map[ds]||[];
    var p=ds.split('-');
    var label=parseInt(p[1])+'월 '+parseInt(p[2])+'일 ('+DOW[parseDS(ds).getDay()]+')';

    if(evs.length===0){
      $det.innerHTML='<h3>'+label+'</h3><p class="empty-det">예정된 경제 이벤트가 없습니다.</p>';
      return;
    }
    var h='<h3>'+label+' — '+evs.length+'개 일정</h3>';
    for(var i=0;i<evs.length;i++){
      var ev=evs[i];
      var tm=TYPE_META[ev.type]||TYPE_META.macro;
      var isH=ev.importance==='high';
      var impColor=isH?'var(--accent)':'var(--dim)';
      h+='<div class="d-item">';
      h+='<span class="d-time">'+(ev.time||'--:--')+'</span>';
      h+='<span class="d-badge t-'+ev.type+(isH?' high':'')+'">'+tm.icon+' '+tm.label+'</span>';
      h+='<span class="d-title">'+ev.title+'</span>';
      if(isH)h+='<span class="imp-dot" style="background:var(--accent)" title="중요(High)"></span>';
      h+='</div>';
    }
    $det.innerHTML=h;
  }

  function renderUpcoming(){
    var today=fmtDate(new Date().getFullYear(),new Date().getMonth()+1,new Date().getDate());
    var ms=fmtDate(curYear,curMonth,1);
    var me=fmtDate(curYear,curMonth,daysIn(curYear,curMonth));
    var list=[];
    for(var i=0;i<items.length;i++){
      var it=items[i];
      if(it.date>=ms&&it.date<=me)list.push(it);
    }
    list.sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:(a.time||'')<(b.time||'')?-1:1;});

    var h='';
    var count=0;
    for(var i=0;i<list.length&&count<20;i++){
      var it=list[i];
      var tm=TYPE_META[it.type]||TYPE_META.macro;
      var past=it.date<today;
      var cls='uc-item'+(past?' uc-past':'');
      h+='<div class="'+cls+'">';
      h+='<span class="uc-date">'+fmtMD(it.date)+'</span>';
      h+='<span class="uc-time">'+(it.time||'')+'</span>';
      h+='<span class="d-badge t-'+it.type+(it.importance==='high'?' high':'')+'">'+tm.icon+'</span>';
      h+='<span class="d-title">'+it.title+'</span>';
      if(it.importance==='high')h+='<span class="imp-dot" style="background:var(--accent)"></span>';
      h+='</div>';
      count++;
    }
    if(!h)h='<p class="empty-det">이번 달 예정된 일정이 없습니다.</p>';
    $upc.innerHTML=h;
  }

  // Navigation
  $prev.addEventListener('click',function(){
    curMonth--;
    if(curMonth<1){curMonth=12;curYear--;}
    render();
  });
  $next.addEventListener('click',function(){
    curMonth++;
    if(curMonth>12){curMonth=1;curYear++;}
    render();
  });

  // Resize handler for mobile dot mode
  var resizeTimer;
  window.addEventListener('resize',function(){
    clearTimeout(resizeTimer);
    resizeTimer=setTimeout(function(){renderGrid();},200);
  });

  // Init
  fetchCal();
})();