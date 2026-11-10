'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({window:{crypto:globalThis.crypto},structuredClone,crypto:globalThis.crypto});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/domain/backgroundPersistence.js'),'utf8'),context);
const {createTransitions}=context.window.BackgroundTransitions;
const copy=value=>structuredClone(value);

function fixture(direction='background',snapshot={}){
  const uid='owner',session={uid,generation:1},journal=new Map(),receipts=new Map();
  const storage={getItem:key=>journal.get(key)||null,setItem:(key,value)=>journal.set(key,value),removeItem:key=>journal.delete(key)};
  const source={entityId:'plain',generation:1,revision:1,deleted:false,values:{note:'Keep me'}};
  const row={catalogId:'pokemon:383:standard:legacy:Groudon',backgroundId:'lc-go-fest-2026-tokyo',priority:'H',note:'Keep me',gender:'',variant:'',shiny:true,lucky:false,xxl:false,xxs:false,quantity:1};
  const entities=new Map(direction==='background'?[[source.entityId,copy(source)]]:[]);
  let pool={head:direction==='background'?0:1,entries:direction==='background'?[]:[copy(row)],pending:null};
  const state={state:'review-required',active:true,listenerHealthy:true,controllerHealthy:true,lastError:'',pendingCount:0,blockedCount:0,conflictCount:0,unsafeBlockedCount:0,recoveryCandidateCount:10,...snapshot};
  let mutations=0,finished=0,denial='';
  const background={snapshot:()=>copy(pool),hydrate:async()=>({ok:true}),flush:async()=>({ok:true}),replace:async(entries,{operationId})=>{pool={head:pool.head+1,entries:copy(entries),pending:null};receipts.set('r'+pool.head,{opId:operationId});return{ok:true};}};
  const canonical={snapshot:async()=>copy(state),drain:async()=>{},get:id=>copy(entities.get(id)),backgroundReceipt:async revision=>receipts.get(revision),resolveGuard:async()=>{},finished:async()=>{finished++;},
    retire:async(value,id)=>{if(denial)return{ok:false,error:{code:denial}};mutations++;entities.set(value.entityId,{...copy(value),deleted:true,revision:value.revision+1,lifecycleMutation:id});return{ok:true};},
    create:async(op,id)=>{if(denial)return{ok:false,error:{code:denial}};mutations++;entities.set(op.targetId,{entityId:op.targetId,generation:1,revision:op.targetRevision+1,deleted:false,values:copy(op.values),lifecycleMutation:id});return{ok:true};}
  };
  const options={uid,storage,currentSession:()=>session,background,canonical};
  const plan=direction==='background'?{direction,source,target:row}:{direction,source:row,targetId:'plain',identity:{catalogId:row.catalogId,surface:'my-list',lane:'wishlist'},values:{note:row.note}};
  return{open:()=>createTransitions(options),plan,source,row,state,entities,session,background,journal,deny:code=>{denial=code;},mutations:()=>mutations,finished:()=>finished};
}

for(const direction of ['background','plain']){
  test(`${direction} conversion finishes with healthy unrelated preserved reviews`,async()=>{
    const f=fixture(direction),transition=f.open();
    assert.equal((await transition.start(f.plan)).ok,true);
    assert.equal(transition.snapshot(),null);
    assert.equal(f.state.recoveryCandidateCount,10,'conversion must not accept or discard older evidence');
    assert.equal(f.entities.get('plain').deleted,direction==='background');
    assert.equal(f.background.snapshot().entries.length,direction==='background'?1:0);
    assert.equal(f.mutations(),1);assert.equal(f.finished(),1);
  });
  test(`${direction} saved conversion remains supported`,async()=>{
    const f=fixture(direction,{state:'saved',recoveryCandidateCount:0});
    assert.equal((await f.open().start(f.plan)).ok,true);
  });
  test(`${direction} durable draft resumes after restart without repeating canonical mutation`,async()=>{
    const f=fixture(direction,{pendingCount:1});
    assert.equal((await f.open().start(f.plan)).code,'canonical-pending');
    assert.equal(f.open().snapshot().direction,direction);assert.equal(f.mutations(),1);
    f.state.pendingCount=0;
    const reopened=f.open();assert.equal((await reopened.resume()).ok,true);
    assert.equal(reopened.snapshot(),null);assert.equal(f.mutations(),1);assert.equal(f.finished(),1);
  });
  for(const [name,blocked]of Object.entries({pending:{pendingCount:1},blocked:{blockedCount:1},conflict:{conflictCount:1},unsafe:{unsafeBlockedCount:1},inactive:{active:false},listener:{listenerHealthy:false},controller:{controllerHealthy:false},error:{lastError:'account-sync/listener-failed'},offline:{state:'offline'},unknown:{state:'unknown'}})){
    test(`${direction} conversion keeps recovery journal while ${name}`,async()=>{
      const f=fixture(direction,blocked),transition=f.open();
      assert.equal((await transition.start(f.plan)).code,'canonical-pending');
      assert.ok(transition.snapshot());assert.equal(f.finished(),0);
      if(direction==='plain')assert.equal(f.background.snapshot().entries.length,1,'do not retire background before canonical target is ready');
    });
  }
  test(`${direction} overlapping item review still refuses the canonical mutation`,async()=>{
    const f=fixture(direction),transition=f.open();f.deny('account-sync/entity-review-required');
    assert.equal((await transition.start(f.plan)).code,'account-sync/entity-review-required');
    assert.ok(transition.snapshot());assert.equal(f.mutations(),0);assert.equal(f.finished(),0);
    if(direction==='background')assert.deepEqual(f.entities.get('plain'),f.source);
    else assert.deepEqual(f.background.snapshot().entries,[f.row]);
  });
}

test('resuming does not accept a source retired by another operation',async()=>{
  const f=fixture('background',{pendingCount:1});await f.open().start(f.plan);
  f.state.pendingCount=0;f.entities.get('plain').lifecycleMutation='different-operation';
  assert.equal((await f.open().resume()).code,'source-changed');assert.ok(f.open().snapshot());
});
test('resuming does not accept a target created by another operation',async()=>{
  const f=fixture('plain',{pendingCount:1});await f.open().start(f.plan);
  f.state.pendingCount=0;f.entities.get('plain').lifecycleMutation='different-operation';
  assert.equal((await f.open().resume()).code,'target-collision');assert.equal(f.background.snapshot().entries.length,1);
});
for(const choice of ['original','both'])test(`review-only state permits explicit ${choice} recovery without changing preserved evidence`,async()=>{
  const f=fixture();f.deny('account-sync/entity-review-required');await f.open().start(f.plan);
  assert.equal((await f.open().resolve(choice)).ok,true);
  assert.deepEqual(f.entities.get('plain'),f.source);assert.equal(f.state.recoveryCandidateCount,10);
  assert.equal(f.background.snapshot().entries.length,choice==='original'?0:1);
  assert.equal(f.open().snapshot(),null);assert.equal(f.mutations(),0);
});
