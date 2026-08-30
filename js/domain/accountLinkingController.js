(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const model=root.accountLinkingModel;
  if(!model)throw new Error('Account linking model must load before the controller');

  function createSharedOperationLease(){
    const active=new Map();let sequence=0;
    return Object.freeze({
      acquire(key){if(active.has(key))return null;const token=Object.freeze({key,sequence:++sequence});active.set(key,token);return token;},
      release(token){if(token&&active.get(token.key)===token)active.delete(token.key);},
      size(){return active.size;}
    });
  }
  function createAccountLinkingController({registry,continuation,authSession,providerAdapter,accountBoundary,lease=createSharedOperationLease(),clock=()=>Date.now()}={}){
    if(!registry||!continuation||!authSession?.snapshot||!providerAdapter||!accountBoundary?.snapshot)throw new TypeError('Account linking controller dependencies are incomplete');
    let state=Object.freeze({status:'idle',operation:'',providerKey:'',code:'',retryable:false});
    let generation=0,lastRetry=null,activeAuthority=null;
    const listeners=new Set();
    const notify=next=>{state=Object.freeze({...next});for(const listener of listeners)listener(state);return state;};
    const currentAuthority=()=>model.authority(authSession.snapshot());
    async function capture(operation,providerKey){
      if(!model.OPERATIONS.includes(operation))throw model.failure('provider-link/operation-invalid');
      const descriptor=registry.descriptor(providerKey);
      if(!descriptor||(providerKey==='username-pin'&&operation!=='reauthenticate'))throw model.failure('provider-link/provider-unavailable','unavailable');
      const availability=registry.availability(providerKey);if(!availability.available)throw model.failure('provider-link/provider-unavailable','unavailable');
      const session=currentAuthority(),ownerBinding=await continuation.ownerBinding(session.uid),lifecycleBinding=await continuation.lifecycleBinding(`${session.uid}\0${session.lifecycleId}`);
      const before=model.boundary(await accountBoundary.snapshot(session.uid));
      return Object.freeze({operation,providerKey,session,ownerBinding,lifecycleBinding,before,generation:++generation});
    }
    function requireCurrent(context,result){
      let current;try{current=currentAuthority();}catch{throw model.failure('provider-link/auth-lifecycle-changed');}
      if(context.generation!==generation||!model.authorityCurrent(context.session,current))throw model.failure('provider-link/auth-lifecycle-changed');
      if(result?.uid&&result.uid!==context.session.uid)throw model.failure('provider-link/uid-changed');
      return current;
    }
    async function verifyUnchanged(context,result){
      requireCurrent(context,result);
      const after=await accountBoundary.snapshot(context.session.uid);
      model.assertBoundaryUnchanged(context.before,after);return after;
    }
    async function withLease(context,work){
      const token=lease.acquire(`${context.ownerBinding}:${context.providerKey}`);
      if(!token)throw model.failure('provider-link/operation-in-progress');
      try{return await work();}finally{lease.release(token);}
    }
    function contextualError(error,context){
      if(!context?.session)return error;
      let current;try{current=currentAuthority();}catch{return model.failure('provider-link/auth-lifecycle-changed');}
      return context.generation!==generation||!model.authorityCurrent(context.session,current)?model.failure('provider-link/auth-lifecycle-changed'):error;
    }
    function failState(error,context,retry){
      const failure=contextualError(error,context),classified=model.classify(failure);lastRetry=classified.retryable?retry:null;
      activeAuthority=null;
      notify({status:classified.state,operation:context?.operation||'',providerKey:context?.providerKey||'',code:classified.code,retryable:classified.retryable});
      const outgoing=model.failure(classified.code,classified.state);outgoing.cause=failure;throw outgoing;
    }
    async function linkPopup(providerKey){
      let context;
      try{
        context=await capture('link',providerKey);activeAuthority=context.session;lastRetry=()=>linkPopup(providerKey);
        notify({status:'connecting',operation:'link',providerKey,code:'',retryable:false});
        const result=await withLease(context,()=>providerAdapter.linkCurrentUser({providerKey,flow:'popup'}));
        await verifyUnchanged(context,result);
        activeAuthority=null;lastRetry=null;return notify({status:'connected',operation:'link',providerKey,code:'',retryable:false});
      }catch(error){return failState(error,context,()=>linkPopup(providerKey));}
    }
    async function beginRedirect(providerKey,{returnRoute='#settings/security'}={}){
      let context;
      try{
        context=await capture('link',providerKey);activeAuthority=context.session;
        const record=continuation.issue({operation:'link',providerKey,ownerBinding:context.ownerBinding,lifecycleBinding:context.lifecycleBinding,returnRoute});
        notify({status:'waiting-browser',operation:'link',providerKey,code:'',retryable:false});
        await providerAdapter.beginRedirectLink({providerKey,nonce:record.nonce});
        return Object.freeze({status:'waiting-browser',nonce:record.nonce,returnRoute:record.returnRoute});
      }catch(error){continuation.cancel();return failState(error,context,()=>beginRedirect(providerKey,{returnRoute}));}
    }
    async function resumeRedirect({providerKey,nonce}={}){
      let context;
      try{
        context=await capture('link',providerKey);activeAuthority=context.session;
        continuation.consume({nonce,operation:'link',providerKey,ownerBinding:context.ownerBinding,lifecycleBinding:context.lifecycleBinding});
        notify({status:'connecting',operation:'link',providerKey,code:'',retryable:false});
        const result=await withLease(context,()=>providerAdapter.completeRedirectLink({providerKey,nonce}));
        await verifyUnchanged(context,result);
        activeAuthority=null;lastRetry=null;return notify({status:'connected',operation:'link',providerKey,code:'',retryable:false});
      }catch(error){return failState(error,context,null);}
    }
    async function reauthenticate(methodKey){
      let context;
      try{
        context=await capture('reauthenticate',methodKey);activeAuthority=context.session;
        notify({status:'reauthenticate',operation:'reauthenticate',providerKey:methodKey,code:'',retryable:false});
        const result=await withLease(context,()=>providerAdapter.reauthenticateCurrentUser({methodKey}));
        requireCurrent(context,result);activeAuthority=null;lastRetry=null;
        return notify({status:'connected',operation:'reauthenticate',providerKey:methodKey,code:'',retryable:false});
      }catch(error){return failState(error,context,()=>reauthenticate(methodKey));}
    }
    async function unlink(providerKey,{usernamePinAvailable=true,linkedExternalProviders={}}={}){
      let context;
      try{
        context=await capture('unlink',providerKey);activeAuthority=context.session;
        const methods=registry.methods({providerData:authSession.snapshot()?.providerData,usernamePinAvailable,linkedExternalProviders});
        const decision=model.unlinkDecision({providerKey,methods,session:context.session,now:clock()});
        if(!decision.ok)throw model.failure(decision.code,decision.code.endsWith('recent-auth-required')?'reauthenticate':'blocked');
        notify({status:'disconnecting',operation:'unlink',providerKey,code:'',retryable:false});
        const result=await withLease(context,()=>providerAdapter.unlinkCurrentUser({providerKey}));
        await verifyUnchanged(context,result);
        activeAuthority=null;lastRetry=null;return notify({status:'disconnected',operation:'unlink',providerKey,code:'',retryable:false});
      }catch(error){return failState(error,context,()=>unlink(providerKey,{usernamePinAvailable,linkedExternalProviders}));}
    }
    async function signIn(providerKey,{flow='popup',returnRoute='#settings/account'}={}){
      const context={operation:'sign-in',providerKey};
      try{
        const current=authSession.snapshot();if(current?.uid)throw model.failure('provider-link/already-signed-in');
        const descriptor=registry.descriptor(providerKey),availability=registry.availability(providerKey);
        if(!descriptor||descriptor.source==='application'||!availability.available)throw model.failure('provider-link/provider-unavailable','unavailable');
        notify({status:flow==='redirect'?'waiting-browser':'connecting',operation:'sign-in',providerKey,code:'',retryable:false});
        if(flow==='redirect'){
          const record=continuation.issue({operation:'sign-in',providerKey,returnRoute});
          await providerAdapter.beginRedirectSignIn({providerKey,nonce:record.nonce});
          return Object.freeze({status:'waiting-browser',nonce:record.nonce,returnRoute:record.returnRoute});
        }
        const token=lease.acquire(`signed-out:${providerKey}`);if(!token)throw model.failure('provider-link/operation-in-progress');
        let result;try{result=await providerAdapter.signInProvider({providerKey,flow:'popup'});}finally{lease.release(token);}
        return acceptSignInResult(result,providerKey);
      }catch(error){if(flow==='redirect')continuation.cancel();return failState(error,context,()=>signIn(providerKey,{flow,returnRoute}));}
    }
    function acceptSignInResult(result,providerKey){
      if(result?.status==='new-user')return notify({status:'blocked',operation:'sign-in',providerKey,code:'provider-link/onboarding-required',retryable:false});
      if(result?.status!=='existing'||!result?.uid)throw model.failure('provider-link/sign-in-result-invalid');
      let settled;try{settled=currentAuthority();}catch{throw model.failure('provider-link/auth-not-settled');}
      if(settled.uid!==result.uid)throw model.failure('provider-link/uid-changed');
      lastRetry=null;return notify({status:'connected',operation:'sign-in',providerKey,code:'',retryable:false});
    }
    async function resumeSignInRedirect({providerKey,nonce}={}){
      const context={operation:'sign-in',providerKey};
      try{
        if(authSession.snapshot()?.uid)throw model.failure('provider-link/already-signed-in');
        continuation.consume({nonce,operation:'sign-in',providerKey});
        notify({status:'connecting',operation:'sign-in',providerKey,code:'',retryable:false});
        const token=lease.acquire(`signed-out:${providerKey}`);if(!token)throw model.failure('provider-link/operation-in-progress');
        let result;try{result=await providerAdapter.completeRedirectSignIn({providerKey,nonce});}finally{lease.release(token);}
        return acceptSignInResult(result,providerKey);
      }catch(error){return failState(error,context,null);}
    }
    function observeAuth(){
      if(!activeAuthority)return false;
      let current;try{current=currentAuthority();}catch{current=null;}
      if(model.authorityCurrent(activeAuthority,current))return false;
      generation++;continuation.cancel();activeAuthority=null;lastRetry=null;
      notify({status:'blocked',operation:state.operation,providerKey:state.providerKey,code:'provider-link/auth-lifecycle-changed',retryable:false});return true;
    }
    function cancel(){generation++;continuation.cancel();activeAuthority=null;lastRetry=null;return notify({status:'canceled',operation:state.operation,providerKey:state.providerKey,code:'provider-link/canceled',retryable:true});}
    function retry(){if(!lastRetry)throw model.failure('provider-link/retry-unavailable');return lastRetry();}
    function subscribe(listener){listeners.add(listener);listener(state);return()=>listeners.delete(listener);}
    return Object.freeze({snapshot:()=>state,subscribe,linkPopup,beginRedirect,resumeRedirect,reauthenticate,unlink,signIn,resumeSignInRedirect,observeAuth,cancel,retry});
  }

  root.accountLinkingController=Object.freeze({createSharedOperationLease,createAccountLinkingController});
})(window);
