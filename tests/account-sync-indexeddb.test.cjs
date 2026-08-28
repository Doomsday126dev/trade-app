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
  assert.deepEqual(after.otherSnapshot,{ownerUid:'uid-owner-b',pendingCount:0,blockedCount:0,recoverableBlockedCount:0,unsafeBlockedCount:0,blockedCategories:[],blockedErrorCode:'',conflictCount:0,entityCount:0,recoveryCandidateCount:0});
  assert.equal(after.retried,false);assert.equal(after.conflictStatus,'conflict');assert.equal(after.resolved,true);assert.equal(after.resolvedStatus,'resolved');assert.equal(after.resolvedSnapshot.conflictCount,0);
});

test('reviewed recovery evidence remains preserved locally without keeping the account in review-required',async t=>{
  const server=http.createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<!doctype html><title>Recovery review persistence</title>');});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage(),databaseName=`pogoAccountSync_reviewed_${Date.now()}`,url=`http://127.0.0.1:${server.address().port}/`;
  const load=async()=>{await page.addScriptTag({path:path.join(root,'js/domain/accountSyncModel.js')});await page.addScriptTag({path:path.join(root,'js/data/accountSyncJournal.js')});};
  await page.goto(url,{waitUntil:'domcontentloaded'});await load();
  const prepared=await page.evaluate(async databaseName=>{
    const journal=window.PogoData.accountSyncJournal.createAccountSyncJournal({ownerUid:'uid-owner',databaseName}),candidateId=`candidate_${'a'.repeat(64)}`;
    await journal.putRecoveryCandidate({schemaVersion:1,ownerUid:'uid-owner',candidateId,reason:'favorite-uid-unresolved',entityType:'favorite',entityId:'unresolved:mazer',identity:{targetUidUnresolved:true},values:{displayName:'Mazer'},source:'favorite-add',createdAt:10,resolved:false});
    const before=await journal.snapshot(),resolved=await journal.resolveRecoveryCandidate(candidateId),after=await journal.snapshot(),unresolved=await journal.listRecoveryCandidates(),all=await journal.listRecoveryCandidates({unresolvedOnly:false});
    await journal.close();return{candidateId,before,resolved,after,unresolved,all};
  },databaseName);
  assert.equal(prepared.before.recoveryCandidateCount,1);assert.equal(prepared.resolved,true);assert.equal(prepared.after.recoveryCandidateCount,0);assert.equal(prepared.unresolved.length,0);
  assert.equal(prepared.all.length,1);assert.equal(prepared.all[0].resolved,true);assert.ok(prepared.all[0].resolvedAt>0);

  await page.reload({waitUntil:'domcontentloaded'});await load();
  const reopened=await page.evaluate(async({databaseName,candidateId})=>{
    const journal=window.PogoData.accountSyncJournal.createAccountSyncJournal({ownerUid:'uid-owner',databaseName}),snapshot=await journal.snapshot(),unresolved=await journal.listRecoveryCandidates(),all=await journal.listRecoveryCandidates({unresolvedOnly:false}),resolvedAgain=await journal.resolveRecoveryCandidate(candidateId);
    await journal.close();await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(databaseName);request.onsuccess=resolve;request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('test database deletion blocked'));});
    return{snapshot,unresolved,all,resolvedAgain};
  },{databaseName,candidateId:prepared.candidateId});
  assert.equal(reopened.snapshot.recoveryCandidateCount,0);assert.equal(reopened.unresolved.length,0);assert.equal(reopened.all.length,1);assert.equal(reopened.all[0].resolved,true);assert.equal(reopened.resolvedAgain,false);
});

