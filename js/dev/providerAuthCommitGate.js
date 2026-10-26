(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  const LOCK='pogo-auth-commit:v1';
  function failure(code){return Object.assign(new Error(code),{code});}
  function createProviderAuthCommitGate({auth,locks=global.navigator?.locks,beforeAuthStateChanged,signInWithCustomToken,getLifecycle}={}){
    if(!auth||typeof locks?.request!=='function'||typeof beforeAuthStateChanged!=='function'||typeof signInWithCustomToken!=='function'||typeof getLifecycle!=='function')throw new TypeError('Serialized auth dependencies required');
    let disposed=false;
    async function run({expectedUid,expectedLifecycle,kind='preserve',isCurrent:externalCurrent=()=>true,isActive:operationActive=()=>true,onCommitBoundary=()=>{}}={},work){
      if(disposed)throw failure('provider-auth/disposed');
      if(!['preserve','sign-in','sign-out'].includes(kind)||typeof work!=='function'||typeof expectedLifecycle!=='string')throw failure('provider-auth/invalid-operation');
      return locks.request(LOCK,{mode:'exclusive'},async()=>{
        if(disposed)throw failure('provider-auth/disposed');
        if(!operationActive()||!externalCurrent())throw failure('provider-auth/canceled');
        const before=String(auth.currentUser?.uid||''),lifecycle=getLifecycle();
        if(lifecycle!==expectedLifecycle||(kind==='sign-in'?before!=='':before!==expectedUid))throw failure('provider-auth/session-changed');
        const allowedUid=kind==='sign-out'?'':expectedUid;
        let changed=false,authorized=false;
        const unsubscribe=beforeAuthStateChanged(auth,user=>{
          if(disposed||!operationActive()||!externalCurrent())throw failure('provider-auth/canceled');
          if(String(user?.uid||'')!==allowedUid)throw failure('provider-auth/unexpected-account');
          // Firebase awaits later middleware and then installs the user without
          // rerunning this hook. Once accepted, cancellation cannot be promised.
          onCommitBoundary(Object.freeze({status:'committing',canCancel:false}));
          authorized=true;
          changed=true;
        });
        const isCurrent=()=>!disposed&&getLifecycle()===lifecycle&&String(auth.currentUser?.uid||'')===before;
        try{
          if(!isCurrent())throw failure('provider-auth/session-changed');
          const result=await work({isCurrent});
          if(!authorized&&!operationActive())throw failure('provider-auth/canceled');
          if((disposed&&!authorized)||String(auth.currentUser?.uid||'')!==allowedUid)throw failure('provider-auth/session-changed');
          if(kind==='preserve'&&getLifecycle()!==lifecycle)throw failure('provider-auth/session-changed');
          if(kind==='sign-in'&&(!changed||result?.user?.uid!==expectedUid))throw failure('provider-auth/result-mismatch');
          return result;
        }catch(error){if(!authorized&&(!operationActive()||!externalCurrent()))throw failure('provider-auth/canceled');throw error;}finally{unsubscribe();}
      });
    }
    async function commitCustomToken({customToken,expectedUid,expectedLifecycle,isCurrent=()=>true,isActive=()=>true,onCommitBoundary=()=>{}}={}){
      if(typeof customToken!=='string'||customToken.length<8||customToken.length>8192||!expectedUid)throw failure('provider-auth/token-invalid');
      return run({expectedUid,expectedLifecycle,kind:'sign-in',isCurrent,isActive,onCommitBoundary},()=>{if(!isCurrent())throw failure('provider-auth/session-changed');return signInWithCustomToken(auth,customToken);});
    }
    return Object.freeze({run,commitCustomToken,dispose(){disposed=true;}});
  }
  root.providerAuthCommitGate=Object.freeze({LOCK,createProviderAuthCommitGate});
})(window);
