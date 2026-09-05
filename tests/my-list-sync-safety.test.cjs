const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');

const source=require('../scripts/lib/frontend-source.cjs').readFrontendSource(path.join(__dirname,'..'));
function loadAccountSyncProduct(){
  const window={crypto:webcrypto,btoa:value=>Buffer.from(value,'binary').toString('base64')},context=vm.createContext({window,Uint8Array,unescape,encodeURIComponent,console});
  for(const file of ['js/domain/accountSyncModel.js','js/domain/accountSyncProduct.js'])vm.runInContext(readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
  return window.PogoDomain.accountSyncProduct;
}
const accountSyncProduct=loadAccountSyncProduct();

function between(start,end){
  const from=source.indexOf(start);
  const to=source.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,`missing source block: ${start}`);
  return source.slice(from,to);
}

function syncHelperHarness({exactReads=true,authUid='uid-a',activeOwner={uid:'uid-a',username:'TrainerA'},coordinatorOwner={uid:'uid-a',username:'TrainerA'}}={}){
  let hydrated=false;
  const subscriptions=[];
  const notices=[];
  const queued=[];
  const context={
    fbOn:true,
    db:{},
    auth:{currentUser:{uid:authUid}},
    cur:'TrainerA',
    _firstSyncDone:false,
    _pathLoadState:{},
    managedSessionCache:{snapshot:()=>({activeOwner})},
    ownedExactReadsEnabled:()=>exactReads,
    managedOwnedDataCoordinator:{
      isHydratedFor:(_surface,identity)=>hydrated&&identity.uid===coordinatorOwner.uid&&identity.username===coordinatorOwner.username
    },
    ensureListSubscribed:type=>subscriptions.push(type),
    toast:message=>notices.push(message),
    i18nCore:{t:key=>key},
    OWNED_MY_LIST_TYPES:Object.freeze(['wishlist','dynamax','gmax','costumes']),
    queueMyListUpdate:(type,username,patch)=>{
      queued.push({type,username,patch});
      return Object.freeze({ok:true,status:'queued',changed:Object.keys(patch).length});
    }
  };
  context.accountSyncProjectionReady=()=>false;
  vm.runInNewContext(
    between('function resetOwnedHydrationState','async function writeList(type,u,list,{previousList,orderModel}={})'),
    context
  );
  return{context,subscriptions,notices,queued,setHydrated:value=>{hydrated=value;}};
}

test('My List mutation fails closed until this session receives its exact list snapshot',()=>{
  const h=syncHelperHarness();
  assert.equal(h.context.requireOwnedListHydration('wishlist','TrainerA'),false);
  assert.deepEqual(h.subscriptions,['wishlist']);
  assert.deepEqual(h.notices,['storage.listHydrationRequired']);
  h.setHydrated(true);
  assert.equal(h.context.requireOwnedListHydration('wishlist','TrainerA'),true);
  assert.equal(h.context.requireOwnedListHydration('wishlist','DifferentTrainer'),false);
});

test('My List hydration binds the authenticated UID, active cache owner, username, and snapshot identity',()=>{
  const wrongAuth=syncHelperHarness({authUid:'uid-b'});wrongAuth.setHydrated(true);
  assert.equal(wrongAuth.context.requireOwnedListHydration('wishlist','TrainerA'),false);
  assert.deepEqual(wrongAuth.subscriptions,[]);

  const wrongOwner=syncHelperHarness({activeOwner:{uid:'uid-a',username:'TrainerB'}});wrongOwner.setHydrated(true);
  assert.equal(wrongOwner.context.requireOwnedListHydration('wishlist','TrainerA'),false);

  const staleSnapshot=syncHelperHarness({coordinatorOwner:{uid:'uid-b',username:'TrainerA'}});staleSnapshot.setHydrated(true);
  assert.equal(staleSnapshot.context.requireOwnedListHydration('wishlist','TrainerA'),false);

  const exact=syncHelperHarness();exact.setHydrated(true);
  assert.equal(exact.context.requireOwnedListHydration('wishlist','TrainerA'),true);
});

test('legacy hydration fallback uses the broad listener root key recorded by subscribePath(type)',()=>{
  const h=syncHelperHarness({exactReads:false});
  h.context._pathLoadState.wishlist='loaded';
  assert.equal(h.context.requireOwnedListHydration('wishlist','TrainerA'),true);
  delete h.context._pathLoadState.wishlist;
  h.context._pathLoadState['wishlist/TrainerA']='loaded';
  assert.equal(h.context.requireOwnedListHydration('wishlist','TrainerA'),false);
  assert.match(source,/if\(LEGACY_BROAD_READS_ENABLED\)subscribePath\(type\)/);
  assert.match(source,/_pathLoadState\[path\]='loaded'/);
});

