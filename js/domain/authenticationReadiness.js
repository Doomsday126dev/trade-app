(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const DURABLE_AUTH_PROVIDERS_ENABLED=false;
  const PROVIDERS=Object.freeze(['google','email','discord','legacy-pin']);
  const FUTURE_STATES=Object.freeze(['linked','not-linked','reauthentication-required','conflict','recovery-required']);

  function accountSecurityModel({signedIn=false}={}){
    if(!signedIn)return Object.freeze({enabled:false,rows:Object.freeze([])});
    return Object.freeze({
      enabled:false,
      rows:Object.freeze([
        Object.freeze({provider:'google',state:'not-linked',interactive:false}),
        Object.freeze({provider:'email',state:'not-linked',interactive:false}),
        Object.freeze({provider:'discord',state:'not-linked',interactive:false}),
        Object.freeze({provider:'legacy-pin',state:'linked',interactive:false})
      ])
    });
  }

  function providerActionAllowed(){
    return false;
  }

  function legacyRepairDecision({currentUid='',replacementUid=''}={}){
    const established=typeof currentUid==='string'&&currentUid.length>0;
    const replacementRequested=typeof replacementUid==='string'&&replacementUid.length>0&&replacementUid!==currentUid;
    if(established&&replacementRequested){
      return Object.freeze({allowed:false,code:'auth/immutable-uid'});
    }
    return Object.freeze({allowed:true,code:established?'auth/uid-preserving-only':'auth/unbound-account'});
  }

  function unlinkDecision({usableMethodCount=0,isAdmin=false,recentAuth=false}={}){
    if(!Number.isSafeInteger(usableMethodCount)||usableMethodCount<=1){
      return Object.freeze({allowed:false,code:'auth/final-method'});
    }
    if(!recentAuth)return Object.freeze({allowed:false,code:'auth/recent-auth-required'});
    if(isAdmin)return Object.freeze({allowed:false,code:'auth/admin-strong-reauth-required'});
    return Object.freeze({allowed:false,code:'auth/unlink-not-implemented'});
  }

  function onboardingDecision({oauthAuthenticated=false,handleReserved=false}={}){
    return Object.freeze({
      mayCreateTrainerProfile:false,
      nextStep:oauthAuthenticated&&!handleReserved?'reserve-trainer-handle':'await-explicit-onboarding'
    });
  }

  root.authenticationReadiness=Object.freeze({
    DURABLE_AUTH_PROVIDERS_ENABLED,
    PROVIDERS,
    FUTURE_STATES,
    accountSecurityModel,
    providerActionAllowed,
    legacyRepairDecision,
    unlinkDecision,
    onboardingDecision
  });
})(window);
