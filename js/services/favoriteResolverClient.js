(function(global){
  'use strict';
  const root=global.PogoServices=global.PogoServices||{};
  const ENDPOINT='https://us-central1-trade-list-a4297.cloudfunctions.net/resolveLegacyFavoriteIdentities';
  const MAX_HANDLES=50;
  const valid=(value,max=128)=>typeof value==='string'&&value.length>0&&value.length<=max&&value===value.trim()&&value===value.normalize('NFC')&&!/[.#$\[\]/\u0000-\u001f\u007f]/u.test(value);
  const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...fields].sort().join(',');
  const failure=(code,retryAfter=0)=>Object.assign(new Error(code),{code,retryAfter});
  function validateResponse(value,handles,ownerUid){
    if(!exact(value,['version','results'])||value.version!==1||!Array.isArray(value.results)||value.results.length!==handles.length)throw failure('favorite/response-invalid');
    const results=value.results.map((row,index)=>{
      if(row?.handle!==handles[index])throw failure('favorite/response-invalid');
      if(exact(row,['handle','status'])&&row.status==='unavailable')return Object.freeze({...row});
      if(!exact(row,['handle','status','targetUid','canonicalHandle'])||row.status!=='resolved'||!valid(row.targetUid)||row.targetUid===ownerUid||row.canonicalHandle!==handles[index])throw failure('favorite/response-invalid');
      return Object.freeze({...row});
    });
    return Object.freeze(results);
  }
  function createFavoriteResolverClient({auth,appCheckReady,loadAppCheckSdk,sessionCurrent,enabled=false,fetch=global.fetch?.bind(global),timeoutMs=25000}={}){
    if(!auth||[appCheckReady,loadAppCheckSdk,sessionCurrent,fetch].some(fn=>typeof fn!=='function'))throw new TypeError('Favorite resolver client is incomplete');
    return Object.freeze({async resolve(handles){
      if(!enabled)throw failure('favorite/not-enabled');
      if(!Array.isArray(handles)||handles.length<1||handles.length>MAX_HANDLES||handles.some(value=>!valid(value,64))||new Set(handles).size!==handles.length)throw failure('favorite/request-invalid');
      const user=auth.currentUser,uid=user?.uid;
      const current=()=>{if(!valid(uid)||auth.currentUser!==user||!sessionCurrent())throw failure('favorite/session-changed');};
      current();const abort=new AbortController();let timer;
      try{
        const work=(async()=>{
          const token=await user.getIdToken();current();
          const ready=await appCheckReady();current();if(!ready?.ok||!ready.instance)throw failure('favorite/app-check-required');
          const sdk=await loadAppCheckSdk();current();
          if(typeof sdk.getLimitedUseToken!=='function')throw failure('favorite/app-check-required');
          const appToken=await sdk.getLimitedUseToken(ready.instance);current();
          if(typeof appToken?.token!=='string'||!appToken.token)throw failure('favorite/app-check-required');
          const response=await fetch(ENDPOINT,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',signal:abort.signal,
            headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`,'X-Firebase-AppCheck':appToken.token},body:JSON.stringify({handles})});current();
          const text=await response.text();current();if(text.length>32768)throw failure('favorite/response-invalid');
          let value;try{value=JSON.parse(text);}catch{throw failure('favorite/response-invalid');}
          if(!response.ok){
            const allowed=['favorite/auth-required','favorite/app-check-required','favorite/caller-unavailable','favorite/rate-limited','favorite/busy','favorite/not-enabled','favorite/unavailable','favorite/quota-unavailable'];
            const code=exact(value,['code'])&&allowed.includes(value.code)?value.code:'favorite/unavailable';
            throw failure(code,Math.max(0,Math.min(900,Number(response.headers.get('Retry-After'))||0)));
          }
          return validateResponse(value,handles,uid);
        })();
        return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(failure('favorite/network-failed'));},timeoutMs);})]);
      }catch(error){current();if(String(error?.code||'').startsWith('favorite/'))throw error;throw failure('favorite/network-failed');}
      finally{clearTimeout(timer);abort.abort();}
    }});
  }
  root.favoriteResolverClient=Object.freeze({ENDPOINT,MAX_HANDLES,valid,validateResponse,createFavoriteResolverClient});
})(window);
