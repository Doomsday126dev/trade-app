(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  const REQUEST_KEY='pogo.discord.prototype.request';
  const TTL_MS=5*60*1000;
  const TOKEN=/^[A-Za-z0-9_-]{43}$/;
  const BINDING=/^v1_[a-f0-9]{64}$/;
  const SAFE_REASONS=new Set(['provider/subject_already_linked','provider/account_already_linked','discord/auth_lifecycle_changed',
    'discord/handle_conflict','discord/registration_canceled','discord/registration_expired','discord/registration_review_required','discord/rate_limited','auth/recent_auth_required','discord/confirmation_expired']);
  function failure(code){return Object.assign(new Error(code),{code});}
  function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.slice().sort().join(',');}
  function base64url(bytes){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return global.btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  function createDiscordOAuthPrototypeClient({
    fetchImpl=global.fetch.bind(global),location=global.location,history=global.history,
    storage=global.sessionStorage,cryptoApi=global.crypto,clock=()=>Date.now(),
    getAuthorizationHeader=async()=>'',getSessionBinding,signInWithCustomToken,
    endpointRoot='/__local/discord/oauth',callbackUri,candidateMode=false,requestTransport,onStatus=()=>{}
  }={}){
    if(!fetchImpl||!location||!history||!storage||!cryptoApi?.getRandomValues||typeof getSessionBinding!=='function')throw new TypeError('Discord prototype client dependencies are incomplete');
    const initial=new URL(location.href),origin=initial.origin;
    if(candidateMode){if(origin!=='https://doomsday126dev.github.io'||typeof requestTransport!=='function')throw failure('discord/candidate-config-invalid');}
    else if(initial.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(initial.hostname)||endpointRoot!=='/__local/discord/oauth')throw failure('discord/development-only');
    if(typeof callbackUri!=='string'||!callbackUri)throw failure('discord/callback-invalid');
    const redirect=new URL(callbackUri,origin);
    if(candidateMode&&redirect.pathname!=='/trade-app/auth/discord.html')throw failure('discord/callback-invalid');
    if(redirect.origin!==origin||redirect.search||redirect.hash||redirect.username||redirect.password)throw failure('discord/callback-invalid');
    const endpoint=route=>new URL(`${endpointRoot}/${route}`,origin).href;
    let generation=0,activeRun=null,review=null,coordinationBlocked=false;
    const getState=()=>Object.freeze({status:coordinationBlocked?'coordination-blocked':activeRun?.committing?'committing':activeRun?'pending':review?.kind==='registration'?'onboarding':review?'review':'idle',canCancel:!coordinationBlocked&&!activeRun?.committing});
    function notify(){try{onStatus(getState());}catch{/* UI observers cannot alter auth decisions. */}}
    function session(operation){
      const value=getSessionBinding();
      if(!exactKeys(value,['ownerBinding','lifecycleBinding'])||!BINDING.test(value.lifecycleBinding)||
        (operation==='link'?!BINDING.test(value.ownerBinding):value.ownerBinding!==''))throw failure('discord/session-changed');
      return{...value};
    }
    function assertCurrent(expected){
      const value=session(expected.operation);
      if(value.ownerBinding!==expected.ownerBinding||value.lifecycleBinding!==expected.lifecycleBinding)throw failure('discord/session-changed');
    }
    async function request(route,pending,payload,run){
      run.check();assertCurrent(pending);
      const headers={'content-type':'application/json'};
      if(pending.operation==='link'){
        const authorization=await getAuthorizationHeader();
        run.check();assertCurrent(pending);
        if(!authorization)throw failure('discord/auth-required');headers.authorization=authorization;
      }
      if(candidateMode){
        const data=await requestTransport(route,{...payload,browserBinding:pending.browserBinding,lifecycleId:pending.lifecycleBinding},{authorization:headers.authorization||'',signal:run.controller?.signal});
        run.check();assertCurrent(pending);
        if(data?.ok===false)throw failure(SAFE_REASONS.has(data?.error?.reason)?data.error.reason:'discord/request-failed');
        return data;
      }
      const response=await fetchImpl(endpoint(route),{method:'POST',credentials:'same-origin',redirect:'error',headers,body:JSON.stringify(payload),...(run.controller?{signal:run.controller.signal}:{})});
      run.check();assertCurrent(pending);
      let data;try{data=await response.json();}catch{throw failure('discord/response-invalid');}
      run.check();assertCurrent(pending);
      if(!response.ok||data?.ok===false)throw failure(SAFE_REASONS.has(data?.error?.reason)?data.error.reason:'discord/request-failed');
      return data;
    }
    async function exclusive(work){
      if(coordinationBlocked)throw failure('provider-auth/coordination-blocked');
      if(activeRun)throw failure('discord/operation-pending');
      const run={generation:++generation,controller:global.AbortController?new global.AbortController():null};
      run.check=()=>{if(generation!==run.generation||run.controller?.signal.aborted)throw failure('discord/canceled');};
      activeRun=run;
      notify();
      try{return await work(run);}catch(error){run.check();throw error;}finally{if(activeRun===run){activeRun=null;notify();}}
    }
    function clearPending(){storage.removeItem(REQUEST_KEY);}
    function scrubCallback(){
      const clean=new URL(location.href);for(const key of['code','state','iss','error','error_description','error_uri'])clean.searchParams.delete(key);
      history.replaceState(history.state,'',`${clean.pathname}${clean.search}${clean.hash}`);
    }
    async function begin(operation){return exclusive(async run=>{
      if(!['link','sign-in'].includes(operation))throw new TypeError('Invalid Discord operation');
      review=null;clearPending();
      const captured=session(operation),issuedAt=clock();
      const pending={operation,requestId:`discord-${base64url(cryptoApi.getRandomValues(new Uint8Array(32)))}`,...captured,...(candidateMode?{browserBinding:base64url(cryptoApi.getRandomValues(new Uint8Array(32)))}:{})};
      const result=await request('begin',pending,{operation,requestId:pending.requestId},run);
      if(!exactKeys(result,['authorizeUrl','expiresInMs'])||!Number.isSafeInteger(result.expiresInMs)||result.expiresInMs<1||result.expiresInMs>TTL_MS)throw failure('discord/response-invalid');
      const authorize=new URL(result.authorizeUrl);
      const fields=['response_type','client_id','redirect_uri','scope','state','code_challenge','code_challenge_method','prompt'];
      if(authorize.origin!=='https://discord.com'||authorize.username||authorize.password||authorize.hash||authorize.pathname!=='/oauth2/authorize'||
        [...authorize.searchParams.keys()].sort().join(',')!==fields.sort().join(',')||
        authorize.searchParams.get('prompt')!=='consent'||authorize.searchParams.get('response_type')!=='code'||authorize.searchParams.get('scope')!=='identify'||
        authorize.searchParams.get('code_challenge_method')!=='S256'||!TOKEN.test(authorize.searchParams.get('state'))||
        !TOKEN.test(authorize.searchParams.get('code_challenge'))||!/^\d{5,32}$/.test(authorize.searchParams.get('client_id'))||
        authorize.searchParams.get('redirect_uri')!==redirect.href||authorize.searchParams.has('client_secret'))throw failure('discord/authorization-url-invalid');
      run.check();assertCurrent(pending);
      storage.setItem(REQUEST_KEY,JSON.stringify({...pending,state:authorize.searchParams.get('state'),issuedAt,expiresAt:issuedAt+result.expiresInMs}));
      try{location.assign(authorize.href);}catch{clearPending();throw failure('discord/navigation-failed');}
      return Object.freeze({status:'redirecting'});
    });}
    async function completeFromLocation(callbackUrl=location.href){return exclusive(async run=>{
      const callback=new URL(callbackUrl),hasCallback=['code','state','error'].some(key=>callback.searchParams.has(key));
      if(!hasCallback)return null;
      // Scrub before storage, network, or validation can throw. Never render provider error text.
      scrubCallback();
      let pending;try{pending=JSON.parse(storage.getItem(REQUEST_KEY)||'null');}catch{}finally{clearPending();}
      if(!exactKeys(pending,['operation','requestId','ownerBinding','lifecycleBinding','state','issuedAt','expiresAt',...(candidateMode?['browserBinding']:[])])||
        !['link','sign-in'].includes(pending.operation)||!/^discord-[A-Za-z0-9_-]{43}$/.test(pending.requestId)||
        !TOKEN.test(pending.state)||(candidateMode&&!TOKEN.test(pending.browserBinding))||!Number.isSafeInteger(pending.issuedAt)||!Number.isSafeInteger(pending.expiresAt)||
        pending.expiresAt<=clock()||pending.issuedAt>clock()||pending.expiresAt-pending.issuedAt>TTL_MS)throw failure('discord/continuation-invalid');
      run.check();assertCurrent(pending);
      if(callback.searchParams.getAll('iss').length!==1||callback.searchParams.get('iss')!=='https://discord.com'||callback.origin!==redirect.origin||callback.pathname!==redirect.pathname||callback.searchParams.getAll('state').length!==1||callback.searchParams.get('state')!==pending.state)throw failure('discord/callback-invalid');
      if(callback.searchParams.has('error')){
        if(callback.searchParams.has('code')||callback.searchParams.getAll('error').length!==1)throw failure('discord/callback-invalid');
        if(callback.searchParams.get('error')!=='access_denied')throw failure('discord/provider-unavailable');
        return Object.freeze({status:'canceled'});
      }
      const code=callback.searchParams.get('code');
      if(callback.searchParams.getAll('code').length!==1||typeof code!=='string'||code.length<8||code.length>2048||/[\u0000-\u001f\u007f]/.test(code))throw failure('discord/callback-invalid');
      const result=await request('complete',pending,{code,issuer:callback.searchParams.get('iss'),state:pending.state,requestId:pending.requestId},run);
      if(result.operation!==pending.operation||result.ok!==true)throw failure('discord/response-invalid');
      if(pending.operation==='link'&&exactKeys(result,['ok','operation','status','confirmationToken','discordLabel','expiresInMs'])&&
        result.status==='confirmation-required'&&TOKEN.test(result.confirmationToken)&&typeof result.discordLabel==='string'&&result.discordLabel.length<=80&&
        Number.isSafeInteger(result.expiresInMs)&&result.expiresInMs>0&&result.expiresInMs<=TTL_MS){
        review={...pending,confirmationToken:result.confirmationToken,expiresAt:clock()+result.expiresInMs};
        return Object.freeze({status:'confirmation-required',discordLabel:result.discordLabel});
      }
      if(pending.operation==='sign-in'&&exactKeys(result,['ok','operation','status','uid','customToken'])&&result.status==='existing-account'&&
        typeof result.uid==='string'&&/^[A-Za-z0-9_-]{6,128}$/.test(result.uid)&&typeof result.customToken==='string'&&result.customToken.length>=8&&result.customToken.length<=8192){
        if(typeof signInWithCustomToken!=='function')throw failure('discord/sign-in-unavailable');
        run.check();assertCurrent(pending);
        // The host must serialize ALL auth actions, including cross-tab changes, with this commit.
        const committed=await signInWithCustomToken(result.customToken,{expectedUid:result.uid,expectedLifecycle:pending.lifecycleBinding,
          onCommitBoundary:()=>{run.check();assertCurrent(pending);run.committing=true;notify();},
          isActive:()=>{try{run.check();return true;}catch{return false;}},isCurrent:()=>{try{run.check();assertCurrent(pending);return true;}catch{return false;}}});
        run.check();coordinationBlocked=committed?.authCoordinationBlocked===true;
        return Object.freeze({status:'existing-account',...(coordinationBlocked?{authCoordinationBlocked:true}:{})});
      }
      if(pending.operation==='sign-in'&&exactKeys(result,['ok','operation','status','registrationToken','expiresInMs'])&&result.status==='onboarding-required'&&TOKEN.test(result.registrationToken)&&Number.isSafeInteger(result.expiresInMs)&&result.expiresInMs>0&&result.expiresInMs<=TTL_MS){
        review={...pending,kind:'registration',registrationToken:result.registrationToken,expiresAt:clock()+result.expiresInMs,requestedHandle:null};
        return Object.freeze({status:'onboarding-required'});
      }
      if(pending.operation==='sign-in'&&exactKeys(result,['ok','operation','status'])&&result.status==='onboarding-required')return Object.freeze({status:'onboarding-required'});
      throw failure('discord/response-invalid');
    });}
    async function confirmLink(){return exclusive(async run=>{
      if(!review||review.kind==='registration'||clock()>=review.expiresAt)throw failure('discord/confirmation-expired');
      const captured=review;
      const result=await request('confirm',captured,{confirmationToken:captured.confirmationToken,requestId:captured.requestId},run);
      if(!exactKeys(result,['ok','operation','status','replay'])||result.ok!==true||result.operation!=='link'||
        !['linked','already-linked'].includes(result.status)||typeof result.replay!=='boolean')throw failure('discord/response-invalid');
      review=null;return Object.freeze({status:result.status});
    });}
    async function confirmRegistration({requestedHandle,reviewAccepted=false}={}){return exclusive(async run=>{
      const captured=review;
      if(captured?.kind!=='registration'||clock()>=captured.expiresAt)throw failure('discord/registration-expired');
      if(reviewAccepted!==true)throw failure('discord/registration-review-required');
      const handle=String(requestedHandle||'').normalize('NFKC').trim();
      if(!handle||handle.length>64)throw failure('discord/handle-invalid');
      if(captured.requestedHandle&&captured.requestedHandle!==handle)throw failure('discord/registration-retry-same-handle');
      // After dispatch an unknown outcome must retain this exact reviewed name.
      captured.requestedHandle=handle;
      let result;
      try{result=await request('register',captured,{registrationToken:captured.registrationToken,requestId:captured.requestId,requestedHandle:handle,reviewAccepted:true},run);}
      catch(error){if(error.code==='discord/handle_conflict')captured.requestedHandle=null;throw error;}
      if(!exactKeys(result,['ok','operation','status','uid','customToken','canonicalTrainerName','replay'])||result.ok!==true||result.operation!=='registration'||result.status!=='account-created'||
        !/^[A-Za-z0-9_-]{6,128}$/.test(result.uid||'')||typeof result.customToken!=='string'||result.customToken.length<8||result.customToken.length>8192||result.canonicalTrainerName!==handle||typeof result.replay!=='boolean')throw failure('discord/response-invalid');
      if(typeof signInWithCustomToken!=='function')throw failure('discord/sign-in-unavailable');
      run.check();assertCurrent(captured);
      const committed=await signInWithCustomToken(result.customToken,{expectedUid:result.uid,expectedLifecycle:captured.lifecycleBinding,
        onCommitBoundary:()=>{run.check();assertCurrent(captured);run.committing=true;notify();},
        isActive:()=>{try{run.check();return true;}catch{return false;}},isCurrent:()=>{try{run.check();assertCurrent(captured);return true;}catch{return false;}}});
      run.check();coordinationBlocked=committed?.authCoordinationBlocked===true;review=null;
      return Object.freeze({status:'account-created',...(coordinationBlocked?{authCoordinationBlocked:true}:{})});
    });}
    async function cancelRegistration(){return exclusive(async run=>{
      const captured=review;
      if(captured?.kind!=='registration')throw failure('discord/registration-expired');
      const result=await request('cancelRegistration',captured,{registrationToken:captured.registrationToken,requestId:captured.requestId},run);
      if(!exactKeys(result,['ok','operation','status'])||result.ok!==true||result.operation!=='registration'||!['canceled','already-created'].includes(result.status))throw failure('discord/response-invalid');
      review=null;return Object.freeze({status:result.status});
    });}
    async function readAccount(){return exclusive(async run=>{
      const captured={...session('link'),operation:'link'};
      const result=await request('readAccount',captured,{},run);
      const foundation=result?.foundation;
      if(!exactKeys(result,['ok','operation','foundation'])||result.ok!==true||result.operation!=='read-account'||
        !exactKeys(foundation,['schemaVersion','canonicalTrainerName','normalizedTrainerName','handleKey','identityKind','legacyAccessConfigured','legacyUsername','revision','status'])||
        foundation.schemaVersion!==1||foundation.status!=='active'||!Number.isSafeInteger(foundation.revision)||foundation.revision<1||
        typeof foundation.canonicalTrainerName!=='string'||!foundation.canonicalTrainerName||foundation.canonicalTrainerName.length>128||
        foundation.normalizedTrainerName!==foundation.canonicalTrainerName.normalize('NFKC').toLowerCase()||!/^v1_[a-f0-9]{2,512}$/.test(foundation.handleKey||'')||
        !['provider_only','legacy_migrated'].includes(foundation.identityKind)||foundation.legacyAccessConfigured!==(foundation.identityKind==='legacy_migrated')||
        (foundation.identityKind==='provider_only'?foundation.legacyUsername!==null:foundation.legacyUsername!==foundation.canonicalTrainerName))throw failure('discord/response-invalid');
      return result;
    });}
    function cancel(){
      if(coordinationBlocked)return Object.freeze({status:'coordination-blocked',canCancel:false});
      if(activeRun?.committing)return Object.freeze({status:'committing',canCancel:false});
      generation++;const previous=activeRun;activeRun=null;previous?.controller?.abort();review=null;clearPending();notify();
      return Object.freeze({status:'canceled',canCancel:true});
    }
    return Object.freeze({begin,completeFromLocation,confirmLink,confirmRegistration,cancelRegistration,readAccount,cancel,getState});
  }
  root.discordOAuthPrototypeClient=Object.freeze({REQUEST_KEY,TTL_MS,createDiscordOAuthPrototypeClient});
})(window);
