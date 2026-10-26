(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  const LOCK='pogo-auth-commit:v1';
  function failure(code){return Object.assign(new Error(code),{code});}
  function createLedger(indexedDB){
    const opened=new Promise((resolve,reject)=>{
      const request=indexedDB.open('pogo-auth-commit-ledger',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('state');
      request.onerror=()=>reject(failure('provider-auth/coordination-unavailable'));
      request.onblocked=()=>reject(failure('provider-auth/coordination-unavailable'));
      request.onsuccess=()=>resolve(request.result);
    });
    async function access(value){
      const db=await opened;
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('state',value?'readwrite':'readonly'),store=tx.objectStore('state');
        const request=value?store.put(value,'session'):store.get('session');let result;
        request.onsuccess=()=>{result=request.result;};
        tx.oncomplete=()=>resolve(value||result||{revision:0,uid:null,status:'settled'});
        tx.onerror=tx.onabort=()=>reject(failure('provider-auth/coordination-unavailable'));
      });
    }
    return Object.freeze({read:()=>access(),write:value=>access(value)});
  }
  function createProviderAuthCommitGate({auth,locks=global.navigator?.locks,beforeAuthStateChanged,signInWithCustomToken,getLifecycle,coordination=global.indexedDB?createLedger(global.indexedDB):null}={}){
    if(!auth||typeof locks?.request!=='function'||typeof beforeAuthStateChanged!=='function'||typeof signInWithCustomToken!=='function'||typeof getLifecycle!=='function')throw new TypeError('Serialized auth dependencies required');
    if(global.document&&!coordination)throw failure('provider-auth/coordination-unavailable');
    let disposed=false,observedRevision;
    const ready=coordination?coordination.read().then(value=>{observedRevision=value.revision;}):Promise.resolve();
    // Avoid an unhandled rejection before the first operation; run still fails closed.
    ready.catch(()=>{});
    async function run({expectedUid,expectedLifecycle,kind='preserve',isCurrent:externalCurrent=()=>true,isActive:operationActive=()=>true,onCommitBoundary=()=>{}}={},work){
      if(disposed)throw failure('provider-auth/disposed');
      if(!['preserve','sign-in','sign-out'].includes(kind)||typeof work!=='function'||typeof expectedLifecycle!=='string')throw failure('provider-auth/invalid-operation');
      return locks.request(LOCK,{mode:'exclusive'},async()=>{
        await ready;
        if(disposed)throw failure('provider-auth/disposed');
        if(!operationActive()||!externalCurrent())throw failure('provider-auth/canceled');
        const before=String(auth.currentUser?.uid||''),lifecycle=getLifecycle();
        if(lifecycle!==expectedLifecycle||(kind==='sign-in'?before!=='':before!==expectedUid))throw failure('provider-auth/session-changed');
        let checkpoint;
        if(coordination){
          checkpoint=await coordination.read();
          if(checkpoint.status!=='settled'||!Number.isSafeInteger(checkpoint.revision)||checkpoint.revision!==observedRevision||
            checkpoint.uid!==null&&checkpoint.uid!==before)throw failure('provider-auth/session-changed');
          if(!operationActive()||!externalCurrent()||getLifecycle()!==lifecycle||String(auth.currentUser?.uid||'')!==before)throw failure('provider-auth/canceled');
          await coordination.write({revision:checkpoint.revision+1,uid:before,status:'pending'});
        }
        async function settle(uid){
          if(!coordination)return;
          await coordination.write({revision:checkpoint.revision+2,uid,status:'settled'});observedRevision=checkpoint.revision+2;
        }
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
          // Auth has settled successfully. A failed coordination write must not
          // turn that into a false sign-in failure; the pending record blocks reuse.
          try{await settle(allowedUid);}catch{return{...result,authCoordinationBlocked:true};}
          return result;
        }catch(error){
          if(String(auth.currentUser?.uid||'')===before)try{await settle(before);}catch{/* Pending checkpoint blocks later attempts after uncertain storage outcome. */}
          if(!authorized&&(!operationActive()||!externalCurrent()))throw failure('provider-auth/canceled');throw error;
        }finally{unsubscribe();}
      });
    }
    async function commitCustomToken({customToken,expectedUid,expectedLifecycle,isCurrent=()=>true,isActive=()=>true,onCommitBoundary=()=>{}}={}){
      if(typeof customToken!=='string'||customToken.length<8||customToken.length>8192||!expectedUid)throw failure('provider-auth/token-invalid');
      return run({expectedUid,expectedLifecycle,kind:'sign-in',isCurrent,isActive,onCommitBoundary},()=>{if(!isCurrent())throw failure('provider-auth/session-changed');return signInWithCustomToken(auth,customToken);});
    }
    return Object.freeze({run,commitCustomToken,ready:()=>ready,dispose(){disposed=true;}});
  }
  root.providerAuthCommitGate=Object.freeze({LOCK,createProviderAuthCommitGate});
})(window);
