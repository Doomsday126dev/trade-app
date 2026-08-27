const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');

const root=path.join(__dirname,'..');
const files=[
  'js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/domain/accountSyncMigration.js','js/domain/accountSyncProduct.js',
  'js/data/accountSyncController.js','js/data/accountSyncRuntime.js'
];

function load(){
  const window={crypto:webcrypto,btoa:value=>Buffer.from(value,'binary').toString('base64'),navigator:{onLine:true}};
  const context=vm.createContext({window,Uint8Array,unescape,encodeURIComponent,decodeURIComponent,queueMicrotask,structuredClone,console,setTimeout,clearTimeout});
  for(const file of files)vm.runInContext(readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  return window.PogoData.accountSyncRuntime;
}

function state(overrides={}){
  return{state:'sync-error',eligible:true,active:true,listenerState:'failed',listenerHealthy:false,controllerHealthy:false,lastError:'account-sync/listener-failed',lastErrorCategory:'listener',pendingCount:0,blockedCount:0,conflictCount:0,recoveryCandidateCount:0,...overrides};
}

function context(snapshot,overrides={}){
  return{snapshot,runtimePresent:true,projectionReady:false,sessionCurrent:true,sessionBinding:{uid:'owner',username:'Owner'},...overrides};
}

test('recovery routing distinguishes retained writes, runtime failures, conflicts, and unsafe evidence',()=>{
  const api=load();
  assert.equal(api.recoveryPlan(context(state({blockedCount:1,blockedErrorCode:'account-sync/committed-entity-invalid',lastError:'account-sync/committed-entity-invalid',lastErrorCategory:'blocked-operation'}),{projectionReady:true})).action,'retry-blocked');
  assert.equal(api.recoveryPlan(context(state({lastError:'account-sync/start-failed',lastErrorCategory:'startup'}))).action,'restart-runtime');
  assert.equal(api.recoveryPlan(context(state({state:'conflict',conflictCount:1,lastError:'',lastErrorCategory:'',listenerState:'healthy',listenerHealthy:true,controllerHealthy:true}),{projectionReady:true})).action,'review-conflict');
  assert.equal(api.recoveryPlan(context(state({state:'review-required',recoveryCandidateCount:1,lastError:'',lastErrorCategory:'',listenerState:'healthy',listenerHealthy:true,controllerHealthy:true}),{projectionReady:true})).action,'none');
  assert.equal(api.recoveryPlan(context(state({lastError:'account-sync/migration-evidence-conflict',lastErrorCategory:'migration'}))).action,'none');
  assert.equal(api.recoveryPlan(context(state({lastError:'account-sync/remote-version-substitution',lastErrorCategory:'canonical'}),{projectionReady:true})).action,'none');
  assert.equal(api.recoveryPlan(context(state(),{sessionCurrent:false})).code,'account-sync/session-changed');
  assert.equal(api.recoveryPlan(context(state({state:'saved',lastError:'',lastErrorCategory:'',listenerState:'healthy',listenerHealthy:true,controllerHealthy:true}),{projectionReady:true})).category,'healthy');
});

test('a zero-operation blocked retry is a failed recovery and never restarts or reports success',async()=>{
  const api=load(),initial=context(state({blockedCount:1,blockedErrorCode:'account-sync/committed-entity-invalid',lastError:'account-sync/committed-entity-invalid',lastErrorCategory:'blocked-operation'}),{projectionReady:true});
  let retries=0,restarts=0;
  const coordinator=api.createRecoveryCoordinator({capture:async()=>initial,isCurrent:()=>true,retryBlocked:async()=>{retries++;return{ok:true,retried:0};},restart:async()=>{restarts++;return initial;},recapture:async()=>initial});
  const result=await coordinator.recover();
  assert.equal(result.ok,false);assert.equal(result.code,'account-sync/retry-empty');assert.equal(result.retried,0);assert.equal(retries,1);assert.equal(restarts,0);
});

test('concurrent recovery taps share one retained-operation attempt',async()=>{
  const api=load(),initial=context(state({blockedCount:1,blockedErrorCode:'account-sync/committed-entity-invalid',lastError:'account-sync/committed-entity-invalid',lastErrorCategory:'blocked-operation'}),{projectionReady:true});
  const healthy=context(state({state:'saved',lastError:'',lastErrorCategory:'',blockedCount:0,blockedErrorCode:'',listenerState:'healthy',listenerHealthy:true,controllerHealthy:true}),{projectionReady:true});
  let release,retries=0;const gate=new Promise(resolve=>{release=resolve;});
  const coordinator=api.createRecoveryCoordinator({capture:async()=>initial,isCurrent:()=>true,retryBlocked:async()=>{retries++;await gate;return{ok:true,retried:1};},restart:async()=>healthy,recapture:async()=>healthy});
  const first=coordinator.recover(),second=coordinator.recover();assert.equal(first,second);release();
  const [a,b]=await Promise.all([first,second]);assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(a.status,'recovered');assert.equal(retries,1);
});

test('startup recovery restarts once with the same session, install identity, and retained journal',async()=>{
  const api=load(),journal={},initial=context(state({lastError:'account-sync/migration-failed',lastErrorCategory:'migration'}),{journal,deviceInstallId:'device-stable'}),healthy=context(state({state:'saved',lastError:'',lastErrorCategory:'',listenerState:'healthy',listenerHealthy:true,controllerHealthy:true}),{projectionReady:true,journal,deviceInstallId:'device-stable'});
  let retries=0,restarts=0;
  const coordinator=api.createRecoveryCoordinator({capture:async()=>initial,isCurrent:value=>value.sessionCurrent,retryBlocked:async()=>{retries++;return{ok:true,retried:1};},restart:async value=>{restarts++;assert.equal(value.journal,journal);assert.equal(value.deviceInstallId,'device-stable');return healthy;},recapture:async value=>{assert.equal(value.journal,journal);return healthy;}});
  const result=await coordinator.recover();assert.equal(result.ok,true);assert.equal(result.status,'recovered');assert.equal(restarts,1);assert.equal(retries,0);
});

test('a recurring listener failure remains failed after one restart and never reconnects in a loop',async()=>{
  const api=load(),failed=context(state()),progress=[];let restarts=0;
  const coordinator=api.createRecoveryCoordinator({capture:async()=>failed,isCurrent:()=>true,retryBlocked:async()=>({ok:false}),restart:async()=>{restarts++;return failed;},recapture:async()=>failed,onProgress:value=>progress.push(value)});
  const result=await coordinator.recover();assert.equal(result.ok,false);assert.equal(result.code,'account-sync/listener-failed');assert.equal(restarts,1);assert.deepEqual(progress.map(item=>item.status),['running','failed']);
});

test('a session switch during recovery fails before accepting the replacement runtime',async()=>{
  const api=load(),initial=context(state({lastError:'account-sync/start-failed',lastErrorCategory:'startup'}));let checks=0,restarts=0;
  const coordinator=api.createRecoveryCoordinator({capture:async()=>initial,isCurrent:()=>++checks===1,retryBlocked:async()=>({ok:false}),restart:async()=>{restarts++;return{...initial,sessionCurrent:false};},recapture:async()=>{throw new Error('must not recapture a changed session');}});
  const result=await coordinator.recover();assert.equal(result.ok,false);assert.equal(result.code,'account-sync/session-changed');assert.equal(restarts,1);assert.equal(checks,2);
});

test('sanitized diagnostics bound unknown errors and contain no private values',()=>{
  const api=load(),privateValue='owner@example.com/trainer/Pikachu/op_secret',diagnostic=api.sanitizedDiagnostic(context(state({lastError:privateValue,lastErrorCategory:privateValue}),{recoveryOutcome:'failed',release:'2026-08-26.70'}));
  assert.deepEqual(Object.keys(diagnostic),['code','category','pendingCount','blockedCount','conflictCount','reviewCount','runtime','listener','projection','recoveryOutcome','release']);
  assert.equal(diagnostic.code,'account-sync/unknown');assert.equal(diagnostic.category,'projection');assert.equal(diagnostic.recoveryOutcome,'failed');assert.equal(diagnostic.release,'2026-08-26.70');assert.doesNotMatch(JSON.stringify(diagnostic),/owner@example|Pikachu|op_secret/);
});
