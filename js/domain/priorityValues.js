(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  function normalizeTradeQualifier(value){
    let normalized=String(value||'').trim();
    if(!normalized)return'';
    const boundary='[^\\p{L}\\p{N}]';
    normalized=normalized
      .replace(new RegExp(`(^|${boundary})(?:shadow|シャドウ|oscuro|oscura|crypto)(?=$|${boundary})`,'giu'),'$1')
      .replace(new RegExp(`(^|${boundary})(?:female|f|♀|hembra|weiblich|メス)(?=$|${boundary})`,'giu'),'$1F')
      .replace(new RegExp(`(^|${boundary})(?:male|m|♂|macho|männlich|オス)(?=$|${boundary})`,'giu'),'$1M')
      .replace(/\s+/g,' ')
      .replace(/\s*([,;/|+])\s*/g,'$1 ')
      .replace(/([,;/|+])(?:\s*[,;/|+])+/g,'$1')
      .replace(/^[\s,;/|+_-]+|[\s,;/|+_-]+$/g,'')
      .trim();
    return normalized;
  }

  function entryGender(mod){
    const m=normalizeTradeQualifier(mod);
    if(/(^|[^\p{L}\p{N}])F(?=$|[^\p{L}\p{N}])/u.test(m))return'f';
    if(/(^|[^\p{L}\p{N}])M(?=$|[^\p{L}\p{N}])/u.test(m))return'm';
    return'';
  }

  const BACKGROUND_ID_RE=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  function normalizeBackgroundId(value){
    const id=String(value||'').trim().toLowerCase();
    return BACKGROUND_ID_RE.test(id)?id:'';
  }

  function matchesTradeIntent(intent,inventoryGender='',inventoryIntent=null){
    const have=inventoryGender&&typeof inventoryGender==='object'?inventoryGender:(inventoryIntent||{});
    const haveGender=inventoryGender&&typeof inventoryGender==='object'?inventoryGender.gender||inventoryGender.mod||'':inventoryGender;
    const wantedGender=entryGender(intent?.mod);
    const wantedBackground=normalizeBackgroundId(intent?.backgroundId);
    const haveBackground=normalizeBackgroundId(have?.backgroundId);
    const requiredFlags=['lucky','shiny','xxl','xxs'];
    return(!wantedGender||entryGender(haveGender)===wantedGender)
      &&(!wantedBackground||wantedBackground===haveBackground)
      &&requiredFlags.every(flag=>!intent?.[flag]||have?.[flag]===true);
  }

  function parsePri(v){
    if(!v)return{p:'',mod:'',lucky:false,xxl:false,xxs:false,shiny:false,backgroundId:''};
    const s=String(v);
    const priM=s.match(/^([HML])(.*)/);
    const p=priM?priM[1]:'';
    let rest=priM?(priM[2]||''):s;
    const lucky=/\[lucky\]/i.test(rest);
    const xxl=/\[xxl\]/i.test(rest);
    const xxs=/\[xxs\]/i.test(rest);
    let shiny=/\[shiny\]/i.test(rest);
    const backgroundTokens=[...rest.matchAll(/\[bg:([^\]]*)\]/gi)];
    const backgroundId=backgroundTokens.length===1?normalizeBackgroundId(backgroundTokens[0][1]):'';
    rest=rest.replace(/\[lucky\]/gi,'').replace(/\[xxl\]/gi,'').replace(/\[xxs\]/gi,'').replace(/\[shiny\]/gi,'').replace(/\[bg:[^\]]*\]/gi,'').replace(/\[iv:[^\]]*\]/gi,'');
    let mod=rest.replace(/[()]/g,'').trim();
    if(!shiny&&/\bshiny\b|\bshny\b/i.test(mod)){
      shiny=true;
      mod=mod.replace(/\bshiny\b/gi,'').replace(/\bshny\b/gi,'').replace(/,\s*,/g,',').replace(/^\s*,\s*|\s*,\s*$/g,'').trim();
    }
    mod=normalizeTradeQualifier(mod);
    return{p,mod,lucky,xxl,xxs,shiny,backgroundId};
  }

  function priValue(p,mod='',lucky=false,xxl=false,xxs=false,shiny=false,backgroundId=''){
    const qualifier=normalizeTradeQualifier(mod);
    const background=normalizeBackgroundId(backgroundId);
    return`${p||''}${lucky?'[lucky]':''}${shiny?'[shiny]':''}${xxl?'[xxl]':''}${xxs?'[xxs]':''}${background?`[bg:${background}]`:''}${qualifier?`(${qualifier})`:''}`;
  }

  // Presentation only: stored priority and canonical declaration identity stay intact.
  // SHINY remains the legacy presentation key for compatibility with section controls.
  // Its label is now Special trades; membership does not imply shiny.
  // Presentation classification only; never changes saved shiny or priority values.
  const SPECIAL_SPECIES=new Set([144,145,146,150,243,244,245,249,250,377,378,379,380,381,382,383,384,480,481,482,483,484,485,486,487,488,638,639,640,641,642,643,644,645,646,716,717,718,772,773,785,786,787,788,789,790,791,792,793,794,795,796,797,798,799,800,803,804,805,806,808,809,888,889,890,891,892,894,895,896,897,898,905,1001,1002,1003,1004,1007,1008,1014,1015,1016,1017,1024]);
  function isSpecialTradeWant(entry){return entry?.shiny===true||SPECIAL_SPECIES.has(Number(entry?.speciesId||entry?.no));}
  function dexCompare(a,b){return (Number(a.no)||9999)-(Number(b.no)||9999)||String(a.name||'').localeCompare(String(b.name||''),undefined,{numeric:true,sensitivity:'base'});}
  const WANT_FLAGS=Object.freeze(['lucky','shiny','xxl','xxs']);
  function wantSectionKey(entry){
    if(['H','M','L'].includes(entry.p))return entry.p;
    return WANT_FLAGS.filter(flag=>flag==='shiny'?isSpecialTradeWant(entry):entry[flag]===true).map(flag=>flag.toUpperCase()).join('+')||'NEEDS_PRIORITY';
  }
  function wantSections(entries=[]){
    const groups=new Map();
    for(const entry of entries){
      const key=wantSectionKey(entry);
      if(!groups.has(key))groups.set(key,{key,priority:['H','M','L'].includes(key)?key:'',flags:WANT_FLAGS.filter(flag=>key.split('+').includes(flag.toUpperCase())),entries:[]});
      groups.get(key).entries.push(entry);
    }
    for(const section of groups.values())section.entries.sort(dexCompare);
    const rank=section=>section.priority?['H','M','L'].indexOf(section.priority):section.key==='NEEDS_PRIORITY'?100:3+WANT_FLAGS.indexOf(section.flags[0]);
    return [...groups.values()].sort((a,b)=>rank(a)-rank(b)||a.flags.length-b.flags.length||a.key.localeCompare(b.key));
  }
  function wantSectionLabel(section,t,{recipient=false}={}){
    if(section.priority)return t({H:'priority.high',M:'priority.medium',L:'priority.low'}[section.priority]);
    if(section.key==='NEEDS_PRIORITY')return t(recipient?'workflow.priorityNotSet':'workflow.needsPriority');
    return section.flags.map(flag=>({xxl:'XXL',xxs:'XXS'}[flag]||t(flag==='lucky'?'myList.lucky':'workflow.specialTrades'))).join(' · ');
  }

  root.priorityValues=Object.freeze({
    isSpecialTradeWant,
    dexCompare,
    wantSectionKey,
    wantSections,
    wantSectionLabel,
    entryGender,
    matchesTradeIntent,
    normalizeBackgroundId,
    normalizeTradeQualifier,
    parsePri,
    priValue
  });
})(window);
