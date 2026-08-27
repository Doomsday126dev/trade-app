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
  boundary.writeQueue({'wishlist/TrainerA/Pikachu':{kind:'set',path:'wishlist/TrainerA/Pikachu',data:'H',ts:1}});
  assert.deepEqual(parsed(storage,'pogoSessionCache_v2').protected.owner,ownerA);
  assert.deepEqual(parsed(storage,'pogoSyncQueue_v2').owner,ownerA);
  assert.equal(boundary.readData().users.TrainerA.bio,'private');
  assert.equal(Object.keys(boundary.readQueue()).length,1);
});

test('owned whole-list replacements are preserved in quarantine and never restored for flush',()=>{
  const fullList={path:'wishlist/TrainerA',data:{Pikachu:'H'},ts:1};
  const leaf={path:'wishlist/TrainerA/Eevee',data:'M',ts:2};
  const storage=memoryStorage({
    pogoSyncQueue_v2:JSON.stringify({
      schemaVersion:2,owner:ownerA,
      entries:{'wishlist/TrainerA':fullList,'wishlist/TrainerA/Eevee':leaf}
    })
  });
  const boundary=loadBoundary(storage);
  assert.equal(boundary.activate(ownerA).ok,true);
  assert.deepEqual(plain(boundary.readQueue()),{'wishlist/TrainerA/Eevee':leaf});
  assert.deepEqual(plain(boundary.readQuarantinedQueue()),{'wishlist/TrainerA':fullList});
  assert.equal(boundary.snapshot().quarantinedQueueCount,1);
  assert.deepEqual(Array.from(boundary.drainNotices()),['storage/whole-list-queue-quarantined']);
  const persisted=parsed(storage,'pogoSyncQueue_v2');
  assert.equal(Object.prototype.hasOwnProperty.call(persisted.entries,'wishlist/TrainerA'),false);
  assert.deepEqual(persisted.quarantined['wishlist/TrainerA'],fullList);
});

test('new whole-list queue entries fail into quarantine while item writes remain flushable',()=>{
  const storage=memoryStorage();
  const boundary=loadBoundary(storage);
  boundary.activate(ownerA);
  const fullList={path:'costumes/TrainerA',data:{'Pikachu (Dawn)':'M'},ts:3};
  const leaf={path:'costumes/TrainerA/Pikachu (Dawn)',data:'M',ts:4};
  assert.equal(boundary.writeQueue({
    'costumes/TrainerA':fullList,
    'costumes/TrainerA/Pikachu (Dawn)':leaf
  }).ok,true);
  assert.deepEqual(plain(boundary.readQueue()),{'costumes/TrainerA/Pikachu (Dawn)':leaf});
  assert.deepEqual(plain(boundary.readQuarantinedQueue()),{'costumes/TrainerA':fullList});
  assert.equal(boundary.quarantineQueueEntry('costumes/TrainerA/Pikachu (Dawn)',leaf).error.code,'storage/quarantine-path-invalid');
});

test('owner-bound atomic My List patches persist while foreign or mismatched entries fail closed',()=>{
  const storage=memoryStorage();
  const boundary=loadBoundary(storage);
  boundary.activate(ownerA);
  const root='wishlist/TrainerA';
  const key=`@my-list-update:${root}`;
  const patch={kind:'my-list-update',path:root,data:{Pikachu:'H',Eevee:null},ts:5};
  assert.equal(boundary.writeQueue({[key]:patch}).ok,true);
  assert.deepEqual(plain(boundary.readQueue()),{[key]:patch});
  assert.equal(boundary.writeQueue({wrong:{kind:'set',path:'wishlist/TrainerA/Pikachu',data:'M',ts:6}}).error.code,'storage/queue-entry-invalid');
  assert.equal(boundary.writeQueue({'wishlist/TrainerB/Pikachu':{kind:'set',path:'wishlist/TrainerB/Pikachu',data:'M',ts:7}}).error.code,'storage/queue-entry-invalid');
});

test('restored malformed and foreign queue records are discarded before activation can expose them',()=>{
  const valid={kind:'set',path:'users/TrainerA/bio',data:'kept',ts:1};
  const storage=memoryStorage({
    pogoSyncQueue_v2:JSON.stringify({schemaVersion:2,owner:ownerA,entries:{
      mismatch:{kind:'set',path:'users/TrainerA/bio',data:'wrong-key',ts:2},
      'wishlist/TrainerB/Pikachu':{kind:'set',path:'wishlist/TrainerB/Pikachu',data:'H',ts:3},
      'users/TrainerA/bio':valid
    },quarantined:{'wishlist/TrainerB':{path:'wishlist/TrainerB',data:{Pikachu:'H'},ts:4}}})
  });
  const boundary=loadBoundary(storage);
  boundary.activate(ownerA);
  assert.deepEqual(plain(boundary.readQueue()),{'users/TrainerA/bio':valid});
  assert.deepEqual(plain(boundary.readQuarantinedQueue()),{});
  assert.deepEqual(Array.from(boundary.drainNotices()),['storage/queue-entry-discarded']);
});

