'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {
  D3_CLOSEOUT,ENABLE_CONFIRMATION,RESTORE_CONFIRMATION,activationGatePlan,bindingDigest,clientControllerContract,
  disabledGatePlan,evidenceDigest,guardProductionClientFoundation,replayLedgerDigest,validateGroupEGuard,validateGroupEObservation
}=require('../production/e1ProductionClientFoundationGuard.cjs');
const {APP_CHECK_MODE,appCheckRuntimeProofDigest}=require('../production/e1ProductionThirdMutationBrowserHarness.cjs');

const NOW=Date.parse('2030-01-01T12:10:00.000Z');
function clone(value){return structuredClone(value);}
function runtimeProvenance(slot,index,bindings,cohortDigest){
  const base=Date.parse(`2030-01-01T12:0${index}:00.000Z`);
  const at=(offset)=>new Date(base+offset).toISOString();
  const stage=(start,outcome='resolved')=>({startedAt:at(start),settledAt:at(start+1000),outcome});
  const value={slot,origin:'https://doomsday126dev.github.io',pathname:'/trade-app/',
    appId:'1:1053781218847:web:378b312470943152d9a72a',uidHash:bindings[slot].uidHash,
    trainerHash:bindings[slot].trainerHash,bindingDigest:cohortDigest,probeStartedAt:at(0),
    samePageRuntimeEstablished:true,debugTokenGlobalAbsent:true,pageRuntimeBinding:stage(0,'verified'),
    sdkImport:stage(2000),readiness:stage(4000),appCheckInstance:{...stage(6000,'verified'),exactInstance:true},
    limitedUseToken:{...stage(8000),nonEmpty:true,tokenFingerprint:String(index+3).repeat(64),persisted:false,
      reused:false,sentToCallable:false},failureStage:null,runtimeProofDigest:null};
  value.runtimeProofDigest=appCheckRuntimeProofDigest(value);
  return value;
}
function fixture(){
  const bindings={A:{uidHash:'a'.repeat(64),trainerHash:'1'.repeat(64)},
    B:{uidHash:'b'.repeat(64),trainerHash:'2'.repeat(64)}};
  const cohortDigest=bindingDigest(bindings);
  const evidence=['A','B'].map((slot,index)=>({schemaVersion:2,slot,capturedAt:`2030-01-01T12:0${index+4}:00.000Z`,
    expiresAt:`2030-01-01T12:1${index+5}:00.000Z`,pagesReleaseId:'2030-01-01.99',pagesSourceSha:'b'.repeat(40),
    pagesArtifactDigest:'c'.repeat(64),uidHash:bindings[slot].uidHash,trainerHash:bindings[slot].trainerHash,
    cohortDigest,browserContextHash:String(index+5).repeat(64),appCheckMode:APP_CHECK_MODE,
    appCheckProvenance:runtimeProvenance(slot,index,bindings,cohortDigest),callableConstructed:false,callableInvoked:false,
    credentialsOrTokensPersisted:false,sanitizedSentinel:String(index+7).repeat(16)}));
  const replayLedger={schemaVersion:1,cohortDigest,generationId:'123e4567-e89b-42d3-a456-426614174000',
    createdAt:'2030-01-01T11:59:00.000Z',entries:evidence.map((entry)=>({slot:entry.slot,capturedAt:entry.capturedAt,
      runtimeProofDigest:entry.appCheckProvenance.runtimeProofDigest,
      tokenFingerprint:entry.appCheckProvenance.limitedUseToken.tokenFingerprint})),callableInvocations:0,ledgerDigest:null};
  replayLedger.ledgerDigest=replayLedgerDigest(replayLedger);
  const provenance={toolingSourceSha:'a'.repeat(40),pagesReleaseId:'2030-01-01.99',pagesSourceSha:'b'.repeat(40),pagesArtifactDigest:'c'.repeat(64),
    gatewaySourceSha:'d'.repeat(40),gatewaySourceFingerprint:'e'.repeat(64),authorityRevision:'e1-identity-authority-00123-abc',
    authorityImageDigest:`sha256:${'f'.repeat(64)}`};
  const securityBoundary={authorityPrivate:true,gatewayOnlyInvoker:true,projectWideInvoker:false,
    gatewayForbiddenRolesPresent:false,iamDrift:false,productionDebugTokensRegistered:false,providerLinkRoutePresent:false};
  const budget={expectedGatewayCalls:2,expectedAuthorityCalls:2,expectedSuccessfulReads:2,applicationWrites:0,
    firestoreWrites:0,rtdbWrites:0,ordinaryUserWrites:0,processLocalCounterAuthoritative:false,
    authoritativeReconciliationRequired:true};
  const jit={approvedAt:'2030-01-01T12:06:00.000Z',expiresAt:'2030-01-01T12:21:00.000Z',cohortDigest,
    evidenceDigest:evidenceDigest(evidence),replayLedgerDigest:replayLedger.ledgerDigest,
    activationWindowStart:'2030-01-01T12:06:00.000Z',activationWindowEnd:'2030-01-01T12:36:00.000Z',confirmation:ENABLE_CONFIRMATION,
    humanOperatorPresent:true,restorationOwnerPresent:true};
  const readiness={schemaVersion:1,environment:'production',projectId:'trade-list-a4297',approvalGroup:'E',
    cohortStage:'client-foundation-canary',mode:'synthetic-canary',cohortDigest,bindings,d3Closeout:D3_CLOSEOUT,evidence,
    replayLedger,replayLedgerDigest:replayLedger.ledgerDigest,jit,
    provenance,securityBoundary,startingGates:disabledGatePlan(),activationGatePlan:activationGatePlan(),
    restorationGatePlan:disabledGatePlan(),clientControllerContract:clientControllerContract(),budget,
    executionSequence:['A-read','A-reconcile','sign-out','B-read','B-reconcile','restore'],
    observationPolicy:{minimumMinutes:30,targetMaximumMinutes:60,closeoutGraceMinutes:15,startAfterRestoration:true,
      extendOnAnomalyOrWrite:true},
    laterGroupsAuthorized:false,groupEAuthorized:true};
  const input={environment:'production',projectId:'trade-list-a4297',approvalGroup:'E',cohortStage:'client-foundation-canary',
    mode:'synthetic-canary',cohortDigest,bindings,d3Closeout:D3_CLOSEOUT,evidenceDigest:evidenceDigest(evidence),
    replayLedgerDigest:replayLedger.ledgerDigest,provenance,
    securityBoundary,currentGates:disabledGatePlan(),activationGatePlan:activationGatePlan(),restorationGatePlan:disabledGatePlan(),
    clientControllerContract:clientControllerContract(),budget,e2Reachable:false,
    readRateLimiterMode:'group-e-synthetic-read-v1',normalDurableLimiterChanged:false,
    confirmation:ENABLE_CONFIRMATION};
  return{readiness,input};
}

