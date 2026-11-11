'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({structuredClone,crypto:require('node:crypto').webcrypto});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/domain/backgroundPersistence.js'),'utf8'),context);
const {createProtocol}=context.BackgroundProtocol;
const {createRepository}=context.BackgroundRepository;
const {createEditorAdapter}=context.BackgroundEditorAdapter;
const clone=value=>structuredClone(value);
const token='bgs_'+'a'.repeat(32),root='backgroundStores/'+token;
const catalogId='pokemon:25:standard:legacy:Pikachu';
const journalKey='background-journal-v1:owner:'+token;
const value=(backgroundId,overrides={})=>({catalogId,backgroundId,p:'H',mod:'',gender:'',note:'Keep this note',shiny:false,lucky:false,xxl:false,xxs:false,qty:1,...overrides});
const row=(backgroundId,overrides={})=>({catalogId,backgroundId,priority:'H',variant:'',gender:'',note:'Keep this note',shiny:false,lucky:false,xxl:false,xxs:false,quantity:1,...overrides});
const three=()=>['bg-a','bg-b','bg-c'].map(id=>value(id));
const result=actual=>clone(actual);
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}

// All owner data and transport are synthetic. Exercise the production protocol,
// repository, and adapter together without Firebase or a live account.
function fixture({entries=[],head=entries.length?1:0,isEligible=()=>true}={}){
  const store={head,snapshots:head?{['r'+head]:{entriesJson:JSON.stringify(entries)}}:{},snapshotSlots:head?{a:'r'+head}:{},published:{}};
  const journal=new Map(),journalWrites=[],requests=[];
  const session={uid:'owner',generation:1};
  const controls={patch:'success',releaseDenied:false,beforePatch:null,afterPatch:null};
  let replaceCalls=0;
  journal.set(journalKey,JSON.stringify({head,entries,pending:null}));
  const storage={getItem:key=>journal.get(key)||null,setItem:(key,data)=>{journalWrites.push(JSON.parse(data));journal.set(key,data);}};
  const read=relative=>relative.split('/').reduce((node,key)=>node?.[key],store)??null;
  const put=(relative,data)=>{const parts=relative.split('/'),last=parts.pop();let node=store;for(const part of parts)node=node[part]??={};if(data===null)delete node[last];else node[last]=clone(data);};
  const db=async(method,target,data)=>{
    assert.ok(target.startsWith(root+'/')||target===root);
    requests.push({method,target,data:clone(data)});
    const relative=target.slice(root.length+1);
    if(method==='GET')return{status:200,value:clone(read(relative))};
    if(method==='DELETE'){if(controls.releaseDenied)return{status:403};put(relative,null);return{status:200};}
    assert.equal(method,'PATCH');assert.equal(target,root);
    if(controls.beforePatch)await controls.beforePatch();
    if(controls.patch==='offline')throw Error('offline');
    if(controls.patch==='denied')return{status:403};
    for(const [key,v]of Object.entries(data))put(key,v);
    if(controls.afterPatch)await controls.afterPatch();
    if(controls.patch==='lost-response')throw Error('receipt-lost');
    return{status:200};
  };
  const protocol=createProtocol({token,db,bounded:true,isEligible});
  const open=()=>{
    const repository=createRepository({uid:'owner',token,protocol,readHead:async()=>store.head,storage,currentSession:()=>({...session})});
    const observed={...repository,replace:async(...args)=>{replaceCalls++;return repository.replace(...args);}};
    const adapter=createEditorAdapter({repository:observed,uid:'owner',currentUid:()=>session.uid,catalogForId:id=>({name:id===catalogId?'Pikachu':'Other',category:'wishlist'})});
    return{repository,adapter};
  };
  return{...open(),open,store,journal,journalWrites,requests,session,controls,protocol,replaceCalls:()=>replaceCalls,patches:()=>requests.filter(r=>r.method==='PATCH'),remoteRows:()=>JSON.parse(store.snapshots['r'+store.head].entriesJson)};
}

test('three backgrounds append in one replace, one durable operation, and one snapshot revision',async()=>{
  const existing=row('bg-existing',{priority:'L',note:'Original',quantity:4,mirror:true,sortOrder:8,plainIdentity:{surface:'my-list',lane:'wishlist',catalogId}});
  const f=fixture({entries:[existing]});
  const selected=three().map(v=>({...v,p:'M',shiny:true,qty:3,mirror:true,sortOrder:9}));
  const before=clone(selected);
  assert.deepEqual(result(await f.adapter.addMany('owner',selected)),{added:3,skipped:0});
  assert.deepEqual(selected,before,'caller values stay untouched');
  assert.equal(f.replaceCalls(),1);assert.equal(f.patches().length,1);assert.equal(f.store.head,2);
  const intents=f.journalWrites.filter(s=>s.pending);
  assert.equal(intents.length,1);assert.equal(intents[0].pending.base,1);assert.ok(intents[0].pending.opId);
  assert.equal(intents[0].pending.entries.length,4);assert.equal(f.repository.snapshot().pending,null);
  assert.deepEqual(f.remoteRows(),[existing,...['bg-a','bg-b','bg-c'].map(id=>row(id,{priority:'M',shiny:true,quantity:3,mirror:true,sortOrder:9}))]);
  assert.equal(f.adapter.list('owner').length,4);
});

