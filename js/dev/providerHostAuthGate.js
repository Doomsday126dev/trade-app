(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  function fail(code){throw Object.assign(new Error(code),{code});}
  function install({enabled=false,auth,sdk,expectedSignInUid,locks=global.navigator?.locks,onStatus=()=>{}}={}){
    if(!enabled)return Object.freeze({available:false,sdk});
    if(!auth||!sdk||typeof expectedSignInUid!=='string'||!expectedSignInUid||!root.providerAuthCommitGate)fail('provider-auth/canary-config-required');
    let generation=0,lastUid=String(auth.currentUser?.uid||''),active=null;
    const lifecycle=()=>{const uid=String(auth.currentUser?.uid||'');if(uid!==lastUid){lastUid=uid;generation++;}return`host-${generation}`;};
    const gate=root.providerAuthCommitGate.createProviderAuthCommitGate({auth,locks,beforeAuthStateChanged:sdk.beforeAuthStateChanged,signInWithCustomToken:sdk.signInWithCustomToken,getLifecycle:lifecycle});
    function status(value){try{onStatus(Object.freeze(value));}catch{}}
    function run(kind,work,user){
      if(active)return Promise.reject(Object.assign(new Error('provider-auth/operation-pending'),{code:'provider-auth/operation-pending'}));
      const uid=String(auth.currentUser?.uid||'');
      if(user&&user!==auth.currentUser)fail('provider-auth/session-changed');
      if(uid&&uid!==expectedSignInUid)fail('provider-auth/canary-owner-required');
      const operation={canceled:false,committing:false};active=operation;status({status:'pending',canCancel:true});
      operation.settled=gate.run({kind,expectedUid:kind==='sign-in'?expectedSignInUid:uid,expectedLifecycle:lifecycle(),isActive:()=>!operation.canceled,
        onCommitBoundary:()=>{operation.committing=true;status({status:'committing',canCancel:false});}},work)
        .finally(()=>{active=null;status({status:'idle',canCancel:true});});
      return operation.settled;
    }
    const wrapped={...sdk};
    for(const name of['signInWithEmailAndPassword','signInWithPopup','signInWithCustomToken'])wrapped[name]=(instance,...args)=>{
      if(instance!==auth)fail('provider-auth/instance-mismatch');return run('sign-in',()=>sdk[name](auth,...args));
    };
    for(const name of['linkWithPopup','reauthenticateWithPopup','unlink','updatePassword'])wrapped[name]=(user,...args)=>run('preserve',()=>sdk[name](user,...args),user);
    wrapped.unlink=(user,providerId)=>{
      if(providerId!=='google.com'||!user?.providerData?.some(item=>item.providerId==='password'))fail('provider-auth/verified-fallback-required');
      return run('preserve',()=>sdk.unlink(user,providerId),user);
    };
    wrapped.signOut=async instance=>{
      if(instance!==auth)fail('provider-auth/instance-mismatch');
      if(active?.committing)fail('provider-auth/commit-in-progress');
      if(active){const pending=active;pending.canceled=true;await pending.settled.catch(()=>{});}
      return run('sign-out',()=>sdk.signOut(auth));
    };
    // Existing-account qualification never creates or deletes Firebase users.
    for(const name of['createUserWithEmailAndPassword','deleteUser'])wrapped[name]=()=>fail('provider-auth/account-creation-disabled');
    return Object.freeze({available:true,sdk:Object.freeze(wrapped),snapshot:()=>Object.freeze({uid:String(auth.currentUser?.uid||''),lifecycleId:lifecycle()}),
      cancel(){if(active?.committing)return Object.freeze({status:'committing',canCancel:false});if(active)active.canceled=true;return Object.freeze({status:'canceled',canCancel:true});}});
  }
  root.providerHostAuthGate=Object.freeze({install});
})(window);
