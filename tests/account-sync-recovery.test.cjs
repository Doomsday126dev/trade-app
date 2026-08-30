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
  return{state:'sync-error',eligible:true,active:true,listenerState:'failed',listenerHealthy:false,controllerHealthy:false,lastError:'account-sync/listener-failed',lastErrorCategory:'listener',pendingCount:0,blockedCount:0,recoverableBlockedCount:0,unsafeBlockedCount:0,blockedCategories:[],conflictCount:0,recoveryCandidateCount:0,...overrides};
}

function context(snapshot,overrides={}){
  return{snapshot,runtimePresent:true,projectionReady:false,sessionCurrent:true,sessionBinding:{uid:'owner',username:'Owner'},...overrides};
}

function retained(code='account-sync/committed-entity-invalid',overrides={}){
  return state({state:'sync-error',listenerState:'healthy',listenerHealthy:true,controllerHealthy:true,lastError:code,lastErrorCategory:'blocked-operation',blockedErrorCode:code,blockedCount:1,recoverableBlockedCount:1,blockedCategories:['historical-acknowledgement'],...overrides});
}

function healthy(overrides={}){
  return state({state:'saved',listenerState:'healthy',listenerHealthy:true,controllerHealthy:true,lastError:'',lastErrorCategory:'',...overrides});
}

test('recovery routing distinguishes retained writes, runtime failures, conflicts, and unsafe evidence',()=>{
  const api=load();
  assert.equal(api.recoveryPlan(context(retained(),{projectionReady:true})).action,'retry-blocked');
  assert.equal(api.recoveryPlan(context(state({lastError:'account-sync/start-failed',lastErrorCategory:'startup'}))).action,'restart-runtime');
  assert.equal(api.recoveryPlan(context(healthy({state:'conflict',conflictCount:1}),{projectionReady:true})).action,'review-conflict');
  assert.equal(api.recoveryPlan(context(healthy({state:'review-required',recoveryCandidateCount:1}),{projectionReady:true})).action,'none');
  assert.equal(api.recoveryPlan(context(state({lastError:'account-sync/migration-evidence-conflict',lastErrorCategory:'migration'}))).action,'none');
  assert.equal(api.recoveryPlan(context(state({lastError:'account-sync/remote-version-substitution',lastErrorCategory:'canonical'}),{projectionReady:true})).action,'none');
  assert.equal(api.recoveryPlan(context(state(),{sessionCurrent:false})).code,'account-sync/session-changed');
  assert.equal(api.recoveryPlan(context(healthy(),{projectionReady:true})).category,'healthy');
});

test('unsafe canonical evidence outranks conflicts, review candidates, and retained operations without erasing their counts',()=>{
  const api=load(),cases=[
    {name:'conflict plus malformed canonical',snapshot:healthy({state:'conflict',conflictCount:1,lastError:'account-sync/remote-entity-invalid',lastErrorCategory:'canonical'}),counts:{conflictCount:1,reviewCount:0,blockedCount:0}},
    {name:'conflict plus missing entity',snapshot:healthy({state:'conflict',conflictCount:2,lastError:'account-sync/remote-entity-missing',lastErrorCategory:'canonical'}),counts:{conflictCount:2,reviewCount:0,blockedCount:0}},
    {name:'conflict plus owner failure',snapshot:healthy({state:'conflict',conflictCount:1,lastError:'account-sync/owner-mismatch',lastErrorCategory:'canonical'}),counts:{conflictCount:1,reviewCount:0,blockedCount:0}},
    {name:'conflict plus schema failure',snapshot:healthy({state:'conflict',conflictCount:1,lastError:'account-sync/schema-version-invalid',lastErrorCategory:'canonical'}),counts:{conflictCount:1,reviewCount:0,blockedCount:0}},
    {name:'review candidate plus canonical failure',snapshot:healthy({state:'review-required',recoveryCandidateCount:3,lastError:'account-sync/canonical-validation-failed',lastErrorCategory:'canonical'}),counts:{conflictCount:0,reviewCount:3,blockedCount:0}},
    {name:'blocked operation plus canonical failure',snapshot:retained('account-sync/committed-entity-invalid',{lastError:'account-sync/remote-version-substitution',lastErrorCategory:'canonical'}),counts:{conflictCount:0,reviewCount:0,blockedCount:1}}
  ];
  for(const item of cases){
    const plan=api.recoveryPlan(context(item.snapshot,{projectionReady:true}));
    assert.equal(plan.action,'none',item.name);assert.equal(plan.category,'unsafe-evidence',item.name);
    assert.equal(plan.conflictCount,item.counts.conflictCount,item.name);assert.equal(plan.reviewCount,item.counts.reviewCount,item.name);assert.equal(plan.blockedCount,item.counts.blockedCount,item.name);
  }
});

test('attached listeners remain pending until a validated callback proves health',()=>{
  const api=load(),pending=state({state:'pending-sync',listenerState:'listening',lastError:'',lastErrorCategory:''}),plan=api.recoveryPlan(context(pending,{projectionReady:true}));
  assert.equal(plan.action,'none');assert.equal(plan.category,'pending-sync');assert.equal(api.healthySnapshot(context(pending,{projectionReady:true})),false);
});

test('a zero-operation blocked retry is a failed recovery and never restarts or reports success',async()=>{
  const api=load(),initial=context(retained(),{projectionReady:true});
  let retries=0,restarts=0;
  const coordinator=api.createRecoveryCoordinator({capture:async()=>initial,isCurrent:()=>true,retryBlocked:async()=>{retries++;return{ok:true,retried:0};},restart:async()=>{restarts++;return initial;},recapture:async()=>initial});
  const result=await coordinator.recover();
  assert.equal(result.ok,false);assert.equal(result.code,'account-sync/retry-empty');assert.equal(result.retried,0);assert.equal(retries,1);assert.equal(restarts,0);
});

