(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const RECENT_AUTH_MAX_AGE_MS=10*60*1000;
  const STATES=Object.freeze(['idle','connecting','waiting-browser','connected','collision','canceled','blocked','reauthenticate','disconnecting','disconnected','unavailable']);
  const OPERATIONS=Object.freeze(['link','sign-in','reauthenticate','unlink']);
  const COLLISION_CODES=new Set(['auth/credential-already-in-use','auth/account-exists-with-different-credential','provider/subject-already-linked','provider-link/collision']);
  const CANCELED_CODES=new Set(['auth/popup-closed-by-user','auth/cancelled-popup-request','provider-link/canceled']);
  const POPUP_BLOCKED_CODES=new Set(['auth/popup-blocked','provider-link/popup-blocked']);

  function failure(code,state='blocked'){
    const value=new Error(code);value.code=code;value.state=STATES.includes(state)?state:'blocked';return value;
  }
  function authority(value){
    const uid=String(value?.uid||''),lifecycleId=String(value?.lifecycleId||'');
    if(!uid)throw failure('provider-link/auth-required','blocked');
    if(!lifecycleId)throw failure('provider-link/lifecycle-missing','blocked');
    return Object.freeze({uid,lifecycleId,authTime:Number(value?.authTime)||0});
  }
  function authorityCurrent(expected,current){
    return!!expected&&!!current&&expected.uid===current.uid&&expected.lifecycleId===current.lifecycleId;
  }
  function recentAuth(value,now=Date.now(),maxAgeMs=RECENT_AUTH_MAX_AGE_MS){
    const authTime=Number(value?.authTime)||0,time=Number(now);
    return authTime>0&&authTime<=time&&time-authTime<=maxAgeMs;
  }
  function boundary(value){
    const fields=['accountDataFingerprint','journalOwner','journalGeneration','migrationGeneration','reviewedEvidenceCount','activeEvidenceCount','listenerAuthority','publicIdentityFingerprint','trainerIdentityFingerprint'];
    const out={};for(const field of fields)out[field]=value?.[field];
    if(typeof out.accountDataFingerprint!=='string'||!out.accountDataFingerprint)throw failure('provider-link/account-boundary-invalid');
    return Object.freeze(out);
  }
  function assertBoundaryUnchanged(beforeValue,afterValue){
    const before=boundary(beforeValue),after=boundary(afterValue);
    for(const key of Object.keys(before))if(before[key]!==after[key])throw failure(`provider-link/account-boundary-changed-${key.replace(/[A-Z]/g,char=>`-${char.toLowerCase()}`)}`);
    return true;
  }
  function unlinkDecision({providerKey,methods,session,now=Date.now(),maxAgeMs=RECENT_AUTH_MAX_AGE_MS}={}){
    if(providerKey==='username-pin')return Object.freeze({ok:false,code:'provider-link/primary-method-protected'});
    const linked=(methods||[]).filter(method=>method?.usable===true);
    const target=linked.find(method=>method.key===providerKey);
    if(!target)return Object.freeze({ok:false,code:'provider-link/provider-not-linked'});
    if(linked.length<=1)return Object.freeze({ok:false,code:'provider-link/last-usable-method'});
    if(!recentAuth(session,now,maxAgeMs))return Object.freeze({ok:false,code:'provider-link/recent-auth-required'});
    return Object.freeze({ok:true,remaining:linked.length-1});
  }
  function classify(error){
    const code=String(error?.code||'provider-link/failed');
    if(COLLISION_CODES.has(code))return Object.freeze({code:'provider-link/collision',state:'collision',retryable:false});
    if(CANCELED_CODES.has(code))return Object.freeze({code:'provider-link/canceled',state:'canceled',retryable:true});
    if(POPUP_BLOCKED_CODES.has(code))return Object.freeze({code:'provider-link/popup-blocked',state:'blocked',retryable:true});
    if(code==='provider-link/provider-unavailable')return Object.freeze({code,state:'unavailable',retryable:false});
    if(code==='provider-link/recent-auth-required')return Object.freeze({code,state:'reauthenticate',retryable:true});
    const safeCode=/^provider-(?:link|continuation)\/[a-z0-9-]+$/.test(code)?code:'provider-link/failed';
    const state=STATES.includes(error?.state)?error.state:'blocked';
    return Object.freeze({code:safeCode,state,retryable:!['collision','unavailable'].includes(state)});
  }

  root.accountLinkingModel=Object.freeze({RECENT_AUTH_MAX_AGE_MS,STATES,OPERATIONS,failure,authority,authorityCurrent,recentAuth,boundary,assertBoundaryUnchanged,unlinkDecision,classify});
})(window);
