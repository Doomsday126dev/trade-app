(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  function collectEventBonusTexts(ev){
    const texts=[];
    const visit=(value,depth=0)=>{
      if(!value||depth>5)return;
      if(typeof value==='string'){texts.push(value);return;}
      if(Array.isArray(value)){value.forEach(v=>visit(v,depth+1));return;}
      if(typeof value==='object'){
        if(typeof value.text==='string')texts.push(value.text);
        if(typeof value.description==='string')texts.push(value.description);
        Object.values(value).forEach(v=>visit(v,depth+1));
      }
    };
    visit(ev?.extraData);
    return [...new Set(texts)];
  }
  function eventNumberTokenToInt(token){
    const n=parseInt(token,10);
    if(Number.isFinite(n))return n;
    return{one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10}[String(token||'').toLowerCase()]||0;
  }
  function parseSpecialTradeBonus(texts){
    const n='(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)';
    for(const raw of texts){
      const t=String(raw||'').toLowerCase();
      if(!t.includes('special')||!t.includes('trade'))continue;
      if(/\ban\s+(?:additional|extra|bonus)\s+special\s+trade\b/i.test(t))return{bonus:1,text:raw,kind:'additional'};
      let m=t.match(new RegExp(`${n}\\s+(?:additional|extra|bonus)\\s+special\\s+trades?`,'i'));
      if(m)return{bonus:eventNumberTokenToInt(m[1]),text:raw,kind:'additional'};
      m=t.match(new RegExp(`(?:additional|extra|bonus)\\s+${n}\\s+special\\s+trades?`,'i'));
      if(m)return{bonus:eventNumberTokenToInt(m[1]),text:raw,kind:'additional'};
      m=t.match(/\+\s*(\d+)\s*special\s+trades?/i);
      if(m)return{bonus:eventNumberTokenToInt(m[1]),text:raw,kind:'additional'};
      m=t.match(new RegExp(`up to\\s+${n}\\s+special\\s+trades?`,'i'));
      if(m)return{bonus:Math.max(0,eventNumberTokenToInt(m[1])-1),text:raw,kind:'total'};
    }
    return null;
  }
  // Classify an event only from explicit scraped bonus text. No name-based guessing.
  // Returns {bonus, bonusType, ambiguous, bonusText}
  function classifyEvent(ev){
    const parsed=parseSpecialTradeBonus(collectEventBonusTexts(ev));
    if(parsed&&parsed.bonus>0)return{bonus:parsed.bonus,bonusType:'special',ambiguous:false,bonusText:parsed.text,bonusKind:parsed.kind};
    return{bonus:0,bonusType:'special',ambiguous:true,bonusText:''};
  }
  // Stable ID for an event.
  function getEventId(ev){return ev.eventID||ev.eventID||`${ev.name}_${ev.start}`;}

  root.scheduleEventRules=Object.freeze({
    collectEventBonusTexts,
    eventNumberTokenToInt,
    parseSpecialTradeBonus,
    classifyEvent,
    getEventId
  });
})(window);
