const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function memoryStorage(seed={}){
  const values=new Map(Object.entries(seed));
  return{
    getItem:key=>values.has(key)?values.get(key):null,
    setItem:(key,value)=>values.set(key,String(value)),
    removeItem:key=>values.delete(key),
    dump:key=>values.get(key),
    has:key=>values.has(key)
  };
}
function loadBoundary(storage){
  const window={};
  vm.runInContext(
    readFileSync(path.join(__dirname,'..','js/data/sessionCacheBoundary.js'),'utf8'),
    vm.createContext({window})
  );
  return window.PogoData.sessionCacheBoundary.createSessionCacheBoundary({storage});
}
function parsed(storage,key){return JSON.parse(storage.dump(key));}
function plain(value){return JSON.parse(JSON.stringify(value));}
const ownerA={uid:'uid-a',username:'TrainerA'};
const ownerB={uid:'uid-b',username:'TrainerB'};

test('legacy pogo3 migration retains only the public login directory',()=>{
  const storage=memoryStorage({pogo3:JSON.stringify({
    loginDirectory:{TrainerA:{authReady:true}},
    users:{TrainerA:{pin:'private'}},wishlist:{TrainerA:{Pikachu:'H'}}
  })});
  const boundary=loadBoundary(storage);
  assert.deepEqual(plain(boundary.readData()),{loginDirectory:{TrainerA:{authReady:true}}});
  const stored=parsed(storage,'pogoSessionCache_v2');
  assert.equal(storage.has('pogo3'),false);
  assert.equal(stored.schemaVersion,2);
  assert.equal(stored.protected,null);
  assert.equal(JSON.stringify(stored).includes('private'),false);
  assert.equal(JSON.stringify(stored).includes('Pikachu'),false);
  assert.deepEqual(Array.from(boundary.drainNotices()),['storage/cache-migrated']);
});

test('legacy unowned sync queue is discarded and never assigned to a login',()=>{
  const storage=memoryStorage({pogoSyncQueue_v1:JSON.stringify({'wishlist/TrainerA':{data:{Pikachu:'H'}}})});
  const boundary=loadBoundary(storage);
  assert.equal(storage.has('pogoSyncQueue_v1'),false);
  assert.deepEqual(Array.from(boundary.drainNotices()),['storage/legacy-queue-discarded']);
  boundary.activate(ownerA);
  assert.deepEqual(plain(boundary.readQueue()),{});
});

test('owned cache and queue persist UID and username metadata',()=>{
  const storage=memoryStorage();
  const boundary=loadBoundary(storage);
  assert.equal(boundary.activate(ownerA).ok,true);
  boundary.writeData({loginDirectory:{Public:{}},users:{TrainerA:{bio:'private'}},wishlist:{TrainerA:{Pikachu:'H'}}});
  boundary.writeQueue({'wishlist/TrainerA':{path:'wishlist/TrainerA',data:{Pikachu:'H'},ts:1}});
  assert.deepEqual(parsed(storage,'pogoSessionCache_v2').protected.owner,ownerA);
  assert.deepEqual(parsed(storage,'pogoSyncQueue_v2').owner,ownerA);
  assert.equal(boundary.readData().users.TrainerA.bio,'private');
  assert.equal(Object.keys(boundary.readQueue()).length,1);
});

test('transient auth loss locks protected data and same-user recovery restores it',()=>{
  const storage=memoryStorage();
  const boundary=loadBoundary(storage);
  boundary.activate(ownerA);
  boundary.writeData({loginDirectory:{Public:{}},users:{TrainerA:{bio:'private'}}});
  boundary.writeQueue({pending:{path:'users/TrainerA',data:{bio:'private'},ts:1}});
  boundary.suspend('auth_loss');
  assert.deepEqual(plain(boundary.readData()),{loginDirectory:{Public:{}}});
  assert.deepEqual(plain(boundary.readQueue()),{});
  assert.equal(boundary.activate(ownerA).ok,true);
  assert.equal(boundary.readData().users.TrainerA.bio,'private');
  assert.equal(Object.keys(boundary.readQueue()).length,1);
});

test('explicit logout removes protected cache and pending changes but keeps public data',()=>{
  const storage=memoryStorage();
  const boundary=loadBoundary(storage);
  boundary.activate(ownerA);
  boundary.writeData({loginDirectory:{Public:{}},users:{TrainerA:{bio:'private'}}});
  boundary.writeQueue({pending:{path:'users/TrainerA',data:{bio:'private'},ts:1}});
  boundary.clearForLogout();
  assert.deepEqual(plain(boundary.readData()),{loginDirectory:{Public:{}}});
  assert.equal(parsed(storage,'pogoSessionCache_v2').protected,null);
  assert.equal(parsed(storage,'pogoSyncQueue_v2').owner,null);
  assert.deepEqual(parsed(storage,'pogoSyncQueue_v2').entries,{});
});

test('User A logout then User B cannot expose or merge User A state',()=>{
  const storage=memoryStorage();
  const boundary=loadBoundary(storage);
  boundary.activate(ownerA);
  boundary.writeData({users:{TrainerA:{secret:'a'}}});
  boundary.clearForLogout();
  boundary.activate(ownerB);
  boundary.writeData({users:{TrainerB:{secret:'b'}}});
  assert.equal(boundary.readData().users.TrainerA,undefined);
  assert.equal(boundary.readData().users.TrainerB.secret,'b');
});

