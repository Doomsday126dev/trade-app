(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const model=root.accountSyncModel;
  if(!model)throw new Error('Account sync model must load before the product adapter');

  const MY_LIST_LANES=Object.freeze(['wishlist','dynamax','gmax','costumes']);
  const SPECIAL_BOARD_LANES=Object.freeze({lf:'looking-for',ft:'for-trade'});
  const DEVICE_LOCAL_STATE=Object.freeze([
    'priority-collapse','recent-trainers','viewed-list-history','language','theme','search-locale',
    'export-style','temporary-filters','dialog-state','community-view','cache'
  ]);
  const TRADE_DEFAULTS=Object.freeze({
    priority:'',variant:'',gender:'',lucky:false,xxl:false,xxs:false,shiny:false,
    backgroundId:'',sortOrder:0,quantity:1,note:'',mirror:false
  });
  const LIST_QUALIFIER_FIELDS=Object.freeze(['priority','variant','lucky','xxl','xxs','shiny','backgroundId']);

  function plain(value){return model.plainObject(value)?value:{};}
  function safeInteger(value,fallback=0,min=0,max=100000){
    return Number.isSafeInteger(value)&&value>=min&&value<=max?value:fallback;
  }
  function tradeValues(value={}){
    const values={
      priority:['H','M','L'].includes(value.priority||value.p)?value.priority||value.p:'',
      variant:String(value.variant??value.mod??'').normalize('NFC').trim().slice(0,160),
      gender:['m','f'].includes(value.gender)?value.gender:'',
      lucky:value.lucky===true,xxl:value.xxl===true,xxs:value.xxs===true,shiny:value.shiny===true,
      backgroundId:String(value.backgroundId||'').trim().slice(0,160),
      sortOrder:safeInteger(value.sortOrder),quantity:safeInteger(value.quantity??value.qty,1,1,999),
      note:String(value.note||'').normalize('NFC').trim().slice(0,160),mirror:value.mirror===true
    };
    for(const [field,fieldValue] of Object.entries(values))if(!model.fieldValueValid('tradeEntry',field,fieldValue))throw new TypeError(`Invalid trade sync field: ${field}`);
    return Object.freeze(values);
  }
  function listQualifierValues(value={}){
    return Object.freeze({
      priority:['H','M','L'].includes(value.priority||value.p)?value.priority||value.p:'',
      variant:String(value.variant??value.mod??'').normalize('NFC').trim().slice(0,160),
      lucky:value.lucky===true,xxl:value.xxl===true,xxs:value.xxs===true,shiny:value.shiny===true,
      backgroundId:String(value.backgroundId||'').trim().slice(0,160)
    });
  }
  function rebaseListEdit({base={},current={},desired={},decode,encode}={}){
    if(typeof decode!=='function'||typeof encode!=='function')throw new TypeError('My List rebase adapters are incomplete');
    const before=plain(base),latest=plain(current),requested=plain(desired),next={...latest};
    for(const name of new Set([...Object.keys(before),...Object.keys(requested)])){
      const beforeHas=Object.hasOwn(before,name),requestedHas=Object.hasOwn(requested,name);
      if(beforeHas===requestedHas&&model.canonicalJson(before[name])===model.canonicalJson(requested[name]))continue;
      if(!requestedHas){delete next[name];continue;}
      if(!beforeHas||!Object.hasOwn(latest,name)){next[name]=requested[name];continue;}
      const prior=listQualifierValues(decode(before[name],name)),wanted=listQualifierValues(decode(requested[name],name)),actual={...listQualifierValues(decode(latest[name],name))};let changed=false;
      for(const field of LIST_QUALIFIER_FIELDS)if(model.canonicalJson(prior[field])!==model.canonicalJson(wanted[field])){actual[field]=wanted[field];changed=true;}
      if(changed)next[name]=encode(actual,name);
    }
    return Object.freeze(next);
  }
  function priorityOrder(orders,lane,name,priority,fallback){
    const groups=orders?.[lane]?.priorities||orders?.[lane]||{};
    const group=Array.isArray(groups[priority||'U'])?groups[priority||'U']:[];
    const index=group.indexOf(name);
    return index>=0?index:fallback;
  }
  function listRows({lists={},orders={},parsePriority,catalogIdForListEntry,genderForVariant=()=>''}={}){
    if(typeof parsePriority!=='function'||typeof catalogIdForListEntry!=='function')throw new TypeError('My List sync adapters are incomplete');
    const rows=[],unresolved=[];
    for(const lane of MY_LIST_LANES){
      let fallback=0;
      for(const [name,encoded] of Object.entries(plain(lists[lane]))){
        const parsed=parsePriority(encoded,name,lane)||{},catalogId=String(catalogIdForListEntry({lane,name,encoded})||'').trim();
        if(!catalogId){unresolved.push(Object.freeze({surface:'my-list',lane,name,reason:'catalog-identity-unresolved'}));continue;}
        const identity={surface:'my-list',lane,catalogId},values=tradeValues({...parsed,gender:parsed.gender||genderForVariant(parsed.mod||parsed.variant||''),sortOrder:priorityOrder(orders,lane,name,parsed.p||parsed.priority,fallback++)});
        rows.push(Object.freeze({entityType:'tradeEntry',entityId:model.tradeEntryId(identity),identity,values,legacyName:name}));
      }
    }
    return Object.freeze({rows:Object.freeze(rows.sort((a,b)=>a.entityId.localeCompare(b.entityId))),unresolved:Object.freeze(unresolved)});
  }
  function specialBoardRows({board={},catalogIdForBoardEntry}={}){
    if(typeof catalogIdForBoardEntry!=='function')throw new TypeError('Special Trade Board sync adapter is incomplete');
    const rows=[],unresolved=[];
    for(const [side,lane] of Object.entries(SPECIAL_BOARD_LANES)){
      const entries=Array.isArray(board?.[side])?board[side]:[];
      entries.forEach((raw,index)=>{
        const catalogId=String(catalogIdForBoardEntry({side,lane,entry:raw,index})||'').trim();
        if(!catalogId){unresolved.push(Object.freeze({surface:'special-board',lane,name:String(raw?.name||''),reason:'catalog-identity-unresolved'}));return;}
        const identity={surface:'special-board',lane,catalogId},values=tradeValues({...raw,sortOrder:index,quantity:raw?.qty??raw?.quantity??1});
        rows.push(Object.freeze({entityType:'tradeEntry',entityId:model.tradeEntryId(identity),identity,values,legacyName:String(raw?.name||'')}));
      });
    }
    return Object.freeze({rows:Object.freeze(rows.sort((a,b)=>a.entityId.localeCompare(b.entityId))),unresolved:Object.freeze(unresolved)});
  }
  function changedFields(before={},after={}){
    const patch={};
    for(const field of model.TRADE_FIELDS)if(model.canonicalJson(before[field])!==model.canonicalJson(after[field]))patch[field]=after[field];
    return patch;
  }
  function planTradeMutations({currentEntities=[],desiredRows=[],scope}={}){
    const inScope=row=>!scope||(row?.identity?.surface===scope.surface&&scope.lanes?.includes(row.identity?.lane));
    const scopedDesired=(desiredRows||[]).filter(inScope),wanted=new Map(scopedDesired.map(row=>[row.entityId,row])),current=new Map();
    for(const entity of currentEntities||[]){
      if(entity?.entityType!=='tradeEntry')continue;
      if(scope&&(entity.identity?.surface!==scope.surface||!scope.lanes?.includes(entity.identity?.lane)))continue;
      current.set(entity.entityId,entity);
    }
    const mutations=[];
    for(const row of scopedDesired){
      const existing=current.get(row.entityId);
      if(!existing||existing.deleted===true)mutations.push(Object.freeze({kind:'add',...row}));
      else{
        const patch=changedFields(existing.values,row.values);
        if(Object.keys(patch).length)mutations.push(Object.freeze({kind:'patch',entityType:'tradeEntry',entityId:row.entityId,patch}));
      }
    }
    for(const entity of current.values())if(entity.deleted!==true&&!wanted.has(entity.entityId))mutations.push(Object.freeze({kind:'delete',entityType:'tradeEntry',entityId:entity.entityId}));
    return Object.freeze(mutations.sort((a,b)=>a.entityId.localeCompare(b.entityId)||a.kind.localeCompare(b.kind)));
  }
  function projectTradeEntities({entities=[],catalogEntryForId,encodePriority}={}){
    if(typeof catalogEntryForId!=='function'||typeof encodePriority!=='function')throw new TypeError('Trade projection adapters are incomplete');
    const lists=Object.fromEntries(MY_LIST_LANES.map(lane=>[lane,{}])),orders=Object.fromEntries(MY_LIST_LANES.map(lane=>[lane,{priorities:{H:[],M:[],L:[],U:[]}}]));
    const board={lf:[],ft:[]},unresolved=[];
    const active=(entities||[]).filter(entity=>entity?.entityType==='tradeEntry'&&entity.deleted!==true).sort((a,b)=>(a.values?.sortOrder??0)-(b.values?.sortOrder??0)||a.entityId.localeCompare(b.entityId));
    for(const entity of active){
      const catalog=catalogEntryForId(entity.identity.catalogId,entity.identity)||null;
      const name=String(catalog?.name||'').trim();
      if(!name){unresolved.push(Object.freeze({entityId:entity.entityId,catalogId:entity.identity.catalogId,reason:'catalog-projection-unresolved'}));continue;}
      const values=tradeValues(entity.values);
      if(entity.identity.surface==='my-list'&&MY_LIST_LANES.includes(entity.identity.lane)){
        lists[entity.identity.lane][name]=encodePriority(values);
        orders[entity.identity.lane].priorities[values.priority||'U'].push(name);
      }else if(entity.identity.surface==='special-board'){
        const side=entity.identity.lane==='looking-for'?'lf':entity.identity.lane==='for-trade'?'ft':'';
        if(side)board[side].push({name,dn:catalog.displayName||name,no:catalog.no||null,shiny:values.shiny,mirror:values.mirror,backgroundId:values.backgroundId,note:values.note,...(side==='ft'?{qty:values.quantity}:{})});
      }
    }
    return Object.freeze({lists,orders,board,unresolved:Object.freeze(unresolved)});
  }
  function projectAcceptedPublicRows({rows=[],catalogEntryForId,encodePriority}={}){
    if(!Array.isArray(rows))throw new TypeError('Accepted public trade projection is invalid');
    const expectedKeys=['entryId','surface','lane','catalogId',...model.TRADE_FIELDS].sort().join(',');
    const entities=rows.map(row=>{
      if(!plain(row)||Object.keys(row).sort().join(',')!==expectedKeys)throw new TypeError('Accepted public trade row shape is invalid');
      const identity={surface:row.surface,lane:row.lane,catalogId:row.catalogId},entityId=String(row.entryId||'');
      if(!model.identityValid('tradeEntry',entityId,identity))throw new TypeError('Accepted public trade row identity is invalid');
      const values=tradeValues(Object.fromEntries(model.TRADE_FIELDS.map(field=>[field,row[field]])));
      return Object.freeze({entityType:'tradeEntry',entityId,identity,deleted:false,values});
    });
    return projectTradeEntities({entities,catalogEntryForId,encodePriority});
  }
  function organizerProjection(entities=[]){
    const tags={},favorites=[];
    for(const entity of entities||[])if(entity?.entityType==='tag'&&entity.deleted!==true)tags[entity.entityId]={id:entity.entityId,label:entity.values.label,createdAt:entity.createdAt,updatedAt:entity.updatedAt};
    for(const entity of entities||[])if(entity?.entityType==='favorite'&&entity.deleted!==true){
      const tagIds=Object.entries(plain(entity.values.tagIds)).filter(([,selected])=>selected===true).map(([id])=>id).filter(id=>tags[id]).sort();
      favorites.push({targetUid:entity.entityId,displayName:entity.values.displayName,tagIds,createdAt:entity.createdAt,updatedAt:entity.updatedAt});
    }
    favorites.sort((a,b)=>a.displayName.localeCompare(b.displayName,'en',{sensitivity:'base'})||a.targetUid.localeCompare(b.targetUid));
    return Object.freeze({tags:Object.freeze(tags),favorites:Object.freeze(favorites)});
  }
  function favoritePatch({displayName,tagIds=[]}={}){
    const patch={displayName:String(displayName||'').normalize('NFC').trim()};
    for(const tagId of [...new Set(tagIds.map(String))].sort())patch[`tagIds/${tagId}`]=true;
    return patch;
  }
  function favoriteTagPatch(before=[],after=[]){
    const oldSet=new Set(before.map(String)),nextSet=new Set(after.map(String)),patch={};
    for(const id of new Set([...oldSet,...nextSet]))if(oldSet.has(id)!==nextSet.has(id))patch[`tagIds/${id}`]=nextSet.has(id);
    return patch;
  }
  function exactFavoriteTargetUid(username,{users={},authIndex={}}={}){
    const name=String(username||'').normalize('NFC').trim(),uid=model.firebaseKey(users?.[name]?.authUid,128);
    return uid&&String(authIndex?.[uid]?.username||'')===name?uid:'';
  }

  root.accountSyncProduct=Object.freeze({
    MY_LIST_LANES,SPECIAL_BOARD_LANES,DEVICE_LOCAL_STATE,TRADE_DEFAULTS,LIST_QUALIFIER_FIELDS,tradeValues,listQualifierValues,rebaseListEdit,listRows,specialBoardRows,
    changedFields,planTradeMutations,projectTradeEntities,projectAcceptedPublicRows,organizerProjection,favoritePatch,favoriteTagPatch,exactFavoriteTargetUid
  });
})(window);
