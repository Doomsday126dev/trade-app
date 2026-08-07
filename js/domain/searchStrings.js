(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const syntax=root.pokemonGoSearchSyntax;
  if(!syntax)throw new Error('Pokémon GO search syntax must load before search string helpers');
  const PREFILTER=syntax.queryPrefix(syntax.PRIORITY_QUERY,'en');
  const POGO_STR_LIMIT=1500;

  function dexNumbersFromSearchItems(items){
    return syntax.uniqueDexNumbers((items||[]).map(({term})=>parseInt(String(term||'').match(/\d+/)?.[0]||'',10)));
  }
  function dexStringFromNumbers(nums,options={}){
    const locale=options.locale||'en',query=options.query||syntax.PRIORITY_QUERY;
    return syntax.serializeQuery(syntax.withDexNumbers(query,nums),locale);
  }
  function stringFromSearchItems(items,options={}){
    return dexStringFromNumbers(dexNumbersFromSearchItems(items),options);
  }
  function stringParts(str){
    const tail=String(str||'').split(syntax.OPERATORS.and).at(-1)||'';
    return tail.split(syntax.OPERATORS.list).map(x=>x.trim()).filter(x=>/^\d+$/.test(x));
  }
  function searchPartSort(a,b){
    const da=parseInt(String(a).match(/\d+/)?.[0]||'0');
    const db=parseInt(String(b).match(/\d+/)?.[0]||'0');
    return da-db||String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'});
  }
  function combineStrings(strs,levels,options={}){
    const parts=[];
    levels.forEach(p=>{if(strs[p])parts.push(...stringParts(strs[p]));});
    return dexStringFromNumbers([...new Set(parts)].sort(searchPartSort),options);
  }
  function combinedStringOptions(strs,options={}){
    return[
      {levels:['H','M'],label:'High + Medium'},
      {levels:['H','L'],label:'High + Low'},
      {levels:['M','L'],label:'Medium + Low'},
      {levels:['H','M','L'],label:'All priorities'}
    ].map(o=>({...o,value:combineStrings(strs,o.levels,options)}))
      .filter(o=>o.value&&o.levels.filter(p=>strs[p]).length>1);
  }
  function strLenInfo(str){
    const len=(str||'').length;
    const cls=len>POGO_STR_LIMIT?'danger':len>POGO_STR_LIMIT*0.85?'warn':'';
    return{len,cls};
  }

  root.searchStrings=Object.freeze({PREFILTER,POGO_STR_LIMIT,dexNumbersFromSearchItems,dexStringFromNumbers,stringFromSearchItems,stringParts,searchPartSort,combineStrings,combinedStringOptions,strLenInfo});
})(window);
