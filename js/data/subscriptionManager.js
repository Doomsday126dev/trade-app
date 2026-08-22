(function(global){
  const root=global.PogoData=global.PogoData||{};
  const LISTENER_SCOPES=Object.freeze(['public','session','screen','selectedTrainer','legacyAdmin']);

  function errorDetails(error,fallbackCode){
    return Object.freeze({
      code:String(error?.code||fallbackCode),
      message:String(error?.message||'Listener operation failed')
    });
  }
  function managerError(code,message){return{ok:false,error:errorDetails({code,message},code)};}

  function createSubscriptionManager(){
    const entries=new Map();
    let generation=0;

    function unsubscribeEntry(entry){
      if(!entry||!entry.active)return false;
      entry.active=false;
      try{entry.unsubscribe();}catch{}
      return true;
    }
    function unsubscribeByKey(key){
      const entry=entries.get(key);
      if(!entry)return{ok:true,status:'missing',key};
      entries.delete(key);
      unsubscribeEntry(entry);
      return{ok:true,status:'unsubscribed',key};
    }
    function subscribe({key,scope,start,onValue,onError,fingerprint=''}){
      if(!key||typeof key!=='string')return managerError('listener/invalid-key','Listener key must be a non-empty string');
      if(!LISTENER_SCOPES.includes(scope))return managerError('listener/invalid-scope','Listener scope is not registered');
      if(typeof start!=='function'||typeof onValue!=='function')return managerError('listener/invalid-handler','Listener start and onValue must be functions');
      const existing=entries.get(key);
      if(existing&&existing.scope===scope&&existing.fingerprint===fingerprint&&existing.active){
        return{ok:true,status:'existing',key,scope};
      }
      if(existing)unsubscribeByKey(key);
      const token=++generation;
      const entry={key,scope,fingerprint,token,active:true,unsubscribe:()=>{}};
      const isCurrent=()=>entry.active&&entries.get(key)===entry&&entry.token===token;
      entries.set(key,entry);
      try{
        const unsubscribe=start({
          next:value=>{if(isCurrent())onValue(value);},
          error:error=>{
            if(!isCurrent())return;
            entries.delete(key);
            unsubscribeEntry(entry);
            onError?.(errorDetails(error,'listener/runtime-failed'));
          }
        });
        if(typeof unsubscribe!=='function'){
          entry.active=false;
          entries.delete(key);
          return managerError('listener/invalid-unsubscribe','Listener start must return an unsubscribe function');
        }
        entry.unsubscribe=unsubscribe;
        return{ok:true,status:existing?'replaced':'subscribed',key,scope};
      }catch(error){
        entry.active=false;
        entries.delete(key);
        return managerError(String(error?.code||'listener/start-failed'),String(error?.message||'Listener failed to start'));
      }
    }
    function unsubscribeByScope(scope){
      if(!LISTENER_SCOPES.includes(scope))return managerError('listener/invalid-scope','Listener scope is not registered');
      const keys=[...entries.values()].filter(entry=>entry.scope===scope).map(entry=>entry.key);
      keys.forEach(unsubscribeByKey);
      return{ok:true,status:'scope-cleared',scope,count:keys.length};
    }
    function unsubscribeAll(){
      const keys=[...entries.keys()];
      keys.forEach(unsubscribeByKey);
      return{ok:true,status:'all-cleared',count:keys.length};
    }
    function cleanupForLogout(){return unsubscribeAll();}
    function cleanupForAuthLoss(){return unsubscribeAll();}
    function snapshot(){
      return[...entries.values()].map(({key,scope,fingerprint})=>({key,scope,fingerprint}));
    }
    return Object.freeze({subscribe,unsubscribeByKey,unsubscribeByScope,unsubscribeAll,cleanupForLogout,cleanupForAuthLoss,snapshot,size:()=>entries.size});
  }

  root.subscriptionManager=Object.freeze({LISTENER_SCOPES,createSubscriptionManager});
})(window);
