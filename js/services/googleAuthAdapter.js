(function(global){
  const root=global.PogoServices=global.PogoServices||{};
  const PROVIDER_KEY='google';
  const PROVIDER_ID='google.com';
  const SAFE_ERROR_CODES=new Map([
    ['auth/credential-already-in-use','auth/credential-already-in-use'],
    ['auth/account-exists-with-different-credential','auth/account-exists-with-different-credential'],
    ['auth/popup-blocked','auth/popup-blocked'],
    ['auth/popup-closed-by-user','auth/popup-closed-by-user'],
    ['auth/cancelled-popup-request','auth/cancelled-popup-request'],
    ['auth/provider-already-linked','provider-link/already-connected'],
    ['auth/no-such-provider','provider-link/provider-not-linked'],
    ['auth/requires-recent-login','provider-link/recent-auth-required'],
    ['auth/network-request-failed','provider-link/network-failed'],
    ['auth/user-token-expired','provider-link/auth-lifecycle-changed'],
    ['auth/user-disabled','provider-link/account-disabled']
  ]);

  function failure(code,state='blocked'){
    const error=new Error(code);error.code=code;error.state=state;return error;
  }
  function safeFailure(error){
    const code=SAFE_ERROR_CODES.get(String(error?.code||''))||'provider-link/google-failed';
    const state=code==='provider-link/recent-auth-required'?'reauthenticate':code==='provider-link/already-connected'?'connected':'blocked';
    return failure(code,state);
  }
  function providerIds(user){
    return Object.freeze((Array.isArray(user?.providerData)?user.providerData:[])
      .map(value=>String(value?.providerId||''))
      .filter(Boolean));
  }
  function sanitizedResult(user,status,extra={}){
    const uid=String(user?.uid||'');
    if(!uid)throw failure('provider-link/sign-in-result-invalid');
    return Object.freeze({uid,status,providerIds:providerIds(user),...extra});
  }
  function browserContext({navigator=global.navigator,matchMedia=global.matchMedia}={}){
    let standalone=false;
    try{standalone=navigator?.standalone===true||matchMedia?.('(display-mode: standalone)')?.matches===true;}catch{}
    return Object.freeze({standalone,popup:true,redirect:false});
  }
  function createGoogleAuthAdapter({
    getAuth,GoogleAuthProvider,linkWithPopup,signInWithPopup,reauthenticateWithPopup,unlink,
    getAdditionalUserInfo=()=>null,onReauthenticated=()=>{}
  }={}){
    if(typeof getAuth!=='function'||typeof GoogleAuthProvider!=='function'||typeof linkWithPopup!=='function'||typeof signInWithPopup!=='function'||typeof reauthenticateWithPopup!=='function'||typeof unlink!=='function'){
      throw new TypeError('Google Auth adapter dependencies are incomplete');
    }
    const authInstance=()=>{
      const auth=getAuth();
      if(!auth||typeof auth!=='object')throw failure('provider-link/auth-unavailable');
      return auth;
    };
    const googleProvider=()=>new GoogleAuthProvider();
    const currentUser=()=>{
      const user=authInstance().currentUser;
      if(!user?.uid)throw failure('provider-link/auth-required');
      return user;
    };
    const requireGoogle=key=>{
      if(String(key||'')!==PROVIDER_KEY)throw failure('provider-link/provider-unavailable','unavailable');
    };
    const run=async work=>{try{return await work();}catch(error){if(/^provider-link\//.test(String(error?.code||'')))throw error;throw safeFailure(error);}};
    async function linkCurrentUser({providerKey}={}){
      requireGoogle(providerKey);
      return run(async()=>{
        const auth=authInstance(),user=currentUser(),uid=user.uid;
        if(providerIds(user).includes(PROVIDER_ID))return sanitizedResult(user,'already-linked');
        const result=await linkWithPopup(user,googleProvider());
        if(auth.currentUser?.uid!==uid||result?.user?.uid!==uid)throw failure('provider-link/uid-changed');
        return sanitizedResult(result.user,'linked');
      });
    }
    async function signInProvider({providerKey,flow='popup'}={}){
      requireGoogle(providerKey);
      if(flow!=='popup')throw failure('provider-link/redirect-disabled','unavailable');
      return run(async()=>{
        const auth=authInstance();
        if(auth.currentUser?.uid)throw failure('provider-link/already-signed-in');
        const result=await signInWithPopup(auth,googleProvider());
        if(!result?.user?.uid||auth.currentUser?.uid!==result.user.uid)throw failure('provider-link/auth-not-settled');
        const additional=getAdditionalUserInfo(result);
        return sanitizedResult(result.user,'authenticated',{isNewFirebaseUser:additional?.isNewUser===true});
      });
    }
    async function reauthenticateCurrentUser({methodKey,providerKey}={}){
      requireGoogle(methodKey||providerKey);
      return run(async()=>{
        const auth=authInstance(),user=currentUser(),uid=user.uid;
        const result=await reauthenticateWithPopup(user,googleProvider());
        if(auth.currentUser?.uid!==uid||result?.user?.uid!==uid)throw failure('provider-link/uid-changed');
        onReauthenticated(Object.freeze({uid,at:Date.now()}));
        return sanitizedResult(result.user,'reauthenticated');
      });
    }
    async function unlinkCurrentUser({providerKey}={}){
      requireGoogle(providerKey);
      return run(async()=>{
        const auth=authInstance(),user=currentUser(),uid=user.uid;
        if(!providerIds(user).includes(PROVIDER_ID))throw failure('provider-link/provider-not-linked');
        const result=await unlink(user,PROVIDER_ID);
        if(auth.currentUser?.uid!==uid||result?.uid!==uid)throw failure('provider-link/uid-changed');
        return sanitizedResult(result,'unlinked');
      });
    }
    return Object.freeze({providerKey:PROVIDER_KEY,providerId:PROVIDER_ID,linkCurrentUser,signInProvider,reauthenticateCurrentUser,unlinkCurrentUser,browserContext:()=>browserContext()});
  }

  root.googleAuthAdapter=Object.freeze({PROVIDER_KEY,PROVIDER_ID,SAFE_ERROR_CODES,browserContext,createGoogleAuthAdapter});
})(window);