test('the real IndexedDB journal resolves only the exact recovery review set in one transaction',async t=>{
  const server=http.createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<!doctype html><title>Atomic recovery review</title>');});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage(),databaseName=`pogoAccountSync_recovery_batch_${Date.now()}`,url=`http://127.0.0.1:${server.address().port}/`;
  const load=async()=>{await page.addScriptTag({path:path.join(root,'js/domain/accountSyncModel.js')});await page.addScriptTag({path:path.join(root,'js/data/accountSyncJournal.js')});};
  await page.goto(url,{waitUntil:'domcontentloaded'});await load();
  const prepared=await page.evaluate(async databaseName=>{
    const journal=window.PogoData.accountSyncJournal.createAccountSyncJournal({ownerUid:'uid-owner',databaseName}),ids=['a','b','c'].map(value=>`candidate_${value.repeat(64)}`);
    for(const [index,candidateId] of ids.entries())await journal.putRecoveryCandidate({schemaVersion:1,ownerUid:'uid-owner',candidateId,reason:'historical-device-value',entityType:'tradeEntry',entityId:`unresolved:${index}`,identity:{unresolved:true},values:{index},source:'owner-review',createdAt:10+index,resolved:false});
    let incompleteCode='',duplicateName='';
    try{await journal.resolveRecoveryCandidates(ids.slice(0,2));}catch(error){incompleteCode=error.code||'';}
    try{await journal.resolveRecoveryCandidates([ids[0],ids[0],ids[2]]);}catch(error){duplicateName=error.name;}
    const afterRejected=await journal.listRecoveryCandidates({unresolvedOnly:false}),resolved=await journal.resolveRecoveryCandidates(ids),after=await journal.listRecoveryCandidates({unresolvedOnly:false}),snapshot=await journal.snapshot();
    await journal.close();return{ids,incompleteCode,duplicateName,afterRejected,resolved,after,snapshot};
  },databaseName);
  assert.equal(prepared.incompleteCode,'account-sync/recovery-review-changed');assert.equal(prepared.duplicateName,'TypeError');assert.ok(prepared.afterRejected.every(item=>item.resolved!==true));
  assert.equal(prepared.resolved,3);assert.equal(prepared.snapshot.recoveryCandidateCount,0);assert.ok(prepared.after.every(item=>item.resolved===true));assert.equal(new Set(prepared.after.map(item=>item.resolvedAt)).size,1);

  await page.reload({waitUntil:'domcontentloaded'});await load();
  const reopened=await page.evaluate(async databaseName=>{
    const journal=window.PogoData.accountSyncJournal.createAccountSyncJournal({ownerUid:'uid-owner',databaseName}),all=await journal.listRecoveryCandidates({unresolvedOnly:false}),snapshot=await journal.snapshot();
    await journal.close();await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(databaseName);request.onsuccess=resolve;request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('test database deletion blocked'));});
    return{all,snapshot};
  },databaseName);
  assert.equal(reopened.all.length,3);assert.ok(reopened.all.every(item=>item.resolved===true));assert.equal(reopened.snapshot.recoveryCandidateCount,0);
});

