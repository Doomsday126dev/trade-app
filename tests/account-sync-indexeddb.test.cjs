const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');

const root=path.join(__dirname,'..');

test('the real IndexedDB journal survives reload, isolates owners, and keeps conflicts non-retryable',async t=>{
  const server=http.createServer((_request,response)=>{
    response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    response.end('<!doctype html><title>Account sync journal test</title>');
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage(),databaseName=`pogoAccountSync_test_${Date.now()}`;
  const loadScripts=async()=>{
    await page.addScriptTag({path:path.join(root,'js/domain/accountSyncModel.js')});
    await page.addScriptTag({path:path.join(root,'js/data/accountSyncJournal.js')});
  };
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});await loadScripts();
  const prepared=await page.evaluate(async databaseName=>{
    const model=window.PogoDomain.accountSyncModel,journal=window.PogoData.accountSyncJournal.createAccountSyncJournal({ownerUid:'uid-owner-a',databaseName});
    const identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:25:base'},entityId=model.tradeEntryId(identity);
    const make=async(operationId,catalogId)=>{
      const nextIdentity={...identity,catalogId},nextId=model.tradeEntryId(nextIdentity);
      return(await model.createOperation({schemaVersion:1,operationId,ownerUid:'uid-owner-a',entityType:'tradeEntry',entityId:nextId,identity:nextIdentity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},patch:{priority:'H'},clientAt:10})).value;
    };
    const pending=await make('op_0000000000001001','pokemon:25:base'),conflicted=await make('op_0000000000001002','pokemon:384:base');
    await journal.enqueueOperation(pending);await journal.enqueueOperation(conflicted);
    await journal.markConflict(conflicted.operationId,[{conflictId:`conflict_${conflicted.operationId}`,ownerUid:'uid-owner-a',entityType:'tradeEntry',entityId:conflicted.entityId,operationId:conflicted.operationId,generation:1,fields:['priority'],createdAt:10,resolved:false}]);
    const before=await journal.snapshot();await journal.close();return{before,pendingId:pending.operationId,conflictOperationId:conflicted.operationId,conflictRecordId:`conflict_${conflicted.operationId}`};
  },databaseName);
  assert.equal(prepared.before.pendingCount,1);assert.equal(prepared.before.conflictCount,1);

  await page.reload({waitUntil:'domcontentloaded'});await loadScripts();
  const after=await page.evaluate(async({databaseName,conflictOperationId,conflictRecordId})=>{
    const api=window.PogoData.accountSyncJournal,owner=api.createAccountSyncJournal({ownerUid:'uid-owner-a',databaseName}),other=api.createAccountSyncJournal({ownerUid:'uid-owner-b',databaseName});
    const ownerSnapshot=await owner.snapshot(),otherSnapshot=await other.snapshot(),retried=await owner.retryBlocked(conflictOperationId),conflictStatus=(await owner.listOperations({statuses:['conflict']}))[0]?.status,resolved=await owner.resolveConflict(conflictRecordId),resolvedStatus=(await owner.listOperations({statuses:['resolved']}))[0]?.status,resolvedSnapshot=await owner.snapshot();
    await owner.close();await other.close();
    await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(databaseName);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('test database deletion blocked'));});
    return{ownerSnapshot,otherSnapshot,retried,conflictStatus,resolved,resolvedStatus,resolvedSnapshot};
  },{databaseName,conflictOperationId:prepared.conflictOperationId,conflictRecordId:prepared.conflictRecordId});
  assert.equal(after.ownerSnapshot.pendingCount,1);assert.equal(after.ownerSnapshot.conflictCount,1);
  assert.deepEqual(after.otherSnapshot,{ownerUid:'uid-owner-b',pendingCount:0,blockedCount:0,conflictCount:0,entityCount:0,recoveryCandidateCount:0});
  assert.equal(after.retried,false);assert.equal(after.conflictStatus,'conflict');assert.equal(after.resolved,true);assert.equal(after.resolvedStatus,'resolved');assert.equal(after.resolvedSnapshot.conflictCount,0);
});

test('the real IndexedDB journal commits operation batches and optimistic entities atomically',async t=>{
  const server=http.createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><title>Atomic journal</title>');});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage(),databaseName=`pogoAccountSync_atomic_${Date.now()}`;
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
  await page.addScriptTag({path:path.join(root,'js/domain/accountSyncModel.js')});await page.addScriptTag({path:path.join(root,'js/domain/accountSyncMerge.js')});await page.addScriptTag({path:path.join(root,'js/data/accountSyncJournal.js')});
  const result=await page.evaluate(async databaseName=>{
    const model=window.PogoDomain.accountSyncModel,merge=window.PogoDomain.accountSyncMerge,journal=window.PogoData.accountSyncJournal.createAccountSyncJournal({ownerUid:'uid-owner',databaseName});
    const make=async(catalogId,operationId)=>{const identity={surface:'my-list',lane:'wishlist',catalogId},entityId=model.tradeEntryId(identity),operation=(await model.createOperation({operationId,ownerUid:'uid-owner',entityType:'tradeEntry',entityId,identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},patch:{priority:'H'},clientAt:10})).value;return{operation,entity:merge.mergeOperation(null,operation,{acceptedAt:10}).value};};
    const a=await make('pokemon:380:base','op_0000000000002001'),b=await make('pokemon:381:base','op_0000000000002002');
    await journal.enqueueOperations([a.operation,b.operation],[a.entity,b.entity]);const snapshot=await journal.snapshot();await journal.close();
    const reopened=window.PogoData.accountSyncJournal.createAccountSyncJournal({ownerUid:'uid-owner',databaseName}),operations=await reopened.listOperations({statuses:['pending']}),entities=await reopened.listEntities();await reopened.close();
    await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(databaseName);request.onsuccess=resolve;request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('test database deletion blocked'));});
    return{snapshot,operationCount:operations.length,entityCount:entities.length};
  },databaseName);
  assert.equal(result.snapshot.pendingCount,2);assert.equal(result.snapshot.entityCount,2);assert.equal(result.operationCount,2);assert.equal(result.entityCount,2);
});
