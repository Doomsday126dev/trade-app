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

  function parsePri(v){
    if(!v)return{p:'',mod:'',lucky:false,xxl:false,xxs:false,shiny:false};
    const s=String(v);
    const priM=s.match(/^([HML])(.*)/);
    const p=priM?priM[1]:'';
    let rest=priM?(priM[2]||''):s;
    const lucky=/\[lucky\]/i.test(rest);
    const xxl=/\[xxl\]/i.test(rest);
    const xxs=/\[xxs\]/i.test(rest);
    let shiny=/\[shiny\]/i.test(rest);
    rest=rest.replace(/\[lucky\]/gi,'').replace(/\[xxl\]/gi,'').replace(/\[xxs\]/gi,'').replace(/\[shiny\]/gi,'').replace(/\[iv:[^\]]*\]/gi,'');
    let mod=rest.replace(/[()]/g,'').trim();
    if(!shiny&&/\bshiny\b|\bshny\b/i.test(mod)){
      shiny=true;
      mod=mod.replace(/\bshiny\b/gi,'').replace(/\bshny\b/gi,'').replace(/,\s*,/g,',').replace(/^\s*,\s*|\s*,\s*$/g,'').trim();
    }
    mod=normalizeTradeQualifier(mod);
    return{p,mod,lucky,xxl,xxs,shiny};
  }

  function priValue(p,mod='',lucky=false,xxl=false,xxs=false,shiny=false){
    const qualifier=normalizeTradeQualifier(mod);
    return`${p||''}${lucky?'[lucky]':''}${shiny?'[shiny]':''}${xxl?'[xxl]':''}${xxs?'[xxs]':''}${qualifier?`(${qualifier})`:''}`;
  }

  root.priorityValues=Object.freeze({
    entryGender,
    normalizeTradeQualifier,
    parsePri,
    priValue
  });
})(window);
