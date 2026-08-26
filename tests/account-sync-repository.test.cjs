const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');

const root=path.join(__dirname,'..');
function load(){
  const window={crypto:webcrypto,btoa:value=>Buffer.from(value,'binary').toString('base64')};
  const context=vm.createContext({window,Uint8Array,unescape,encodeURIComponent,decodeURIComponent,structuredClone,console});
  for(const file of ['js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/data/accountSyncRepository.js'])vm.runInContext(readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  return window;
}
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
function resolveServerTimestamps(value,time){
  if(value&&typeof value==='object'&&!Array.isArray(value)&&value['.sv']==='timestamp'&&Object.keys(value).length===1)return time;
  if(Array.isArray(value))return value.map(item=>resolveServerTimestamps(item,time));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,resolveServerTimestamps(item,time)]));
  return value;
}
function repositoryFixture(window,{transactionTimestampOffset=0}={}){
  let current=null,serverTime=50_000,serverTimestampCalls=0,transactionCalls=0,getCalls=0,lastProposed=null,lastTransactionValue=null;
  const snapshot=value=>({exists:()=>value!=null,val:()=>clone(value)});
  const repository=window.PogoData.accountSyncRepository.createAccountSyncRepository({
    database:{},ownerUid:'uid-owner',clock:()=>1,
    ref:(_database,target)=>target,get:async()=>{getCalls++;return snapshot(current);},onValue:()=>()=>{},
    serverTimestamp:()=>{serverTimestampCalls++;return{'.sv':'timestamp'};},
    runTransaction:async(_target,update)=>{
      transactionCalls++;lastProposed=update(clone(current));
      if(lastProposed===undefined)return{committed:false,snapshot:snapshot(current)};
      current=resolveServerTimestamps(lastProposed,++serverTime);lastTransactionValue=clone(current);
      if(transactionTimestampOffset&&lastTransactionValue){
        for(const field of ['createdAt','updatedAt','deletedAt'])if(Number.isSafeInteger(lastTransactionValue[field]))lastTransactionValue[field]+=transactionTimestampOffset;
      }
      return{committed:true,snapshot:snapshot(lastTransactionValue)};
    }
  });
  return{repository,get current(){return current;},get lastProposed(){return lastProposed;},get lastTransactionValue(){return lastTransactionValue;},get serverTimestampCalls(){return serverTimestampCalls;},get transactionCalls(){return transactionCalls;},get getCalls(){return getCalls;}};
}
async function operation(window,{kind='add',baseGeneration=0,generation=1,baseFieldRevisions={priority:0},patch={priority:'H'},operationId='op_0000000000000001'}={}){
  return window.PogoDomain.accountSyncModel.createOperation({
    ownerUid:'uid-owner',entityType:'tradeEntry',entityId:'te_WzEsInBvZ28tYWNjb3VudC10cmFkZS1lbnRyeSIsIm15LWxpc3QiLCJ3aXNobGlzdCIsInBva2Vtb246cGlrYWNodSJd',
    identity:{surface:'my-list',lane:'wishlist',catalogId:'pokemon:pikachu'},kind,baseGeneration,generation,baseFieldRevisions,patch,clientAt:1,operationId
  },{crypto:webcrypto});
}

test('repository replaces client-clock entity timestamps with one server timestamp per committed mutation',async()=>{
  const window=load(),fixture=repositoryFixture(window),created=await operation(window);assert.equal(created.ok,true);
  const first=await fixture.repository.applyOperation(created.value);assert.equal(first.ok,true);
  assert.deepEqual(fixture.lastProposed.createdAt,{'.sv':'timestamp'});assert.deepEqual(fixture.lastProposed.updatedAt,{'.sv':'timestamp'});
  assert.equal(fixture.lastProposed.createdAt,fixture.lastProposed.updatedAt);assert.equal(first.value.createdAt,50_001);assert.equal(first.value.updatedAt,50_001);

  const token=window.PogoDomain.accountSyncModel.fieldToken('priority'),patched=await operation(window,{kind:'patch',baseGeneration:1,generation:1,baseFieldRevisions:{priority:first.value.fieldRevisions[token]},patch:{priority:'M'},operationId:'op_0000000000000002'});
  const second=await fixture.repository.applyOperation(patched.value);assert.equal(second.ok,true);
  assert.equal(fixture.lastProposed.createdAt,50_001);assert.deepEqual(fixture.lastProposed.updatedAt,{'.sv':'timestamp'});
  assert.equal(second.value.updatedAt,50_002);assert.equal(second.value.values.priority,'M');
});

test('repository acknowledges the canonical readback instead of a transaction timestamp estimate',async()=>{
  const window=load(),fixture=repositoryFixture(window,{transactionTimestampOffset:-57}),created=await operation(window);
  const committed=await fixture.repository.applyOperation(created.value);
  assert.equal(committed.ok,true);assert.equal(fixture.getCalls,1);
  assert.equal(fixture.lastTransactionValue.revision,fixture.current.revision);
  assert.notEqual(fixture.lastTransactionValue.updatedAt,fixture.current.updatedAt);
  assert.deepEqual(committed.value,fixture.current);
  assert.equal(committed.value.createdAt,50_001);assert.equal(committed.value.updatedAt,50_001);
});

test('idempotent retry preserves the committed timestamp and does not request a new server timestamp',async()=>{
  const window=load(),fixture=repositoryFixture(window),created=await operation(window);await fixture.repository.applyOperation(created.value);
  const timestampCalls=fixture.serverTimestampCalls,before=clone(fixture.current),retried=await fixture.repository.applyOperation(created.value);
  assert.equal(retried.ok,true);assert.equal(retried.status,'idempotent');assert.equal(fixture.serverTimestampCalls,timestampCalls);assert.deepEqual(fixture.current,before);
});

test('account metadata initialization uses one server timestamp and preserves it on later updates',async()=>{
  const window=load(),fixture=repositoryFixture(window),first=await fixture.repository.updateMeta({ownerUid:'uid-owner',initialized:true,initializedAt:1,featureVersion:1});
  assert.equal(first.ok,true);assert.equal(first.value.initializedAt,50_001);assert.equal(first.value.updatedAt,50_001);
  assert.equal(fixture.lastProposed.initializedAt,fixture.lastProposed.updatedAt);
  const second=await fixture.repository.updateMeta({ownerUid:'uid-owner',initialized:true,initializedAt:999,featureVersion:1});
  assert.equal(second.ok,true);assert.equal(second.value.initializedAt,50_001);assert.equal(second.value.updatedAt,50_002);
});

test('invalid create-only evidence IDs fail before any parent-path transaction',async()=>{
  const window=load(),fixture=repositoryFixture(window),before=fixture.transactionCalls;
  const migration=await fixture.repository.createMigration({ownerUid:'uid-owner',deviceMigrationId:'../bad'});
  const candidate=await fixture.repository.createRecoveryCandidate({ownerUid:'uid-owner',candidateId:''});
  assert.equal(migration.ok,false);assert.equal(migration.error.code,'account-sync/migration-id-invalid');
  assert.equal(candidate.ok,false);assert.equal(candidate.error.code,'account-sync/recovery-candidate-id-invalid');
  assert.equal(fixture.transactionCalls,before);
});