test('real IndexedDB conflict acceptance publishes Saved before reporting success',async t=>{
  const server=http.createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<!doctype html><title>Account sync conflict acceptance</title>');});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage(),databaseName=`pogoAccountSync_conflict_acceptance_${Date.now()}`;
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
  for(const file of ['js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/data/accountSyncJournal.js','js/data/accountSyncController.js'])await page.addScriptTag({path:path.join(root,file)});
  const result=await page.evaluate(async databaseName=>{
    const model=window.PogoDomain.accountSyncModel,merge=window.PogoDomain.accountSyncMerge,journal=window.PogoData.accountSyncJournal.createAccountSyncJournal({ownerUid:'uid-owner',databaseName});
    const identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:960:base'},entityId=model.tradeEntryId(identity),operation=(await model.createOperation({operationId:'op_0000000000007203',ownerUid:'uid-owner',entityType:'tradeEntry',entityId,identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},patch:{priority:'L'},clientAt:10})).value,canonical=merge.mergeOperation(null,operation,{acceptedAt:20}).value,conflictId=`conflict_${operation.operationId}`;
    await journal.enqueueOperation(operation,canonical);await journal.markConflict(operation.operationId,[{conflictId,ownerUid:'uid-owner',entityType:'tradeEntry',entityId,operationId:operation.operationId,generation:1,code:'lifecycle-conflict',fields:[],createdAt:20,resolved:false}]);
    let applyCalls=0;const states=[],repository={ownerUid:'uid-owner',listenAccount({onData}){queueMicrotask(()=>onData({tradeEntries:{[entityId]:canonical}}));return()=>{};},async applyOperation(){applyCalls++;throw new Error('resolved conflicts must not be resent');}};
    const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>true,onState:state=>states.push(state),clock:(()=>{let value=30;return()=>++value;})(),crypto:window.crypto});
    await controller.activate();await controller.waitForListenerReady();const before=await controller.snapshot(),accepted=await controller.acceptConflict(conflictId),published=states.at(-1),after=await controller.snapshot();
    await controller.deactivate();await journal.close();
    await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(databaseName);request.onsuccess=resolve;request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('test database deletion blocked'));});
    return{before,accepted,published,after,applyCalls};
  },databaseName);
  assert.equal(result.before.state,'conflict');assert.equal(result.before.conflictCount,1);
  assert.equal(result.accepted.ok,true);assert.equal(result.published.state,'saved');assert.equal(result.published.conflictCount,0);
  assert.equal(result.after.state,'saved');assert.equal(result.after.conflictCount,0);assert.equal(result.applyCalls,0);
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
  assert.equal(retained.snapshot.blockedCount,1);assert.equal(retained.snapshot.recoverableBlockedCount,1);assert.equal(retained.snapshot.unsafeBlockedCount,0);assert.deepEqual(retained.snapshot.blockedCategories,['historical-acknowledgement']);assert.equal(retained.snapshot.blockedErrorCode,'account-sync/committed-entity-invalid');assert.equal(retained.snapshot.pendingCount,0);

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

test('persisted pending and sending operations stay byte-identical until a live listener snapshot is accepted',async t=>{
  const server=http.createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<!doctype html><title>Listener authority persistence</title>');});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage(),databaseName=`pogoAccountSync_listener_authority_${Date.now()}`,url=`http://127.0.0.1:${server.address().port}/`;
  const load=async()=>{for(const file of ['js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/data/accountSyncJournal.js','js/data/accountSyncController.js'])await page.addScriptTag({path:path.join(root,file)});};
  await page.goto(url,{waitUntil:'domcontentloaded'});await load();
  const prepared=await page.evaluate(async databaseName=>{
    const model=window.PogoDomain.accountSyncModel,journal=window.PogoData.accountSyncJournal.createAccountSyncJournal({ownerUid:'uid-owner',databaseName});
    const make=async(operationId,catalogId)=>{const identity={surface:'my-list',lane:'wishlist',catalogId},entityId=model.tradeEntryId(identity);return(await model.createOperation({operationId,ownerUid:'uid-owner',entityType:'tradeEntry',entityId,identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},patch:{priority:'H'},clientAt:10})).value;};
    const pending=await make('op_0000000000007201','pokemon:25:base'),sending=await make('op_0000000000007202','pokemon:133:base');
    await journal.enqueueOperations([pending,sending]);
    await new Promise((resolve,reject)=>{
      const request=indexedDB.open(databaseName);request.onerror=()=>reject(request.error);request.onsuccess=()=>{
        const database=request.result,transaction=database.transaction('operations','readwrite'),store=transaction.objectStore('operations'),read=store.get(`uid-owner|${sending.operationId}`);
        read.onerror=()=>reject(read.error);read.onsuccess=()=>store.put({...read.result,status:'sending'});
        transaction.oncomplete=()=>{database.close();resolve();};transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
      };
    });
    const before=JSON.stringify(await journal.listOperations({statuses:['pending','sending']}));await journal.close();return{before};
  },databaseName);

  await page.reload({waitUntil:'domcontentloaded'});await load();
  const result=await page.evaluate(async databaseName=>{
    const merge=window.PogoDomain.accountSyncMerge,journal=window.PogoData.accountSyncJournal.createAccountSyncJournal({ownerUid:'uid-owner',databaseName});
    let listener=null,applyCalls=0;const canonical=new Map();
    const repository={
      ownerUid:'uid-owner',
      listenAccount({onData}){listener=onData;return()=>{};},
      async applyOperation(operation){applyCalls++;const current=canonical.get(operation.entityId)||null,next=merge.mergeOperation(current,operation,{acceptedAt:100+applyCalls});if(!next.ok)throw new Error('canonical merge failed');canonical.set(operation.entityId,next.value);return{ok:true,status:'committed',value:next.value};}
    };
    const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>true,clock:(()=>{let value=100;return()=>++value;})(),crypto:window.crypto});
    await controller.activate();await controller.drain();
    const beforeProof={applyCalls,records:JSON.stringify(await journal.listOperations({statuses:['pending','sending']})),state:await controller.snapshot()};
    listener({});const listenerReady=await controller.waitForListenerReady();await controller.drain();
    const acknowledged=await journal.listOperations({statuses:['acknowledged']}),after=await controller.snapshot();
    await controller.deactivate();await journal.close();
    await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(databaseName);request.onsuccess=resolve;request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('test database deletion blocked'));});
    return{beforeProof,listenerReady,applyCalls,acknowledged:acknowledged.length,after};
  },databaseName);
  assert.equal(result.beforeProof.applyCalls,0);assert.equal(result.beforeProof.records,prepared.before);assert.equal(result.beforeProof.state.listenerState,'listening');assert.equal(result.beforeProof.state.listenerHealthy,false);
  assert.equal(result.listenerReady.ok,true);assert.equal(result.listenerReady.status,'healthy');assert.equal(result.applyCalls,2);assert.equal(result.acknowledged,2);assert.equal(result.after.pendingCount,0);assert.equal(result.after.listenerHealthy,true);
});

