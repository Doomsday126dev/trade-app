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
    async function access(value,key='session'){
      const db=await opened;
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('state',value?'readwrite':'readonly'),store=tx.objectStore('state');
        const request=value?store.put(value,key):store.get(key);let result;
        request.onsuccess=()=>{result=request.result;};
        tx.oncomplete=()=>resolve(value||result||(key==='session'?{revision:0,uid:null,status:'settled'}:null));
        tx.onerror=tx.onabort=()=>reject(failure('provider-auth/coordination-unavailable'));
      });
    }
    return Object.freeze({read:()=>access(),write:value=>access(value),readOutcome:id=>access(null,`outcome:${id}`),writeOutcome:value=>access(value,`outcome:${value.operationId}`)});
  }
  function createProviderAuthCommitGate({auth,locks=global.navigator?.locks,beforeAuthStateChanged,signInWithCustomToken,getLifecycle,coordination=global.indexedDB?createLedger(global.indexedDB):null,verifyCurrentAuth}={}){
    if(!auth||typeof locks?.request!=='function'||typeof beforeAuthStateChanged!=='function'||typeof signInWithCustomToken!=='function'||typeof getLifecycle!=='function')throw new TypeError('Serialized auth dependencies required');
    if(global.document&&!coordination)throw failure('provider-auth/coordination-unavailable');
    let disposed=false,observedRevision;
    const ready=coordination?coordination.read().then(value=>{observedRevision=value.revision;}):Promise.resolve();
    const reviews=new WeakMap();
    // Avoid an unhandled rejection before the first operation; run still fails closed.
    ready.catch(()=>{});
    async function assertSession(){
      return locks.request(LOCK,{mode:'exclusive'},async()=>{
        await ready;if(disposed)throw failure('provider-auth/disposed');
        if(coordination){const value=await coordination.read();
          if(value.status!=='settled'||value.revision!==observedRevision||value.uid!==null&&value.uid!==String(auth.currentUser?.uid||''))throw failure('provider-auth/coordination-blocked');
        }
        return true;
      });
    }
    async function recoveryEvidence(){
      if(!coordination?.readOutcome||typeof verifyCurrentAuth!=='function')throw failure('provider-auth/reconciliation-unavailable');
      await auth.authStateReady?.();
      const checkpoint=await coordination.read(),user=auth.currentUser,uid=String(user?.uid||''),lifecycle=getLifecycle();
      if(checkpoint.status!=='pending'||!Number.isSafeInteger(checkpoint.revision)||typeof checkpoint.operationId!=='string'||!['sign-in','sign-out'].includes(checkpoint.kind))throw failure('provider-auth/outcome-unproven');
      const outcome=await coordination.readOutcome(checkpoint.operationId);
      if(!outcome||outcome.status!=='completed'||outcome.operationId!==checkpoint.operationId||outcome.pendingRevision!==checkpoint.revision||outcome.kind!==checkpoint.kind||outcome.beforeUid!==checkpoint.uid||outcome.uid!==checkpoint.targetUid||outcome.uid!==uid)throw failure('provider-auth/outcome-unproven');
      const verified=await verifyCurrentAuth({user,expectedUid:uid});
      if(verified?.uid!==uid||verified?.verified!==true||auth.currentUser!==user||String(auth.currentUser?.uid||'')!==uid||getLifecycle()!==lifecycle)throw failure('provider-auth/session-changed');
      return{checkpoint,outcome,uid,lifecycle};
    }
    async function prepareReconciliation(){
      return locks.request(LOCK,{mode:'exclusive'},async()=>{
        await ready;if(disposed)throw failure('provider-auth/disposed');
        const evidence=await recoveryEvidence();
        const ticket=Object.freeze({status:'review-required',kind:evidence.outcome.kind,uid:evidence.uid,operationId:evidence.outcome.operationId});
        reviews.set(ticket,JSON.stringify(evidence));return ticket;
      });
    }
    async function confirmReconciliation(ticket,{accepted=false}={}){
      if(accepted!==true||!reviews.has(ticket))throw failure('provider-auth/explicit-review-required');
      return locks.request(LOCK,{mode:'exclusive'},async()=>{
        if(disposed)throw failure('provider-auth/disposed');
        const evidence=await recoveryEvidence();
        if(JSON.stringify(evidence)!==reviews.get(ticket))throw failure('provider-auth/reconciliation-changed');
        const revision=evidence.checkpoint.revision+1;
        await coordination.write({revision,uid:evidence.uid,status:'settled',reconciledOperationId:evidence.outcome.operationId});
        observedRevision=revision;reviews.delete(ticket);
        return Object.freeze({status:'reconciled',uid:evidence.uid,operationId:evidence.outcome.operationId});
      });
    }
    async function run({expectedUid,expectedLifecycle,kind='preserve',isCurrent:externalCurrent=()=>true,isActive:operationActive=()=>true,onCommitBoundary=()=>{}}={},work){
      if(disposed)throw failure('provider-auth/disposed');
      if(!['preserve','sign-in','sign-out'].includes(kind)||typeof work!=='function'||typeof expectedLifecycle!=='string')throw failure('provider-auth/invalid-operation');
      return locks.request(LOCK,{mode:'exclusive'},async()=>{
        await ready;
        if(disposed)throw failure('provider-auth/disposed');
        if(!operationActive()||!externalCurrent())throw failure('provider-auth/canceled');
        const before=String(auth.currentUser?.uid||''),lifecycle=getLifecycle();
        if(lifecycle!==expectedLifecycle||(kind==='sign-in'?before!=='':before!==expectedUid))throw failure('provider-auth/session-changed');
        let checkpoint,operationId;
        if(coordination){
          checkpoint=await coordination.read();
          if(checkpoint.status!=='settled'||!Number.isSafeInteger(checkpoint.revision)||checkpoint.revision!==observedRevision||
            checkpoint.uid!==null&&checkpoint.uid!==before)throw failure('provider-auth/session-changed');
          if(!operationActive()||!externalCurrent()||getLifecycle()!==lifecycle||String(auth.currentUser?.uid||'')!==before)throw failure('provider-auth/canceled');
          operationId=coordination.writeOutcome&&global.crypto?.randomUUID?global.crypto.randomUUID():null;
          await coordination.write({revision:checkpoint.revision+1,uid:before,status:'pending',...(operationId?{operationId,kind,targetUid:kind==='sign-out'?'':expectedUid}:{})});
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
          try{
            if(operationId&&['sign-in','sign-out'].includes(kind))await coordination.writeOutcome({operationId,pendingRevision:checkpoint.revision+1,kind,beforeUid:before,uid:allowedUid,status:'completed'});
            await settle(allowedUid);
          }catch{return{...result,authCoordinationBlocked:true};}
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
    return Object.freeze({run,commitCustomToken,ready:()=>ready,assertSession,prepareReconciliation,confirmReconciliation,dispose(){disposed=true;}});
  }
  root.providerAuthCommitGate=Object.freeze({LOCK,createProviderAuthCommitGate,createLedger});
})(window);
