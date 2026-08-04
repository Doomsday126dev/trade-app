(function(global){
  const root=global.PogoData=global.PogoData||{};

  function lifecycleError(code,message){
    return{ok:false,error:Object.freeze({code,message})};
  }
  function identity(value){
    const uid=String(value?.uid||'').trim();
    const username=String(value?.username||'').trim();
    return uid&&username?Object.freeze({uid,username}):null;
  }
  function createListenerLifecycle({subscriptions}){
    if(!subscriptions||typeof subscriptions.subscribe!=='function'||typeof subscriptions.unsubscribeByScope!=='function'){
      throw new TypeError('Listener lifecycle requires a subscription manager');
    }
    let activeSession=null;
    let selectedTrainer='';
    const authenticatedShareKeys=new Set();

    function subscribePublic(options){
      const path=String(options?.path||'');
      const key=String(options?.key||`public:${path}`);
      return subscriptions.subscribe({...options,key,scope:'public',fingerprint:path});
    }
    function deactivateSession(reason='session_end'){
      const session=subscriptions.unsubscribeByScope('session');
      const legacyAdmin=subscriptions.unsubscribeByScope('legacyAdmin');
      let authenticatedShares=0;
      for(const key of [...authenticatedShareKeys]){
        const result=subscriptions.unsubscribeByKey(key);
        if(result.status==='unsubscribed')authenticatedShares++;
        authenticatedShareKeys.delete(key);
      }
      activeSession=null;
      return{ok:true,status:'session_inactive',reason,session:session.count,legacyAdmin:legacyAdmin.count,authenticatedShares};
    }
    function activateSession(value){
      const next=identity(value);
      if(!next)return lifecycleError('listener/session-identity-required','Session listeners require UID and username');
      if(activeSession&&(activeSession.uid!==next.uid||activeSession.username!==next.username)){
        deactivateSession('session_replaced');
      }
      const status=activeSession?'existing':'active';
      activeSession=next;
      return{ok:true,status,identity:activeSession};
    }
    function subscribeSession(options){
      if(!activeSession)return lifecycleError('listener/session-inactive','Session listener requested without an active identity');
      const path=String(options?.path||'');
      const key=String(options?.key||`session:${path}`);
      const fingerprint=`${activeSession.uid}\u0000${activeSession.username}\u0000${path}`;
      return subscriptions.subscribe({...options,key,scope:'session',fingerprint});
    }
    function subscribeLegacyAdmin(options){
      if(!activeSession)return lifecycleError('listener/session-inactive','Admin listener requested without an active identity');
      const path=String(options?.path||'');
      const key=String(options?.key||`legacyAdmin:${path}`);
      const fingerprint=`${activeSession.uid}\u0000${activeSession.username}\u0000${path}`;
      return subscriptions.subscribe({...options,key,scope:'legacyAdmin',fingerprint});
    }
    function clearLegacyAdmin(reason='admin_closed'){
      const result=subscriptions.unsubscribeByScope('legacyAdmin');
      return{ok:true,status:'legacy_admin_inactive',reason,count:result.count};
    }
    function selectTrainer(username){
      const next=String(username||'').trim();
      if(!next)return lifecycleError('listener/trainer-required','Selected-trainer listeners require a username');
      if(selectedTrainer&&selectedTrainer!==next)clearSelectedTrainer('trainer_replaced');
      const status=selectedTrainer?'existing':'selected';
      selectedTrainer=next;
      return{ok:true,status,username:selectedTrainer};
    }
    function subscribeSelectedTrainer(options){
      const selected=selectTrainer(options?.username);
      if(!selected.ok)return selected;
      const path=String(options?.path||'');
      const access=options?.authenticated?'authenticated':'public';
      const key=String(options?.key||`selectedTrainer:${access}:${path}`);
      const fingerprint=`${selectedTrainer}\u0000${access}\u0000${path}`;
      const result=subscriptions.subscribe({...options,key,scope:'selectedTrainer',fingerprint});
      if(result.ok&&options?.authenticated)authenticatedShareKeys.add(key);
      return result;
    }
    function clearAuthenticatedShareListeners(){
      let count=0;
      for(const key of [...authenticatedShareKeys]){
        const result=subscriptions.unsubscribeByKey(key);
        if(result.status==='unsubscribed')count++;
        authenticatedShareKeys.delete(key);
      }
      return{ok:true,status:'authenticated_shares_cleared',count};
    }
    function clearSelectedTrainer(reason='trainer_closed'){
      const result=subscriptions.unsubscribeByScope('selectedTrainer');
      authenticatedShareKeys.clear();
      selectedTrainer='';
      return{ok:true,status:'trainer_inactive',reason,count:result.count};
    }
    function snapshot(){
      return Object.freeze({
        session:activeSession?Object.freeze({...activeSession}):null,
        selectedTrainer:selectedTrainer||null,
        subscriptions:subscriptions.snapshot()
      });
    }
    return Object.freeze({
      subscribePublic,activateSession,subscribeSession,subscribeLegacyAdmin,clearLegacyAdmin,deactivateSession,
      selectTrainer,subscribeSelectedTrainer,clearAuthenticatedShareListeners,
      clearSelectedTrainer,snapshot
    });
  }

  root.listenerLifecycle=Object.freeze({createListenerLifecycle});
})(window);
