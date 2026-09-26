// Optional synthetic Auth/App Check/HTTP service boundary for the real Favorite
// resolver, write transport, journal and acknowledgement path. No UI replacement.
function prepareFavoriteTransport(){
  window.__installSyntheticFavoriteTransport=()=>{
    auth.currentUser.getIdToken=async()=> 'synthetic-id-token';
    firebaseAppCheckReady=async()=>({ok:true,instance:{}});
    loadFirebaseAppCheckSdk=async()=>({getToken:async()=>({token:'synthetic-app-check'}),getLimitedUseToken:async()=>({token:'synthetic-limited-app-check'})});
    const original=window.fetch.bind(window);__editorFixture.favoriteRequests=[];
    window.fetch=async(input,options={})=>{
      const url=new URL(String(input));
      if(url.hostname==='us-central1-trade-list-a4297.cloudfunctions.net'){
        if(url.pathname!=='/resolveLegacyFavoriteIdentities'||options.method!=='POST')throw Error('Unexpected synthetic resolver request');
        const handles=JSON.parse(options.body).handles;__editorFixture.favoriteRequests.push({kind:'resolve',handles});
        return new Response(JSON.stringify({version:1,results:handles.map(handle=>({handle,status:'resolved',targetUid:'synthetic-'+handle.replaceAll(' ','-'),canonicalHandle:handle}))}),{status:200});
      }
      if(url.hostname==='trade-list-a4297-default-rtdb.firebaseio.com'){
        if(url.pathname!=='/.json'||options.method!=='PATCH')throw Error('Unexpected synthetic Favorite request');
        const changes=JSON.parse(options.body);
        for(const path of Object.keys(changes))if(!path.startsWith('accountSync/want-editor-local-uid/favorites/')&&!path.startsWith('favoriteSlots/want-editor-local-uid/'))throw Error('Unexpected synthetic Favorite write path');
        __editorFixture.favoriteRequests.push({kind:'write',paths:Object.keys(changes)});
        __editorFixture.receive(changes);
        return new Response(null,{status:204});
      }
      return original(input,options);
    };
  };
}
module.exports={prepareFavoriteTransport};
