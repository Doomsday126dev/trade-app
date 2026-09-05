(function(global){
  'use strict';
  const root=global.PogoDomain=global.PogoDomain||{};
  const LIST_TYPES=Object.freeze(['wishlist','dynamax','gmax','costumes']);
  const STORED_FIELDS=Object.freeze(['lists','profile','publishedAt','publishedListTypes','schemaVersion','shareVersion','trainerName','updatedAt']);
  const REQUIRED_STORED_FIELDS=Object.freeze(STORED_FIELDS.filter(field=>field!=='lists'));
  const PUBLIC_FIELDS=Object.freeze(['lists','profile','publishedListTypes','updatedAt','username','version']);
  const PROFILE_FIELDS=Object.freeze(['avatarPokemon','bio','discord','friendCode','lastUpdated']);
  const PROFILE_TEXT_LIMITS=Object.freeze({friendCode:14,bio:120,discord:40,avatarPokemon:120});
  const ENTRY_FIELDS=Object.freeze(['backgroundId','lucky','mod','p','shiny','xxl','xxs']);
  const PRIORITIES=new Set(['','H','M','L']);
  const BACKGROUND_ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
  const CONTROL=/[\u0000-\u001f\u007f]/u;
  const MAX_PROJECTION_BYTES=512*1024;
  const MAX_TOTAL_ENTRIES=2000;
  const DANGEROUS_KEYS=Object.freeze(['__proto__','prototype','constructor']);
  const DANGEROUS_KEY_SET=new Set(DANGEROUS_KEYS);

  function plain(value){return!!value&&typeof value==='object'&&!Array.isArray(value);}
  function dictionary(){return Object.create(null);}
  function safeDynamicKey(value,max){return safeString(value,max,{empty:false})&&!DANGEROUS_KEY_SET.has(value);}
  function exact(value,fields){
    if(!plain(value))return false;
    const keys=Object.keys(value).sort(),expected=[...fields].sort();
    return keys.length===expected.length&&keys.every((key,index)=>key===expected[index]);
  }
  function optional(value,fields){return plain(value)&&Object.keys(value).every(key=>fields.includes(key));}
  function storedFields(value){return optional(value,value?.schemaVersion===2?[...STORED_FIELDS,'declarations','declarationCount']:STORED_FIELDS)&&REQUIRED_STORED_FIELDS.every(field=>Object.hasOwn(value,field));}
  function safeString(value,max,{empty=true}={}){return typeof value==='string'&&!CONTROL.test(value)&&value.length<=max&&(empty||value.length>0);}
  function safeTime(value,{positive=false}={}){return Number.isSafeInteger(value)&&value>=(positive?1:0);}
  function serializedBytes(value){
    let json;try{json=JSON.stringify(value);}catch{return Number.POSITIVE_INFINITY;}
    if(typeof json!=='string')return Number.POSITIVE_INFINITY;
    let bytes=0;
    for(let index=0;index<json.length;index++){
      const code=json.charCodeAt(index);
      if(code<0x80)bytes+=1;
      else if(code<0x800)bytes+=2;
      else if(code>=0xd800&&code<=0xdbff&&index+1<json.length&&json.charCodeAt(index+1)>=0xdc00&&json.charCodeAt(index+1)<=0xdfff){bytes+=4;index++;}
      else bytes+=3;
      if(bytes>MAX_PROJECTION_BYTES)return bytes;
    }
    return bytes;
  }
  function validEntry(value){
    if(typeof value==='string')return value.length>0&&value.length<=512&&!CONTROL.test(value);
    if(!optional(value,ENTRY_FIELDS)||!PRIORITIES.has(value.p))return false;
    if(Object.hasOwn(value,'mod')&&!safeString(value.mod,200))return false;
    for(const field of['lucky','shiny','xxl','xxs'])if(Object.hasOwn(value,field)&&typeof value[field]!=='boolean')return false;
    return!Object.hasOwn(value,'backgroundId')||value.backgroundId===''||safeString(value.backgroundId,120,{empty:false})&&BACKGROUND_ID.test(value.backgroundId);
  }
  function validatedLists(value){
    if(!optional(value||{},LIST_TYPES))return null;
    const lists=dictionary();let count=0;
    for(const type of LIST_TYPES){
      const source=value?.[type]||{};
      if(!plain(source))return null;
      const entries=Object.entries(source);count+=entries.length;if(count>MAX_TOTAL_ENTRIES)return null;
      lists[type]=dictionary();
      for(const[name,entry]of entries){
        if(!safeDynamicKey(name,200)||!validEntry(entry))return null;
        lists[type][name]=plain(entry)?{...entry}:entry;
      }
      Object.freeze(lists[type]);
    }
    return Object.freeze(lists);
  }
  function validProfile(value){
    return exact(value,PROFILE_FIELDS)&&safeString(value.friendCode,PROFILE_TEXT_LIMITS.friendCode)&&
      safeString(value.bio,PROFILE_TEXT_LIMITS.bio)&&safeString(value.discord,PROFILE_TEXT_LIMITS.discord)&&
      safeString(value.avatarPokemon,PROFILE_TEXT_LIMITS.avatarPokemon)&&safeTime(value.lastUpdated);
  }
  function publicSnapshotStatus(value,{trainerName}={}){
    const expected=String(trainerName||'').trim(),unified=value?.version===2,lists=exact(value,unified?[...PUBLIC_FIELDS,'declarations','declarationCount']:PUBLIC_FIELDS)?validatedLists(value.lists):null;
    let declarations;
    if(unified){try{declarations=root.publicSharePublication.publicDeclarations(value.declarations??[],{strict:true});}catch{return Object.freeze({ok:false,status:'projection_unsupported'});}
      if(value.declarationCount!==declarations.length)return Object.freeze({ok:false,status:'projection_unsupported'});}
    if(serializedBytes(value)>MAX_PROJECTION_BYTES||!lists||![1,2].includes(value.version)||!safeString(value.username,64,{empty:false})||expected&&value.username!==expected||
      !validProfile(value.profile)||!safeTime(value.updatedAt,{positive:true})||!Array.isArray(value.publishedListTypes)||
      value.publishedListTypes.length!==LIST_TYPES.length||!LIST_TYPES.every((type,index)=>value.publishedListTypes[index]===type)){
      return Object.freeze({ok:false,status:'projection_unsupported'});
    }
    const snapshot=Object.freeze({version:unified?2:1,...(unified?{declarations,declarationCount:declarations.length}:{}),username:value.username,profile:Object.freeze({...value.profile}),lists,
      publishedListTypes:Object.freeze([...LIST_TYPES]),updatedAt:value.updatedAt});
    const entryCount=unified?declarations.length:LIST_TYPES.reduce((count,type)=>count+Object.keys(lists[type]).length,0);
    return Object.freeze({ok:true,status:entryCount?'published':'published_empty',entryCount,snapshot});
  }
  function storedProjectionStatus(value,{trainerName}={}){
    const expected=String(trainerName||'').trim(),lists=storedFields(value)?validatedLists(value.lists):null;
    if(serializedBytes(value)>MAX_PROJECTION_BYTES||!lists||![1,2].includes(value.schemaVersion)||!Number.isSafeInteger(value.shareVersion)||value.shareVersion<1||
      !safeString(value.trainerName,64,{empty:false})||expected&&value.trainerName!==expected||
      !validProfile(value.profile)||!safeTime(value.publishedAt,{positive:true})||!safeTime(value.updatedAt,{positive:true})||
      value.updatedAt<value.publishedAt||!exact(value.publishedListTypes,LIST_TYPES)||
      !LIST_TYPES.every(type=>value.publishedListTypes[type]===true))return Object.freeze({ok:false,status:'projection_unsupported'});
    return publicSnapshotStatus({version:value.schemaVersion,...(value.schemaVersion===2?{declarations:value.declarations??[],declarationCount:value.declarationCount}:{}),username:value.trainerName,profile:{...value.profile},lists,
      publishedListTypes:[...LIST_TYPES],updatedAt:value.updatedAt},{trainerName:expected});
  }
  function nextProjection(snapshot,current,{trainerName,now=Date.now()}={}){
    const expected=String(trainerName||'').trim();
    const normalized=publicSnapshotStatus(snapshot,{trainerName:expected});
    if(!normalized?.ok||!safeTime(now,{positive:true}))throw Object.assign(new Error('provider-public/projection-invalid'),{code:'provider-public/projection-invalid'});
    const currentStatus=current===null||current===undefined?null:storedProjectionStatus(current,{trainerName:expected});
    if(currentStatus&&!currentStatus.ok)throw Object.assign(new Error('provider-public/existing-projection-invalid'),{code:'provider-public/existing-projection-invalid'});
    const priorVersion=current?.shareVersion||0,publishedAt=current?.publishedAt||now,updatedAt=Math.max(now,(current?.updatedAt||0)+1);
    const profile={...normalized.snapshot.profile,lastUpdated:Number(normalized.snapshot.profile.lastUpdated||0)||0};
    const next={schemaVersion:normalized.snapshot.version,...(normalized.snapshot.version===2?{declarations:normalized.snapshot.declarations,declarationCount:normalized.snapshot.declarationCount}:{}),shareVersion:priorVersion+1,trainerName:expected,profile,
      lists:Object.fromEntries(LIST_TYPES.map(type=>[type,{...normalized.snapshot.lists[type]}])),
      publishedListTypes:Object.fromEntries(LIST_TYPES.map(type=>[type,true])),publishedAt,updatedAt};
    if(serializedBytes(next)>MAX_PROJECTION_BYTES)throw Object.assign(new Error('provider-public/projection-oversized'),{code:'provider-public/projection-oversized'});
    return Object.freeze(next);
  }
  function canonical(value){
    if(Array.isArray(value))return`[${value.map(canonical).join(',')}]`;
    if(plain(value))return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }
  function projectionContentMatches(snapshot,current,{trainerName}={}){
    const incoming=publicSnapshotStatus(snapshot,{trainerName}),stored=storedProjectionStatus(current,{trainerName});
    if(!incoming.ok||!stored.ok)return false;
    const content=value=>({version:value.version,username:value.username,profile:value.profile,lists:value.lists,publishedListTypes:value.publishedListTypes,...(value.version===2?{declarations:value.declarations}: {})});
    return canonical(content(incoming.snapshot))===canonical(content(stored.snapshot));
  }
  root.providerPublicProjection=Object.freeze({DANGEROUS_KEYS,LIST_TYPES,MAX_PROJECTION_BYTES,PROFILE_TEXT_LIMITS,PUBLIC_FIELDS,REQUIRED_STORED_FIELDS,STORED_FIELDS,nextProjection,projectionContentMatches,publicSnapshotStatus,storedProjectionStatus});
})(window);