test('concurrent recovery taps share one retained-operation attempt',async()=>{
  const api=load(),initial=context(retained(),{projectionReady:true});
  const ready=context(healthy(),{projectionReady:true});
  let release,retries=0;const gate=new Promise(resolve=>{release=resolve;});
  const coordinator=api.createRecoveryCoordinator({capture:async()=>initial,isCurrent:()=>true,retryBlocked:async()=>{retries++;await gate;return{ok:true,retried:1};},restart:async()=>ready,recapture:async()=>ready});
  const first=coordinator.recover(),second=coordinator.recover();assert.equal(first,second);release();
  const [a,b]=await Promise.all([first,second]);assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(a.status,'recovered');assert.equal(retries,1);
});

test('startup recovery restarts once with the same session, install identity, and retained journal',async()=>{
  const api=load(),journal={},initial=context(state({lastError:'account-sync/migration-failed',lastErrorCategory:'migration'}),{journal,deviceInstallId:'device-stable'}),ready=context(healthy(),{projectionReady:true,journal,deviceInstallId:'device-stable'});
  let retries=0,restarts=0;
  const coordinator=api.createRecoveryCoordinator({capture:async()=>initial,isCurrent:value=>value.sessionCurrent,retryBlocked:async()=>{retries++;return{ok:true,retried:1};},restart:async value=>{restarts++;assert.equal(value.journal,journal);assert.equal(value.deviceInstallId,'device-stable');return ready;},recapture:async value=>{assert.equal(value.journal,journal);return ready;}});
  const result=await coordinator.recover();assert.equal(result.ok,true);assert.equal(result.status,'recovered');assert.equal(restarts,1);assert.equal(retries,0);
});

test('one restart may expose one exact safe retained operation and retry it once',async()=>{
  const api=load(),initial=context(state({lastError:'account-sync/listener-failed',lastErrorCategory:'listener'})),afterRestart=context(retained(),{projectionReady:true}),ready=context(healthy(),{projectionReady:true});
  let restarts=0,retries=0,recaptures=0;
  const coordinator=api.createRecoveryCoordinator({capture:async()=>initial,isCurrent:()=>true,restart:async()=>{restarts++;return afterRestart;},retryBlocked:async()=>{retries++;return{ok:true,retried:1};},recapture:async()=>++recaptures===1?afterRestart:ready});
  const result=await coordinator.recover();assert.equal(result.ok,true);assert.equal(result.retried,1);assert.equal(restarts,1);assert.equal(retries,1);assert.equal(recaptures,2);
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

test('session invalidation at every restart boundary prevents stale recapture or replacement-runtime control',async()=>{
  const api=load(),initial=context(state({lastError:'account-sync/start-failed',lastErrorCategory:'startup'}));
  for(const stage of ['capture','pre-restart','while-stopping','post-restart']){
    let current=true,restarts=0,recaptures=0,replacementStops=0,releaseStop;
    const stopGate=new Promise(resolve=>{releaseStop=resolve;});
    const coordinator=api.createRecoveryCoordinator({
      capture:async()=>{if(stage==='capture')current=false;return initial;},
      isCurrent:()=>{if(stage==='pre-restart'&&restarts===0)current=false;return current;},
      retryBlocked:async()=>({ok:false}),
      restart:async()=>{restarts++;if(stage==='while-stopping'){current=false;await stopGate;}if(stage==='post-restart')current=false;return{...initial,runtime:{stop(){replacementStops++;}}};},
      recapture:async()=>{recaptures++;return initial;}
    });
    const pending=coordinator.recover();releaseStop();const result=await pending;
    assert.equal(result.code,'account-sync/session-changed',stage);assert.equal(recaptures,0,stage);assert.equal(replacementStops,0,stage);
  }
});

test('the historical same-revision timestamp substitution stays diagnostic-only and is never restarted automatically',async()=>{
  const api=load(),unsafe=context(state({lastError:'account-sync/remote-version-substitution',lastErrorCategory:'canonical'}),{projectionReady:true});let restarts=0,retries=0;
  const coordinator=api.createRecoveryCoordinator({capture:async()=>unsafe,isCurrent:()=>true,retryBlocked:async()=>{retries++;return{ok:false};},restart:async()=>{restarts++;return unsafe;},recapture:async()=>unsafe});
  const result=await coordinator.recover();assert.equal(result.ok,false);assert.equal(result.status,'unavailable');assert.equal(result.code,'account-sync/remote-version-substitution');assert.equal(restarts,0);assert.equal(retries,0);
});

test('sanitized diagnostics bound unknown errors and contain no private values',()=>{
  const api=load(),privateValue='owner@example.com/trainer/Pikachu/op_secret',diagnostic=api.sanitizedDiagnostic(context(state({lastError:privateValue,lastErrorCategory:privateValue}),{recoveryOutcome:'failed',release:'2026-08-30.82'}));
  assert.deepEqual(Object.keys(diagnostic),['code','category','pendingCount','blockedCount','recoverableBlockedCount','unsafeBlockedCount','conflictCount','reviewCount','runtime','listener','projection','recoveryOutcome','release']);
  assert.equal(diagnostic.code,'account-sync/unknown');assert.equal(diagnostic.category,'projection');assert.equal(diagnostic.recoveryOutcome,'failed');assert.equal(diagnostic.release,'2026-08-30.82');assert.doesNotMatch(JSON.stringify(diagnostic),/owner@example|Pikachu|op_secret/);
});