test('whole-list changes produce one atomic patch containing only changed Pokemon',()=>{
  const h=syncHelperHarness();
  const queued=h.context.queueListEntryDiff('wishlist','TrainerA',{
    Pikachu:'M',Eevee:'L',Bulbasaur:'H'
  },{
    Pikachu:'H',Bulbasaur:'H',Squirtle:'M'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(queued)),{ok:true,status:'queued',changed:3});
  assert.deepEqual(JSON.parse(JSON.stringify(h.queued)),[
    {type:'wishlist',username:'TrainerA',patch:{Pikachu:'H',Eevee:null,Squirtle:'M'}}
  ]);
});

test('queue flush rejects restored whole-list replacements and uses atomic update for list patches',()=>{
  const queueBlock=between('function unsafeWholeListQueueEntry','function showSyncDot');
  const guardAt=queueBlock.indexOf('if(unsafeWholeListQueueEntry(path,item))');
  const updateAt=queueBlock.indexOf('await update(ref(db,item.path),item.data);');
  assert.ok(guardAt>=0&&guardAt<updateAt);
  assert.match(queueBlock,/managedSessionCache\.quarantineQueueEntry\(path,item\)/);
  assert.match(queueBlock,/queueItemIsCurrent\(path,item\)/);
  assert.doesNotMatch(queueBlock,/syncQueue\[path\]=item/);

  const writeBlock=between('async function writeList(type,u,list,{previousList,orderModel}={})','function refreshAddPokemonChoices');
  assert.match(writeBlock,/requireOwnedListHydration\(type,u\)/);
  assert.match(writeBlock,/writeList\.pending/);
  assert.match(writeBlock,/accountSyncProduct\.rebaseListEdit/);
  assert.match(writeBlock,/queueListEntryDiff\(type,u,cachedPrevious,list\|\|\{\}\)/);
  assert.doesNotMatch(writeBlock,/queueSync\(`\$\{type\}\/\$\{u\}`/);
});

function deferred(){
  let resolve,reject;
  const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});
  return{promise,resolve,reject};
}
function queueRuntimeHarness({setAdapter=async()=>{},updateAdapter=async()=>{},saveQueueResult={ok:true}}={}){
  const window={};
  const context=vm.createContext({window});
  vm.runInContext(readFileSync(path.join(__dirname,'..','js/data/sessionCacheBoundary.js'),'utf8'),context);
  const boundary=window.PogoData.sessionCacheBoundary;
  Object.assign(context,{
    sessionCacheBoundaryData:boundary,
    providerOnlyIdentityActive:()=>false,
    managedSessionCache:{
      snapshot:()=>({activeOwner:{uid:'uid-a',username:'TrainerA'}}),
      quarantineQueueEntry:()=>({ok:true})
    },
    syncQueue:{},syncFlushTimer:null,fbOn:true,db:{},auth:{currentUser:{uid:'uid-a'}},cur:'TrainerA',
    firebaseAuthConfigured:()=>false,setSyncStatus:()=>{},showSyncDot:()=>{},refreshSyncUi:()=>{},
    showSessionStorageNotices:()=>{},toast:()=>{},i18nCore:{t:key=>key},warnLocalOnlyMode:()=>{},
    clearTimeout:()=>{},setTimeout:()=>1,saveSyncQueue:()=>saveQueueResult,
    ref:(_db,target)=>target,set:setAdapter,update:updateAdapter,
    activePublicShareHydrationToken:null,publicShareSessionMatches:()=>false,
    inspectOwnPublicShareAfterHydration:()=>{},console
  });
  context.accountSyncRolloutEligible=async()=>false;
  context.accountSyncMarkMutationBlocked=()=>{};
  context.accountSyncMigratedLegacyQueueItem=()=>false;
  vm.runInContext(between('function unsafeWholeListQueueEntry','function showSyncDot'),context);
  vm.runInContext(between('function listEntryValuesEqual','async function writeList(type,u,list,{previousList,orderModel}={})'),context);
  return context;
}