test('exact duplicates are skipped without changing metadata and repeated selections keep the first new record',async()=>{
  const existing=row('bg-a',{priority:'L',note:'Saved metadata',quantity:7,mirror:true,sortOrder:12,plainIdentity:{surface:'my-list',lane:'wishlist',catalogId}});
  const f=fixture({entries:[existing]});
  const selected=[value('bg-a',{p:'H',note:'Must not replace',qty:1,mirror:false,sortOrder:0}),value('bg-b',{p:'M',note:'First selected',qty:2}),value('bg-b',{p:'L',note:'Repeated selection',qty:9}),value('bg-c')];
  assert.deepEqual(result(await f.adapter.addMany('owner',selected)),{added:2,skipped:2});
  assert.equal(f.replaceCalls(),1);
  assert.deepEqual(f.remoteRows(),[existing,row('bg-b',{priority:'M',note:'First selected',quantity:2}),row('bg-c')]);
});

test('all eight protocol identity fields distinguish variants without merging normal and shiny entries',async()=>{
  const f=fixture({entries:[row('bg-a')]});
  const distinct=[{catalogId:'pokemon:26:standard:legacy:Raichu'},{backgroundId:'bg-b'},{shiny:true},{gender:'f'},{mod:'female'},{lucky:true},{xxl:true},{xxs:true}];
  const selected=[value('bg-a'),...distinct.map(fields=>value('bg-a',fields))];
  assert.deepEqual(result(await f.adapter.addMany('owner',selected)),{added:8,skipped:1});
  assert.equal(f.remoteRows().length,9);assert.equal(f.store.head,2);assert.equal(f.patches().length,1);
  assert.equal(f.protocol.validate(f.remoteRows()).length,9);
});

for(const name of ['empty','already saved'])test(`${name} selection is a no-op with no revision, journal, or network write`,async()=>{
  const f=fixture({entries:[row('bg-a')]});const before=f.journal.get(journalKey);
  assert.deepEqual(result(await f.adapter.addMany('owner',name==='empty'?[]:[value('bg-a'),value('bg-a')])),{added:0,skipped:name==='empty'?0:2});
  assert.equal(f.replaceCalls(),0);assert.equal(f.requests.length,0);assert.equal(f.journalWrites.length,0);
  assert.equal(f.store.head,1);assert.equal(f.journal.get(journalKey),before);
});

for(const [name,invalid]of Object.entries({note:{note:'x'.repeat(501)},priority:{p:'INVALID'},quantity:{qty:1000},gender:{gender:'invalid'},variant:{mod:'x'.repeat(161)},mirror:{mirror:'yes'},sortOrder:{sortOrder:-1},plainIdentity:{plainIdentity:{surface:'my-list',lane:'wishlist',catalogId:'wrong'}}}))test(`invalid ${name} anywhere in a batch rejects before journaling or dispatch`,async()=>{
  const f=fixture({entries:[row('bg-existing')]});
  const before=f.journal.get(journalKey);
  await assert.rejects(f.adapter.addMany('owner',[...three(),value('bg-invalid',invalid)]),/invalid-record/);
  assert.equal(f.journal.get(journalKey),before);assert.equal(f.journalWrites.length,0);assert.equal(f.requests.length,0);
  assert.deepEqual(f.remoteRows(),[row('bg-existing')]);
});

for(const selected of [null,{},'bg-a'])test(`non-array batch input ${JSON.stringify(selected)} cannot mutate the repository`,async()=>{
  const f=fixture();await assert.rejects(f.adapter.addMany('owner',selected),/invalid-records/);
  assert.equal(f.journalWrites.length,0);assert.equal(f.requests.length,0);
});

for(const invalid of [null,undefined,[],false,'bg-invalid'])test(`invalid candidate ${JSON.stringify(invalid)} rejects the entire batch`,async()=>{
  const f=fixture();await assert.rejects(f.adapter.addMany('owner',[...three(),invalid]),/invalid-record/);
  assert.equal(f.journalWrites.length,0);assert.equal(f.requests.length,0);
});

