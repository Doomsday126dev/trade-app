(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  function entryGender(mod){
    const m=String(mod||'').toLowerCase();
    if(/\bfemale\b|♀|\bf\b/.test(m))return'f';
    if(/\bmale\b|♂|\bm\b/.test(m))return'm';
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
    return{p,mod,lucky,xxl,xxs,shiny};
  }

  function priValue(p,mod='',lucky=false,xxl=false,xxs=false,shiny=false){
    return`${p||''}${lucky?'[lucky]':''}${shiny?'[shiny]':''}${xxl?'[xxl]':''}${xxs?'[xxs]':''}${mod?`(${mod})`:''}`;
  }

  root.priorityValues=Object.freeze({
    entryGender,
    parsePri,
    priValue
  });
})(window);
