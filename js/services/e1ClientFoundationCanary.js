(function(global){
  const root=global.PogoServices=global.PogoServices||{};
  const REGION='us-central1';
  const CALLABLE='readE1AccountFoundation';
  const UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const SHA256=/^[a-f0-9]{64}$/;
  const BASE64URL=/^[A-Za-z0-9_-]+$/;
  const HANDLE_KEY=/^v1_[a-f0-9]{2,512}$/;
  const CODES=new Set(['SUCCESS','FOUNDATION_NOT_INITIALIZED','ACCOUNT_FROZEN']);
  const CAPABILITY_FIELDS=Object.freeze([
    'schemaVersion','recordType','environment','projectId','runId','slot','jti','uidHash','trainerHash',
    'cohortDigest','generationId','sessionGeneration','attemptHash','firebaseAppIdHash','browserContextDigest',
    'runtimeInstanceDigest','sessionGenerationDigest',
    'toolingSourceSha','pagesReleaseId','pagesSourceSha','pagesArtifactDigest','gatewaySourceSha',
    'gatewaySourceFingerprint','authorityRevision','authorityImageDigest','d3CloseoutDigest','identityBaselineDigest',
    'admissionEvidenceDigest','preCallReplayLedgerDigest','dispatchLedgerDigest','issuedAt','expiresAt',
    'remainingAdmittedCallBudget','runManifestDigest','keyId','priorAReconciliationDigest','sessionBoundaryDigest'
  ]);
  const SESSION_GENERATION_FIELDS=Object.freeze([
    'schemaVersion','environment','projectId','runId','cohortDigest','slot','uidHash','trainerHash','generationId',
    'sessionGeneration','firebaseAppIdHash','browserContextDigest','runtimeInstanceDigest'
  ]);
  const CONFIGURATION_FIELDS=Object.freeze(['schemaVersion','capability','signature','publicKeySpki']);
  const STORED_ENVELOPE_FIELDS=Object.freeze([...CONFIGURATION_FIELDS,'capabilityDigest']);
  const FROZEN=new Set(['frozen','blocked','conflict','conflict-frozen']);
  const RESPONSE_FIELDS=Object.freeze({
    SUCCESS:['admissionReceiptDigest','attemptHash','code','foundation','schemaVersion','subjectBinding'],
    FOUNDATION_NOT_INITIALIZED:['admissionReceiptDigest','attemptHash','code','schemaVersion','subjectBinding'],
    ACCOUNT_FROZEN:['admissionReceiptDigest','attemptHash','code','foundation','schemaVersion','subjectBinding']
  });
  const FOUNDATION_FIELDS=Object.freeze([
    'canonicalTrainerName','createdAt','handleKey','legacyUsername','normalizedTrainerName',
    'revision','schemaVersion','status','updatedAt'
  ]);
  const RUNTIME_INSTANCE_NONCE=createRuntimeInstanceNonce();

  function fail(code){const error=new Error(code);error.code=code;throw error;}
  function createRuntimeInstanceNonce(cryptoImpl=global.crypto){
    if(typeof cryptoImpl?.getRandomValues!=='function')fail('group-e/crypto-unavailable');
    const nonce=new Uint8Array(32);
    cryptoImpl.getRandomValues(nonce);
    return nonce;
  }
  function exactFields(value,expected){
    const keys=value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).sort():[];
    const expectedKeys=[...expected].sort();
    return keys.length===expectedKeys.length&&keys.every((key,index)=>key===expectedKeys[index]);
  }
  function browserConfigurationFromStoredEnvelope(value){
    if(!exactFields(value,STORED_ENVELOPE_FIELDS)||value.schemaVersion!==1)fail('group-e/configuration-invalid');
    return Object.freeze(Object.fromEntries(CONFIGURATION_FIELDS.map(field=>[field,value[field]])));
  }
  function bytes(value){return new TextEncoder().encode(value);}
  function concat(left,right){const value=new Uint8Array(left.length+right.length);value.set(left);value.set(right,left.length);return value;}
  function hex(value){return Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');}
  async function sha256Bytes(value,cryptoImpl=global.crypto){
    if(!cryptoImpl?.subtle)fail('group-e/crypto-unavailable');
    return cryptoImpl.subtle.digest('SHA-256',value);
  }
  async function digest(parts,cryptoImpl=global.crypto){return hex(await sha256Bytes(bytes(JSON.stringify(parts)),cryptoImpl));}
  function base64urlBytes(value){
    if(typeof value!=='string'||!BASE64URL.test(value))fail('group-e/signature-invalid');
    const base64=value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4);
    let binary;try{binary=global.atob(base64);}catch{fail('group-e/signature-invalid');}
    if(typeof global.btoa!=='function'||global.btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')!==value){
      fail('group-e/signature-invalid');
    }
    const output=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)output[index]=binary.charCodeAt(index);
    return output;
  }
  function canonicalCapability(value){return[
    1,'group-e-admission-capability-ed25519',value.schemaVersion,value.recordType,value.environment,value.projectId,
    value.runId,value.slot,value.jti,value.uidHash,value.trainerHash,value.cohortDigest,value.generationId,
    value.sessionGeneration,value.attemptHash,
    value.firebaseAppIdHash,value.browserContextDigest,value.runtimeInstanceDigest,value.sessionGenerationDigest,
    value.toolingSourceSha,value.pagesReleaseId,
    value.pagesSourceSha,value.pagesArtifactDigest,value.gatewaySourceSha,value.gatewaySourceFingerprint,value.authorityRevision,
    value.authorityImageDigest,value.d3CloseoutDigest,value.identityBaselineDigest,value.admissionEvidenceDigest,
    value.preCallReplayLedgerDigest,value.dispatchLedgerDigest,value.issuedAt,value.expiresAt,value.remainingAdmittedCallBudget,
    value.runManifestDigest,value.keyId,value.priorAReconciliationDigest,value.sessionBoundaryDigest
  ];}
  async function attemptHash(attemptId,cryptoImpl){
    if(!UUID_V4.test(attemptId||''))fail('group-e/request-invalid');
    return digest([1,'group-e-client-attempt',attemptId],cryptoImpl);
  }
  async function firebaseAppIdHash(appId,cryptoImpl){return digest([1,'group-e-firebase-app-id',appId],cryptoImpl);}
  async function browserContextDigest(origin,pathname,appId,cryptoImpl){
    if(typeof origin!=='string'||typeof pathname!=='string'||typeof appId!=='string'||!origin||!pathname||!appId){
      fail('group-e/runtime-binding-invalid');
    }
    return digest([1,'group-e-browser-context',origin,pathname,appId],cryptoImpl);
  }
  async function runtimeInstanceDigest(firebaseAppIdHashValue){
    const origin=global.location?.origin,pathname=global.location?.pathname;
    if(typeof origin!=='string'||typeof pathname!=='string'||!origin||!pathname||
      !SHA256.test(firebaseAppIdHashValue||''))fail('group-e/runtime-binding-invalid');
    return digest([1,'group-e-browser-runtime-instance',origin,pathname,firebaseAppIdHashValue,
      hex(RUNTIME_INSTANCE_NONCE)],global.crypto);
  }
  async function subjectHash(kind,value,cryptoImpl){return digest([1,'group-e-client-foundation',kind,value],cryptoImpl);}
  function sessionGenerationContext(value,generation=value?.sessionGeneration){
    return{
      schemaVersion:value?.schemaVersion,environment:value?.environment,projectId:value?.projectId,runId:value?.runId,
      cohortDigest:value?.cohortDigest,slot:value?.slot,uidHash:value?.uidHash,trainerHash:value?.trainerHash,
      generationId:value?.generationId,sessionGeneration:generation,firebaseAppIdHash:value?.firebaseAppIdHash,
      browserContextDigest:value?.browserContextDigest,runtimeInstanceDigest:value?.runtimeInstanceDigest
    };
  }
  async function sessionGenerationDigest(value,cryptoImpl){
    if(!exactFields(value,SESSION_GENERATION_FIELDS)||value.schemaVersion!==1||value.environment!=='production'||
      value.projectId!=='trade-list-a4297'||!UUID_V4.test(value.runId||'')||!SHA256.test(value.cohortDigest||'')||
      !['A','B'].includes(value.slot)||!SHA256.test(value.uidHash||'')||!SHA256.test(value.trainerHash||'')||
      !UUID_V4.test(value.generationId||'')||!Number.isSafeInteger(value.sessionGeneration)||
      value.sessionGeneration<0||!SHA256.test(value.firebaseAppIdHash||'')||!SHA256.test(value.browserContextDigest||'')||
      !SHA256.test(value.runtimeInstanceDigest||'')){
      fail('group-e/session-binding-invalid');
    }
    return digest([1,'group-e-session-generation',...SESSION_GENERATION_FIELDS.map(field=>value[field])],cryptoImpl);
  }
  async function responseBinding(uid,attemptId,receiptDigest,cryptoImpl){
    return digest([1,'group-e-client-response',uid,attemptId,receiptDigest],cryptoImpl);
  }
  function validTime(value){return typeof value==='string'&&Number.isFinite(Date.parse(value));}
  function validateCapabilityShape(value,now){
    const slot=value?.slot,issued=Date.parse(value?.issuedAt),expires=Date.parse(value?.expiresAt);
    if(!exactFields(value,CAPABILITY_FIELDS)||value.schemaVersion!==1||value.recordType!=='group-e-slot-capability'||
      value.environment!=='production'||value.projectId!=='trade-list-a4297'||!UUID_V4.test(value.runId||'')||
      !['A','B'].includes(slot)||!UUID_V4.test(value.jti||'')||!SHA256.test(value.uidHash||'')||
      !SHA256.test(value.trainerHash||'')||!SHA256.test(value.cohortDigest||'')||!UUID_V4.test(value.generationId||'')||
      !Number.isSafeInteger(value.sessionGeneration)||value.sessionGeneration<0||!SHA256.test(value.attemptHash||'')||
      !SHA256.test(value.firebaseAppIdHash||'')||
      !SHA256.test(value.browserContextDigest||'')||!SHA256.test(value.runtimeInstanceDigest||'')||
      !SHA256.test(value.sessionGenerationDigest||'')||
      !/^[a-f0-9]{40}$/.test(value.toolingSourceSha||'')||!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(value.pagesReleaseId||'')||
      !/^[a-f0-9]{40}$/.test(value.pagesSourceSha||'')||!SHA256.test(value.pagesArtifactDigest||'')||
      !/^[a-f0-9]{40}$/.test(value.gatewaySourceSha||'')||!SHA256.test(value.gatewaySourceFingerprint||'')||
      !/^e1-identity-authority-[0-9]{5}-[a-z0-9]{3}$/.test(value.authorityRevision||'')||
      !/^sha256:[a-f0-9]{64}$/.test(value.authorityImageDigest||'')||!SHA256.test(value.d3CloseoutDigest||'')||
      !SHA256.test(value.identityBaselineDigest||'')||!SHA256.test(value.admissionEvidenceDigest||'')||
      !SHA256.test(value.preCallReplayLedgerDigest||'')||!SHA256.test(value.dispatchLedgerDigest||'')||
      !Number.isFinite(issued)||!Number.isFinite(expires)||issued>=expires||expires-issued>15*60*1000||now<issued||now>=expires||
      value.remainingAdmittedCallBudget!==(slot==='A'?2:1)||!SHA256.test(value.runManifestDigest||'')||
      !SHA256.test(value.keyId||'')||(slot==='A'?(value.priorAReconciliationDigest!==null||value.sessionBoundaryDigest!==null):
        (!SHA256.test(value.priorAReconciliationDigest||'')||!SHA256.test(value.sessionBoundaryDigest||'')))){
      fail('group-e/configuration-invalid');
    }
    return value;
  }
  async function verifyCapability(value,signature,publicKeySpki,cryptoImpl,now){
    const capability=validateCapabilityShape(value,now);
    if(await sessionGenerationDigest(sessionGenerationContext(capability),cryptoImpl)!==capability.sessionGenerationDigest){
      fail('group-e/configuration-invalid');
    }
    const spki=base64urlBytes(publicKeySpki),signatureValue=base64urlBytes(signature);
    if(signatureValue.length!==64)fail('group-e/signature-invalid');
    const keyId=hex(await sha256Bytes(concat(bytes('group-e-ed25519-key-id-v1\0'),spki),cryptoImpl));
    if(keyId!==capability.keyId)fail('group-e/signature-invalid');
    let key;try{key=await cryptoImpl.subtle.importKey('spki',spki,{name:'Ed25519'},false,['verify']);}
    catch{fail('group-e/signature-invalid');}
    const verified=await cryptoImpl.subtle.verify({name:'Ed25519'},key,signatureValue,bytes(JSON.stringify(canonicalCapability(capability))));
    if(!verified)fail('group-e/signature-invalid');
    return capability;
  }
  function validateFoundation(value,code){
    if(!exactFields(value,FOUNDATION_FIELDS))fail('group-e/response-invalid');
    if(value.schemaVersion!==1||typeof value.canonicalTrainerName!=='string'||!value.canonicalTrainerName||
      typeof value.normalizedTrainerName!=='string'||!value.normalizedTrainerName||!HANDLE_KEY.test(value.handleKey||'')||
      value.legacyUsername!==null&&typeof value.legacyUsername!=='string'||
      value.revision!==null&&(!Number.isSafeInteger(value.revision)||value.revision<0)||
      !validTime(value.createdAt)||!validTime(value.updatedAt)||typeof value.status!=='string')fail('group-e/response-invalid');
    if(code==='SUCCESS'&&value.status!=='active')fail('group-e/response-invalid');
    if(code==='ACCOUNT_FROZEN'&&!FROZEN.has(value.status))fail('group-e/response-invalid');
    return Object.freeze({...value});
  }
  async function validateResponse(value,{attemptId,uid,cryptoImpl}){
    if(!value||typeof value!=='object'||Array.isArray(value)||!CODES.has(value.code)||
      !exactFields(value,RESPONSE_FIELDS[value.code])||value.schemaVersion!==1||!SHA256.test(value.admissionReceiptDigest||'')){
      fail('group-e/response-invalid');
    }
    const fullAttemptHash=await attemptHash(attemptId,cryptoImpl);
    const expectedBinding=await responseBinding(uid,attemptId,value.admissionReceiptDigest,cryptoImpl);
    if(value.attemptHash!==fullAttemptHash.slice(0,16)||value.subjectBinding!==expectedBinding)fail('group-e/response-invalid');
    const response={...value};
    if(value.code!=='FOUNDATION_NOT_INITIALIZED')response.foundation=validateFoundation(value.foundation,value.code);
    return Object.freeze(response);
  }
  function bounded(promise,timeoutMs,code){
    let timer;
    return Promise.race([Promise.resolve(promise),new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(Object.assign(new Error(code),{code})),timeoutMs);
    })]).finally(()=>clearTimeout(timer));
  }
  function createClientFoundationCanary({firebaseApp,auth,firebaseAppCheckReady,getSessionGeneration,
    getBrowserContextDigest,importFunctionsSdk,cryptoImpl=global.crypto,timeoutMs=15000,now=()=>Date.now()}={}){
    if(!firebaseApp||typeof firebaseApp!=='object'||typeof firebaseApp.options?.appId!=='string'||!auth||
      typeof firebaseAppCheckReady!=='function'||typeof getSessionGeneration!=='function'||
      typeof getBrowserContextDigest!=='function'||typeof importFunctionsSdk!=='function'||
      !Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)fail('group-e/dependencies-invalid');
    let generation=0,configuration=null,held=null,inFlight=false,terminal=false,destroyed=false;
    function clear(){generation++;held=null;inFlight=false;}
    function close(){clear();configuration=null;destroyed=true;return Object.freeze({ok:true,closed:true});}
    async function open(value={}){
      if(destroyed)fail('group-e/controller-closed');
      clear();
      if(!exactFields(value,CONFIGURATION_FIELDS)||value.schemaVersion!==1){configuration=null;fail('group-e/configuration-invalid');}
      const capability=await verifyCapability(value.capability,value.signature,value.publicKeySpki,cryptoImpl,now());
      const currentFirebaseAppIdHash=await firebaseAppIdHash(firebaseApp.options.appId,cryptoImpl);
      if(capability.firebaseAppIdHash!==currentFirebaseAppIdHash||
        capability.browserContextDigest!==await getBrowserContextDigest()||
        capability.runtimeInstanceDigest!==await runtimeInstanceDigest(currentFirebaseAppIdHash)||
        capability.sessionGeneration!==getSessionGeneration()){
        configuration=null;fail('group-e/runtime-binding-invalid');
      }
      configuration=Object.freeze({capability,signature:value.signature});
      return Object.freeze({ok:true,slot:capability.slot,generationId:capability.generationId,runId:capability.runId});
    }
    function currentResult(){
      const user=auth.currentUser;
      if(!held||!user||held.uid!==user.uid||held.sessionGeneration!==getSessionGeneration())return null;
      return held.value;
    }
    async function read({attemptId}={}){
      if(!configuration)fail('group-e/disabled');
      if(!UUID_V4.test(attemptId||''))fail('group-e/request-invalid');
      if(terminal)fail('group-e/invocation-terminal');
      if(inFlight)fail('group-e/request-in-flight');
      const capability=configuration.capability,user=auth.currentUser;
      if(!user?.uid||typeof user.getIdToken!=='function')fail('group-e/auth-required');
      if(await subjectHash('uid',user.uid,cryptoImpl)!==capability.uidHash)fail('group-e/subject-denied');
      if(await attemptHash(attemptId,cryptoImpl)!==capability.attemptHash)fail('group-e/attempt-denied');
      const sessionGeneration=getSessionGeneration();
      const currentFirebaseAppIdHash=await firebaseAppIdHash(firebaseApp.options.appId,cryptoImpl);
      if(currentFirebaseAppIdHash!==capability.firebaseAppIdHash||
        await getBrowserContextDigest()!==capability.browserContextDigest||
        await runtimeInstanceDigest(currentFirebaseAppIdHash)!==capability.runtimeInstanceDigest||
        sessionGeneration!==capability.sessionGeneration||await sessionGenerationDigest(
        sessionGenerationContext(capability,sessionGeneration),cryptoImpl
      )!==capability.sessionGenerationDigest){
        fail('group-e/session-binding-invalid');
      }
      const requestGeneration=++generation,startedAt=now();
      const stage=(promise,code)=>bounded(promise,Math.max(1,timeoutMs-(now()-startedAt)),code);
      held=null;inFlight=true;
      let readyInstance;
      const stillCurrent=(instance)=>generation===requestGeneration&&auth.currentUser?.uid===user.uid&&
        getSessionGeneration()===sessionGeneration&&(!instance||instance===readyInstance);
      try{
        await stage(user.getIdToken(true),'group-e/id-token-timeout');
        const readiness=await stage(firebaseAppCheckReady(),'group-e/app-check-timeout');
        if(!readiness?.ok||!readiness.instance)fail('group-e/app-check-unavailable');
        readyInstance=readiness.instance;
        if(!stillCurrent())fail('group-e/stale-session');
        const sdk=await stage(importFunctionsSdk(),'group-e/sdk-timeout');
        if(typeof sdk?.getFunctions!=='function'||typeof sdk?.httpsCallable!=='function')fail('group-e/sdk-invalid');
        if(await stage(getBrowserContextDigest(),'group-e/runtime-binding-timeout')!==capability.browserContextDigest||
          await stage(runtimeInstanceDigest(currentFirebaseAppIdHash),'group-e/runtime-binding-timeout')!==
            capability.runtimeInstanceDigest)fail('group-e/stale-session');
        const functions=sdk.getFunctions(firebaseApp,REGION);
        const callable=sdk.httpsCallable(functions,CALLABLE,{limitedUseAppCheckTokens:true});
        if(typeof callable!=='function')fail('group-e/sdk-invalid');
        if(!stillCurrent(readyInstance))fail('group-e/stale-session');
        terminal=true;
        const result=await stage(callable({schemaVersion:1,attemptId,capability,signature:configuration.signature}),
          'group-e/callable-timeout');
        const after=await stage(firebaseAppCheckReady(),'group-e/app-check-timeout');
        if(!after?.ok||after.instance!==readyInstance||!stillCurrent(after.instance))fail('group-e/stale-session');
        const value=await validateResponse(result?.data,{attemptId,uid:user.uid,cryptoImpl});
        held=Object.freeze({uid:user.uid,sessionGeneration,value});
        return value;
      }catch(error){held=null;throw error;}
      finally{if(generation===requestGeneration)inFlight=false;}
    }
    return Object.freeze({open,read,currentResult,clear,close,isEnabled:()=>configuration!==null,isTerminal:()=>terminal});
  }

  root.e1ClientFoundationCanary=Object.freeze({
    CALLABLE,REGION,browserConfigurationFromStoredEnvelope,browserContextDigest,canonicalCapability,
    createClientFoundationCanary,sessionGenerationContext,runtimeInstanceDigest,sessionGenerationDigest,
    validateResponse,verifyCapability
  });
})(window);
