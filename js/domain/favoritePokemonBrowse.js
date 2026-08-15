(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const LIST_TYPES=Object.freeze(['wishlist','dynamax','gmax','costumes']);
  const PRIORITY_ORDER=Object.freeze({H:0,M:1,L:2,'':3});

  function normalizedText(value){return String(value||'').normalize('NFKC').trim();}
  function trainerKey(value){return normalizedText(value).toLocaleLowerCase('en-US');}
  function pokemonKey(value){return root.pokemonCatalog?.catalogKey?.(value)||normalizedText(value).toLocaleLowerCase('en-US');}
  function priorityFor(value){
    if(value&&typeof value==='object'&&!Array.isArray(value)){
      const direct=String(value.p||value.priority||'').toUpperCase();
      return Object.prototype.hasOwnProperty.call(PRIORITY_ORDER,direct)?direct:'';
    }
    const parser=root.priorityValues?.parsePri;
    const parsed=typeof parser==='function'?parser(value):{p:String(value||'').match(/^([HML])/)?.[1]||''};
    const priority=String(parsed?.p||'').toUpperCase();
    return Object.prototype.hasOwnProperty.call(PRIORITY_ORDER,priority)?priority:'';
  }
  function higherPriority(a,b){return(PRIORITY_ORDER[a]??3)<=(PRIORITY_ORDER[b]??3)?a:b;}

  function projectSnapshot(snapshot){
    const lists=snapshot?.lists&&typeof snapshot.lists==='object'?snapshot.lists:{};
    const projected=new Map();
    LIST_TYPES.forEach(category=>{
      Object.entries(lists[category]||{}).forEach(([name,value])=>{
        const canonicalName=normalizedText(name),key=pokemonKey(canonicalName);
        if(!key)return;
        const priority=priorityFor(value),current=projected.get(key);
        if(!current){projected.set(key,{pokemonKey:key,pokemonName:canonicalName,priority,categories:[category]});return;}
        current.priority=higherPriority(current.priority,priority);
        if(!current.categories.includes(category))current.categories.push(category);
      });
    });
    return[...projected.values()].map(entry=>Object.freeze({...entry,categories:Object.freeze([...entry.categories])}));
  }

  function buildIndex(records){
    const index=new Map();
    const values=records&&typeof records.values==='function'?[...records.values()]:Array.from(records||[]);
    values.forEach(record=>{
      if(record?.status!=='published'&&record?.status!=='published_empty')return;
      (record.entries||[]).forEach(entry=>{
        const key=pokemonKey(entry.pokemonKey||entry.pokemonName);
        if(!key)return;
        const matches=index.get(key)||[];
        matches.push(Object.freeze({
          trainerKey:trainerKey(record.trainerKey||record.displayName),
          displayName:normalizedText(record.displayName),
          priority:priorityFor(entry.priority),
          categories:Object.freeze([...new Set((entry.categories||[]).filter(type=>LIST_TYPES.includes(type)))])
        }));
        index.set(key,matches);
      });
    });
    return index;
  }

  function resultsForPokemon(index,pokemonName,{favorites=[],tags={},recent=[],locale='en'}={}){
    const favoriteMap=new Map((favorites||[]).map(item=>[trainerKey(item.key||item.displayName),item]));
    const recentMap=new Map((recent||[]).map(item=>[trainerKey(item.key||item.displayName),Number(item.openedAt)||0]));
    const collator=new Intl.Collator(locale,{numeric:true,sensitivity:'base'});
    return(index?.get?.(pokemonKey(pokemonName))||[])
      .filter(match=>favoriteMap.has(match.trainerKey))
      .map(match=>{
        const favorite=favoriteMap.get(match.trainerKey);
        return Object.freeze({
          ...match,
          displayName:favorite.displayName||match.displayName,
          tags:Object.freeze((favorite.tagIds||[]).map(id=>tags[id]?.label).filter(Boolean)),
          lastOpenedAt:recentMap.get(match.trainerKey)||0
        });
      })
      .sort((a,b)=>(PRIORITY_ORDER[a.priority]??3)-(PRIORITY_ORDER[b.priority]??3)||b.lastOpenedAt-a.lastOpenedAt||collator.compare(a.displayName,b.displayName));
  }

  root.favoritePokemonBrowse=Object.freeze({
    LIST_TYPES,PRIORITY_ORDER,trainerKey,pokemonKey,priorityFor,projectSnapshot,buildIndex,resultsForPokemon
  });
})(window);