test('invalid exact duplicates are validated even when they would otherwise be skipped',async()=>{
  const f=fixture({entries:[row('bg-a')]});
  await assert.rejects(f.adapter.addMany('owner',[value('bg-b'),value('bg-a',{note:'x'.repeat(501)})]),/invalid-record/);
  await assert.rejects(f.adapter.addMany('owner',[value('bg-b'),value('bg-b',{qty:1000})]),/invalid-record/);
  assert.equal(f.replaceCalls(),0);assert.equal(f.journalWrites.length,0);assert.equal(f.requests.length,0);
});

test('eligibility validation rejects the whole batch before creating a local intent',async()=>{
  const f=fixture({isEligible:r=>r.backgroundId!=='bg-ineligible'});
  await assert.rejects(f.adapter.addMany('owner',[...three(),value('bg-ineligible')]),/invalid-record/);
  assert.equal(f.journalWrites.length,0);assert.equal(f.requests.length,0);
});

test('record capacity is checked for the final deduplicated collection before any mutation',async()=>{
  const entries=Array.from({length:998},(_,i)=>row('bg-'+i));const f=fixture({entries});
  await assert.rejects(f.adapter.addMany('owner',[value('bg-0'),...three()]),/invalid-records/);
  assert.equal(f.store.head,1);assert.equal(f.journalWrites.length,0);assert.equal(f.requests.length,0);
  assert.deepEqual(result(await f.adapter.addMany('owner',[value('bg-0'),value('bg-a'),value('bg-b'),value('bg-a')])),{added:2,skipped:2});
  assert.equal(f.remoteRows().length,1000);assert.equal(f.store.head,2);assert.equal(f.patches().length,1);
});

for(const [mode,code]of [['offline','transport-unknown'],['denied','conflict-or-denied']])test(`${mode} preserves the entire draft; retry reuses one operation and commits every entry together`,async()=>{
  const f=fixture({entries:[row('bg-existing')]});f.controls.patch=mode;
  await assert.rejects(f.adapter.addMany('owner',three()),error=>error.code===code);
  assert.deepEqual(f.remoteRows(),[row('bg-existing')]);assert.equal(f.store.head,1);
  const pending=f.repository.snapshot().pending;assert.equal(pending.entries.length,4);assert.equal(pending.base,1);
  assert.deepEqual(f.open().repository.snapshot().pending,pending);
  await assert.rejects(f.adapter.addMany('owner',[value('bg-later')]),/pending-intent/);
  f.controls.patch='success';const reopened=f.open();assert.equal((await reopened.repository.flush()).ok,true);
  assert.equal(f.store.head,2);assert.equal(f.remoteRows().length,4);assert.equal(reopened.repository.snapshot().pending,null);
  assert.equal(f.patches().length,2);assert.equal(f.patches()[0].data['snapshots/r2'].opId,f.patches()[1].data['snapshots/r2'].opId);
  assert.deepEqual(result(await reopened.adapter.addMany('owner',three())),{added:0,skipped:3});
  assert.equal(f.patches().length,2);
});

test('uncertain commit is recovered by the exact receipt after restart without appending or dispatching twice',async()=>{
  const f=fixture();f.controls.patch='lost-response';
  await assert.rejects(f.adapter.addMany('owner',three()),error=>error.code==='transport-unknown');
  assert.equal(f.store.head,1);assert.equal(f.remoteRows().length,3);assert.equal(f.repository.snapshot().entries.length,0);
  const pending=f.repository.snapshot().pending;assert.equal(pending.entries.length,3);
  f.controls.patch='success';const reopened=f.open();assert.deepEqual(result(await reopened.repository.flush()),{ok:true,recovered:true});
  assert.equal(f.patches().length,1);assert.equal(reopened.repository.snapshot().pending,null);
  assert.deepEqual(result(await reopened.adapter.addMany('owner',three())),{added:0,skipped:3});
  assert.equal(f.patches().length,1);assert.equal(f.store.head,1);
});

test('an identical remote collection with another operation receipt remains a conflict',async()=>{
  const f=fixture();f.controls.patch='lost-response';await assert.rejects(f.adapter.addMany('owner',three()),/transport-unknown/);
  const pending=f.repository.snapshot().pending;f.store.snapshots.r1.opId='another-operation';
  const reopened=f.open();assert.deepEqual(result(await reopened.repository.flush()),{ok:false,code:'conflict',pending:true});
  assert.deepEqual(reopened.repository.snapshot().pending,pending);assert.equal(f.patches().length,1);
});

