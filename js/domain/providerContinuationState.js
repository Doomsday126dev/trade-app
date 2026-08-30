(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const SCHEMA_VERSION=1;
  const DEFAULT_TTL_MS=10*60*1000;
  const ACTIVE_KEY='pogo-provider-continuation:v1';
  const STORAGE_OWNER_KEY='pogo-provider-continuation-owner:v1';
  const CONSUMED_PREFIX='pogo-provider-continuation-consumed:v1:';
  const OPERATIONS=Object.freeze(['link','sign-in','reauthenticate','unlink']);
  const PROVIDERS=Object.freeze(['google','discord']);
  const HEX_32=/^[a-f0-9]{64}$/;
  const OPAQUE_BINDING=/^v1_[a-f0-9]{64}$/;
  const OPAQUE_OWNER=/^tab_[a-f0-9]{32}$/;

  function error(code){const value=new Error(code);value.code=code;return value;}
  function bytesHex(bytes){return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');}
  function randomHex(crypto,size){
    if(!crypto?.getRandomValues)throw error('provider-continuation/crypto-unavailable');
    return bytesHex(crypto.getRandomValues(new Uint8Array(size)));
  }
  async function opaqueBinding(value,{crypto=global.crypto,purpose='owner'}={}){
    if(typeof value!=='string'||!value)throw error('provider-continuation/binding-source-invalid');
    if(!crypto?.subtle?.digest)throw error('provider-continuation/crypto-unavailable');
    const encoded=new TextEncoder().encode(`pogo-provider-${purpose}-v1\0${value}`);
    return`v1_${bytesHex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoded)))}`;
  }
  function safeRoute(value){
    const route=String(value||'');
    if(!/^#settings\/(?:security|account)$/.test(route))throw error('provider-continuation/route-invalid');
    return route;
  }
  function exactRecord(value){
    if(!value||typeof value!=='object'||Array.isArray(value))throw error('provider-continuation/malformed');
    const fields=['schemaVersion','operation','providerKey','ownerBinding','lifecycleBinding','returnRoute','nonce','issuedAt','expiresAt','storageOwner'];
    if(Object.keys(value).sort().join(',')!==fields.sort().join(','))throw error('provider-continuation/malformed');
    if(value.schemaVersion!==SCHEMA_VERSION||!OPERATIONS.includes(value.operation)||!PROVIDERS.includes(value.providerKey))throw error('provider-continuation/malformed');
    if(value.operation==='sign-in'){
      if(value.ownerBinding!==''||value.lifecycleBinding!=='')throw error('provider-continuation/owner-invalid');
    }else if(!OPAQUE_BINDING.test(value.ownerBinding)||!OPAQUE_BINDING.test(value.lifecycleBinding))throw error('provider-continuation/owner-invalid');
    if(!HEX_32.test(value.nonce)||!OPAQUE_OWNER.test(value.storageOwner))throw error('provider-continuation/malformed');
    if(!Number.isSafeInteger(value.issuedAt)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=value.issuedAt)throw error('provider-continuation/malformed');
    safeRoute(value.returnRoute);
    return Object.freeze({...value});
  }
  function createProviderContinuationState({storage=global.sessionStorage,crypto=global.crypto,clock=()=>Date.now(),ttlMs=DEFAULT_TTL_MS}={}){
    if(!storage?.getItem||!storage?.setItem||!storage?.removeItem)throw error('provider-continuation/storage-unavailable');
    const ttl=Math.min(DEFAULT_TTL_MS,Math.max(30*1000,Number(ttlMs)||DEFAULT_TTL_MS));
    function storageOwner(){
      const existing=storage.getItem(STORAGE_OWNER_KEY);
      if(OPAQUE_OWNER.test(existing||''))return existing;
      const created=`tab_${randomHex(crypto,16)}`;storage.setItem(STORAGE_OWNER_KEY,created);return created;
    }
    function read(){
      const raw=storage.getItem(ACTIVE_KEY);if(!raw)return null;
      try{return exactRecord(JSON.parse(raw));}catch(cause){storage.removeItem(ACTIVE_KEY);throw cause;}
    }
    function issue({operation,providerKey,ownerBinding='',lifecycleBinding='',returnRoute='#settings/security'}={}){
      if(!OPERATIONS.includes(operation)||!PROVIDERS.includes(providerKey))throw error('provider-continuation/request-invalid');
      const issuedAt=Number(clock());if(!Number.isSafeInteger(issuedAt))throw error('provider-continuation/clock-invalid');
      const record=exactRecord({schemaVersion:SCHEMA_VERSION,operation,providerKey,ownerBinding,lifecycleBinding,returnRoute:safeRoute(returnRoute),nonce:randomHex(crypto,32),issuedAt,expiresAt:issuedAt+ttl,storageOwner:storageOwner()});
      storage.setItem(ACTIVE_KEY,JSON.stringify(record));
      return record;
    }
    function consume({nonce,operation,providerKey,ownerBinding='',lifecycleBinding=''}={}){
      if(HEX_32.test(nonce||'')&&storage.getItem(`${CONSUMED_PREFIX}${nonce}`)==='1')throw error('provider-continuation/replayed');
      const record=read();if(!record)throw error('provider-continuation/missing');
      if(record.nonce!==nonce)throw error('provider-continuation/nonce-mismatch');
      if(record.storageOwner!==storageOwner())throw error('provider-continuation/storage-owner-mismatch');
      if(record.operation!==operation)throw error('provider-continuation/operation-mismatch');
      if(record.providerKey!==providerKey)throw error('provider-continuation/provider-mismatch');
      if(record.ownerBinding!==ownerBinding||record.lifecycleBinding!==lifecycleBinding)throw error('provider-continuation/owner-mismatch');
      if(Number(clock())>=record.expiresAt){storage.removeItem(ACTIVE_KEY);throw error('provider-continuation/expired');}
      storage.removeItem(ACTIVE_KEY);storage.setItem(`${CONSUMED_PREFIX}${record.nonce}`,'1');
      return record;
    }
    function cancel(){storage.removeItem(ACTIVE_KEY);}
    function inspect(){
      const record=read();
      return record?Object.freeze({schemaVersion:record.schemaVersion,operation:record.operation,providerKey:record.providerKey,returnRoute:record.returnRoute,issuedAt:record.issuedAt,expiresAt:record.expiresAt,active:true}):Object.freeze({schemaVersion:SCHEMA_VERSION,active:false});
    }
    return Object.freeze({issue,consume,cancel,inspect,storageOwner,ownerBinding:value=>opaqueBinding(value,{crypto,purpose:'owner'}),lifecycleBinding:value=>opaqueBinding(value,{crypto,purpose:'lifecycle'})});
  }

  root.providerContinuationState=Object.freeze({SCHEMA_VERSION,DEFAULT_TTL_MS,ACTIVE_KEY,STORAGE_OWNER_KEY,OPERATIONS,PROVIDERS,opaqueBinding,createProviderContinuationState});
})(window);