test('direct switch to a wholly different owner discards the previous partition',()=>{
  const storage=memoryStorage();
  const boundary=loadBoundary(storage);
  boundary.activate(ownerA);
  boundary.writeData({users:{TrainerA:{secret:'a'}}});
  boundary.writeQueue({pending:{path:'users/TrainerA',data:{secret:'a'},ts:1}});
  const switched=boundary.activate(ownerB);
  assert.equal(switched.ok,true);
  assert.equal(boundary.readData().users,undefined);
  assert.deepEqual(plain(boundary.readQueue()),{});
});

test('matching UID with mismatched username fails closed',()=>{
  const storage=memoryStorage();
  const boundary=loadBoundary(storage);
  boundary.activate(ownerA);
  boundary.suspend();
  const result=boundary.activate({uid:ownerA.uid,username:'DifferentTrainer'});
  assert.equal(result.ok,false);
  assert.equal(result.error.code,'storage/owner-mismatch');
  assert.equal(boundary.snapshot().protectedAccessible,false);
});

test('matching username with mismatched UID fails closed',()=>{
  const storage=memoryStorage();
  const boundary=loadBoundary(storage);
  boundary.activate(ownerA);
  boundary.suspend();
  const result=boundary.activate({uid:'different-uid',username:ownerA.username});
  assert.equal(result.ok,false);
  assert.equal(result.error.code,'storage/owner-mismatch');
  assert.equal(boundary.snapshot().queueAccessible,false);
});

test('corrupted and partially written metadata resets without exposing data',()=>{
  const storage=memoryStorage({
    pogoSessionCache_v2:'{"schemaVersion":2,"public":',
    pogoSyncQueue_v2:JSON.stringify({schemaVersion:2,owner:{uid:'uid-a'},entries:{private:{}}})
  });
  const boundary=loadBoundary(storage);
  assert.deepEqual(plain(boundary.readData()),{loginDirectory:{}});
  assert.deepEqual(plain(boundary.readQueue()),{});
  assert.equal(parsed(storage,'pogoSessionCache_v2').protected,null);
  assert.equal(parsed(storage,'pogoSyncQueue_v2').owner,null);
});

test('browser refresh recovers an owned partition only for the matching identity',()=>{
  const storage=memoryStorage();
  let boundary=loadBoundary(storage);
  boundary.activate(ownerA);
  boundary.writeData({users:{TrainerA:{bio:'persisted'}}});
  boundary.suspend('refresh');
  boundary=loadBoundary(storage);
  assert.equal(boundary.readData().users,undefined);
  boundary.activate(ownerA);
  assert.equal(boundary.readData().users.TrainerA.bio,'persisted');
});

test('protected writes and queue writes fail while no owner is active',()=>{
  const storage=memoryStorage();
  const boundary=loadBoundary(storage);
  assert.equal(boundary.writeData({loginDirectory:{Public:{}},users:{Leak:{secret:true}}}).ok,true);
  assert.deepEqual(plain(boundary.readData()),{loginDirectory:{Public:{}}});
  const queued=boundary.writeQueue({leak:{path:'users/Leak',data:{secret:true}}});
  assert.equal(queued.ok,false);
  assert.equal(queued.error.code,'storage/session-inactive');
  assert.deepEqual(parsed(storage,'pogoSyncQueue_v2').entries,{});
});

test('logout clears protected local state before identity and tolerates Firebase sign-out failure',()=>{
  const source=readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const block=source.slice(source.indexOf('function logout(){'),source.indexOf('// ── NAV',source.indexOf('function logout(){')));
  const listenerAt=block.indexOf("managedListenerLifecycle.deactivateSession('logout');");
  const cacheAt=block.indexOf('clearOwnedSession();');
  const identityAt=block.indexOf('cur=null;');
  const signOutAt=block.indexOf('firebaseSignOut(auth).catch(()=>{});');
  assert.ok(listenerAt>=0&&listenerAt<cacheAt);
  assert.ok(cacheAt<identityAt);
  assert.ok(identityAt<signOutAt);
});

test('auth loss locks storage before authenticated identity is cleared',()=>{
  const source=readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const block=source.slice(source.indexOf('function bindAuthObserver(){'),source.indexOf('function waitForAuthState'));
  assert.ok(block.indexOf("managedListenerLifecycle.deactivateSession('auth_loss');")<block.indexOf("suspendOwnedSession('auth_loss');"));
  assert.ok(block.indexOf("suspendOwnedSession('auth_loss');")<block.indexOf("currentAuthUid=user?.uid||'';"));
  assert.ok(block.includes("document.querySelectorAll('.ov.open').forEach(el=>closeModal(el.id));"));
  assert.ok(block.includes("document.getElementById('app').style.display='none';"));
});

test('selected-trainer snapshots are runtime-only and never persisted',()=>{
  const source=readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const publicStart=source.indexOf('function onPublicShareSnapshot(username,snap){');
  const authStart=source.indexOf('function onShareSnapshot(path,snap){');
  const end=source.indexOf('function ensureShareViewSubscriptions(username){',authStart);
  assert.equal(source.slice(publicStart,authStart).includes('saveLocal('),false);
  assert.equal(source.slice(authStart,end).includes('saveLocal('),false);
  assert.ok(source.slice(publicStart,end).includes('runtimeDataWithSelectedTrainer(getLocal())'));
});