test('multi-Pokemon action reaches Firebase as one atomic root update with null deletion',async()=>{
  const calls=[];
  const h=queueRuntimeHarness({updateAdapter:async(target,patch)=>calls.push({target,patch})});
  assert.deepEqual(JSON.parse(JSON.stringify(h.queueListEntryDiff('wishlist','TrainerA',
    {Pikachu:'M',Eevee:'L',Bulbasaur:'H'},
    {Pikachu:'H',Bulbasaur:'H',Squirtle:'M'}
  ))),{ok:true,status:'queued',changed:3});
  await h.flushSyncQueue();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{target:'wishlist/TrainerA',patch:{Pikachu:'H',Eevee:null,Squirtle:'M'}}]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.syncQueue)),{});
});

test('list diff distinguishes no-op, validation failure, and queue persistence failure',()=>{
  const noOp=queueRuntimeHarness();
  assert.deepEqual(JSON.parse(JSON.stringify(noOp.queueListEntryDiff(
    'wishlist','TrainerA',{Pikachu:'H'},{Pikachu:'H'}
  ))),{ok:true,status:'no_changes',changed:0});

  const invalid=queueRuntimeHarness();
  assert.deepEqual(JSON.parse(JSON.stringify(invalid.queueMyListUpdate(
    'wishlist','TrainerA',{Pikachu:{priority:'H'}}
  ))),{ok:false,status:'validation_failed',changed:1});

  const failed=queueRuntimeHarness({saveQueueResult:{ok:false,error:{code:'storage/quota'}}});
  assert.deepEqual(JSON.parse(JSON.stringify(failed.queueListEntryDiff(
    'wishlist','TrainerA',{Pikachu:'M'},{Pikachu:'H'}
  ))),{ok:false,status:'persistence_failed',changed:1,errorCode:'storage/quota'});
  assert.deepEqual(failed.syncQueue,{});
});

function mutationHarness({queueResult={ok:true,status:'queued',changed:1},initialList={Pikachu:'M'},authority=async()=>Object.freeze({mode:'legacy'})}={}){
  let state={
    users:{TrainerA:{lastUpdated:10,lastSeen:11}},
    wishlist:{TrainerA:{...initialList}}
  };
  const effects={activity:[],queueSync:[],publication:[],notices:[],saves:0,syncs:0,refreshes:0};
  const context={
    fbOn:true,db:{},auth:{currentUser:{uid:'uid-a'}},
    requireOwnedListHydration:()=>true,
    providerOnlyIdentityActive:()=>false,
    accountSyncMutationAuthority:authority,
    accountSyncProduct,
    parsePri:value=>{const raw=String(value||'');if(raw.startsWith('{')){const parsed=JSON.parse(raw);return{p:parsed.priority||'',mod:parsed.variant||'',lucky:parsed.lucky===true,xxl:parsed.xxl===true,xxs:parsed.xxs===true,shiny:parsed.shiny===true,backgroundId:parsed.backgroundId||''};}return{p:['H','M','L'].includes(raw.charAt(0))?raw.charAt(0):'',mod:'',lucky:false,xxl:false,xxs:false,shiny:false,backgroundId:''};},
    priValue:(priority,variant,lucky,xxl,xxs,shiny,backgroundId)=>variant||lucky||xxl||xxs||shiny||backgroundId?JSON.stringify({priority,variant,lucky,xxl,xxs,shiny,backgroundId}):priority,
    getLocal:()=>JSON.parse(JSON.stringify(state)),
    queueListEntryDiff:()=>queueResult,
    recordActivityEvent:(...args)=>effects.activity.push(args),
    expandMyListPrioritiesReceivingEntries:()=>{},
    saveLocal:value=>{effects.saves++;state=JSON.parse(JSON.stringify(value));},
    queueSync:(...args)=>{effects.queueSync.push(args);return true;},
    requestPublicSharePublication:(...args)=>effects.publication.push(args),
    syncFromLocal:()=>{effects.syncs++;},
    refreshAddPokemonChoices:()=>{effects.refreshes++;},
    toast:message=>effects.notices.push(message),
    i18nCore:{t:key=>key},cur:'TrainerA',Date
  };
  vm.runInNewContext(
    between('async function writeList(type,u,list,{previousList,orderModel}={})','function refreshAddPokemonChoices'),
    context
  );
  return{context,effects,state:()=>JSON.parse(JSON.stringify(state))};
}

