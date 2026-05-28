(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  const PREFILTER="!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&";
  const POGO_STR_LIMIT=1500;

  function dexStringFromNumbers(nums){
    const dexes=[...new Set(nums.map(n=>parseInt(n)).filter(Number.isFinite))].sort((a,b)=>a-b);
    return dexes.length?PREFILTER+dexes.join(','):'';
  }
  function stringFromSearchItems(items){
    if(!items.length)return'';
    const dexes=[...new Set(items.map(({term})=>parseInt(String(term||'').match(/\d+/)?.[0]||'',10)).filter(Number.isFinite))].sort((a,b)=>a-b);
    return dexes.length?PREFILTER+dexes.join(','):'';
  }
  function stringParts(str){
    const body=String(str||'').startsWith(PREFILTER)?String(str).slice(PREFILTER.length):String(str||'');
    return body.split(',').map(x=>x.trim()).filter(Boolean);
  }
  function searchPartSort(a,b){
    const da=parseInt(String(a).match(/\d+/)?.[0]||'0');
    const db=parseInt(String(b).match(/\d+/)?.[0]||'0');
    return da-db||String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'});
  }
  function combineStrings(strs,levels){
    const parts=[];
    levels.forEach(p=>{if(strs[p])parts.push(...stringParts(strs[p]));});
    const unique=[...new Set(parts)].sort(searchPartSort);
    return unique.length?PREFILTER+unique.join(','):'';
  }
  function combinedStringOptions(strs){
    return[
      {levels:['H','M'],label:'High + Medium'},
      {levels:['H','L'],label:'High + Low'},
      {levels:['M','L'],label:'Medium + Low'},
      {levels:['H','M','L'],label:'All priorities'}
    ].map(o=>({...o,value:combineStrings(strs,o.levels)}))
      .filter(o=>o.value&&o.levels.filter(p=>strs[p]).length>1);
  }
  function strLenInfo(str){
    const len=(str||'').length;
    const cls=len>POGO_STR_LIMIT?'danger':len>POGO_STR_LIMIT*0.85?'warn':'';
    return{len,cls};
  }

  root.searchStrings=Object.freeze({
    PREFILTER,
    POGO_STR_LIMIT,
    dexStringFromNumbers,
    stringFromSearchItems,
    stringParts,
    searchPartSort,
    combineStrings,
    combinedStringOptions,
    strLenInfo
  });
})(window);
