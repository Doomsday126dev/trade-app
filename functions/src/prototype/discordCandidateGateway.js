'use strict';
const {fail,stableError}=require('../domain/errors');
const BINDING=/^[A-Za-z0-9_-]{43,128}$/,LIFECYCLE=/^[A-Za-z0-9._:-]{8,160}$/;
const FIELDS={
  begin:['operation','requestId','browserBinding','lifecycleId'],
  complete:['issuer','code','state','requestId','browserBinding','lifecycleId'],
  confirm:['confirmationToken','requestId','browserBinding','lifecycleId'],
  unlink:['requestId','expectedProviderRevision','browserBinding','lifecycleId']
};
// Host seam for the existing public gateway -> private authority pattern.
// No Functions export, credential lookup, environment activation, or deployment is performed here.
function createDiscordCandidateGateway({enabled=false,oauth,authority,verifyAppCheck,allowedOrigin}={}){
  if(!oauth?.begin||!oauth?.complete||!oauth?.confirmLink||!authority?.verify||!authority?.unlink||typeof verifyAppCheck!=='function'||!allowedOrigin)throw new TypeError('Candidate gateway dependencies required');
  return async function invoke(action,input,context={}){
    try{
      if(!enabled)fail('unavailable','discord/gate_disabled');
      if(context.origin!==allowedOrigin)fail('permission_denied','discord/origin_invalid');
      if(await verifyAppCheck(context.appCheckToken)!==true)fail('app_check_required','discord/app_check_required');
      if(!FIELDS[action]||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!==[...FIELDS[action]].sort().join(',')||Buffer.byteLength(JSON.stringify(input))>4096||!BINDING.test(input.browserBinding)||!LIFECYCLE.test(input.lifecycleId))fail('invalid_argument','discord/request_invalid');
      const currentAuthority=async()=>context.idToken?authority.verify({idToken:context.idToken,lifecycleId:input.lifecycleId}):null;
      const base={...input,clientKey:input.browserBinding,currentAuthority};delete base.lifecycleId;
      if(action==='begin')return await oauth.begin(base);
      if(action==='complete')return await oauth.complete({...base,observedRedirectUri:oauth.redirectUri});
      if(action==='confirm')return await oauth.confirmLink(base);
      if(!context.idToken)fail('unauthenticated','discord/auth_required');
      // No caller may supply an alternate-method assertion or raw Firestore path.
      return await authority.unlink({idToken:context.idToken,lifecycleId:input.lifecycleId,requestId:input.requestId,expectedProviderRevision:input.expectedProviderRevision});
    }catch(error){return{ok:false,error:stableError(error)};}
  };
}
module.exports={createDiscordCandidateGateway};
