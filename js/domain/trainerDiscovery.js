(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const LIST_TYPES=Object.freeze(['wishlist','dynamax','gmax','costumes']);

  function fold(value){
    return String(value||'').normalize('NFKC').toLocaleLowerCase('en-US').trim();
  }

  function normalizedTokens(value){
    return fold(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  }

  function preferenceRanks(values){
    return new Map((values||[]).map((value,index)=>[fold(value),index]));
  }

  function oneEditApart(a,b){
    if(Math.abs(a.length-b.length)>1)return false;
    if(a.length===b.length){
      const differences=[];
      for(let i=0;i<a.length;i++)if(a[i]!==b[i])differences.push(i);
      return differences.length===1||(differences.length===2&&differences[1]===differences[0]+1&&a[differences[0]]===b[differences[1]]&&a[differences[1]]===b[differences[0]]);
    }
    const shorter=a.length<b.length?a:b,longer=a.length<b.length?b:a;
    let i=0,j=0,edits=0;
    while(i<shorter.length&&j<longer.length){
      if(shorter[i]===longer[j]){i++;j++;continue;}
      if(++edits>1)return false;j++;
    }
    return true;
  }

  function reciprocalCounts(matchCounts,normalized){
    const value=matchCounts?.get?.(normalized)||matchCounts?.[normalized]||{};
    const theyHaveMyWants=Math.max(0,Number(value.theyHaveMyWants)||0);
    const iHaveTheirWants=Math.max(0,Number(value.iHaveTheirWants)||0);
    const theyHaveAvailable=value.theyHaveAvailable===true||theyHaveMyWants>0;
    const iHaveAvailable=value.iHaveAvailable===true||iHaveTheirWants>0;
    return{theyHaveMyWants,iHaveTheirWants,total:theyHaveMyWants+iHaveTheirWants,available:theyHaveAvailable||iHaveAvailable,theyHaveAvailable,iHaveAvailable};
  }

  // Textual intent is the primary tier. Reciprocal usefulness and local history
  // only order results within the same text tier.
  function rankTrainerResults(names,query,{minLength=2,limit=8,favoriteNames=[],recentNames=[],matchCounts={}}={}){
    const needle=fold(query);
    if(needle.length<minLength)return[];
    const unique=new Map();
    (names||[]).map(name=>String(name||'').trim()).filter(Boolean).forEach(name=>{
      const normalized=fold(name);if(normalized&&!unique.has(normalized))unique.set(normalized,name);
    });
    const favorites=preferenceRanks(favoriteNames),recents=preferenceRanks(recentNames);
    return [...unique.entries()]
      .map(([normalized,name])=>{
        const index=normalized.indexOf(needle);
        const tokens=normalizedTokens(name);
        const fuzzy=needle.length>=4&&oneEditApart(normalized,needle);
        if(index<0&&!fuzzy)return null;
        const matchType=normalized===needle?'exact'
          :normalized.startsWith(needle)?'prefix'
          :tokens.some(token=>token.startsWith(needle))?'token_prefix'
          :index>=0?'substring':'fuzzy';
        const score={exact:0,prefix:1,token_prefix:2,substring:3,fuzzy:4}[matchType];
        const reciprocal=reciprocalCounts(matchCounts,normalized);
        return{name,normalized,index,score,matchType,
          reciprocal,
          favoriteRank:favorites.has(normalized)?favorites.get(normalized):Number.MAX_SAFE_INTEGER,
          recentRank:recents.has(normalized)?recents.get(normalized):Number.MAX_SAFE_INTEGER};
      })
      .filter(Boolean)
      .sort((a,b)=>a.score-b.score||b.reciprocal.total-a.reciprocal.total||a.favoriteRank-b.favoriteRank||a.recentRank-b.recentRank||Math.max(0,a.index)-Math.max(0,b.index)||a.normalized.localeCompare(b.normalized,'en',{sensitivity:'base'})||a.name.localeCompare(b.name,'en'))
      .slice(0,limit)
      .map(item=>({name:item.name,normalized:item.normalized,matchStart:item.index,matchLength:item.index>=0?needle.length:0,matchType:item.matchType,favorite:item.favoriteRank!==Number.MAX_SAFE_INTEGER,recent:item.recentRank!==Number.MAX_SAFE_INTEGER,...item.reciprocal}));
  }

  function trainerSuggestions(names,query,options={}){
    return rankTrainerResults(names,query,options);
  }

  function bestTrainerSuggestion(names,query,options={}){
    return trainerSuggestions(names,query,{...options,limit:1})[0]||null;
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

  root.trainerDiscovery=Object.freeze({LIST_TYPES,fold,normalizedTokens,oneEditApart,rankTrainerResults,trainerSuggestions,bestTrainerSuggestion,canonicalPublishedValue,publishedEntries,diffPublishedLists});
})(window);
