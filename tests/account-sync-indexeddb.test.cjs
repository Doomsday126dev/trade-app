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
  assert.deepEqual(after.otherSnapshot,{ownerUid:'uid-owner-b',pendingCount:0,blockedCount:0,blockedErrorCode:'',conflictCount:0,entityCount:0,recoveryCandidateCount:0});
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

test('a pre-.70 committed-entity acknowledgement block survives reload and reconciles idempotently under current source',async t=>{
  const server=http.createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<!doctype html><title>Historical account sync recovery</title>');});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage(),databaseName=`pogoAccountSync_historical_${Date.now()}`,url=`http://127.0.0.1:${server.address().port}/`;
  const load=async files=>{for(const file of files)await page.addScriptTag({path:path.join(root,file)});};
  await page.goto(url,{waitUntil:'domcontentloaded'});await load(['js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/data/accountSyncJournal.js']);
  const retained=await page.evaluate(async databaseName=>{
    const model=window.PogoDomain.accountSyncModel,merge=window.PogoDomain.accountSyncMerge,journal=window.PogoData.accountSyncJournal.createAccountSyncJournal({ownerUid:'uid-owner',databaseName});
    const identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:960:base'},entityId=model.tradeEntryId(identity);
    const operation=(await model.createOperation({operationId:'op_0000000000006900',ownerUid:'uid-owner',entityType:'tradeEntry',entityId,identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},patch:{priority:'H'},clientAt:69})).value;
    const optimistic=merge.mergeOperation(null,operation,{acceptedAt:69}).value;
    await journal.enqueueOperation(operation,optimistic);await journal.markAttempt(operation.operationId,{retryable:false,errorCode:'account-sync/committed-entity-invalid'});
    const snapshot=await journal.snapshot();await journal.close();return{operation,entityId,snapshot};
  },databaseName);
  assert.equal(retained.snapshot.blockedCount,1);assert.equal(retained.snapshot.blockedErrorCode,'account-sync/committed-entity-invalid');assert.equal(retained.snapshot.pendingCount,0);

  await page.reload({waitUntil:'domcontentloaded'});await load(['js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/data/accountSyncJournal.js','js/data/accountSyncController.js']);
  const recovered=await page.evaluate(async({databaseName,operation})=>{
    const merge=window.PogoDomain.accountSyncMerge,journal=window.PogoData.accountSyncJournal.createAccountSyncJournal({ownerUid:'uid-owner',databaseName}),canonical=merge.mergeOperation(null,operation,{acceptedAt:700}).value;
    let applyCalls=0,unsubscribed=0;
    const repository={
      ownerUid:'uid-owner',
      listenAccount({onData}){queueMicrotask(()=>onData({tradeEntries:{[canonical.entityId]:canonical}}));return()=>{unsubscribed++;};},
      async applyOperation(replayed){applyCalls++;assertSame(replayed.operationId,operation.operationId);return{ok:true,status:'idempotent',value:canonical};}
    };
    function assertSame(actual,expected){if(actual!==expected)throw new Error('historical operation identity changed');}
    const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>true,clock:(()=>{let value=800;return()=>++value;})(),crypto:window.crypto});
    await controller.activate();await new Promise(resolve=>setTimeout(resolve,0));
    const before=await controller.snapshot(),result=await controller.retryBlocked(),after=await controller.snapshot(),acknowledged=await journal.listOperations({statuses:['acknowledged']}),active=controller.activeEntities('tradeEntry')[0];
    await controller.deactivate();await journal.close();
    await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(databaseName);request.onsuccess=resolve;request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('test database deletion blocked'));});
    return{before,result,after,applyCalls,unsubscribed,acknowledged:acknowledged.length,priority:active?.values?.priority||''};
  },{databaseName,operation:retained.operation});
  assert.equal(recovered.before.state,'sync-error');assert.equal(recovered.before.blockedCount,1);assert.equal(recovered.before.lastError,'account-sync/committed-entity-invalid');
  assert.equal(recovered.result.ok,true);assert.equal(recovered.result.retried,1);assert.equal(recovered.applyCalls,1);assert.equal(recovered.acknowledged,1);
  assert.equal(recovered.after.state,'saved');assert.equal(recovered.after.blockedCount,0);assert.equal(recovered.after.lastError,'');assert.equal(recovered.after.listenerHealthy,true);assert.equal(recovered.priority,'H');assert.equal(recovered.unsubscribed,1);
});
