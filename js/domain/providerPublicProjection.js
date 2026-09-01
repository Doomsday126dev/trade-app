(function(global){
  'use strict';
  const root=global.PogoDomain=global.PogoDomain||{};
  const LIST_TYPES=Object.freeze(['wishlist','dynamax','gmax','costumes']);
  const STORED_FIELDS=Object.freeze(['lists','profile','publishedAt','publishedListTypes','schemaVersion','shareVersion','trainerName','updatedAt']);
  const REQUIRED_STORED_FIELDS=Object.freeze(STORED_FIELDS.filter(field=>field!=='lists'));
  const PUBLIC_FIELDS=Object.freeze(['lists','profile','publishedListTypes','updatedAt','username','version']);
  const PROFILE_FIELDS=Object.freeze(['avatarPokemon','bio','discord','friendCode','lastUpdated']);
  const ENTRY_FIELDS=Object.freeze(['backgroundId','lucky','mod','p','shiny','xxl','xxs']);
  const PRIORITIES=new Set(['H','M','L']);
  const BACKGROUND_ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
  const CONTROL=/[\u0000-\u001f\u007f]/u;
  const MAX_TOTAL_ENTRIES=2000;

  function plain(value){return!!value&&typeof value==='object'&&!Array.isArray(value);}
  function exact(value,fields){
    if(!plain(value))return false;
    const keys=Object.keys(value).sort(),expected=[...fields].sort();
    return keys.length===expected.length&&keys.every((key,index)=>key===expected[index]);
  }
  function optional(value,fields){return plain(value)&&Object.keys(value).every(key=>fields.includes(key));}
  function storedFields(value){return optional(value,STORED_FIELDS)&&REQUIRED_STORED_FIELDS.every(field=>Object.hasOwn(value,field));}
  function safeString(value,max,{empty=true}={}){return typeof value==='string'&&!CONTROL.test(value)&&value.length<=max&&(empty||value.length>0);}
  function safeTime(value,{positive=false}={}){return Number.isSafeInteger(value)&&value>=(positive?1:0);}
  function validEntry(value){
    if(typeof value==='string')return value.length>0&&value.length<=512&&!CONTROL.test(value);
    if(!optional(value,ENTRY_FIELDS)||!PRIORITIES.has(value.p))return false;
    if(Object.hasOwn(value,'mod')&&!safeString(value.mod,200))return false;
    for(const field of['lucky','shiny','xxl','xxs'])if(Object.hasOwn(value,field)&&typeof value[field]!=='boolean')return false;
    return!Object.hasOwn(value,'backgroundId')||value.backgroundId===''||safeString(value.backgroundId,120,{empty:false})&&BACKGROUND_ID.test(value.backgroundId);
  }
  function validatedLists(value){
    if(!optional(value||{},LIST_TYPES))return null;
    const lists={};let count=0;
    for(const type of LIST_TYPES){
      const source=value?.[type]||{};
      if(!plain(source))return null;
      const entries=Object.entries(source);count+=entries.length;if(count>MAX_TOTAL_ENTRIES)return null;
      lists[type]={};
      for(const[name,entry]of entries){
        if(!safeString(name,200,{empty:false})||!validEntry(entry))return null;
        lists[type][name]=plain(entry)?{...entry}:entry;
      }
    }
    return lists;
  }
  function validProfile(value){
    return exact(value,PROFILE_FIELDS)&&safeString(value.friendCode,32)&&safeString(value.bio,120)&&
      safeString(value.discord,40)&&safeString(value.avatarPokemon,80)&&safeTime(value.lastUpdated);
  }
  function publicSnapshotStatus(value,{trainerName}={}){
    const expected=String(trainerName||'').trim(),lists=exact(value,PUBLIC_FIELDS)?validatedLists(value.lists):null;
    if(!lists||value.version!==1||!safeString(value.username,64,{empty:false})||expected&&value.username!==expected||
      !validProfile(value.profile)||!safeTime(value.updatedAt,{positive:true})||!Array.isArray(value.publishedListTypes)||
      value.publishedListTypes.length!==LIST_TYPES.length||!LIST_TYPES.every((type,index)=>value.publishedListTypes[index]===type)){
      return Object.freeze({ok:false,status:'projection_unsupported'});
    }
    const snapshot={version:1,username:value.username,profile:{...value.profile},lists,
      publishedListTypes:[...LIST_TYPES],updatedAt:value.updatedAt};
    const projection=root.publicSharePublication?.publicShareProjectionStatus(snapshot,{username:value.username});
    return projection?.ok?Object.freeze({...projection,snapshot}):Object.freeze({ok:false,status:'projection_unsupported'});
  }
  function storedProjectionStatus(value,{trainerName}={}){
    const expected=String(trainerName||'').trim(),lists=storedFields(value)?validatedLists(value.lists):null;
    if(!lists||value.schemaVersion!==1||!Number.isSafeInteger(value.shareVersion)||value.shareVersion<1||
      !safeString(value.trainerName,64,{empty:false})||expected&&value.trainerName!==expected||
      !validProfile(value.profile)||!safeTime(value.publishedAt,{positive:true})||!safeTime(value.updatedAt,{positive:true})||
      value.updatedAt<value.publishedAt||!exact(value.publishedListTypes,LIST_TYPES)||
      !LIST_TYPES.every(type=>value.publishedListTypes[type]===true))return Object.freeze({ok:false,status:'projection_unsupported'});
    return publicSnapshotStatus({version:1,username:value.trainerName,profile:{...value.profile},lists,
      publishedListTypes:[...LIST_TYPES],updatedAt:value.updatedAt},{trainerName:expected});
  }
  function nextProjection(snapshot,current,{trainerName,now=Date.now()}={}){
    const expected=String(trainerName||'').trim();
    const normalized=root.publicSharePublication?.publicShareProjectionStatus(snapshot,{username:expected});
    if(!normalized?.ok||!safeTime(now,{positive:true}))throw Object.assign(new Error('provider-public/projection-invalid'),{code:'provider-public/projection-invalid'});
    const currentStatus=current===null||current===undefined?null:storedProjectionStatus(current,{trainerName:expected});
    if(currentStatus&&!currentStatus.ok)throw Object.assign(new Error('provider-public/existing-projection-invalid'),{code:'provider-public/existing-projection-invalid'});
    const priorVersion=current?.shareVersion||0,publishedAt=current?.publishedAt||now,updatedAt=Math.max(now,(current?.updatedAt||0)+1);
    const profile={...normalized.snapshot.profile,lastUpdated:Number(normalized.snapshot.profile.lastUpdated||0)||0};
    return Object.freeze({schemaVersion:1,shareVersion:priorVersion+1,trainerName:expected,profile,
      lists:Object.fromEntries(LIST_TYPES.map(type=>[type,{...normalized.snapshot.lists[type]}])),
      publishedListTypes:Object.fromEntries(LIST_TYPES.map(type=>[type,true])),publishedAt,updatedAt});
  }
  root.providerPublicProjection=Object.freeze({LIST_TYPES,PUBLIC_FIELDS,REQUIRED_STORED_FIELDS,STORED_FIELDS,nextProjection,publicSnapshotStatus,storedProjectionStatus});
})(window);