test('quarantine is bounded to the four owner list roots and excludes unrelated payloads',()=>{
  const storage=memoryStorage();
  const boundary=loadBoundary(storage);
  boundary.activate(ownerA);
  const entries=Object.fromEntries(['wishlist','dynamax','gmax','costumes'].map((type,index)=>{
    const path=`${type}/TrainerA`;
    return[path,{kind:'set',path,data:{Pikachu:index?'M':'H'},ts:index+1}];
  }));
  assert.equal(boundary.writeQueue(entries).ok,true);
  assert.equal(boundary.snapshot().quarantinedQueueCount,4);
  assert.deepEqual(Object.keys(boundary.readQuarantinedQueue()).sort(),Object.keys(entries).sort());
  assert.equal(JSON.stringify(boundary.readQuarantinedQueue()).includes('pin'),false);
});

test('quarantined stale replacement cannot delete unrelated authoritative entries',()=>{
  const stale={path:'wishlist/TrainerA',data:{Pikachu:'H'},ts:1};
  const narrow={path:'wishlist/TrainerA/Pikachu',data:'H',ts:2};
  const storage=memoryStorage({
    pogoSyncQueue_v2:JSON.stringify({
      schemaVersion:2,owner:ownerA,
      entries:{'wishlist/TrainerA':stale,'wishlist/TrainerA/Pikachu':narrow}
    })
  });
  const boundary=loadBoundary(storage);
  boundary.activate(ownerA);
  const server={Pikachu:'L',Eevee:'M',Bulbasaur:'H'};
  for(const item of Object.values(boundary.readQueue())){
    const name=item.path.split('/')[2];
    if(item.data==null)delete server[name];else server[name]=item.data;
  }
  assert.deepEqual(server,{Pikachu:'H',Eevee:'M',Bulbasaur:'H'});
  assert.equal(Object.keys(boundary.readQuarantinedQueue()).length,1);
});

test('transient auth loss locks protected data and same-user recovery restores it',()=>{
  const storage=memoryStorage();
  const boundary=loadBoundary(storage);
  boundary.activate(ownerA);
  boundary.writeData({loginDirectory:{Public:{}},users:{TrainerA:{bio:'private'}}});
  boundary.writeQueue({'users/TrainerA':{path:'users/TrainerA',data:{bio:'private'},ts:1}});
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
  boundary.writeQueue({'users/TrainerA':{path:'users/TrainerA',data:{bio:'private'},ts:1}});
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
  boundary.writeQueue({'users/TrainerA':{path:'users/TrainerA',data:{secret:'a'},ts:1}});
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
  const source=require('../scripts/lib/frontend-source.cjs').readFrontendSource(path.join(__dirname,'..'));
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
  const source=require('../scripts/lib/frontend-source.cjs').readFrontendSource(path.join(__dirname,'..'));
  const block=source.slice(source.indexOf('function bindAuthObserver(){'),source.indexOf('function waitForAuthState'));
  assert.ok(block.indexOf("managedListenerLifecycle.deactivateSession('auth_loss');")<block.indexOf("suspendOwnedSession('auth_loss');"));
  assert.ok(block.indexOf("suspendOwnedSession('auth_loss');")<block.indexOf("currentAuthUid=user?.uid||'';"));
  assert.ok(block.includes("document.querySelectorAll('.ov.open').forEach(el=>closeModal(el.id));"));
  assert.ok(block.includes("document.getElementById('app').style.display='none';"));
});

test('selected-trainer snapshots are runtime-only and never persisted',()=>{
  const source=require('../scripts/lib/frontend-source.cjs').readFrontendSource(path.join(__dirname,'..'));
  const publicStart=source.indexOf('function onPublicShareSnapshot(username,snap){');
  const end=source.indexOf('function ensureShareViewSubscriptions(username){',publicStart);
  assert.ok(publicStart>=0&&end>publicStart);
  assert.equal(source.slice(publicStart,end).includes('saveLocal('),false);
  assert.ok(source.slice(publicStart,end).includes('runtimeDataWithSelectedTrainer(getLocal())'));
});
