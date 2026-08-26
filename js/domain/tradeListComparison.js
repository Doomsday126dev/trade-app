(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const FLAG_KEYS=Object.freeze(['lucky','shiny','xxl','xxs']);

  function cleanEntry(entry){
    return Object.freeze({
      key:String(entry?.key||''),
      name:String(entry?.name||''),
      dn:String(entry?.dn||entry?.name||''),
      no:Number(entry?.no)||null,
      type:String(entry?.type||''),
      p:String(entry?.p||''),
      mod:String(entry?.mod||''),
      gender:String(entry?.gender||''),
      backgroundId:String(entry?.backgroundId||''),
      lucky:entry?.lucky===true,
      shiny:entry?.shiny===true,
      xxl:entry?.xxl===true,
      xxs:entry?.xxs===true
    });
  }
  function defaultNameKey(value){return String(value||'').trim().toLocaleLowerCase('en-US');}
  function qualifierKey(entry,normalizeQualifier=value=>String(value||'').trim().toLocaleLowerCase('en-US')){
    const item=cleanEntry(entry);
    return JSON.stringify([
      item.backgroundId,item.gender,normalizeQualifier(item.mod),
      ...FLAG_KEYS.map(flag=>item[flag])
    ]);
  }
  function wantedIntentKey(entry,{nameKey=defaultNameKey,normalizeQualifier}={}){
    const item=cleanEntry(entry);
    return JSON.stringify([
      nameKey(item.name),item.type,item.backgroundId,item.gender,
      normalizeQualifier?normalizeQualifier(item.mod):defaultNameKey(item.mod),
      ...FLAG_KEYS.map(flag=>item[flag])
    ]);
  }
  function uniqueWants(entries,options){
    const unique=new Map();
    entries.forEach(entry=>{
      const clean=cleanEntry(entry),key=wantedIntentKey(clean,options);
      if(!unique.has(key))unique.set(key,clean);
    });
    return unique;
  }
  function compareWantedLists({myWants=[],theirWants=[]}={},options={}){
    const nameKey=typeof options.nameKey==='function'?options.nameKey:defaultNameKey;
    const normalizeQualifier=typeof options.normalizeQualifier==='function'?options.normalizeQualifier:undefined;
    const compareOptions={nameKey,normalizeQualifier};
    const mine=uniqueWants(myWants,compareOptions),theirs=uniqueWants(theirWants,compareOptions);
    const both=[],onlyMine=[],onlyTheirs=[];
    mine.forEach((entry,key)=>{
      if(theirs.has(key))both.push(Object.freeze({...entry,counterpart:theirs.get(key)}));
      else onlyMine.push(entry);
    });
    theirs.forEach((entry,key)=>{if(!mine.has(key))onlyTheirs.push(entry);});
    return Object.freeze({
      both:Object.freeze(both),
      onlyMine:Object.freeze(onlyMine),
      onlyTheirs:Object.freeze(onlyTheirs)
    });
  }

  root.tradeListComparison=Object.freeze({FLAG_KEYS,cleanEntry,qualifierKey,wantedIntentKey,compareWantedLists});
})(window);
