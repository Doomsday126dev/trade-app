(function(global){
  'use strict';
  const root=global.PogoServices=global.PogoServices||{};
  const REGION='us-central1';
  const CALLABLE='readE1ProviderPublicShare';
  const DIRECTORY_CALLABLE='listE1TrainerDirectory';
  const FAVORITE_CALLABLE='resolveE1FavoriteTrainerIdentity';
  const requested=global.__POGO_PROVIDER_CAPABILITIES__||{};
  const compatibilityFloor=global.__POGO_PROVIDER_ACCOUNT_COMPATIBILITY_FLOOR__||{};
  const DEFAULT_ENABLED=requested.providerPublicReadSupport===true||compatibilityFloor.providerAccountsExist===true;
  const UID=/^[A-Za-z0-9_-]{6,128}$/u;

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
  function compareHandles(left,right){
    const a=Array.from(left),b=Array.from(right),length=Math.min(a.length,b.length);
    for(let index=0;index<length;index++){const difference=a[index].codePointAt(0)-b[index].codePointAt(0);if(difference)return difference;}
    return a.length-b.length;
  }
  function validHandle(value){return typeof value==='string'&&!!value&&value.length<=64&&!/[.#$\[\]\/\u0000-\u001f\u007f]/u.test(value);}
  function response(value,trainerHandle){
    if(exact(value,['code'])&&value.code==='SHARE_NOT_FOUND')return Object.freeze({ok:false,status:'not_found'});
    if(!exact(value,['code','share'])||value.code!=='SUCCESS')throw failure('provider-public/response-invalid');
    const projection=global.PogoDomain?.providerPublicProjection?.publicSnapshotStatus(value.share);
    if(!projection?.ok||foldHandle(projection.snapshot.username)!==foldHandle(trainerHandle))throw failure('provider-public/response-invalid');
    return Object.freeze({ok:true,status:projection.status,snapshot:projection.snapshot,source:'provider'});
  }
  function directoryResponse(value,pageSize,expectedQuery=''){
    const directory=value?.directory;
    if(!exact(value,['code','directory'])||value.code!=='SUCCESS'||!exact(directory,['handles','nextCursor','version'])||
      directory.version!==1||!Array.isArray(directory.handles)||directory.handles.length>pageSize||
      !(directory.nextCursor===null||typeof directory.nextCursor==='string'&&directory.nextCursor.length>0&&directory.nextCursor.length<=1024)){
      throw failure('provider-public/directory-response-invalid');
    }
    const handles=directory.handles.map(value=>String(value||'')),folded=handles.map(foldHandle),prefix=foldHandle(expectedQuery);
    if(handles.some(value=>!validHandle(value))||new Set(folded).size!==folded.length||
      prefix&&folded.some(value=>!value.startsWith(prefix))||
      folded.some((value,index)=>index>0&&compareHandles(folded[index-1],value)>=0)){
      throw failure('provider-public/directory-response-invalid');
    }
    return Object.freeze({ok:true,handles:Object.freeze(handles),nextCursor:directory.nextCursor});
  }
  function favoriteResponse(value,trainerHandle,expectedTargetUid){
    if(exact(value,['code'])&&value.code==='TARGET_NOT_FOUND')return Object.freeze({ok:false,status:'not_found'});
    const favorite=value?.favorite;
    if(!exact(value,['code','favorite'])||value.code!=='SUCCESS'||
      !exact(favorite,['canonicalTrainerName','targetUid','version'])||favorite.version!==1||
      !validHandle(favorite.canonicalTrainerName)||foldHandle(favorite.canonicalTrainerName)!==foldHandle(trainerHandle)||
      !UID.test(favorite.targetUid||'')||expectedTargetUid&&favorite.targetUid!==expectedTargetUid){
      throw failure('provider-public/favorite-response-invalid');
    }
    return Object.freeze({ok:true,targetUid:favorite.targetUid,canonicalTrainerName:favorite.canonicalTrainerName});
  }
  function createProviderPublicShareClient({firebaseApp,auth=null,firebaseAppCheckReady,importFunctionsSdk,
    enabled=DEFAULT_ENABLED,timeoutMs=12000}={}){
    if(!firebaseApp||typeof firebaseAppCheckReady!=='function'||typeof importFunctionsSdk!=='function'||
      typeof enabled!=='boolean'||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)throw failure('provider-public/dependencies-invalid');
    async function callable(name,body,{authRequired=false}={}){
      const uid=authRequired?String(auth?.currentUser?.uid||''):'';
      if(authRequired&&!UID.test(uid))throw failure('provider-public/auth-required');
      const readiness=await bounded(firebaseAppCheckReady(),timeoutMs,'provider-public/app-check-timeout');
      if(!readiness?.ok||!readiness.instance)throw failure('provider-public/app-check-unavailable');
      if(authRequired&&auth?.currentUser?.uid!==uid)throw failure('provider-public/session-changed');
      const sdk=await bounded(importFunctionsSdk(),timeoutMs,'provider-public/sdk-timeout');
      if(typeof sdk?.getFunctions!=='function'||typeof sdk?.httpsCallable!=='function')throw failure('provider-public/sdk-invalid');
      const invoke=sdk.httpsCallable(sdk.getFunctions(firebaseApp,REGION),name,{limitedUseAppCheckTokens:true});
      const result=await bounded(invoke(body),timeoutMs,'provider-public/callable-timeout');
      if(authRequired&&auth?.currentUser?.uid!==uid)throw failure('provider-public/session-changed');
      return result?.data;
    }
    async function read(trainerHandle){
      const handle=String(trainerHandle||'').normalize('NFKC').trim();
      if(!enabled)return Object.freeze({ok:false,status:'disabled'});
      if(!validHandle(handle))return Object.freeze({ok:false,status:'invalid'});
      try{return response(await callable(CALLABLE,{schemaVersion:1,trainerHandle:handle}),handle);}
      catch(error){
        if(String(error?.code||'').startsWith('provider-public/'))throw error;
        const server=String(error?.details?.code||'');
        if(server==='PUBLIC_SHARE_INVALID'||server==='PUBLIC_IDENTITY_CONFLICT')throw failure('provider-public/response-invalid',error);
        return Object.freeze({ok:false,status:'unavailable'});
      }
    }
    async function listDirectory({query='',cursor=null,pageSize=25}={}){
      const normalized=String(query||'').normalize('NFKC').trim();
      if(!enabled)return Object.freeze({ok:false,status:'disabled'});
      if(normalized.length>64||normalized&&Array.from(normalized).length<2||!Number.isInteger(pageSize)||pageSize<1||pageSize>25||
        !(cursor===null||typeof cursor==='string'&&cursor.length>0&&cursor.length<=1024))return Object.freeze({ok:false,status:'invalid'});
      try{return directoryResponse(await callable(DIRECTORY_CALLABLE,{schemaVersion:1,query:normalized,pageSize,cursor},{authRequired:true}),pageSize,normalized);}
      catch(error){
        if(String(error?.code||'').startsWith('provider-public/'))throw error;
        if(['DIRECTORY_IDENTITY_CONFLICT','REQUEST_INVALID'].includes(String(error?.details?.code||''))){
          throw failure('provider-public/directory-response-invalid',error);
        }
        return Object.freeze({ok:false,status:'unavailable'});
      }
    }
    async function resolveFavorite({trainerHandle,expectedTargetUid=''}={}){
      const handle=String(trainerHandle||'').normalize('NFKC').trim(),expected=String(expectedTargetUid||'').trim();
      if(!enabled)return Object.freeze({ok:false,status:'disabled'});
      if(!validHandle(handle)||expected&&!UID.test(expected))return Object.freeze({ok:false,status:'invalid'});
      try{return favoriteResponse(await callable(FAVORITE_CALLABLE,{schemaVersion:1,trainerHandle:handle,expectedTargetUid:expected},{authRequired:true}),handle,expected);}
      catch(error){
        if(String(error?.code||'').startsWith('provider-public/'))throw error;
        if(String(error?.details?.code||'')==='FAVORITE_IDENTITY_CONFLICT')throw failure('provider-public/favorite-identity-conflict',error);
        return Object.freeze({ok:false,status:'unavailable'});
      }
    }
    return Object.freeze({read,listDirectory,resolveFavorite});
  }
  root.providerPublicShareGateway=Object.freeze({
    CALLABLE,DIRECTORY_CALLABLE,FAVORITE_CALLABLE,DEFAULT_ENABLED,REGION,
    createProviderPublicShareClient,directoryResponse,favoriteResponse,response
  });
})(window);
