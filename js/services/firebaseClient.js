(function(global){
  const root=global.PogoServices=global.PogoServices||{};

  function errorResult(error,code='firebase/operation-failed'){
    return{
      ok:false,
      error:Object.freeze({
        code:String(error?.code||code),
        message:String(error?.message||'Firebase operation failed')
      })
    };
  }

  function failure(code,message=code){const error=new Error(message);error.code=code;return error;}
  function normalizedDatabaseUrl(value){
    const url=new URL(String(value||''));
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw failure('firebase/server-read-url-invalid');
    const namespace=url.searchParams.get('ns')||'';
    if([...url.searchParams.keys()].some(key=>key!=='ns'))throw failure('firebase/server-read-url-invalid');
    url.search='';url.hash='';url.pathname=url.pathname.replace(/\/+$/,'');
    return Object.freeze({base:url.toString().replace(/\/$/,''),namespace});
  }
  function exactPath(value){
    const parts=String(value||'').split('/');
    if(!parts.length||parts.some(part=>!part||/[.#$\[\]\u0000-\u001f\u007f]/u.test(part)))throw failure('firebase/server-read-path-invalid');
    return parts.map(part=>encodeURIComponent(part)).join('/');
  }
  function current(options){return !options?.signal?.aborted&&(typeof options?.isCurrent!=='function'||options.isCurrent());}
  function aborted(){return failure('firebase/server-read-cancelled','Firebase server read was cancelled');}
  function awaitCurrent(value,options){
    if(!current(options))return Promise.reject(aborted());
    return new Promise((resolve,reject)=>{
      const signal=options?.signal;
      const onAbort=()=>reject(aborted());
      signal?.addEventListener?.('abort',onAbort,{once:true});
      Promise.resolve(value).then(result=>{
        signal?.removeEventListener?.('abort',onAbort);
        if(!current(options))reject(aborted());else resolve(result);
      },error=>{signal?.removeEventListener?.('abort',onAbort);reject(error);});
    });
  }

  function createServerConfirmedReader({databaseUrl,fetchImpl,appCheckReady,loadAppCheckSdk,sessionCurrent=()=>true,timeoutMs=12000}={}){
    const target=normalizedDatabaseUrl(databaseUrl);
    if(typeof fetchImpl!=='function'||typeof appCheckReady!=='function'||typeof loadAppCheckSdk!=='function'||typeof sessionCurrent!=='function'||
      !Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)throw failure('firebase/server-read-dependencies-invalid');
    async function read(path,options={}){
      const operationId=String(options.operationId||'').trim(),encodedPath=exactPath(path);
      if(!operationId)return errorResult(failure('firebase/server-read-operation-invalid'),'firebase/server-read-operation-invalid');
      const timeoutController=new AbortController();
      const onParentAbort=()=>timeoutController.abort();
      options.signal?.addEventListener?.('abort',onParentAbort,{once:true});
      const timer=setTimeout(()=>timeoutController.abort(),timeoutMs);
      const guarded={...options,signal:timeoutController.signal};
      try{
        if(!sessionCurrent()||!current(guarded))throw aborted();
        const readiness=await awaitCurrent(appCheckReady(),guarded);
        if(!readiness?.ok||!readiness.instance)throw failure('firebase/server-read-app-check-unavailable');
        const sdk=await awaitCurrent(loadAppCheckSdk(),guarded);
        if(typeof sdk?.getToken!=='function')throw failure('firebase/server-read-app-check-sdk-invalid');
        const appCheckToken=await awaitCurrent(sdk.getToken(readiness.instance,false),guarded);
        if(typeof appCheckToken?.token!=='string'||!appCheckToken.token)throw failure('firebase/server-read-app-check-token-invalid');
        if(!sessionCurrent()||!current(guarded))throw aborted();
        const namespace=target.namespace?`?ns=${encodeURIComponent(target.namespace)}`:'';
        const response=await awaitCurrent(fetchImpl(`${target.base}/${encodedPath}.json${namespace}`,{
          method:'GET',headers:{Accept:'application/json','X-Firebase-AppCheck':appCheckToken.token},
          cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:timeoutController.signal
        }),guarded);
        if(!response?.ok)throw failure(`firebase/server-read-http-${Number(response?.status)||0}`);
        const value=await awaitCurrent(response.json(),guarded);
        if(!sessionCurrent()||!current(guarded))throw aborted();
        return Object.freeze({
          ok:true,value,
          evidence:Object.freeze({kind:'server-confirmed-public-share',transport:'rtdb-rest',path:String(path),scope:'whole-projection',completed:true,operationId,httpStatus:Number(response.status)})
        });
      }catch(error){
        const timedOut=timeoutController.signal.aborted&&!options.signal?.aborted&&current(options);
        return errorResult(timedOut?failure('firebase/server-read-timeout'):error,'firebase/server-read-failed');
      }finally{
        clearTimeout(timer);options.signal?.removeEventListener?.('abort',onParentAbort);
      }
    }
    return Object.freeze({read});
  }

  function createFirebaseClient({database,ref,get,onValue,serverReader=null}){
    if(!database||typeof ref!=='function'||typeof get!=='function'||typeof onValue!=='function'){
      throw new TypeError('Firebase client requires database, ref, get, and onValue');
    }
    const databaseRef=path=>ref(database,String(path||''));
    async function read(path){
      try{
        const snapshot=await get(databaseRef(path));
        return{ok:true,value:snapshot?.exists?.()?snapshot.val():null,snapshot};
      }catch(error){
        return errorResult(error,'firebase/read-failed');
      }
    }
    function listen(path,{onData,onError}={}){
      if(typeof onData!=='function')return errorResult(new TypeError('onData must be a function'),'firebase/invalid-listener');
      try{
        const unsubscribe=onValue(
          databaseRef(path),
          snapshot=>onData(snapshot?.exists?.()?snapshot.val():null,snapshot),
          error=>onError?.(errorResult(error,'firebase/listener-failed').error)
        );
        if(typeof unsubscribe!=='function')return errorResult(new TypeError('Firebase listener did not return an unsubscribe function'),'firebase/invalid-unsubscribe');
        return{ok:true,unsubscribe};
      }catch(error){
        return errorResult(error,'firebase/listener-start-failed');
      }
    }
    const readServer=serverReader&&typeof serverReader.read==='function'?(path,options)=>serverReader.read(path,options):null;
    return Object.freeze({databaseRef,read,listen,...(readServer?{readServer}: {})});
  }

  root.firebaseClient=Object.freeze({createFirebaseClient,createServerConfirmedReader,errorResult});
})(window);