test('failed queue persistence leaves whole-list and item writes completely unchanged',async()=>{
  const failed={ok:false,status:'persistence_failed',changed:1,errorCode:'storage/quota'};
  for(const operation of[
    h=>h.context.writeList('wishlist','TrainerA',{Pikachu:'H',Eevee:'L'}),
    h=>h.context.writeListItem('wishlist','TrainerA','Pikachu','H')
  ]){
    const h=mutationHarness({queueResult:failed});
    const before=h.state();
    assert.equal(await operation(h),false);
    assert.deepEqual(h.state(),before);
    assert.deepEqual(h.effects.activity,[]);
    assert.deepEqual(h.effects.queueSync,[]);
    assert.deepEqual(h.effects.publication,[]);
    assert.equal(h.effects.saves,0);
    assert.equal(h.effects.syncs,0);
    assert.equal(h.effects.refreshes,0);
    assert.deepEqual(h.effects.notices,['storage.offlineRecoveryUnavailable']);
  }
});

test('successfully persisted offline queue keeps optimistic list behavior',async()=>{
  const h=mutationHarness();
  assert.equal(await h.context.writeList('wishlist','TrainerA',{Pikachu:'H',Eevee:'L'}),true);
  assert.deepEqual(h.state().wishlist.TrainerA,{Pikachu:'H',Eevee:'L'});
  assert.deepEqual(h.effects.activity,[['TrainerA',1]]);
  assert.equal(h.effects.saves,1);
  assert.equal(h.effects.syncs,1);
  assert.equal(h.effects.refreshes,1);
  assert.equal(h.effects.publication.length,1);
  assert.deepEqual(h.effects.queueSync.map(entry=>entry[0]),[
    'users/TrainerA/lastUpdated','users/TrainerA/lastSeen'
  ]);
  assert.deepEqual(h.effects.notices,[]);
});

test('rapid disjoint qualifier edits serialize and rebase without losing either change',async()=>{
  const h=mutationHarness({initialList:{Pikachu:'H'}}),base={priority:'H',variant:'',lucky:false,xxl:false,xxs:false,shiny:false,backgroundId:''};
  const shiny=JSON.stringify({...base,shiny:true}),lucky=JSON.stringify({...base,lucky:true});
  const first=h.context.writeList('wishlist','TrainerA',{Pikachu:shiny}),second=h.context.writeList('wishlist','TrainerA',{Pikachu:lucky});
  assert.deepEqual(await Promise.all([first,second]),[true,true]);
  assert.deepEqual(JSON.parse(h.state().wishlist.TrainerA.Pikachu),{...base,lucky:true,shiny:true});assert.equal(h.effects.saves,2);
});

test('a serialized My List write cannot cross an authentication-session boundary',async()=>{
  const waiting=deferred(),h=mutationHarness({authority:()=>waiting.promise});
  const pending=h.context.writeList('wishlist','TrainerA',{Pikachu:'H'});
  h.context.auth.currentUser={uid:'uid-b'};h.context.cur='TrainerB';waiting.resolve(Object.freeze({mode:'legacy'}));
  assert.equal(await pending,false);
  assert.deepEqual(h.state().wishlist.TrainerA,{Pikachu:'M'});
  assert.equal(h.effects.saves,0);assert.deepEqual(h.effects.queueSync,[]);assert.deepEqual(h.effects.publication,[]);
});

test('add, import, bulk, and delete UI state changes remain after the write-success boundary',()=>{
  const add=between('function addEntry(){','function allCostumeEntries');
  const tray=between('function confirmAddTray(){','document.addEventListener');
  const imported=between('function confirmImport(){','// ── GLOBAL KEYBOARD SHORTCUTS');
  const bulk=between('function bulkSetPri(){','// ── VOICE INPUT');
  const remove=between('function removeEntry(name){','// ── SEARCH STRINGS');
  assert.ok(add.indexOf('if(!writeList(myListType,cur,list))return;')<add.indexOf("document.getElementById('ac-input').value='';"));
  assert.ok(tray.indexOf('if(!writeList(myListType,cur,list))return;')<tray.indexOf('addTray=[];'));
  assert.ok(imported.indexOf('if(!writeList(myListType,cur,list))return;')<imported.indexOf("closeModal('import-modal')"));
  const firstBulkWrite=bulk.indexOf('if(!writeList(myListType,cur,list))return;');
  assert.ok(firstBulkWrite<bulk.indexOf("sel.value='';",firstBulkWrite));
  assert.ok(bulk.lastIndexOf('if(!writeList(myListType,cur,list))return;')<bulk.indexOf('undoStack=',bulk.lastIndexOf('if(!writeList(myListType,cur,list))return;')));
  assert.match(remove,/if\(!await writeListItem\(myListType,cur,name,null\)\)/);
  assert.doesNotMatch(remove,/writeList\(|undoStack|showUndo/);
  assert.match(remove,/else document\.getElementById\('mylist-filter'\)\?\.focus\(\)/);
  const confirmation=between('function confirmRemove(name,dn){','const canvasImageCache');
  assert.match(confirmation,/if\(!confirm\(message\)\)return false/);
  assert.match(confirmation,/removeEntry\(name\);\s*return true/);
  assert.match(confirmation,/myList\.confirmRemove/);
  assert.match(remove,/if\(row\)row\.style\.transform=''/);
  const swipe=between('function swipeEnd(ev){','// ── PULL TO REFRESH');
  assert.match(swipe,/!confirmRemove\(n,row\.dataset\.full\|\|n\)\)row\.style\.transform=''/);
});

