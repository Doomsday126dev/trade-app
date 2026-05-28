(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  function externalTradePartners(t){
    const raw=Array.isArray(t?.externalPartners)?t.externalPartners:(t?.externalPartner?[t.externalPartner]:[]);
    return raw.map(v=>String(v||'').trim()).filter(Boolean).slice(0,6);
  }
  function parseExternalTradePartners(raw){
    return String(raw||'').split(',').map(v=>v.trim()).filter(Boolean).slice(0,6);
  }
  function scheduledTradeQuantity(t){
    if((t?.type||'regular')!=='regular')return 1;
    if(!t)return 1;
    const n=parseInt(t?.regularCount,10);
    return Number.isFinite(n)&&n>0?Math.min(100,n):1;
  }
  function summarizeScheduledTrades(trades){
    let special=0,regular=0,remote=0,scheduled=0,completed=0;
    const byStatus={
      special:{scheduled:0,completed:0},
      regular:{scheduled:0,completed:0},
      remote:{scheduled:0,completed:0}
    };
    trades.forEach(t=>{
      const bucket=t.type==='special'?'special':t.type==='remote'?'remote':'regular';
      const status=t.status==='completed'?'completed':'scheduled';
      const qty=bucket==='regular'?scheduledTradeQuantity(t):1;
      if(bucket==='special')special+=qty;
      else if(bucket==='remote')remote+=qty;
      else regular+=qty;
      byStatus[bucket][status]+=qty;
      if(status==='completed')completed++;
      else scheduled++;
    });
    return{special,regular,remote,total:special+regular+remote,scheduled,completed,byStatus,trades};
  }

  root.scheduleTradeRules=Object.freeze({
    externalTradePartners,
    parseExternalTradePartners,
    scheduledTradeQuantity,
    summarizeScheduledTrades
  });
})(window);
