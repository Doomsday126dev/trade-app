(function(global){
  const root=global.PogoServices=global.PogoServices||{};
  const MODE='synthetic-ab';
  const REGION='us-central1';
  const CALLABLE='readE1AccountFoundation';
  const UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const SHA256=/^[a-f0-9]{64}$/;
  const HANDLE_KEY=/^v1_[a-f0-9]{2,512}$/;
  const CODES=new Set(['SUCCESS','FOUNDATION_NOT_INITIALIZED','ACCOUNT_FROZEN']);
  const FROZEN=new Set(['frozen','blocked','conflict','conflict-frozen']);
  const RESPONSE_FIELDS=Object.freeze({
    SUCCESS:['attemptHash','code','foundation','schemaVersion','subjectBinding'],
    FOUNDATION_NOT_INITIALIZED:['attemptHash','code','schemaVersion','subjectBinding'],
    ACCOUNT_FROZEN:['attemptHash','code','foundation','schemaVersion','subjectBinding']
  });
  const FOUNDATION_FIELDS=Object.freeze([
    'canonicalTrainerName','createdAt','handleKey','legacyUsername','normalizedTrainerName',
    'revision','schemaVersion','status','updatedAt'
  ]);

  function fail(code){const error=new Error(code);error.code=code;throw error;}
  function exactFields(value,expected){
    const keys=value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).sort():[];
    return keys.length===expected.length&&keys.every((key,index)=>key===expected[index]);
  }
  function bytes(value){return new TextEncoder().encode(value);}
  async function sha256(parts,cryptoImpl=global.crypto){
    if(!cryptoImpl?.subtle)fail('group-e/crypto-unavailable');
    const digest=await cryptoImpl.subtle.digest('SHA-256',bytes(JSON.stringify(parts)));
    return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  function validTime(value){return Number.isFinite(value)||typeof value==='string'&&Number.isFinite(Date.parse(value));}
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
  function validateResponse(value,{attemptHash,subjectBinding}){
    if(!value||typeof value!=='object'||Array.isArray(value)||!CODES.has(value.code)||
      !exactFields(value,RESPONSE_FIELDS[value.code])||value.schemaVersion!==1||
      value.attemptHash!==attemptHash||value.subjectBinding!==subjectBinding)return fail('group-e/response-invalid');
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
    importFunctionsSdk,cryptoImpl=global.crypto,timeoutMs=15000}={}){
    if(!firebaseApp||typeof firebaseApp!=='object'||!auth||typeof firebaseAppCheckReady!=='function'||
      typeof getSessionGeneration!=='function'||typeof importFunctionsSdk!=='function'||
      !Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)fail('group-e/dependencies-invalid');
    let generation=0;
    let configuration=null;
    let held=null;
    let inFlight=false;
    function clear(){generation++;held=null;inFlight=false;}
    function close(){clear();configuration=null;return Object.freeze({ok:true,closed:true});}
    function open(value={}){
      clear();
      const bindings=value.bindings;
      if(value.mode!==MODE||!exactFields(value,['bindings','cohortDigest','mode'])||!SHA256.test(value.cohortDigest||'')||
        !bindings||!exactFields(bindings,['A','B'])||!SHA256.test(bindings.A||'')||!SHA256.test(bindings.B||'')||bindings.A===bindings.B){
        configuration=null;fail('group-e/configuration-invalid');
      }
      configuration=Object.freeze({mode:value.mode,cohortDigest:value.cohortDigest,bindings:Object.freeze({...bindings})});
      return Object.freeze({ok:true,mode:MODE});
    }
    function currentResult(){
      const user=auth.currentUser;
      if(!held||!user||held.uid!==user.uid||held.sessionGeneration!==getSessionGeneration())return null;
      return held.value;
    }
    async function read({slot,attemptId}={}){
      if(!configuration)fail('group-e/disabled');
      if(!['A','B'].includes(slot)||!UUID_V4.test(attemptId||''))fail('group-e/request-invalid');
      if(inFlight)fail('group-e/request-in-flight');
      const user=auth.currentUser;
      if(!user?.uid||typeof user.getIdToken!=='function')fail('group-e/auth-required');
      const uidHash=await sha256([1,'group-e-client-foundation','uid',user.uid],cryptoImpl);
      if(uidHash!==configuration.bindings[slot])fail('group-e/subject-denied');
      const requestGeneration=++generation;
      const sessionGeneration=getSessionGeneration();
      const startedAt=Date.now();
      const stage=(promise,code)=>bounded(promise,Math.max(1,timeoutMs-(Date.now()-startedAt)),code);
      held=null;inFlight=true;
      const stillCurrent=(appCheckInstance)=>generation===requestGeneration&&auth.currentUser?.uid===user.uid&&
        getSessionGeneration()===sessionGeneration&&(!appCheckInstance||appCheckInstance===readyInstance);
      let readyInstance;
      try{
        await stage(user.getIdToken(true),'group-e/id-token-timeout');
        const readiness=await stage(firebaseAppCheckReady(),'group-e/app-check-timeout');
        if(!readiness?.ok||!readiness.instance)fail('group-e/app-check-unavailable');
        readyInstance=readiness.instance;
        if(!stillCurrent())fail('group-e/stale-session');
        const sdk=await stage(importFunctionsSdk(),'group-e/sdk-timeout');
        if(typeof sdk?.getFunctions!=='function'||typeof sdk?.httpsCallable!=='function')fail('group-e/sdk-invalid');
        const functions=sdk.getFunctions(firebaseApp,REGION);
        const callable=sdk.httpsCallable(functions,CALLABLE);
        if(typeof callable!=='function')fail('group-e/sdk-invalid');
        const expectedAttemptHash=(await sha256([1,'group-e-client-attempt',attemptId],cryptoImpl)).slice(0,16);
        const expectedSubjectBinding=await sha256([1,'group-e-client-response',user.uid,attemptId],cryptoImpl);
        const result=await stage(callable({schemaVersion:1,attemptId}),'group-e/callable-timeout');
        const after=await stage(firebaseAppCheckReady(),'group-e/app-check-timeout');
        if(!after?.ok||after.instance!==readyInstance||!stillCurrent(after.instance))fail('group-e/stale-session');
        const value=validateResponse(result?.data,{attemptHash:expectedAttemptHash,subjectBinding:expectedSubjectBinding});
        held=Object.freeze({uid:user.uid,sessionGeneration,value});
        return value;
      }catch(error){held=null;throw error;}
      finally{if(generation===requestGeneration)inFlight=false;}
    }
    return Object.freeze({open,read,currentResult,clear,close,isEnabled:()=>configuration!==null});
  }

  root.e1ClientFoundationCanary=Object.freeze({CALLABLE,MODE,REGION,createClientFoundationCanary,validateResponse});
})(window);