test('another-client Pokemon remains unchanged when this client updates a different Pokemon',async()=>{
  const server={Pikachu:'M',Eevee:'remote-new'};
  const h=queueRuntimeHarness({updateAdapter:async(_target,patch)=>{
    Object.entries(patch).forEach(([name,value])=>{if(value==null)delete server[name];else server[name]=value;});
  }});
  h.queueMyListUpdate('wishlist','TrainerA',{Pikachu:'H'});
  await h.flushSyncQueue();
  assert.deepEqual(server,{Pikachu:'H',Eevee:'remote-new'});
});

test('successive offline edits use explicit same-Pokemon last-write-wins semantics',()=>{
  const h=queueRuntimeHarness();
  h.queueMyListUpdate('wishlist','TrainerA',{Pikachu:'H',Eevee:'L'});
  h.queueMyListUpdate('wishlist','TrainerA',{Pikachu:'M'});
  const key=h.sessionCacheBoundaryData.myListUpdateQueueKey('wishlist/TrainerA');
  assert.deepEqual(JSON.parse(JSON.stringify(h.syncQueue[key].data)),{Pikachu:'M',Eevee:'L'});
});

test('a late transient failure cannot overwrite a newer queued value',async()=>{
  const pending=deferred();
  const h=queueRuntimeHarness({setAdapter:()=>pending.promise});
  h.queueSync('users/TrainerA/bio','old');
  const flushing=h.flushSyncQueue();
  await Promise.resolve();
  h.queueSync('users/TrainerA/bio','new');
  pending.reject(Object.assign(new Error('offline'),{code:'NETWORK_ERROR'}));
  await flushing;
  assert.equal(h.syncQueue['users/TrainerA/bio'].data,'new');
});

test('a failed atomic list patch retries idempotently without widening its root',async()=>{
  const calls=[];
  let fail=true;
  const h=queueRuntimeHarness({updateAdapter:async(target,patch)=>{
    calls.push({target,patch:JSON.parse(JSON.stringify(patch))});
    if(fail){fail=false;throw Object.assign(new Error('offline'),{code:'NETWORK_ERROR'});}
  }});
  h.queueMyListUpdate('wishlist','TrainerA',{Pikachu:null});
  await h.flushSyncQueue();
  assert.equal(Object.keys(h.syncQueue).length,1);
  await h.flushSyncQueue();
  assert.deepEqual(calls,[
    {target:'wishlist/TrainerA',patch:{Pikachu:null}},
    {target:'wishlist/TrainerA',patch:{Pikachu:null}}
  ]);
  assert.equal(Object.keys(h.syncQueue).length,0);
});

test('an in-flight atomic patch cannot erase a newer merged patch',async()=>{
  const pending=deferred();
  const started=deferred();
  const h=queueRuntimeHarness({updateAdapter:()=>{started.resolve();return pending.promise;}});
  h.queueMyListUpdate('wishlist','TrainerA',{Pikachu:'H'});
  const flushing=h.flushSyncQueue();
  await started.promise;
  h.queueMyListUpdate('wishlist','TrainerA',{Eevee:'M'});
  pending.resolve();
  await flushing;
  const key=h.sessionCacheBoundaryData.myListUpdateQueueKey('wishlist/TrainerA');
  assert.deepEqual(JSON.parse(JSON.stringify(h.syncQueue[key].data)),{Pikachu:'H',Eevee:'M'});
});

test('malformed queue records fail closed before any Firebase adapter call',async()=>{
  let calls=0;
  const h=queueRuntimeHarness({setAdapter:async()=>{calls++;},updateAdapter:async()=>{calls++;}});
  h.syncQueue.bad={kind:'set',path:'wishlist/AnotherOwner/Pikachu',data:'H',ts:1};
  await h.flushSyncQueue();
  assert.equal(calls,0);
  assert.deepEqual(h.syncQueue,{});
});
