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
  function prioritySetPartitions(levels){
    const out=[];
    function visit(index,groups){
      if(index===levels.length){out.push(groups.map(group=>[...group]));return;}
      const level=levels[index];
      for(let i=0;i<groups.length;i++){
        groups[i].push(level);visit(index+1,groups);groups[i].pop();
      }
      groups.push([level]);visit(index+1,groups);groups.pop();
    }
    visit(0,[]);
    return out;
  }
  function myListSearchPlan(strs,options={}){
    const locale=options.locale||'en',limit=options.limit||POGO_STR_LIMIT;
    const populated=['H','M','L'].filter(level=>strs?.[level]);
    const option=(levels,kind)=>{
      const value=combineStrings(strs,levels,{locale});
      return{levels:[...levels],value,length:value.length,tooLong:value.length>limit,kind};
    };
    const combined=[];
    const seen=new Set();
    const add=(levels,kind)=>{
      if(levels.some(level=>!strs?.[level]))return;
      const candidate=option(levels,kind);
      if(!candidate.value||seen.has(candidate.value))return;
      seen.add(candidate.value);combined.push(candidate);
    };
    if(populated.length>1)add(populated,'all');
    add(['H','M'],'important');
    add(['H','L'],'more');
    add(['M','L'],'more');

    const all=combined.find(candidate=>candidate.kind==='all')||null;
    let split=[];
    if(all?.tooLong){
      split=prioritySetPartitions(populated)
        .map(groups=>groups.map(levels=>option(levels,'split')))
        .filter(parts=>parts.length>1&&parts.every(part=>!part.tooLong))
        .sort((a,b)=>a.length-b.length
          ||Number(b[0].levels.includes('H')&&b[0].levels.includes('M'))-Number(a[0].levels.includes('H')&&a[0].levels.includes('M'))
          ||b[0].levels.length-a[0].levels.length)[0]||[];
    }
    return{
      populated,
      all,
      secondary:combined.find(candidate=>candidate.kind==='important')||null,
      more:combined.filter(candidate=>candidate.kind==='more'),
      split,
      specials:['LUCKY','XXL','XXS'].filter(key=>strs?.[key]).map(key=>({key,value:strs[key],length:strs[key].length,tooLong:strs[key].length>limit}))
    };
  }
  function strLenInfo(str){
    const len=(str||'').length;
    const cls=len>POGO_STR_LIMIT?'danger':len>POGO_STR_LIMIT*0.85?'warn':'';
    return{len,cls};
  }

  root.searchStrings=Object.freeze({PREFILTER,POGO_STR_LIMIT,dexNumbersFromSearchItems,dexStringFromNumbers,stringFromSearchItems,stringParts,searchPartSort,combineStrings,combinedStringOptions,myListSearchPlan,strLenInfo});
})(window);
