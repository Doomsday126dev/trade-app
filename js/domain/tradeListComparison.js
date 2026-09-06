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

  // Compatibility is referential: no new Pokemon records or inferred offers.
  // Board rows come first to retain the owner's existing board order.
  function declarationKey(entry,options={}){
    return JSON.stringify([entry.intent||'lf',wantedIntentKey(entry,options),
      entry.p||'',entry.note||'',entry.mirror===true,entry.qty??1]);
  }
  function unifyDeclarations(entries=[],options={}){
    const exact=new Map(),catalog=new Map(),duplicates=[],reviews=[];
    const sourceRank=entry=>entry.ref?.surface==='my-list'?(entry.ref.managed?1:0):2;
    for(const entry of entries){
      const key=declarationKey(entry,options),prior=exact.get(key);
      if(prior){
        if(sourceRank(entry)<sourceRank(prior)){
          const original={...prior,aliases:[]};
          Object.assign(prior,entry,{aliases:[...prior.aliases,original],declarationKey:key});
          duplicates.push({survivor:prior,duplicate:original});
        }else{prior.aliases.push(entry);duplicates.push({survivor:prior,duplicate:entry});}
        continue;
      }
      const record={...entry,aliases:[],declarationKey:key};exact.set(key,record);
      const name=(options.nameKey||defaultNameKey)(entry.name);
      const collisionKey=JSON.stringify([entry.intent||'lf',name,entry.type||'wishlist']);
      const group=catalog.get(collisionKey)||[];group.push(record);catalog.set(collisionKey,group);
    }
    for(const group of catalog.values())if(group.length>1)reviews.push(group);
    return{entries:[...exact.values()],duplicates,reviews};
  }
  function compareDeclarations({mine=[],theirs=[],offersAvailable=false}={},options={}){
    const myWants=mine.filter(e=>e.intent==='lf'),theirWants=theirs.filter(e=>e.intent==='lf');
    const overlap=compareWantedLists({myWants,theirWants},options);
    const intersection=(wants,offers)=>compareWantedLists({myWants:wants,theirWants:offers},options).both;
    return{...overlap,offersAvailable,
      theyOffer:offersAvailable?intersection(myWants,theirs.filter(e=>e.intent==='ft')):[],
      iOffer:offersAvailable?intersection(theirWants,mine.filter(e=>e.intent==='ft')):[]};
  }

  function wantsChanges(current=[],previous=null,options={}){
    const key=entry=>wantedIntentKey({...entry,backgroundId:''},options);
    const signature=entry=>JSON.stringify([entry.p||'',entry.note||'']);
    const before=new Map();
    for(const entry of previous||[]){const id=key(entry);if(!before.has(id))before.set(id,[]);before.get(id).push(entry);}
    const entries=current.filter(entry=>entry.intent==='lf');
    const added=previous===null?[]:entries.filter(entry=>!before.has(key(entry)));
    const newTop=previous===null?[]:entries.filter(entry=>entry.p==='H'&&!before.get(key(entry))?.some(old=>old.p==='H'));
    const changed=previous===null?[]:entries.filter(entry=>!before.get(key(entry))?.some(old=>signature(old)===signature(entry)));
    const ids=new Set(entries.map(key));
    const removed=previous===null?0:[...before.keys()].filter(id=>!ids.has(id)).length;
    return{first:previous===null,added,newTop,changed,removed,updated:changed.length>0||removed>0};
  }
  function groupWants(members=[],{scope='all',now=Date.now(),...options}={}){
    const rows=new Map();
    const states=members.map(member=>{
      const fresh=Number(member.fetchedAt)>0&&member.fetchedAt<=now&&now-member.fetchedAt<=300000;
      const aged=!(Number(member.updatedAt)>0&&member.updatedAt<=now)||now-member.updatedAt>30*86400000;
      const available=['published','published_empty'].includes(member.status)&&fresh;
      const status=available?'available':['published','published_empty'].includes(member.status)?'stale':member.status==='loading'?'loading':'unavailable';
      const changes=wantsChanges(member.entries,member.previous??null,options);
      if(available)for(const raw of member.entries||[]){
        if(raw.intent!=='lf'||scope==='top'&&raw.p!=='H')continue;
        if(scope==='new'&&!changes.changed.includes(raw)||scope==='newTop'&&!changes.newTop.includes(raw))continue;
        const entry={...raw,backgroundId:''},key=wantedIntentKey(entry,options)+'|'+JSON.stringify(entry.note||'');
        if(!rows.has(key))rows.set(key,{...entry,key,members:[]});
        const row=rows.get(key);
        const previous=row.members.find(item=>item.key===member.key);
        if(!previous)row.members.push({key:member.key,displayName:member.displayName,p:entry.p||'',priorities:[entry.p||'']});
        else if(!previous.priorities.includes(entry.p||''))previous.priorities.push(entry.p||'');
      }
      return{...member,status,aged,changes:available?changes:null,entries:undefined};
    });
    return{members:states,entries:[...rows.values()]};
  }
  root.tradeListComparison=Object.freeze({FLAG_KEYS,cleanEntry,qualifierKey,wantedIntentKey,compareWantedLists,declarationKey,unifyDeclarations,compareDeclarations,wantsChanges,groupWants});
})(window);