test('a failed retained retry makes one call and remains blocked across another IndexedDB reload',async t=>{
  const server=http.createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<!doctype html><title>Retained retry persistence</title>');});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage(),databaseName=`pogoAccountSync_retained_retry_${Date.now()}`,url=`http://127.0.0.1:${server.address().port}/`;
  const load=async()=>{for(const file of ['js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/data/accountSyncJournal.js','js/data/accountSyncController.js'])await page.addScriptTag({path:path.join(root,file)});};
  await page.goto(url,{waitUntil:'domcontentloaded'});await load();
  await page.evaluate(async databaseName=>{
    const model=window.PogoDomain.accountSyncModel,journal=window.PogoData.accountSyncJournal.createAccountSyncJournal({ownerUid:'uid-owner',databaseName}),identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:960:base'},entityId=model.tradeEntryId(identity);
    const operation=(await model.createOperation({operationId:'op_0000000000007301',ownerUid:'uid-owner',entityType:'tradeEntry',entityId,identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},patch:{priority:'H'},clientAt:10})).value;
    await journal.enqueueOperation(operation);await journal.markAttempt(operation.operationId,{retryable:false,errorCode:'account-sync/network-failed'});await journal.close();
  },databaseName);

  await page.reload({waitUntil:'domcontentloaded'});await load();
  const attempted=await page.evaluate(async databaseName=>{
    const journal=window.PogoData.accountSyncJournal.createAccountSyncJournal({ownerUid:'uid-owner',databaseName});let applyCalls=0;
    const repository={ownerUid:'uid-owner',listenAccount({onData}){queueMicrotask(()=>onData({}));return()=>{};},async applyOperation(){applyCalls++;throw Object.assign(new Error('temporary network failure'),{code:'account-sync/network-failed'});}};
    const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>true,clock:(()=>{let value=200;return()=>++value;})(),crypto:window.crypto});
    await controller.activate();await controller.waitForListenerReady();const retry=await controller.retryBlocked(),record=(await journal.listOperations({statuses:['blocked']}))[0],after=await controller.snapshot();
    await controller.deactivate();await journal.close();return{retry,applyCalls,record:JSON.stringify(record),attempts:record?.attempts,status:record?.status,nextAttemptAt:record?.nextAttemptAt,after};
  },databaseName);
  assert.equal(attempted.retry.ok,false);assert.equal(attempted.retry.retried,1);assert.equal(attempted.applyCalls,1);assert.equal(attempted.status,'blocked');assert.equal(attempted.attempts,2);assert.equal(attempted.after.pendingCount,0);assert.equal(attempted.after.blockedCount,1);

  await page.reload({waitUntil:'domcontentloaded'});await load();
  const reopened=await page.evaluate(async databaseName=>{
    const journal=window.PogoData.accountSyncJournal.createAccountSyncJournal({ownerUid:'uid-owner',databaseName});let applyCalls=0;
    const repository={ownerUid:'uid-owner',listenAccount({onData}){queueMicrotask(()=>onData({}));return()=>{};},async applyOperation(){applyCalls++;throw new Error('blocked records must not auto-dispatch');}};
    const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>true,clock:()=>10000,crypto:window.crypto});
    await controller.activate();await controller.waitForListenerReady();await controller.drain();await new Promise(resolve=>setTimeout(resolve,20));const record=(await journal.listOperations({statuses:['blocked']}))[0],snapshot=await controller.snapshot();
    await controller.deactivate();await journal.close();
    await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(databaseName);request.onsuccess=resolve;request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('test database deletion blocked'));});
    return{applyCalls,record:JSON.stringify(record),snapshot};
  },databaseName);
  assert.equal(reopened.applyCalls,0);assert.equal(reopened.record,attempted.record);assert.equal(reopened.snapshot.pendingCount,0);assert.equal(reopened.snapshot.blockedCount,1);
});