test('Group E guard accepts exact fresh A/B evidence and independent zero-write provenance',()=>{
  const {readiness,input}=fixture(),result=validateGroupEGuard(readiness,input,{now:NOW});
  assert.equal(result.ok,true);assert.equal(result.cohortSize,2);assert.equal(result.executionAuthorized,true);
  assert.deepEqual(result.activationGatePlan,activationGatePlan());assert.deepEqual(result.restorationGatePlan,disabledGatePlan());
  assert.equal(result.budget.processLocalCounterAuthoritative,false);assert.equal(result.budget.authoritativeReconciliationRequired,true);
});

test('legacy groups wrong cohorts stale evidence and provenance substitution fail closed',()=>{
  for(const mutate of [
    (r)=>{r.approvalGroup='D';},(r)=>{r.bindings.B.uidHash=r.bindings.A.uidHash;},
    (r)=>{r.evidence[0].expiresAt='2030-01-01T12:05:00.000Z';},
    (r)=>{r.provenance={...r.provenance,gatewaySourceSha:r.provenance.pagesSourceSha};},
    (r)=>{r.evidence[0]={...r.evidence[0],samePageRuntime:true,existingAppCheckInstanceReused:true,limitedUseTokenAcquired:true};},
    (r)=>{r.evidence[0].appCheckProvenance.debugTokenGlobalAbsent=false;},
    (r)=>{r.evidence[0].appCheckProvenance.limitedUseToken.sentToCallable=true;},
    (r)=>{r.replayLedger.entries[0].runtimeProofDigest='f'.repeat(64);},
    (r)=>{r.jit.confirmation='ENABLE E1 GROUP D3 RESERVE COHORT';},
    (r)=>{r.securityBoundary.providerLinkRoutePresent=true;}
  ]){const{readiness,input}=fixture();mutate(readiness);assert.throws(()=>validateGroupEGuard(readiness,input,{now:NOW}));}
});

