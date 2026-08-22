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
    queueSync:(queuePath,data)=>{queued.push({path:queuePath,data});return true;}
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

test('whole-list changes produce only changed per-Pokemon queue leaves',()=>{
  const h=syncHelperHarness();
  const queued=h.context.queueListEntryDiff('wishlist','TrainerA',{
    Pikachu:'M',Eevee:'L',Bulbasaur:'H'
  },{
    Pikachu:'H',Bulbasaur:'H',Squirtle:'M'
  });
  assert.equal(queued,3);
  assert.deepEqual(h.queued,[
    {path:'wishlist/TrainerA/Pikachu',data:'H'},
    {path:'wishlist/TrainerA/Eevee',data:null},
    {path:'wishlist/TrainerA/Squirtle',data:'M'}
  ]);
  assert.equal(h.queued.some(item=>item.path==='wishlist/TrainerA'),false);
});

test('queue flush rejects any restored whole-list replacement before Firebase set',()=>{
  const queueBlock=between('function unsafeWholeListQueueEntry','function showSyncDot');
  const guardAt=queueBlock.indexOf('if(unsafeWholeListQueueEntry(path,item))');
  const setAt=queueBlock.indexOf('await set(ref(db,path),item.data??null);');
  assert.ok(guardAt>=0&&guardAt<setAt);
  assert.match(queueBlock,/managedSessionCache\.quarantineQueueEntry\(path,item\)/);

  const writeBlock=between('function writeList(type,u,list,{previousList}={})','function refreshAddPokemonChoices');
  assert.match(writeBlock,/requireOwnedListHydration\(type,u\)/);
  assert.match(writeBlock,/queueListEntryDiff\(type,u,previous,list\|\|\{\}\)/);
  assert.doesNotMatch(writeBlock,/queueSync\(`\$\{type\}\/\$\{u\}`/);
});
