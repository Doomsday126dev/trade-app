(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  const REQUEST_KEY='pogo.discord.prototype.request';
  const TTL_MS=5*60*1000;
  const TOKEN=/^[A-Za-z0-9_-]{43}$/;
  const BINDING=/^v1_[a-f0-9]{64}$/;
  const SAFE_REASONS=new Set(['provider/subject_already_linked','provider/account_already_linked','discord/auth_lifecycle_changed',
    'discord/rate_limited','auth/recent_auth_required','discord/confirmation_expired']);
  function failure(code){return Object.assign(new Error(code),{code});}
  function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.slice().sort().join(',');}
  function base64url(bytes){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return global.btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  function createDiscordOAuthPrototypeClient({
    fetchImpl=global.fetch.bind(global),location=global.location,history=global.history,
    storage=global.sessionStorage,cryptoApi=global.crypto,clock=()=>Date.now(),
    getAuthorizationHeader=async()=>'',getSessionBinding,signInWithCustomToken,
    endpointRoot='/__local/discord/oauth',callbackUri,candidateMode=false,requestTransport
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
    let generation=0,activeRun=null,review=null;
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
      if(activeRun)throw failure('discord/operation-pending');
      const run={generation:++generation,controller:global.AbortController?new global.AbortController():null};
      run.check=()=>{if(generation!==run.generation||run.controller?.signal.aborted)throw failure('discord/canceled');};
      activeRun=run;
      try{return await work(run);}catch(error){run.check();throw error;}finally{if(activeRun===run)activeRun=null;}
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
        await signInWithCustomToken(result.customToken,{expectedUid:result.uid,expectedLifecycle:pending.lifecycleBinding,isActive:()=>{try{run.check();return true;}catch{return false;}},isCurrent:()=>{try{run.check();assertCurrent(pending);return true;}catch{return false;}}});
        run.check();return Object.freeze({status:'existing-account'});
      }
      if(pending.operation==='sign-in'&&exactKeys(result,['ok','operation','status'])&&result.status==='onboarding-required')return Object.freeze({status:'onboarding-required'});
      throw failure('discord/response-invalid');
    });}
    async function confirmLink(){return exclusive(async run=>{
      if(!review||clock()>=review.expiresAt)throw failure('discord/confirmation-expired');
      const captured=review;
      const result=await request('confirm',captured,{confirmationToken:captured.confirmationToken,requestId:captured.requestId},run);
      if(!exactKeys(result,['ok','operation','status','replay'])||result.ok!==true||result.operation!=='link'||
        !['linked','already-linked'].includes(result.status)||typeof result.replay!=='boolean')throw failure('discord/response-invalid');
      review=null;return Object.freeze({status:result.status});
    });}
    function cancel(){generation++;const previous=activeRun;activeRun=null;previous?.controller?.abort();review=null;clearPending();}
    return Object.freeze({begin,completeFromLocation,confirmLink,cancel});
  }
  root.discordOAuthPrototypeClient=Object.freeze({REQUEST_KEY,TTL_MS,createDiscordOAuthPrototypeClient});
})(window);
