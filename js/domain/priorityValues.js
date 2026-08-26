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

  root.priorityValues=Object.freeze({
    entryGender,
    matchesTradeIntent,
    normalizeBackgroundId,
    normalizeTradeQualifier,
    parsePri,
    priValue
  });
})(window);
