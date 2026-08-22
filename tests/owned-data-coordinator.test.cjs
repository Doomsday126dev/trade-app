const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function harness({failSurface=''}={}){
  const window={};
  const context=vm.createContext({window});
  for(const file of ['js/data/subscriptionManager.js','js/data/listenerLifecycle.js','js/data/ownedDataCoordinator.js']){
    vm.runInContext(readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  }
  const subscriptions=window.PogoData.subscriptionManager.createSubscriptionManager();
  const lifecycle=window.PogoData.listenerLifecycle.createListenerLifecycle({subscriptions});
  const starts=[];
  const stops=[];
  const handlers=new Map();
  function listen(surface,target,nextHandlers){
    starts.push({surface,target});
    if(surface===failSurface)return{ok:false,error:{code:'database/permission-denied',message:'blocked'}};
    handlers.set(`${surface}:${target}`,nextHandlers);
    return{ok:true,unsubscribe(){stops.push({surface,target});}};
  }
  const repository={
    listenProfile:(username,h)=>listen('profile',`users/${username}`,h),
    listenList:(type,username,h)=>listen(type,`${type}/${username}`,h),
    listenInventory:(username,h)=>listen('inventory',`have/${username}`,h),
    listenAuthIndex:(uid,h)=>listen('authIndex',`authIndex/${uid}`,h),
    listenMemberships:(uid,h)=>listen('memberships',`userCommunities/${uid}`,h),
    listenPendingDecrements:(username,h)=>listen('pendingDecrements',`pendingDecrements/${username}`,h)
  };
  const snapshots=[];
  const errors=[];
  const coordinator=window.PogoData.ownedDataCoordinator.createOwnedDataCoordinator({
    repository,lifecycle,
    onSnapshot:value=>snapshots.push(value),
    onError:value=>errors.push(value)
  });
  return{coordinator,lifecycle,subscriptions,starts,stops,handlers,snapshots,errors};
}

test('core owned data uses only UID and username exact paths',()=>{
  const h=harness();
  assert.equal(h.coordinator.activate({uid:'uid-a',username:'TrainerA'}).ok,true);
  assert.equal(h.coordinator.subscribeCore().ok,true);
  assert.deepEqual(h.starts.map(item=>item.target),[
    'users/TrainerA','wishlist/TrainerA','have/TrainerA','authIndex/uid-a',
    'userCommunities/uid-a','pendingDecrements/TrainerA'
  ]);
});

test('lazy list subscriptions are constrained and deduplicated',()=>{
  const h=harness();
  h.coordinator.activate({uid:'uid-a',username:'TrainerA'});
  assert.equal(h.coordinator.subscribeList('dynamax').status,'subscribed');
  assert.equal(h.coordinator.subscribeList('dynamax').status,'existing');
  assert.equal(h.starts.filter(item=>item.surface==='dynamax').length,1);
  assert.equal(h.coordinator.subscribeList('offers').error.code,'owned-read/list-invalid');
});

test('list hydration requires a current-identity authoritative snapshot',()=>{
  const h=harness();
  h.coordinator.activate({uid:'uid-a',username:'TrainerA'});
  h.coordinator.subscribeList('wishlist');
  assert.equal(h.coordinator.isHydrated('wishlist'),false);
  h.handlers.get('wishlist:wishlist/TrainerA').onData({Pikachu:{p:'H'}});
  assert.equal(h.coordinator.isHydrated('wishlist'),true);
  assert.equal(h.coordinator.isHydratedFor('wishlist',{uid:'uid-a',username:'TrainerA'}),true);
  assert.equal(h.coordinator.isHydratedFor('wishlist',{uid:'uid-b',username:'TrainerA'}),false);
  assert.equal(h.coordinator.isHydratedFor('wishlist',{uid:'uid-a',username:'TrainerB'}),false);
  assert.deepEqual(Array.from(h.coordinator.snapshot().hydratedSurfaces),['wishlist']);

  h.coordinator.activate({uid:'uid-b',username:'TrainerB'});
  assert.equal(h.coordinator.isHydrated('wishlist'),false);
  h.coordinator.subscribeList('wishlist');
  h.handlers.get('wishlist:wishlist/TrainerB').onData({Eevee:{p:'M'}});
  assert.equal(h.coordinator.isHydrated('wishlist'),true);
  assert.equal(h.coordinator.isHydratedFor('wishlist',{uid:'uid-b',username:'TrainerB'}),true);
  assert.equal(h.coordinator.isHydratedFor('wishlist',{uid:'uid-a',username:'TrainerA'}),false);
  h.coordinator.reset();
  assert.equal(h.coordinator.isHydrated('wishlist'),false);
});

test('runtime listener failure revokes hydration and permits a fresh subscription',()=>{
  const h=harness();
  h.coordinator.activate({uid:'uid-a',username:'TrainerA'});
  h.coordinator.subscribeList('wishlist');
  const first=h.handlers.get('wishlist:wishlist/TrainerA');
  first.onData(null);
  assert.equal(h.coordinator.isHydrated('wishlist'),true);
  first.onError({code:'database/disconnected'});
  assert.equal(h.coordinator.isHydrated('wishlist'),false);
  assert.equal(h.coordinator.subscribeList('wishlist').status,'subscribed');
  assert.equal(h.starts.filter(item=>item.surface==='wishlist').length,2);
});

test('switching users replaces listeners and suppresses stale callbacks',()=>{
  const h=harness();
  h.coordinator.activate({uid:'uid-a',username:'TrainerA'});
  h.coordinator.subscribeCore();
  const stale=h.handlers.get('profile:users/TrainerA').onData;
  h.coordinator.activate({uid:'uid-b',username:'TrainerB'});
  h.coordinator.subscribeCore();
  stale({bio:'must not surface'});
  assert.equal(h.snapshots.length,0);
  assert.equal(h.stops.length,6);
  h.handlers.get('profile:users/TrainerB').onData({bio:'current'});
  assert.equal(h.snapshots.length,1);
  assert.equal(h.snapshots[0].path,'users/TrainerB');
});

test('logout cleanup prevents a queued owned callback from mutating state',()=>{
  const h=harness();
  h.coordinator.activate({uid:'uid-a',username:'TrainerA'});
  h.coordinator.subscribeSurface('inventory');
  const stale=h.handlers.get('inventory:have/TrainerA').onData;
  h.lifecycle.deactivateSession('logout');
  h.coordinator.reset();
  stale({Pikachu:2});
  assert.equal(h.snapshots.length,0);
  assert.equal(h.stops.length,1);
});

test('listener failures have stable errors and expose no other-user payload',()=>{
  const h=harness({failSurface:'profile'});
  h.coordinator.activate({uid:'uid-a',username:'TrainerA'});
  const result=h.coordinator.subscribeSurface('profile');
  assert.equal(result.ok,false);
  assert.equal(result.error.code,'database/permission-denied');
  assert.equal(h.snapshots.length,0);
  assert.equal(JSON.stringify(result).includes('TrainerB'),false);
});

test('snapshot metrics contain aggregate counts only',()=>{
  const h=harness();
  h.coordinator.activate({uid:'uid-a',username:'TrainerA'});
  h.coordinator.subscribeSurface('wishlist');
  h.handlers.get('wishlist:wishlist/TrainerA').onData({Pikachu:{p:'H'}});
  const metrics=h.coordinator.snapshotMetrics();
  assert.deepEqual(Object.keys(metrics[0]).sort(),['errors','listenerStarts','payloadBytes','snapshots','surface']);
  assert.equal(metrics[0].surface,'wishlist');
  assert.equal(metrics[0].snapshots,1);
  assert.ok(metrics[0].payloadBytes>0);
  assert.equal(JSON.stringify(metrics).includes('TrainerA'),false);
  assert.equal(JSON.stringify(metrics).includes('uid-a'),false);
});

test('missing identity fails closed before starting a listener',()=>{
  const h=harness();
  assert.equal(h.coordinator.activate({uid:'uid-a',username:''}).error.code,'owned-read/identity-required');
  assert.equal(h.coordinator.subscribeCore().error.code,'owned-read/session-inactive');
  assert.equal(h.starts.length,0);
});
