(function(global){
  const root=global.PogoData=global.PogoData||{};
  const CORE_SURFACES=Object.freeze(['profile','wishlist','inventory','authIndex','memberships','pendingDecrements']);
  const LIST_SURFACES=Object.freeze(['wishlist','dynamax','gmax','costumes']);

  function errorResult(code,message){return{ok:false,error:Object.freeze({code,message})};}
  function normalizeIdentity(value){
    const uid=String(value?.uid||'').trim();
    const username=String(value?.username||'').trim();
    return uid&&username?Object.freeze({uid,username}):null;
  }
  function sameIdentity(a,b){return!!a&&!!b&&a.uid===b.uid&&a.username===b.username;}
  function payloadBytes(value){
    try{return JSON.stringify(value??null).length;}catch{return 0;}
  }

  function createOwnedDataCoordinator({repository,lifecycle,onSnapshot,onError}={}){
    if(!repository||!lifecycle||typeof lifecycle.activateSession!=='function'||typeof lifecycle.subscribeSession!=='function'){
      throw new TypeError('Owned-data coordinator requires repository and listener lifecycle dependencies');
    }
    if(typeof onSnapshot!=='function')throw new TypeError('Owned-data coordinator requires an onSnapshot callback');
    let activeIdentity=null;
    const subscribedLists=new Set();
    const metrics=new Map();

    function metric(surface){
      if(!metrics.has(surface))metrics.set(surface,{surface,listenerStarts:0,snapshots:0,payloadBytes:0,errors:0});
      return metrics.get(surface);
    }
    function surfaceDefinition(surface){
      if(!activeIdentity)return null;
      const{uid,username}=activeIdentity;
      if(surface==='profile')return{path:`users/${username}`,listen:handlers=>repository.listenProfile(username,handlers)};
      if(LIST_SURFACES.includes(surface))return{path:`${surface}/${username}`,listen:handlers=>repository.listenList(surface,username,handlers)};
      if(surface==='inventory')return{path:`have/${username}`,listen:handlers=>repository.listenInventory(username,handlers)};
      if(surface==='authIndex')return{path:`authIndex/${uid}`,listen:handlers=>repository.listenAuthIndex(uid,handlers)};
      if(surface==='memberships')return{path:`userCommunities/${uid}`,listen:handlers=>repository.listenMemberships(uid,handlers)};
      if(surface==='pendingDecrements')return{path:`pendingDecrements/${username}`,listen:handlers=>repository.listenPendingDecrements(username,handlers)};
      return null;
    }
    function activate(value){
      const next=normalizeIdentity(value);
      if(!next)return errorResult('owned-read/identity-required','Owned reads require UID and username');
      if(!sameIdentity(activeIdentity,next))subscribedLists.clear();
      const result=lifecycle.activateSession(next);
      if(!result.ok)return result;
      activeIdentity=next;
      return{ok:true,status:result.status};
    }
    function subscribeSurface(surface){
      if(!activeIdentity)return errorResult('owned-read/session-inactive','Owned read requested without an active identity');
      const definition=surfaceDefinition(surface);
      if(!definition)return errorResult('owned-read/surface-invalid','Owned read surface is not registered');
      const expectedIdentity=activeIdentity;
      const stats=metric(surface);
      const result=lifecycle.subscribeSession({
        key:`session:owned:${surface}`,
        path:definition.path,
        start:handlers=>{
          const listening=definition.listen({onData:handlers.next,onError:handlers.error});
          if(!listening?.ok){
            const failed=new Error(listening?.error?.message||'Owned listener failed to start');
            failed.code=listening?.error?.code||'owned-read/start-failed';
            throw failed;
          }
          return listening.unsubscribe;
        },
        onValue:value=>{
          if(!sameIdentity(activeIdentity,expectedIdentity))return;
          stats.snapshots++;
          stats.payloadBytes=payloadBytes(value);
          onSnapshot(Object.freeze({surface,path:definition.path,value}));
        },
        onError:error=>{
          if(!sameIdentity(activeIdentity,expectedIdentity))return;
          stats.errors++;
          onError?.(Object.freeze({surface,error}));
        }
      });
      if(result.ok&&result.status!=='existing')stats.listenerStarts++;
      return result;
    }
    function subscribeCore(){
      if(!activeIdentity)return errorResult('owned-read/session-inactive','Owned reads require an active identity');
      const results=CORE_SURFACES.map(surface=>subscribeSurface(surface));
      const failed=results.find(result=>!result.ok);
      return failed||{ok:true,status:'core_subscribed',count:results.length};
    }
    function subscribeList(type){
      if(!LIST_SURFACES.includes(type))return errorResult('owned-read/list-invalid','Owned list type is not registered');
      const result=subscribeSurface(type);
      if(result.ok)subscribedLists.add(type);
      return result;
    }
    function reset(){
      activeIdentity=null;
      subscribedLists.clear();
      return{ok:true,status:'reset'};
    }
    function snapshotMetrics(){
      return Object.freeze([...metrics.values()].map(item=>Object.freeze({...item})));
    }
    function snapshot(){
      return Object.freeze({active:!!activeIdentity,subscribedLists:Object.freeze([...subscribedLists]),metrics:snapshotMetrics()});
    }

    return Object.freeze({activate,subscribeCore,subscribeList,subscribeSurface,reset,snapshot,snapshotMetrics});
  }

  root.ownedDataCoordinator=Object.freeze({CORE_SURFACES,LIST_SURFACES,createOwnedDataCoordinator});
})(window);
