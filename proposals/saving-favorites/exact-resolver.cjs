'use strict';
// Review-only contract. No HTTP export, Firebase initialization, deployment hook,
// provider flag or client call site. Trusted adapters must be supplied explicitly.
const key=value=>typeof value==='string'&&value.length>0&&value.length<=128&&value===value.trim()&&!/[.#$\[\]/\u0000-\u001f\u007f]/u.test(value);
function unavailable(){return Object.freeze({ok:false,code:'favorite/identity-unavailable'});}
function createExactFavoriteResolver({verifyAuth,verifyAppCheck,consumeQuota,readExact}){
  for(const dependency of [verifyAuth,verifyAppCheck,consumeQuota,readExact])if(typeof dependency!=='function')throw new TypeError('Trusted resolver adapter required');
  return async function resolve(request){
    const body=request?.body;
    if(!body||Object.keys(body).length!==1||!key(body.handle))return unavailable();
    try{
      const caller=await verifyAuth(request);if(!key(caller?.uid))return unavailable();
      if(await verifyAppCheck(request,{consume:true})!==true)return unavailable();
      if(await consumeQuota(caller.uid,{limit:30,windowMs:900000})!==true)return unavailable();
      const callerHandle=await readExact(`authIndex/${caller.uid}/username`);
      if(!key(callerHandle)||await readExact(`users/${callerHandle}/authUid`)!==caller.uid)return unavailable();
      const targetUid=await readExact(`users/${body.handle}/authUid`);
      if(!key(targetUid)||targetUid===caller.uid)return unavailable();
      if(await readExact(`authIndex/${targetUid}/username`)!==body.handle)return unavailable();
      return Object.freeze({ok:true,targetUid,canonicalHandle:body.handle});
    }catch{return unavailable();}
  };
}
module.exports={createExactFavoriteResolver};
