(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const LIST_TYPES=Object.freeze(['wishlist','dynamax','gmax','costumes']);

  function fold(value){
    return String(value||'').normalize('NFKC').toLocaleLowerCase('en-US');
  }

  function trainerSuggestions(names,query,{minLength=2,limit=8}={}){
    const needle=fold(query).trim();
    if(needle.length<minLength)return[];
    return [...new Set((names||[]).map(name=>String(name||'').trim()).filter(Boolean))]
      .map(name=>({name,index:fold(name).indexOf(needle)}))
      .filter(item=>item.index>=0)
      .sort((a,b)=>(a.index>0)-(b.index>0)||a.index-b.index||a.name.localeCompare(b.name,'en',{sensitivity:'base'}))
      .slice(0,limit)
      .map(item=>({name:item.name,matchStart:item.index,matchLength:needle.length}));
  }

  function canonicalPublishedValue(value){
    const parser=root.priorityValues?.parsePri;
    if(typeof parser!=='function')return String(value??'').normalize('NFKC').trim();
    const parsed=parser(value);
    return JSON.stringify({
      priority:parsed.p||'',
      note:String(parsed.mod||'').normalize('NFKC').trim().replace(/\s+/g,' '),
      lucky:!!parsed.lucky,
      shiny:!!parsed.shiny,
      xxl:!!parsed.xxl,
      xxs:!!parsed.xxs
    });
  }

  function publishedEntries(snapshot){
    const lists=snapshot?.lists&&typeof snapshot.lists==='object'?snapshot.lists:{};
    const entries=new Map();
    LIST_TYPES.forEach(type=>{
      Object.entries(lists[type]||{}).forEach(([name,value])=>{
        const stableId=fold(name).trim();
        if(!stableId)return;
        entries.set(`${type}\u0000${stableId}`,{type,name,stableId,value:String(value??''),canonicalValue:canonicalPublishedValue(value)});
      });
    });
    return entries;
  }

  function diffPublishedLists(previous,current){
    if(!previous||!current)return{available:!!current,firstView:true,added:[],removed:[],modified:[],total:0};
    const before=publishedEntries(previous),after=publishedEntries(current);
    const added=[],removed=[],modified=[];
    after.forEach((entry,key)=>{
      if(!before.has(key))added.push(entry);
      else if(before.get(key).canonicalValue!==entry.canonicalValue)modified.push({...entry,before:before.get(key).value});
    });
    before.forEach((entry,key)=>{if(!after.has(key))removed.push(entry);});
    const byNameBefore=new Map([...before.values()].map(entry=>[entry.stableId,entry]));
    [...added].forEach(entry=>{
      const old=byNameBefore.get(entry.stableId);
      if(!old||old.type===entry.type)return;
      const addAt=added.indexOf(entry),removeAt=removed.findIndex(item=>item.stableId===entry.stableId&&item.type===old.type);
      if(addAt>=0)added.splice(addAt,1);
      if(removeAt>=0)removed.splice(removeAt,1);
      modified.push({...entry,before:old.value,beforeType:old.type,categoryChanged:true});
    });
    const sort=(a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'})||a.type.localeCompare(b.type);
    added.sort(sort);removed.sort(sort);modified.sort(sort);
    return{available:true,firstView:false,added,removed,modified,total:added.length+removed.length+modified.length};
  }

  root.trainerDiscovery=Object.freeze({LIST_TYPES,fold,trainerSuggestions,canonicalPublishedValue,publishedEntries,diffPublishedLists});
})(window);
