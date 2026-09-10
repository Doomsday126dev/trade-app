(function(global){
  'use strict';
  const root=global.PogoServices=global.PogoServices||{};
  const DATABASE='https://trade-list-a4297-default-rtdb.firebaseio.com/.json';
  // REST PATCH avoids SDK update() latency-compensation events being mistaken
  // for canonical server snapshots. Every write still uses the ordinary user's
  // ID token, App Check and the same RTDB Rules; this is not an admin endpoint.
  function createFavoriteWriteTransport({auth,ownerUid,appCheckReady,loadAppCheckSdk,sessionCurrent,fetch=global.fetch?.bind(global),timeoutMs=12000}={}){
    const failure=code=>Object.assign(new Error(code),{code});
    return Object.freeze({async update(_reference,changes){
      const user=auth.currentUser;
      const current=()=>{if(!user||user.uid!==ownerUid||auth.currentUser!==user||!sessionCurrent())throw failure('account-sync/session-changed');};
      current();
      const paths=Object.keys(changes),favoritePrefix=`accountSync/${ownerUid}/favorites/`,slotPrefix=`favoriteSlots/${ownerUid}/`;
      if(paths.length<1||paths.length>101||paths.filter(path=>path.startsWith(favoritePrefix)&&!path.slice(favoritePrefix.length).includes('/')).length!==1||paths.some(path=>!(path.startsWith(favoritePrefix)&&/^[^.#$\[\]/\u0000-\u001f\u007f]{1,128}$/u.test(path.slice(favoritePrefix.length)))&&!(path.startsWith(slotPrefix)&&/^s(0|[1-9][0-9]?)$/.test(path.slice(slotPrefix.length)))))throw failure('account-sync/favorite-write-invalid');
      const body=JSON.stringify(changes);if(body.length>262144)throw failure('account-sync/favorite-write-invalid');
      const abort=new AbortController();let timer;
      try{
        const work=(async()=>{
          const token=await user.getIdToken();current();
          const ready=await appCheckReady();current();if(!ready?.ok||!ready.instance)throw failure('account-sync/app-check-unavailable');
          const sdk=await loadAppCheckSdk();const appToken=await sdk.getToken(ready.instance);current();if(!appToken?.token)throw failure('account-sync/app-check-unavailable');
          // Firebase's REST user-auth protocol requires the auth query parameter.
          // Never log request URLs, token values, response bodies or fetch errors.
          const url=new URL(DATABASE);url.searchParams.set('auth',token);url.searchParams.set('print','silent');
          const response=await fetch(url.href,{method:'PATCH',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:abort.signal,headers:{'Content-Type':'application/json','X-Firebase-AppCheck':appToken.token},body});current();
          if(response.status===401||response.status===403)throw failure('PERMISSION_DENIED');
          if(!response.ok)throw failure('account-sync/network-failed');
          // The repository verifies the exact operation against an own-entity
          // server read before acknowledging. An HTTP response is not enough.
        })();
        await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(failure('account-sync/network-failed'));},timeoutMs);})]);
      }catch(error){current();if(error?.code==='PERMISSION_DENIED'||String(error?.code||'').startsWith('account-sync/'))throw error;throw failure('account-sync/network-failed');}
      finally{clearTimeout(timer);abort.abort();}
    }});
  }
  root.favoriteWriteTransport=Object.freeze({DATABASE,createFavoriteWriteTransport});
})(window);
