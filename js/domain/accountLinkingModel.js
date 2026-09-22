(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const RECENT_AUTH_MAX_AGE_MS=10*60*1000;
  const STATES=Object.freeze(['idle','connecting','prepared','waiting-browser','connected','collision','canceled','blocked','reauthenticate','disconnecting','disconnected','unavailable']);
  const OPERATIONS=Object.freeze(['link','sign-in','reauthenticate','unlink']);
  const COLLISION_CODES=new Set(['auth/credential-already-in-use','auth/account-exists-with-different-credential','provider/subject-already-linked','provider-link/collision']);
  const CANCELED_CODES=new Set(['auth/popup-closed-by-user','auth/cancelled-popup-request','provider-link/canceled']);
  const POPUP_BLOCKED_CODES=new Set(['auth/popup-blocked','provider-link/popup-blocked']);
  const PRODUCT_COMPONENT_KEYS=Object.freeze(['lists','favorites','favoriteTags','specialTradeBoard','intentDeclarations','canonicalEntities']);

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
  function plainObject(value){return!!value&&typeof value==='object'&&!Array.isArray(value);}
  function stable(value){
    if(Array.isArray(value))return value.map(stable);
    if(plainObject(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
    return value;
  }
  function canonicalJson(value){return JSON.stringify(stable(value));}
  function sortedCollection(value,identity){
    return(Array.isArray(value)?value:[]).map(stable).sort((a,b)=>{
      const left=String(identity(a)||''),right=String(identity(b)||'');
      return left.localeCompare(right)||canonicalJson(a).localeCompare(canonicalJson(b));
    });
  }
  function productComponents(value={}){
    const board=plainObject(value.board)?value.board:plainObject(value.specialTradeBoard)?value.specialTradeBoard:{};
    return Object.freeze({
      lists:stable(plainObject(value.lists)?value.lists:{}),
      favorites:Object.freeze(sortedCollection(value.favorites,item=>item?.targetUid||item?.key||item?.displayName)),
      favoriteTags:stable(plainObject(value.tags)?value.tags:plainObject(value.favoriteTags)?value.favoriteTags:{}),
      specialTradeBoard:Object.freeze({
        lf:Object.freeze((Array.isArray(board.lf)?board.lf:[]).map(stable)),
        ft:Object.freeze((Array.isArray(board.ft)?board.ft:[]).map(stable))
      }),
      intentDeclarations:Object.freeze(sortedCollection(value.intentDeclarations,item=>`${item?.sortOrder??''}\u0000${item?.entityId||item?.catalogId||item?.name||''}\u0000${item?.side||''}`)),
      canonicalEntities:Object.freeze(sortedCollection(value.canonicalEntities,item=>`${item?.entityType||''}\u0000${item?.entityId||''}`))
    });
  }
  function collectionSummary(value,identity){
    const rows=Array.isArray(value)?value:[],ids=rows.map(item=>String(identity(item)||'')),counts=new Map();
    ids.forEach(id=>counts.set(id,(counts.get(id)||0)+1));
    return Object.freeze({length:rows.length,identityOrder:Object.freeze(ids),semanticIdentities:Object.freeze([...counts.keys()].sort()),duplicateIdentities:Object.freeze([...counts.entries()].filter(([,count])=>count>1).map(([id,count])=>Object.freeze({id,count})))});
  }
  function productComponentSummaries(components){
    const value=productComponents(components),lists=value.lists,board=value.specialTradeBoard;
    return Object.freeze({
      lists:Object.freeze(Object.fromEntries(Object.entries(lists).map(([key,items])=>[key,Object.freeze({length:Object.keys(plainObject(items)).length,identities:Object.freeze(Object.keys(plainObject(items)).sort())})]))),
      favorites:collectionSummary(value.favorites,item=>item?.targetUid||item?.key||item?.displayName),
      favoriteTags:Object.freeze({length:Object.keys(value.favoriteTags).length,identities:Object.freeze(Object.keys(value.favoriteTags).sort())}),
      specialTradeBoard:Object.freeze({lf:collectionSummary(board.lf,item=>item?.entityId||item?.catalogId||item?.no||item?.name),ft:collectionSummary(board.ft,item=>item?.entityId||item?.catalogId||item?.no||item?.name)}),
      intentDeclarations:collectionSummary(value.intentDeclarations,item=>item?.entityId||`${item?.catalogId||item?.name||''}\u0000${item?.side||''}`),
      canonicalEntities:collectionSummary(value.canonicalEntities,item=>`${item?.entityType||''}\u0000${item?.entityId||''}`)
    });
  }
  async function productEvidence(value,{fingerprint}={}){
    if(typeof fingerprint!=='function')throw failure('provider-link/account-boundary-invalid');
    const components=productComponents(value),componentFingerprints={};
    for(const key of PRODUCT_COMPONENT_KEYS)componentFingerprints[key]=await fingerprint(components[key]);
    return Object.freeze({
      fingerprint:await fingerprint(components),
      components:Object.freeze(componentFingerprints),
      summaries:productComponentSummaries(components)
    });
  }
  function boundary(value){
    const fields=['accountDataFingerprint','accountDataComponents','journalOwner','journalGeneration','migrationGeneration','recoveryEvidenceFingerprint','reviewedEvidenceCount','activeEvidenceCount','listenerAuthority','publicIdentityFingerprint','trainerIdentityFingerprint'];
    const out={};for(const field of fields)out[field]=value?.[field];
    if(typeof out.accountDataFingerprint!=='string'||!out.accountDataFingerprint)throw failure('provider-link/account-boundary-invalid');
    if(!plainObject(out.accountDataComponents)||Object.keys(out.accountDataComponents).sort().join(',')!==[...PRODUCT_COMPONENT_KEYS].sort().join(',')||PRODUCT_COMPONENT_KEYS.some(key=>typeof out.accountDataComponents[key]!=='string'||!out.accountDataComponents[key]))throw failure('provider-link/account-boundary-invalid');
    out.accountDataComponents=Object.freeze({...out.accountDataComponents});
    return Object.freeze(out);
  }
  function assertBoundaryUnchanged(beforeValue,afterValue){
    const before=boundary(beforeValue),after=boundary(afterValue);
    for(const key of PRODUCT_COMPONENT_KEYS)if(before.accountDataComponents[key]!==after.accountDataComponents[key])throw failure(`provider-link/account-boundary-changed-account-data-${key.replace(/[A-Z]/g,char=>`-${char.toLowerCase()}`)}`);
    for(const key of Object.keys(before))if(key!=='accountDataComponents'&&before[key]!==after[key])throw failure(`provider-link/account-boundary-changed-${key.replace(/[A-Z]/g,char=>`-${char.toLowerCase()}`)}`);
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

  root.accountLinkingModel=Object.freeze({RECENT_AUTH_MAX_AGE_MS,STATES,OPERATIONS,PRODUCT_COMPONENT_KEYS,failure,authority,authorityCurrent,recentAuth,productComponents,productComponentSummaries,productEvidence,boundary,assertBoundaryUnchanged,unlinkDecision,classify});
})(window);
