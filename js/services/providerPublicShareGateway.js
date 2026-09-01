(function(global){
  'use strict';
  const root=global.PogoServices=global.PogoServices||{};
  const REGION='us-central1',CALLABLE='readE1ProviderPublicShare';
  const DEFAULT_ENABLED=global.__POGO_PROVIDER_PUBLIC_PROJECTION_DEV__===true;

  function failure(code,cause){const error=new Error(code);error.code=code;if(cause)error.cause=cause;return error;}
  function exact(value,fields){
    const keys=value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).sort():[],expected=[...fields].sort();
    return keys.length===expected.length&&keys.every((key,index)=>key===expected[index]);
  }
  function bounded(value,timeoutMs,code){
    let timer;return Promise.race([Promise.resolve(value),new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(failure(code)),timeoutMs);
    })]).finally(()=>clearTimeout(timer));
  }
  function foldHandle(value){return String(value||'').normalize('NFKC').trim().toLocaleLowerCase('en-US');}
  function response(value,trainerHandle){
    if(exact(value,['code'])&&value.code==='SHARE_NOT_FOUND')return Object.freeze({ok:false,status:'not_found'});
    if(!exact(value,['code','share'])||value.code!=='SUCCESS')throw failure('provider-public/response-invalid');
    const projection=global.PogoDomain?.providerPublicProjection?.publicSnapshotStatus(value.share);
    if(!projection?.ok||foldHandle(projection.snapshot.username)!==foldHandle(trainerHandle))throw failure('provider-public/response-invalid');
    return Object.freeze({ok:true,status:projection.status,snapshot:projection.snapshot,source:'provider'});
  }
  function createProviderPublicShareClient({firebaseApp,firebaseAppCheckReady,importFunctionsSdk,
    enabled=DEFAULT_ENABLED,timeoutMs=12000}={}){
    if(!firebaseApp||typeof firebaseAppCheckReady!=='function'||typeof importFunctionsSdk!=='function'||
      typeof enabled!=='boolean'||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)throw failure('provider-public/dependencies-invalid');
    async function read(trainerHandle){
      const handle=String(trainerHandle||'').normalize('NFKC').trim();
      if(!enabled)return Object.freeze({ok:false,status:'disabled'});
      if(!handle||handle.length>64||/[.#$\[\]\/\u0000-\u001f\u007f]/u.test(handle))return Object.freeze({ok:false,status:'invalid'});
      const readiness=await bounded(firebaseAppCheckReady(),timeoutMs,'provider-public/app-check-timeout');
      if(!readiness?.ok||!readiness.instance)throw failure('provider-public/app-check-unavailable');
      const sdk=await bounded(importFunctionsSdk(),timeoutMs,'provider-public/sdk-timeout');
      if(typeof sdk?.getFunctions!=='function'||typeof sdk?.httpsCallable!=='function')throw failure('provider-public/sdk-invalid');
      const callable=sdk.httpsCallable(sdk.getFunctions(firebaseApp,REGION),CALLABLE,{limitedUseAppCheckTokens:true});
      try{return response((await bounded(callable({schemaVersion:1,trainerHandle:handle}),timeoutMs,'provider-public/callable-timeout'))?.data,handle);}
      catch(error){
        if(String(error?.code||'').startsWith('provider-public/'))throw error;
        const server=String(error?.details?.code||'');
        if(server==='PUBLIC_SHARE_INVALID'||server==='PUBLIC_IDENTITY_CONFLICT')throw failure('provider-public/response-invalid',error);
        return Object.freeze({ok:false,status:'unavailable'});
      }
    }
    return Object.freeze({read});
  }
  root.providerPublicShareGateway=Object.freeze({CALLABLE,DEFAULT_ENABLED,REGION,createProviderPublicShareClient,response});
})(window);
