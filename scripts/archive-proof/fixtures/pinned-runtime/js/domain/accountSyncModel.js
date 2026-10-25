(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const SCHEMA_VERSION=1;
  const DATABASE_NAME='pogoAccountSync_v1';
  const ENTITY_TYPES=Object.freeze(['tradeEntry','favorite','tag']);
  const TRADE_SURFACES=Object.freeze(['my-list','special-board']);
  const TRADE_LANES=Object.freeze(['wishlist','dynamax','gmax','costumes','looking-for','for-trade']);
  const TRADE_FIELDS=Object.freeze(['priority','variant','gender','lucky','xxl','xxs','shiny','backgroundId','sortOrder','quantity','note','mirror']);
  const PROFILE_VALUE_FIELDS=Object.freeze(['friendCode','bio','discord','avatarPokemon']);
  const PROFILE_RECORD_FIELDS=Object.freeze(['schemaVersion','ownerUid',...PROFILE_VALUE_FIELDS,'revision','createdAt','lastUpdated']);
  const PROFILE_TEXT_LIMITS=Object.freeze({friendCode:14,bio:120,discord:40,avatarPokemon:120});
  const RETRY_DELAYS=Object.freeze([1000,2000,4000,8000,16000,30000]);
  // Only the known pre-.70 acknowledgement case and exhausted transient
  // repository failures may receive one explicit user-requested retry.
  const SAFE_BLOCKED_RETRY_CODES=Object.freeze([
    'account-sync/committed-entity-invalid',
    'account-sync/network-failed',
    'account-sync/transaction-aborted'
  ]);
  const SAFE_BLOCKED_RETRY_SET=new Set(SAFE_BLOCKED_RETRY_CODES);
  const UNSAFE_RECOVERY_CODES=Object.freeze([
    'account-sync/catalog-projection-unresolved','account-sync/canonical-validation-failed','account-sync/conflict-current-invalid',
    'account-sync/idempotency-conflict','account-sync/migration-evidence-conflict','account-sync/owner-mismatch',
    'account-sync/meta-conflict',
    'account-sync/recovery-candidate-conflict','account-sync/remote-entity-invalid','account-sync/remote-entity-missing',
    'account-sync/remote-revision-invalid','account-sync/remote-version-substitution','account-sync/listener-authority-lost',
    'account-sync/watched-write-unreconciled'
  ]);
  const UNSAFE_RECOVERY_SET=new Set(UNSAFE_RECOVERY_CODES);
  const FIREBASE_KEY_FORBIDDEN=/[.#$\[\]/\u0000-\u001f\u007f]/u;
  const PROFILE_UNSAFE_TEXT=/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;
  const HEX_64=/^[a-f0-9]{64}$/;

  function failure(code,message,detail){
    return Object.freeze({ok:false,error:Object.freeze({code,message,...(detail?{detail}: {})})});
  }
  function plainObject(value){return!!value&&typeof value==='object'&&!Array.isArray(value);}
  function integer(value,min=0){return Number.isSafeInteger(value)&&value>=min?value:null;}
  function exactText(value,max=512){
    const text=String(value??'').normalize('NFC').trim();
    return text&&Array.from(text).length<=max?text:'';
  }
  function firebaseKey(value,max=512){
    const text=exactText(value,max);
    return text&&!FIREBASE_KEY_FORBIDDEN.test(text)&&text!=='.'&&text!=='..'?text:'';
  }
  function profileText(value,max){
    const text=String(value??'').normalize('NFC').trim();
    return Array.from(text).length<=max&&!PROFILE_UNSAFE_TEXT.test(text)?text:null;
  }
  function normalizeFriendCode(value){
    const text=profileText(value,PROFILE_TEXT_LIMITS.friendCode);
    if(text===null)return null;
    if(!text)return'';
    if(!/^[0-9 -]+$/.test(text))return null;
    const digits=text.replace(/[ -]/g,'');
    return/^[0-9]{12}$/.test(digits)?digits.replace(/(\d{4})(?=\d)/g,'$1 '):null;
  }
  function normalizeProfileValues(value={}){
    if(!plainObject(value)||Object.keys(value).some(key=>!PROFILE_VALUE_FIELDS.includes(key)))return failure('account-sync/profile-invalid','Provider profile contains unknown fields');
    const normalized={friendCode:normalizeFriendCode(value.friendCode),bio:profileText(value.bio,PROFILE_TEXT_LIMITS.bio),discord:profileText(value.discord,PROFILE_TEXT_LIMITS.discord),avatarPokemon:profileText(value.avatarPokemon,PROFILE_TEXT_LIMITS.avatarPokemon)};
    if(Object.values(normalized).some(item=>item===null))return failure('account-sync/profile-invalid','Provider profile contains an invalid value');
    return Object.freeze({ok:true,value:Object.freeze(normalized)});
  }
  function profileValues(value={}){
    return Object.freeze(Object.fromEntries(PROFILE_VALUE_FIELDS.map(key=>[key,value?.[key]??''])));
  }
  function validateProfileRecord(value,{ownerUid}={}){
    const owner=firebaseKey(ownerUid,128),keys=plainObject(value)?Object.keys(value).sort():[],expected=[...PROFILE_RECORD_FIELDS].sort();
    if(!owner||keys.length!==expected.length||keys.some((key,index)=>key!==expected[index]))return failure('account-sync/profile-invalid','Provider profile record shape is invalid');
    const normalized=normalizeProfileValues(profileValues(value)),revision=integer(value.revision,1),createdAt=integer(value.createdAt),lastUpdated=integer(value.lastUpdated);
    if(!normalized.ok||value.schemaVersion!==SCHEMA_VERSION||value.ownerUid!==owner||revision===null||createdAt===null||lastUpdated===null||lastUpdated<createdAt||canonicalJson(normalized.value)!==canonicalJson(profileValues(value)))return failure('account-sync/profile-invalid','Provider profile record is invalid');
    return Object.freeze({ok:true,value:Object.freeze({...value,...normalized.value})});
  }
  function stable(value){
    if(Array.isArray(value))return value.map(stable);
    if(plainObject(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
    return value;
  }
  function canonicalJson(value){return JSON.stringify(stable(value));}
  function utf8Bytes(value){
    const encoded=unescape(encodeURIComponent(String(value)));
    return Uint8Array.from(encoded,character=>character.charCodeAt(0));
  }
  function base64Url(value){
    const bytes=utf8Bytes(value);
    let binary='';
    for(let index=0;index<bytes.length;index+=0x8000)binary+=String.fromCharCode(...bytes.subarray(index,index+0x8000));
    const encoded=typeof global.btoa==='function'?global.btoa(binary):'';
    if(!encoded)throw new Error('Base64 encoder unavailable');
    return encoded.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function tradeEntryId({surface,lane,catalogId}={}){
    const normalizedSurface=exactText(surface,32),normalizedLane=exactText(lane,32),normalizedCatalogId=exactText(catalogId,256);
    if(!TRADE_SURFACES.includes(normalizedSurface)||!TRADE_LANES.includes(normalizedLane)||!normalizedCatalogId){
      throw new TypeError('Trade entry identity is invalid');
    }
    return`te_${base64Url(canonicalJson([SCHEMA_VERSION,'pogo-account-trade-entry',normalizedSurface,normalizedLane,normalizedCatalogId]))}`;
  }
  async function tagIdFromLegacy({ownerUid,label,legacyId}={},cryptoImpl=global.crypto){
    const owner=firebaseKey(ownerUid,128),name=exactText(label,80),prior=exactText(legacyId,128);
    if(!owner||!name)throw new TypeError('Tag identity is invalid');
    return`tag_${await sha256Hex(canonicalJson([SCHEMA_VERSION,'pogo-account-tag',owner,prior||name.toLocaleLowerCase('en-US')]),cryptoImpl)}`;
  }
  function newTagId(cryptoImpl=global.crypto){
    return`tag_${operationId(cryptoImpl).slice(3)}`;
  }
  function fieldToken(path){return`f_${base64Url(String(path))}`;}
  function fieldMetadataPath(entityType,path){
    const value=String(path||'');
    return entityType==='favorite'&&value.startsWith('tagIds/')?value:fieldToken(value);
  }
  function entityPath(ownerUid,entityType,entityId){
    const owner=firebaseKey(ownerUid,128),id=firebaseKey(entityId,700);
    if(!owner||!id||!ENTITY_TYPES.includes(entityType))throw new TypeError('Sync entity path is invalid');
    const collection={tradeEntry:'tradeEntries',favorite:'favorites',tag:'tags'}[entityType];
    return`accountSync/${owner}/${collection}/${id}`;
  }
  function fieldPathValid(entityType,path){
    const value=String(path||'');
    if(entityType==='tradeEntry')return TRADE_FIELDS.includes(value);
    if(entityType==='favorite'){
      if(value==='displayName')return true;
      const match=/^tagIds\/([^/]+)$/.exec(value);
      return!!match&&/^tag_[a-zA-Z0-9_-]{1,700}$/.test(match[1]);
    }
    return entityType==='tag'&&value==='label';
  }
  function fieldValueValid(entityType,path,value){
    if(!fieldPathValid(entityType,path))return false;
    if(entityType==='tradeEntry'){
      if(path==='priority')return['','H','M','L'].includes(value);
      if(['lucky','xxl','xxs','shiny','mirror'].includes(path))return typeof value==='boolean';
      if(path==='sortOrder')return Number.isSafeInteger(value)&&value>=0&&value<=100000;
      if(path==='quantity')return Number.isSafeInteger(value)&&value>=1&&value<=999;
      if(path==='gender')return['','m','f'].includes(value);
      if(path==='variant'||path==='note')return typeof value==='string'&&Array.from(value).length<=160;
      if(path==='backgroundId')return typeof value==='string'&&Array.from(value).length<=160;
    }
    if(entityType==='favorite')return path==='displayName'
      ?typeof value==='string'&&!!exactText(value,64)
      :typeof value==='boolean';
    return entityType==='tag'&&typeof value==='string'&&!!exactText(value,40);
  }
  function identityValid(entityType,entityId,identity){
    if(!plainObject(identity))return false;
    if(entityType==='tradeEntry'){
      try{return tradeEntryId(identity)===entityId&&Object.keys(identity).sort().join(',')==='catalogId,lane,surface';}catch{return false;}
    }
    if(entityType==='favorite')return Object.keys(identity).sort().join(',')==='targetUid'&&firebaseKey(identity.targetUid,128)===entityId;
    return entityType==='tag'&&Object.keys(identity).sort().join(',')==='tagId'&&identity.tagId===entityId&&/^tag_[a-zA-Z0-9_-]{1,700}$/.test(entityId);
  }
  function operationId(cryptoImpl=global.crypto){
    if(typeof cryptoImpl?.randomUUID==='function')return`op_${cryptoImpl.randomUUID().replace(/-/g,'')}`;
    if(typeof cryptoImpl?.getRandomValues!=='function')throw new Error('Secure random operation IDs are unavailable');
    const bytes=new Uint8Array(24);cryptoImpl.getRandomValues(bytes);
    return`op_${Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('')}`;
  }
  async function sha256Hex(value,cryptoImpl=global.crypto){
    if(typeof cryptoImpl?.subtle?.digest!=='function')throw new Error('SHA-256 is unavailable');
    const digest=await cryptoImpl.subtle.digest('SHA-256',utf8Bytes(String(value)));
    return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  function canonicalOperationInput(value){
    return[
      SCHEMA_VERSION,'pogo-account-sync-operation',value.operationId,value.ownerUid,value.entityType,value.entityId,
      value.kind,value.baseGeneration,value.generation,value.baseFieldRevisions,value.patch,value.clientAt
    ];
  }
  async function createOperation(input={},options={}){
    const ownerUid=firebaseKey(input.ownerUid,128),entityType=String(input.entityType||''),entityId=firebaseKey(input.entityId,700);
    const kind=String(input.kind||''),baseGeneration=integer(input.baseGeneration),generation=integer(input.generation),clientAt=integer(input.clientAt);
    const id=firebaseKey(input.operationId||operationId(options.crypto||global.crypto),100);
    if(!ownerUid||!ENTITY_TYPES.includes(entityType)||!entityId||!['add','patch','delete'].includes(kind)||baseGeneration===null||generation===null||clientAt===null||!id){
      return failure('account-sync/operation-invalid','Sync operation metadata is invalid');
    }
    const patch=plainObject(input.patch)?stable(input.patch):{};
    if((kind==='patch'||kind==='add')&&!Object.keys(patch).length)return failure('account-sync/patch-empty','Sync operation has no fields');
    if(kind!=='patch'&&kind!=='add'&&Object.keys(patch).length)return failure('account-sync/patch-unexpected','Delete operations cannot include fields');
    for(const [path,value] of Object.entries(patch))if(!fieldValueValid(entityType,path,value))return failure('account-sync/field-invalid','Sync operation contains an invalid field',{path});
    const baseFieldRevisions={};
    for(const path of Object.keys(patch).sort()){
      const revision=integer(input.baseFieldRevisions?.[path]);
      if(revision===null)return failure('account-sync/field-revision-invalid','Sync operation field revision is invalid',{path});
      baseFieldRevisions[path]=revision;
    }
    if(kind==='patch'&&(generation!==baseGeneration||generation<1))return failure('account-sync/generation-invalid','Patch generation is invalid');
    if(kind!=='patch'&&generation!==baseGeneration+1)return failure('account-sync/generation-invalid','Lifecycle generation is invalid');
    const identity=stable(input.identity||{});
    if(kind==='add'&&!identityValid(entityType,entityId,identity))return failure('account-sync/identity-invalid','Sync entity identity is invalid');
    const value={schemaVersion:SCHEMA_VERSION,operationId:id,ownerUid,entityType,entityId,kind,baseGeneration,generation,baseFieldRevisions,patch,identity:kind==='add'?identity:null,clientAt};
    const inputHash=await sha256Hex(canonicalJson(canonicalOperationInput(value)),options.crypto||global.crypto);
    return Object.freeze({ok:true,value:Object.freeze({...value,inputHash})});
  }
  async function verifyOperation(value,options={}){
    if(!plainObject(value)||value.schemaVersion!==SCHEMA_VERSION||!HEX_64.test(String(value.inputHash||'')))return failure('account-sync/operation-invalid','Sync operation is malformed');
    const rebuilt=await createOperation(value,options);
    if(!rebuilt.ok)return rebuilt;
    if(rebuilt.value.inputHash!==value.inputHash)return failure('account-sync/input-hash-mismatch','Sync operation input hash does not match its contents');
    return Object.freeze({ok:true,value:rebuilt.value});
  }
  function publicTradeProjection(entities){
    return Object.values(entities||{}).filter(entity=>entity?.entityType==='tradeEntry'&&entity.deleted!==true).map(entity=>Object.freeze({
      entryId:entity.entityId,...stable(entity.identity),...stable(entity.values)
    }));
  }
  function retryDelay(attempts){
    const count=Math.max(0,Number(attempts)||0);
    return RETRY_DELAYS[Math.min(count,RETRY_DELAYS.length-1)];
  }
  function blockedRetryCategory(value){
    const code=String(value||'');
    if(code==='account-sync/committed-entity-invalid')return'historical-acknowledgement';
    if(SAFE_BLOCKED_RETRY_SET.has(code))return'transient-transport';
    return'unsafe';
  }
  function blockedRetryEligible(record){
    return record?.status==='blocked'&&blockedRetryCategory(record.lastErrorCode)!=='unsafe';
  }
  function unsafeRecoveryCode(value){
    const code=String(value||'');
    return UNSAFE_RECOVERY_SET.has(code)||/^account-sync\/(?:schema|transition)-/.test(code);
  }

  root.accountSyncModel=Object.freeze({
    SCHEMA_VERSION,DATABASE_NAME,ENTITY_TYPES,TRADE_SURFACES,TRADE_LANES,TRADE_FIELDS,PROFILE_VALUE_FIELDS,PROFILE_RECORD_FIELDS,PROFILE_TEXT_LIMITS,RETRY_DELAYS,SAFE_BLOCKED_RETRY_CODES,UNSAFE_RECOVERY_CODES,
    plainObject,integer,exactText,firebaseKey,stable,canonicalJson,base64Url,tradeEntryId,tagIdFromLegacy,newTagId,fieldToken,fieldMetadataPath,
    fieldPathValid,fieldValueValid,identityValid,entityPath,normalizeFriendCode,normalizeProfileValues,profileValues,validateProfileRecord,operationId,sha256Hex,canonicalOperationInput,
    createOperation,verifyOperation,publicTradeProjection,retryDelay,blockedRetryCategory,blockedRetryEligible,unsafeRecoveryCode,failure
  });
})(window);
