(function(global){
  const root=global.PogoServices=global.PogoServices||{};
  const REGION='us-central1';
  const READ_CALLABLE='readE1AccountFoundation';
  const CREATE_CALLABLE='createE1ProviderAccountFoundation';
  const CLIENT_RELEASE='2026-08-31.86';
  const PROVIDER_ACCOUNT_PROTOCOL_VERSION=1;
  const STORAGE_KEY='pogoProviderAccountOperation:v2';
  const HANDLE_KEY=/^v1_[a-f0-9]{2,512}$/;
  const SHA256=/^[a-f0-9]{64}$/;
  const REQUEST_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
  const FIREBASE_KEY_FORBIDDEN=/[.#$\[\]\/\u0000-\u001f\u007f]/u;
  const INVISIBLE_OR_BIDI=/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
  const HANDLE_ALLOWED=/^[\p{L}\p{N} _.'-]+$/u;
  const RESERVED_HANDLES=new Set(['admin','administrator','firebase','pogo trades','pogotrades','support','system']);
  const OPERATION_FIELDS=Object.freeze([
    'schemaVersion','uidDigest','requestId','requestedHandle','normalizedTrainerName','handleKey','lifecycleId',
    'providerAccountProtocolVersion','clientRelease','idempotencyFingerprint','phase'
  ]);
  const READ_FOUNDATION_FIELDS=Object.freeze([
    'canonicalTrainerName','handleKey','identityKind','legacyAccessConfigured','legacyUsername',
    'normalizedTrainerName','revision','schemaVersion','status'
  ]);
  const CREATE_FOUNDATION_FIELDS=Object.freeze([
    'canonicalTrainerName','handleKey','identityKind','legacyAccessConfigured','legacyUsername',
    'normalizedTrainerName','revision','schemaVersion','status'
  ]);
  const DEFINITE_CODES=new Set([
    'ACCOUNT_EXISTS','FOUNDATION_CONFLICT','HANDLE_CONFLICT','NAMESPACE_NOT_CERTIFIED','PROVIDER_CONFLICT',
    'PROVIDER_IDENTITY_REQUIRED','RATE_LIMITED','REQUEST_INVALID'
  ]);

  function failure(code,state='blocked',cause){const error=new Error(code);error.code=code;error.state=state;if(cause)error.cause=cause;return error;}
  function fail(code,state,cause){throw failure(code,state,cause);}
  function exactFields(value,fields){
    const keys=value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).sort():[];
    const expected=[...fields].sort();return keys.length===expected.length&&keys.every((key,index)=>key===expected[index]);
  }
  function codePointLength(value){return Array.from(value).length;}
  function scriptsIn(value){return[/\p{Script=Latin}/u,/\p{Script=Cyrillic}/u,/\p{Script=Greek}/u].filter(pattern=>pattern.test(value)).length;}
  function utf8Hex(value){return Array.from(new TextEncoder().encode(value),byte=>byte.toString(16).padStart(2,'0')).join('');}
  function normalizeHandle(value){
    const display=String(value??'').normalize('NFKC').trim(),normalized=display.toLowerCase();
    if(!display||codePointLength(display)>64||FIREBASE_KEY_FORBIDDEN.test(normalized)||INVISIBLE_OR_BIDI.test(display)||
      !HANDLE_ALLOWED.test(display)||RESERVED_HANDLES.has(normalized)||scriptsIn(display)>1)fail('provider-account/handle-invalid','handle-unavailable');
    return Object.freeze({display,normalized,handleKey:`v1_${utf8Hex(normalized)}`});
  }
  function hex(value){return Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');}
  async function sha256(value,cryptoImpl=global.crypto){
    if(!cryptoImpl?.subtle)fail('provider-account/crypto-unavailable','blocked');
    return hex(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  }
  async function requestFingerprint(input,cryptoImpl=global.crypto){
    return sha256(JSON.stringify([1,'createProviderAccountFoundation',input.providerAccountProtocolVersion,input.uid,input.requestId,
      input.normalizedTrainerName,input.handleKey,input.lifecycleId]),cryptoImpl);
  }
  function validateReadFoundation(value){
    if(!exactFields(value,READ_FOUNDATION_FIELDS)||value.schemaVersion!==1||!String(value.canonicalTrainerName||'')||
      !String(value.normalizedTrainerName||'')||!HANDLE_KEY.test(value.handleKey||'')||
      value.status!=='active'||!Number.isSafeInteger(value.revision)||value.revision<1)fail('provider-account/response-invalid');
    let normalized;try{normalized=normalizeHandle(value.canonicalTrainerName);}catch{fail('provider-account/response-invalid');}
    if(normalized.normalized!==value.normalizedTrainerName||normalized.handleKey!==value.handleKey||
      value.identityKind==='provider_only'&&(value.legacyAccessConfigured!==false||value.legacyUsername!==null)||
      value.identityKind==='legacy_migrated'&&(value.legacyAccessConfigured!==true||
        typeof value.legacyUsername!=='string'||!value.legacyUsername)||
      !new Set(['provider_only','legacy_migrated']).has(value.identityKind))fail('provider-account/response-invalid');
    return Object.freeze({...value});
  }
  function validateReadResponse(value){
    if(exactFields(value,['code'])&&value.code==='FOUNDATION_NOT_INITIALIZED')return Object.freeze({status:'missing'});
    if(!exactFields(value,['code','foundation'])||value.code!=='SUCCESS')fail('provider-account/response-invalid');
    return Object.freeze({status:'ready',foundation:validateReadFoundation(value.foundation)});
  }
  function validateCreateResponse(value){
    if(!exactFields(value,['code','foundation'])||!new Set(['SUCCESS','IDEMPOTENT','RECONCILED']).has(value.code)||
      !exactFields(value.foundation,CREATE_FOUNDATION_FIELDS))fail('provider-account/response-invalid');
    const foundation=value.foundation;
    if(foundation.schemaVersion!==1||!String(foundation.canonicalTrainerName||'')||
      !String(foundation.normalizedTrainerName||'')||!HANDLE_KEY.test(foundation.handleKey||'')||
      foundation.legacyUsername!==null||foundation.identityKind!=='provider_only'||
      foundation.legacyAccessConfigured!==false||foundation.status!=='active'||foundation.revision!==1){
      fail('provider-account/response-invalid');
    }
    return Object.freeze({code:value.code,foundation:Object.freeze({...foundation})});
  }
  function bounded(value,timeoutMs,code){
    let timer;return Promise.race([Promise.resolve(value),new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(failure(code,'retryable')),timeoutMs);
    })]).finally(()=>clearTimeout(timer));
  }
  function safeServerCode(error){
    const detail=String(error?.details?.code||'');if(DEFINITE_CODES.has(detail))return detail;
    const direct=String(error?.code||'');return DEFINITE_CODES.has(direct)?direct:'';
  }
  function createProviderAccountClient({firebaseApp,auth,firebaseAppCheckReady,getLifecycleSnapshot,importFunctionsSdk,
    storage=global.localStorage,cryptoImpl=global.crypto,timeoutMs=15000,clientRelease=CLIENT_RELEASE,
    providerAccountProtocolVersion=PROVIDER_ACCOUNT_PROTOCOL_VERSION}={}){
    if(!firebaseApp||!auth||typeof firebaseAppCheckReady!=='function'||typeof getLifecycleSnapshot!=='function'||
      typeof importFunctionsSdk!=='function'||!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function'||
      !/^\d{4}-\d{2}-\d{2}\.\d+$/.test(clientRelease)||providerAccountProtocolVersion!==PROVIDER_ACCOUNT_PROTOCOL_VERSION||
      !Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000){
      fail('provider-account/dependencies-invalid');
    }
    let generation=0;
    function lifecycle(){
      const value=getLifecycleSnapshot(),uid=String(value?.uid||''),lifecycleId=String(value?.lifecycleId||'');
      if(!uid||auth.currentUser?.uid!==uid||!/^auth-[1-9][0-9]{0,9}$/.test(lifecycleId))fail('provider-account/auth-lifecycle-changed','canceled');
      return Object.freeze({uid,lifecycleId});
    }
    function current(expected){const value=lifecycle();if(value.uid!==expected.uid||value.lifecycleId!==expected.lifecycleId)fail('provider-account/auth-lifecycle-changed','canceled');return value;}
    function loadOperation(){
      let value=null;try{value=JSON.parse(storage.getItem(STORAGE_KEY)||'null');}catch{}
      return exactFields(value,OPERATION_FIELDS)&&value.schemaVersion===1&&SHA256.test(value.uidDigest||'')&&
        REQUEST_ID.test(value.requestId||'')&&HANDLE_KEY.test(value.handleKey||'')&&SHA256.test(value.idempotencyFingerprint||'')&&
        value.providerAccountProtocolVersion===PROVIDER_ACCOUNT_PROTOCOL_VERSION&&
        ['prepared','dispatched','ambiguous','complete'].includes(value.phase)?Object.freeze(value):null;
    }
    function saveOperation(value){storage.setItem(STORAGE_KEY,JSON.stringify(value));return Object.freeze({...value});}
    function clearOperation(){try{storage.removeItem(STORAGE_KEY);}catch{}return Object.freeze({ok:true});}
    async function uidDigest(uid){return sha256(JSON.stringify([1,'provider-account-operation-owner',uid]),cryptoImpl);}
    async function invoke(name,data,{limitedUse=false,forceRefresh=false,expected}={}){
      const requestGeneration=++generation,user=auth.currentUser;
      if(!user?.uid||typeof user.getIdToken!=='function')fail('provider-account/auth-required','canceled');
      current(expected);
      await bounded(user.getIdToken(forceRefresh),timeoutMs,'provider-account/id-token-timeout');
      const readiness=await bounded(firebaseAppCheckReady(),timeoutMs,'provider-account/app-check-timeout');
      if(!readiness?.ok||!readiness.instance)fail('provider-account/app-check-unavailable','retryable');
      const sdk=await bounded(importFunctionsSdk(),timeoutMs,'provider-account/sdk-timeout');
      if(typeof sdk?.getFunctions!=='function'||typeof sdk?.httpsCallable!=='function')fail('provider-account/sdk-invalid');
      current(expected);if(requestGeneration!==generation)fail('provider-account/request-superseded','canceled');
      const callable=sdk.httpsCallable(sdk.getFunctions(firebaseApp,REGION),name,
        limitedUse?{limitedUseAppCheckTokens:true}:undefined);
      if(typeof callable!=='function')fail('provider-account/sdk-invalid');
      const result=await bounded(callable(data),timeoutMs,'provider-account/callable-timeout');
      current(expected);if(requestGeneration!==generation)fail('provider-account/request-superseded','canceled');
      return result?.data;
    }
    async function read(){
      const expected=lifecycle();
      try{return validateReadResponse(await invoke(READ_CALLABLE,{schemaVersion:1},{expected}));}
      catch(error){if(/^provider-account\//.test(String(error?.code||'')))throw error;throw failure('provider-account/read-failed','retryable',error);}
    }
    function exactFoundation(result,operation){
      const foundation=result?.status==='ready'?result.foundation:null;
      return!!foundation&&foundation.identityKind==='provider_only'&&foundation.canonicalTrainerName===operation.requestedHandle&&
        foundation.normalizedTrainerName===operation.normalizedTrainerName&&foundation.handleKey===operation.handleKey;
    }
    async function reconcile(operation){
      const result=await read();
      if(exactFoundation(result,operation)){
        saveOperation({...operation,phase:'complete'});
        return Object.freeze({status:'account-ready',code:'RECONCILED',foundation:result.foundation});
      }
      saveOperation({...operation,phase:'ambiguous'});
      throw failure('provider-account/ambiguous-result','ambiguous');
    }
    async function prepare(rawHandle,expected){
      const handle=normalizeHandle(rawHandle),digest=await uidDigest(expected.uid),stored=loadOperation();
      if(stored&&stored.uidDigest===digest&&stored.requestedHandle===handle.display&&
        stored.lifecycleId===expected.lifecycleId&&stored.providerAccountProtocolVersion===providerAccountProtocolVersion)return stored;
      if(stored&&['dispatched','ambiguous'].includes(stored.phase))fail('provider-account/pending-reconciliation','ambiguous');
      const requestId=typeof cryptoImpl.randomUUID==='function'?cryptoImpl.randomUUID():fail('provider-account/crypto-unavailable');
      const input={uid:expected.uid,requestId,normalizedTrainerName:handle.normalized,handleKey:handle.handleKey,
        lifecycleId:expected.lifecycleId,providerAccountProtocolVersion};
      const operation={schemaVersion:1,uidDigest:digest,requestId,requestedHandle:handle.display,
        normalizedTrainerName:handle.normalized,handleKey:handle.handleKey,lifecycleId:expected.lifecycleId,
        providerAccountProtocolVersion,clientRelease,idempotencyFingerprint:await requestFingerprint(input,cryptoImpl),phase:'prepared'};
      return saveOperation(operation);
    }
    async function create({requestedHandle}={}){
      const expected=lifecycle(),operation=await prepare(requestedHandle,expected);current(expected);
      if(['dispatched','ambiguous','complete'].includes(operation.phase))return reconcile(operation);
      const dispatched=saveOperation({...operation,phase:'dispatched'});
      const body={schemaVersion:1,requestId:dispatched.requestId,requestedHandle:dispatched.requestedHandle,
        providerAccountProtocolVersion:dispatched.providerAccountProtocolVersion,lifecycleId:dispatched.lifecycleId,
        clientRelease:dispatched.clientRelease,
        idempotencyFingerprint:dispatched.idempotencyFingerprint};
      let response;
      try{
        response=await invoke(CREATE_CALLABLE,body,{limitedUse:true,forceRefresh:true,expected});
      }catch(error){
        if(/^provider-account\/(?:auth-lifecycle-changed|request-superseded|response-invalid)$/.test(String(error?.code||'')))throw error;
        const serverCode=safeServerCode(error);
        if(serverCode){clearOperation();throw failure(`provider-account/${serverCode.toLowerCase().replaceAll('_','-')}`,
          serverCode==='HANDLE_CONFLICT'?'handle-unavailable':'blocked',error);}
        return reconcile(dispatched);
      }
      const accepted=validateCreateResponse(response);
      if(accepted.foundation.canonicalTrainerName!==dispatched.requestedHandle||
        accepted.foundation.normalizedTrainerName!==dispatched.normalizedTrainerName||
        accepted.foundation.handleKey!==dispatched.handleKey)fail('provider-account/response-invalid');
      return reconcile(dispatched);
    }
    function close(){generation++;return Object.freeze({ok:true});}
    return Object.freeze({read,create,reconcilePending:async()=>{const operation=loadOperation();if(!operation)fail('provider-account/no-pending-operation');return reconcile(operation);},clearPending:clearOperation,close,pending:loadOperation});
  }

  root.providerAccountFoundation=Object.freeze({
    CLIENT_RELEASE,CREATE_CALLABLE,PROVIDER_ACCOUNT_PROTOCOL_VERSION,READ_CALLABLE,REGION,STORAGE_KEY,
    createProviderAccountClient,normalizeHandle,
    requestFingerprint,validateCreateResponse,validateReadResponse
  });
})(window);
