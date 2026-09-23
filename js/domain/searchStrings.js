(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const syntax=root.pokemonGoSearchSyntax;
  if(!syntax)throw new Error('Pokémon GO search syntax must load before search string helpers');
  const PREFILTER=syntax.queryPrefix(syntax.PRIORITY_QUERY,'en');
  const POGO_STR_LIMIT=1500;
  const GAME_LANGUAGE_STORAGE_KEYS=Object.freeze({locale:'pogoPokemonGoSearchLocale:v1',override:'pogoPokemonGoSearchLocaleOverride:v1'});
  const CONTEXTUAL_SEARCH_POLICIES=Object.freeze({
    unresolved:Object.freeze({id:'unresolved',query:null,labelKey:'workflow.notIncluded'}),
    ordinary:Object.freeze({id:'section',query:syntax.PRIORITY_QUERY,labelKey:'restored.copySearch'})
  });

  function resolveGameLocalePreference(interfaceLocale='en',storedLocale=null,override=false){
    return override===true&&syntax.SUPPORTED_LOCALES.includes(storedLocale)?storedLocale:syntax.localeKey(interfaceLocale);
  }

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
      specials:['LUCKY','SHINY','XXL','XXS'].filter(key=>strs?.[key]).map(key=>({key,value:strs[key],length:strs[key].length,tooLong:strs[key].length>limit}))
    };
  }
  function strLenInfo(str){
    const len=(str||'').length;
    const cls=len>POGO_STR_LIMIT?'danger':len>POGO_STR_LIMIT*0.85?'warn':'';
    return{len,cls};
  }

  function contextualEntryIdentity(entry={}){
    const raw=entry.no,number=(typeof raw==='number'||typeof raw==='string'&&/^\d+$/.test(raw))?Number(raw):NaN;
    if(!Number.isSafeInteger(number)||number<1||number>9999)return Object.freeze({resolved:false,explicit:false,category:'invalid-dex'});
    const name=String(entry.name||'').normalize('NFKC').trim();
    if(!name)return Object.freeze({resolved:true,explicit:false,category:'species-number',speciesId:number});
    const catalog=root.pokemonCatalog,dex=root.publicPokemonDex;
    if(!dex?.dex)return Object.freeze({resolved:false,explicit:false,category:'identity-unavailable',speciesId:number});
    const legacy=catalog?.resolveLegacyKey?.(name);
    const canonicalName=legacy?.canonicalKey||name;
    if(dex.dex(canonicalName)!==number&&dex.dex(name)!==number)return Object.freeze({resolved:false,explicit:false,category:'unresolved-catalog',speciesId:number});
    const canonical=catalog?.decorateCatalogEntry?.({...entry,no:number,name:canonicalName,displayName:canonicalName,dn:canonicalName});
    return Object.freeze({resolved:true,explicit:false,category:'catalog-identity',catalogId:canonical?.catalogId||'',speciesId:number});
  }

  function contextualEntryPolicy(entry={}){
    const identity=contextualEntryIdentity(entry);
    if(!identity.resolved)return CONTEXTUAL_SEARCH_POLICIES.unresolved;
    return CONTEXTUAL_SEARCH_POLICIES.ordinary;
  }

  // A section is one species discovery scope. Remove only exclusions that
  // contradict explicit requirements present in that section.
  function contextualSearchPlan(entries=[],options={}){
    const locale=syntax.localeKey(options.locale),limit=Math.min(POGO_STR_LIMIT,Math.max(32,Number(options.limit)||POGO_STR_LIMIT));
    const manual=entries.map(entry=>{
      const raw=entry.no,number=(typeof raw==='number'||typeof raw==='string'&&/^\d+$/.test(raw))?Number(raw):NaN;
      const no=Number.isSafeInteger(number)&&number>0&&number<=9999?number:null;
      const normalized={...entry,no};
      return{...normalized,unresolved:no===null||contextualEntryPolicy(normalized).id==='unresolved'};
    });
    const resolved=manual.filter(e=>!e.unresolved);
    const parts=[],partPolicies=[];
    if(resolved.length){
      const requirements={
        shiny:resolved.some(e=>e.shiny===true),
        background:resolved.some(e=>Boolean(e.backgroundId)),
        xxl:resolved.every(e=>e.xxl===true),
        xxs:resolved.every(e=>e.xxs===true)
      };
      // A Lucky want describes the result of a future trade. Search the
      // tradeable species, not an inventory of Pokémon already marked Lucky.
      const queryModel={...syntax.PRIORITY_QUERY,profile:'section',excludeShiny:!requirements.shiny,excludeBackground:!requirements.background,includeXxl:requirements.xxl,includeXxs:requirements.xxs};
      const numbers=syntax.uniqueDexNumbers(resolved.map(e=>e.no));let pending=[];
      const query=dexNumbers=>syntax.serializeQuery(syntax.withDexNumbers(queryModel,dexNumbers),locale);
      const flush=()=>{if(!pending.length)return;parts.push(query(pending));partPolicies.push('section');pending=[];};
      for(const no of numbers){if(pending.length&&query([...pending,no]).length>limit)flush();pending.push(no);}
      flush();
    }
    const policy=resolved.length?'section':'none';
    return{locale,limit,parts,partPolicies,policy,manual,total:manual.length,unresolved:manual.filter(e=>e.unresolved).length,speciesOnly:true};
  }

  root.searchStrings=Object.freeze({PREFILTER,POGO_STR_LIMIT,GAME_LANGUAGE_STORAGE_KEYS,CONTEXTUAL_SEARCH_POLICIES,resolveGameLocalePreference,contextualEntryIdentity,contextualEntryPolicy,dexNumbersFromSearchItems,dexStringFromNumbers,stringFromSearchItems,stringParts,searchPartSort,combineStrings,combinedStringOptions,myListSearchPlan,strLenInfo,contextualSearchPlan});
})(window);