test('the real IndexedDB journal classifies mixed blocked codes and preserves unsafe records byte for byte',async t=>{
  const server=http.createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<!doctype html><title>Blocked account sync classification</title>');});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage(),databaseName=`pogoAccountSync_blocked_${Date.now()}`;await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});await page.addScriptTag({path:path.join(root,'js/domain/accountSyncModel.js')});await page.addScriptTag({path:path.join(root,'js/data/accountSyncJournal.js')});
  const result=await page.evaluate(async databaseName=>{
    const model=window.PogoDomain.accountSyncModel,journal=window.PogoData.accountSyncJournal.createAccountSyncJournal({ownerUid:'uid-owner',databaseName});
    const make=async(operationId,catalogId)=>{const identity={surface:'my-list',lane:'wishlist',catalogId},entityId=model.tradeEntryId(identity);return(await model.createOperation({operationId,ownerUid:'uid-owner',entityType:'tradeEntry',entityId,identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},patch:{priority:'H'},clientAt:10})).value;};
    const safe=await make('op_0000000000007101','pokemon:safe'),unsafe=await make('op_0000000000007102','pokemon:unsafe');await journal.enqueueOperation(safe);await journal.enqueueOperation(unsafe);await journal.markAttempt(safe.operationId,{retryable:false,errorCode:'account-sync/network-failed'});await journal.markAttempt(unsafe.operationId,{retryable:false,errorCode:'account-sync/owner-mismatch'});
    const beforeSnapshot=await journal.snapshot(),unsafeBefore=JSON.stringify((await journal.listOperations({statuses:['blocked']})).find(record=>record.operationId===unsafe.operationId));
    const safeRetried=await journal.retryBlocked(safe.operationId),unsafeRetried=await journal.retryBlocked(unsafe.operationId),unsafeAfter=JSON.stringify((await journal.listOperations({statuses:['blocked']})).find(record=>record.operationId===unsafe.operationId)),afterSnapshot=await journal.snapshot();await journal.close();
    await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(databaseName);request.onsuccess=resolve;request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('test database deletion blocked'));});
    return{beforeSnapshot,safeRetried,unsafeRetried,unsafeBefore,unsafeAfter,afterSnapshot};
  },databaseName);
  assert.equal(result.beforeSnapshot.blockedCount,2);assert.equal(result.beforeSnapshot.recoverableBlockedCount,1);assert.equal(result.beforeSnapshot.unsafeBlockedCount,1);assert.deepEqual(result.beforeSnapshot.blockedCategories,['transient-transport','unsafe']);
  assert.equal(result.safeRetried,true);assert.equal(result.unsafeRetried,false);assert.equal(result.unsafeAfter,result.unsafeBefore);assert.equal(result.afterSnapshot.pendingCount,1);assert.equal(result.afterSnapshot.blockedCount,1);assert.equal(result.afterSnapshot.unsafeBlockedCount,1);
});
