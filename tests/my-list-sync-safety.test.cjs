const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=readFileSync(path.join(__dirname,'..','index.html'),'utf8');

function between(start,end){
  const from=source.indexOf(start);
  const to=source.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,`missing source block: ${start}`);
  return source.slice(from,to);
}

function syncHelperHarness(){
  let hydrated=false;
  const subscriptions=[];
  const notices=[];
  const queued=[];
  const context={
    fbOn:true,
    db:{},
    auth:{currentUser:{uid:'uid-a'}},
    cur:'TrainerA',
    ownedExactReadsEnabled:()=>true,
    managedOwnedDataCoordinator:{isHydrated:()=>hydrated},
    ensureListSubscribed:type=>subscriptions.push(type),
    toast:message=>notices.push(message),
    i18nCore:{t:key=>key},
    queueMyListUpdate:(type,username,patch)=>{queued.push({type,username,patch});return true;}
  };
  vm.runInNewContext(
    between('const OWNED_MY_LIST_TYPES','function writeList(type,u,list,{previousList}={})'),
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

test('whole-list changes produce one atomic patch containing only changed Pokemon',()=>{
  const h=syncHelperHarness();
  const queued=h.context.queueListEntryDiff('wishlist','TrainerA',{
    Pikachu:'M',Eevee:'L',Bulbasaur:'H'
  },{
    Pikachu:'H',Bulbasaur:'H',Squirtle:'M'
  });
  assert.equal(queued,3);
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

  const writeBlock=between('function writeList(type,u,list,{previousList}={})','function refreshAddPokemonChoices');
  assert.match(writeBlock,/requireOwnedListHydration\(type,u\)/);
  assert.match(writeBlock,/queueListEntryDiff\(type,u,previous,list\|\|\{\}\)/);
  assert.doesNotMatch(writeBlock,/queueSync\(`\$\{type\}\/\$\{u\}`/);
});

function deferred(){
  let resolve,reject;
  const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});
  return{promise,resolve,reject};
}
function queueRuntimeHarness({setAdapter=async()=>{},updateAdapter=async()=>{}}={}){
  const window={};
  const context=vm.createContext({window});
  vm.runInContext(readFileSync(path.join(__dirname,'..','js/data/sessionCacheBoundary.js'),'utf8'),context);
  const boundary=window.PogoData.sessionCacheBoundary;
  Object.assign(context,{
    sessionCacheBoundaryData:boundary,
    managedSessionCache:{
      snapshot:()=>({activeOwner:{uid:'uid-a',username:'TrainerA'}}),
      quarantineQueueEntry:()=>({ok:true})
    },
    syncQueue:{},syncFlushTimer:null,fbOn:true,db:{},auth:{currentUser:{uid:'uid-a'}},cur:'TrainerA',
    firebaseAuthConfigured:()=>false,setSyncStatus:()=>{},showSyncDot:()=>{},refreshSyncUi:()=>{},
    showSessionStorageNotices:()=>{},toast:()=>{},i18nCore:{t:key=>key},warnLocalOnlyMode:()=>{},
    clearTimeout:()=>{},setTimeout:()=>1,saveSyncQueue:()=>({ok:true}),
    ref:(_db,target)=>target,set:setAdapter,update:updateAdapter,
    activePublicShareHydrationToken:null,publicShareSessionMatches:()=>false,
    inspectOwnPublicShareAfterHydration:()=>{},console
  });
  vm.runInContext(between('function unsafeWholeListQueueEntry','function showSyncDot'),context);
  vm.runInContext(between('function listEntryValuesEqual','function writeList(type,u,list,{previousList}={})'),context);
  return context;
}

test('multi-Pokemon action reaches Firebase as one atomic root update with null deletion',async()=>{
  const calls=[];
  const h=queueRuntimeHarness({updateAdapter:async(target,patch)=>calls.push({target,patch})});
  assert.equal(h.queueListEntryDiff('wishlist','TrainerA',
    {Pikachu:'M',Eevee:'L',Bulbasaur:'H'},
    {Pikachu:'H',Bulbasaur:'H',Squirtle:'M'}
  ),3);
  await h.flushSyncQueue();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{target:'wishlist/TrainerA',patch:{Pikachu:'H',Eevee:null,Squirtle:'M'}}]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.syncQueue)),{});
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
  const h=queueRuntimeHarness({updateAdapter:()=>pending.promise});
  h.queueMyListUpdate('wishlist','TrainerA',{Pikachu:'H'});
  const flushing=h.flushSyncQueue();
  await Promise.resolve();
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