test('a stale collection retains the whole batch for review without overwriting remote entries',async()=>{
  const f=fixture({entries:[row('bg-existing')]});
  f.store.head=2;f.store.snapshots.r2={entriesJson:JSON.stringify([row('bg-remote')]),opId:'remote-operation'};f.store.snapshotSlots.b='r2';
  await assert.rejects(f.adapter.addMany('owner',three()),error=>error.code==='conflict');
  assert.equal(f.patches().length,0);assert.deepEqual(f.remoteRows(),[row('bg-remote')]);
  assert.deepEqual(f.repository.snapshot().pending.entries,[row('bg-existing'),...three().map(v=>row(v.backgroundId))]);
});

test('bounded snapshot capacity preserves every selected entry and retries atomically when a slot is available',async()=>{
  const f=fixture({entries:[row('bg-existing')],head:3});
  f.store.snapshotSlots={a:'r1',b:'r2',c:'r3'};f.controls.releaseDenied=true;
  await assert.rejects(f.adapter.addMany('owner',three()),error=>error.code==='background-capacity');
  assert.equal(f.patches().length,0);assert.equal(f.repository.snapshot().pending.entries.length,4);
  assert.deepEqual(f.remoteRows(),[row('bg-existing')]);
  f.controls.releaseDenied=false;assert.equal((await f.repository.flush()).ok,true);
  assert.equal(f.store.head,4);assert.equal(f.remoteRows().length,4);assert.equal(f.patches().length,1);
  assert.equal(Object.keys(f.store.snapshotSlots).length,3);
});

test('pending drafts block new, duplicate-only, and empty batch calls without replacing their journal',async()=>{
  const f=fixture({entries:[row('bg-existing')]});f.controls.patch='offline';
  await assert.rejects(f.adapter.addMany('owner',three()),/transport-unknown/);const before=f.journal.get(journalKey);
  for(const selected of [[value('bg-next')],[value('bg-existing')],[]])await assert.rejects(f.adapter.addMany('owner',selected),/pending-intent/);
  assert.equal(f.journal.get(journalKey),before);assert.equal(f.replaceCalls(),1);assert.equal(f.patches().length,1);
});

for(const changed of ['owner','uid','generation'])test(`${changed} changes reject even a no-op batch without writing`,async()=>{
  const f=fixture({entries:[row('bg-a')]});
  if(changed==='uid')f.session.uid='other';if(changed==='generation')f.session.generation++;
  for(const selected of [three(),[value('bg-a')],[]])await assert.rejects(f.adapter.addMany(changed==='owner'?'other':'owner',selected),/session-changed/);
  assert.equal(f.journalWrites.length,0);assert.equal(f.requests.length,0);assert.equal(f.replaceCalls(),0);
});

test('session change during a committed save cannot claim success or clear the original owner draft',async()=>{
  const f=fixture();const entered=deferred(),release=deferred();
  f.controls.afterPatch=async()=>{entered.resolve();await release.promise;};
  const saving=f.adapter.addMany('owner',three());await entered.promise;
  f.session.uid='other';f.session.generation++;release.resolve();await assert.rejects(saving,/session-changed/);
  assert.equal(f.store.head,1);assert.equal(f.remoteRows().length,3);assert.equal(f.repository.snapshot().pending.entries.length,3);
  await assert.rejects(f.repository.flush(),/session-changed/);
  f.session.uid='owner';const reopened=f.open();assert.deepEqual(result(await reopened.repository.flush()),{ok:true,recovered:true});
  assert.equal(f.patches().length,1);assert.equal(reopened.repository.snapshot().pending,null);
});

test('concurrent batch submissions cannot replace the first in-flight batch',async()=>{
  const f=fixture();const entered=deferred(),release=deferred();
  f.controls.beforePatch=async()=>{entered.resolve();await release.promise;};
  const saving=f.adapter.addMany('owner',three());await entered.promise;
  await assert.rejects(f.adapter.addMany('owner',[value('bg-later')]),/pending-intent/);
  release.resolve();assert.deepEqual(result(await saving),{added:3,skipped:0});
  assert.equal(f.replaceCalls(),1);assert.equal(f.patches().length,1);assert.deepEqual(f.remoteRows(),three().map(v=>row(v.backgroundId)));
});

test('single-record save still rejects duplicates and enforces stale edit revisions',async()=>{
  const f=fixture({entries:[row('bg-a')]});const existing=f.adapter.list('owner')[0];
  await assert.rejects(f.adapter.save('owner',value('bg-a'),{}),/duplicate/);
  await assert.rejects(f.adapter.save('owner',value('bg-a',{note:'Edited'}),{expectedKey:existing.key,expectedRevision:0}),/stale-entry/);
  assert.equal(f.replaceCalls(),0);
  await f.adapter.save('owner',value('bg-a',{note:'Edited',p:'L'}),{expectedKey:existing.key,expectedRevision:1});
  assert.deepEqual(f.remoteRows(),[row('bg-a',{note:'Edited',priority:'L'})]);assert.equal(f.store.head,2);
});