test('write budget process-local authority claim and ordinary-user effects fail closed',()=>{
  for(const [field,value] of [['firestoreWrites',1],['rtdbWrites',1],['ordinaryUserWrites',1],
    ['processLocalCounterAuthoritative',true],['authoritativeReconciliationRequired',false]]){
    const{readiness,input}=fixture();readiness.budget[field]=value;assert.throws(()=>validateGroupEGuard(readiness,input,{now:NOW}),/group_e_budget_invalid/);
  }
});

test('private readiness evidence replay ledger and JIT artifacts must be independent mode-0600 files',()=>{
  const{readiness,input}=fixture(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'group-e-guard-'));
  const paths={};
  for(const[name,value]of Object.entries({readiness,evidence:readiness.evidence,jit:readiness.jit,replayLedger:readiness.replayLedger})){
    paths[`${name}Path`]=path.join(directory,`${name}.json`);fs.writeFileSync(paths[`${name}Path`],JSON.stringify(value),{mode:0o600});
  }
  assert.equal(guardProductionClientFoundation(input,{...paths,now:NOW}).ok,true);
  fs.chmodSync(paths.evidencePath,0o644);
  assert.throws(()=>guardProductionClientFoundation(input,{...paths,now:NOW}),/group_e_private_artifact_mode_invalid/);
  fs.rmSync(directory,{recursive:true,force:true});
});

test('restore confirmation and disabled plan remain usable after JIT expiry',()=>{
  assert.equal(RESTORE_CONFIRMATION,'RESTORE E1 GROUP E CLIENT FOUNDATION GATES');
  assert.equal(ENABLE_CONFIRMATION,'ENABLE E1 GROUP E CLIENT FOUNDATION CANARY');
  assert.deepEqual(disabledGatePlan(),{
    CLIENT_FOUNDATION_USE_ENABLED:false,GATEWAY_INVOCATION_ENABLED:false,READ_ACCOUNT_FOUNDATION_ENABLED:false,
    RESERVE_HANDLE_ENABLED:false,REPAIR_FOUNDATION_ENABLED:false,APPLY_MIGRATION_ENABLED:false,
    FREEZE_CONFLICT_ENABLED:false,READ_PROOF_MODE:false
  });
});

test('closeout separates exact execution calls from zero-call observation and permits 15-minute closeout grace',()=>{
  const value={schemaVersion:2,cohortDigest:'c'.repeat(64),execution:{startAt:'2030-01-01T12:55:00.000Z',
    endAt:'2030-01-01T13:00:00.000Z',gatewayCalls:2,authorityCalls:2,successfulReads:2,applicationWrites:0,
    firestoreWrites:0,rtdbWrites:0,ordinaryUserWrites:0,stateDigest:D3_CLOSEOUT.stateDigest,d3DocumentCount:32,gatesRestored:true},
    postRestorationObservation:{startAt:'2030-01-01T13:00:00.000Z',endAt:'2030-01-01T14:01:00.000Z',durationMinutes:61,
      additionalGatewayCalls:0,additionalAuthorityCalls:0,additionalSuccessfulReads:0,applicationWrites:0,firestoreWrites:0,
      rtdbWrites:0,ordinaryUserWrites:0,gatesRestored:true,iamAndExposureStable:true,anomaliesAbsent:true},healthy:true};
  assert.deepEqual(validateGroupEObservation(value),{ok:true,healthy:true});
  for(const mutate of [(v)=>{v.execution.gatewayCalls=3;},(v)=>{v.execution.firestoreWrites=1;},
    (v)=>{v.postRestorationObservation.additionalGatewayCalls=1;},
    (v)=>{v.postRestorationObservation.durationMinutes=76;v.postRestorationObservation.endAt='2030-01-01T14:16:00.000Z';},
    (v)=>{v.postRestorationObservation.gatesRestored=false;}]){
    const copy=clone(value);mutate(copy);assert.throws(()=>validateGroupEObservation(copy),/group_e_observation_invalid/);
  }
});
