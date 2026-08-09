(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  const STALE_WARN=7,STALE_OLD=30;

  function freshnessClass(ts){
    if(!ts)return'stale';
    const d=(Date.now()-ts)/86400000;
    return d<STALE_WARN?'fresh':d<STALE_OLD?'warn':'stale';
  }
  function freshnessLabel(ts){
    if(!ts)return'Never';
    const m=Math.floor((Date.now()-ts)/60000);
    if(m<2)return'Just now';if(m<60)return`${m}m ago`;
    const h=Math.floor(m/60);if(h<24)return`${h}h ago`;
    const d=Math.floor(h/24);if(d<7)return`${d}d ago`;
    if(d<30)return`${Math.floor(d/7)}w ago`;return`${Math.floor(d/30)}mo ago`;
  }
  function freshnessColor(cls){return{fresh:'var(--ok)',warn:'var(--warn)',stale:'var(--danger)'}[cls]||'var(--muted)';}
  function relativeTime(ts){
    if(!ts)return'';
    const d=(Date.now()-ts)/1000;
    if(d<60)return'just now';
    if(d<3600)return`${Math.floor(d/60)}m ago`;
    if(d<86400)return`${Math.floor(d/3600)}h ago`;
    return`${Math.floor(d/86400)}d ago`;
  }
  function recentTrainerRecency(ts,now=Date.now()){
    const timestamp=Number(ts),current=Number(now);
    if(!Number.isFinite(timestamp)||!Number.isFinite(current))return Object.freeze({kind:'date',timestamp:0});
    const age=Math.max(0,current-timestamp);
    if(age<60000)return Object.freeze({kind:'just-now',value:0,unit:'second',timestamp});
    if(age<3600000)return Object.freeze({kind:'relative',value:Math.max(1,Math.floor(age/60000)),unit:'minute',timestamp});
    if(age<86400000)return Object.freeze({kind:'relative',value:Math.max(1,Math.floor(age/3600000)),unit:'hour',timestamp});
    if(age<604800000)return Object.freeze({kind:'relative',value:Math.max(1,Math.floor(age/86400000)),unit:'day',timestamp});
    if(age<3024000000)return Object.freeze({kind:'relative',value:Math.max(1,Math.floor(age/604800000)),unit:'week',timestamp});
    return Object.freeze({kind:'date',timestamp});
  }

  root.relativeTime=Object.freeze({
    STALE_WARN,
    STALE_OLD,
    freshnessClass,
    freshnessLabel,
    freshnessColor,
    relativeTime,
    recentTrainerRecency
  });
})(window);
