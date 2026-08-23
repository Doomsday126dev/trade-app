'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {
  D3_CLOSEOUT,ENABLE_CONFIRMATION,RESTORE_CONFIRMATION,activationGatePlan,bindingDigest,disabledGatePlan,evidenceDigest,
  guardProductionClientFoundation,validateGroupEGuard,validateGroupEObservation
}=require('../production/e1ProductionClientFoundationGuard.cjs');

const NOW=Date.parse('2030-01-01T12:10:00.000Z');
function clone(value){return structuredClone(value);}
function fixture(){
  const bindings={A:{uidHash:'a'.repeat(64),trainerHash:'1'.repeat(64)},
    B:{uidHash:'b'.repeat(64),trainerHash:'2'.repeat(64)}};
  const cohortDigest=bindingDigest(bindings);
  const evidence=['A','B'].map((slot,index)=>({slot,capturedAt:`2030-01-01T12:0${index}:00.000Z`,
    expiresAt:`2030-01-01T12:1${index+4}:00.000Z`,origin:'https://doomsday126dev.github.io',pathname:'/trade-app/',
    appId:'1:1053781218847:web:378b312470943152d9a72a',uidHash:bindings[slot].uidHash,trainerHash:bindings[slot].trainerHash,
    cohortDigest,samePageRuntime:true,existingAppCheckInstanceReused:true,limitedUseTokenAcquired:true,
    limitedUseTokenFingerprint:String(index+3).repeat(64),callableConstructed:false,callableInvoked:false,
    credentialsOrTokensPersisted:false,sanitizedSentinel:String(index+4).repeat(16)}));
  const provenance={toolingSourceSha:'a'.repeat(40),pagesSourceSha:'b'.repeat(40),pagesArtifactDigest:'c'.repeat(64),
    gatewaySourceSha:'d'.repeat(40),gatewaySourceFingerprint:'e'.repeat(64),authorityRevision:'e1-identity-authority-00123-abc',
    authorityImageDigest:`sha256:${'f'.repeat(64)}`};
  const securityBoundary={authorityPrivate:true,gatewayOnlyInvoker:true,projectWideInvoker:false,
    gatewayForbiddenRolesPresent:false,iamDrift:false,productionDebugTokensRegistered:false,providerLinkRoutePresent:false};
  const budget={expectedGatewayCalls:2,expectedAuthorityCalls:2,expectedSuccessfulReads:2,applicationWrites:0,
    firestoreWrites:0,rtdbWrites:0,ordinaryUserWrites:0,processLocalCounterAuthoritative:false,
    authoritativeReconciliationRequired:true};
  const jit={approvedAt:'2030-01-01T12:02:00.000Z',expiresAt:'2030-01-01T12:17:00.000Z',cohortDigest,
    evidenceDigest:evidenceDigest(evidence),activationWindowStart:'2030-01-01T12:02:00.000Z',
    activationWindowEnd:'2030-01-01T12:32:00.000Z',confirmation:ENABLE_CONFIRMATION,
    humanOperatorPresent:true,restorationOwnerPresent:true};
  const readiness={schemaVersion:1,environment:'production',projectId:'trade-list-a4297',approvalGroup:'E',
    cohortStage:'client-foundation-canary',mode:'synthetic-canary',cohortDigest,bindings,d3Closeout:D3_CLOSEOUT,evidence,jit,
    provenance,securityBoundary,startingGates:disabledGatePlan(),activationGatePlan:activationGatePlan(),
    restorationGatePlan:disabledGatePlan(),budget,executionSequence:['A-read','A-reconcile','sign-out','B-read','B-reconcile','restore'],
    observationPolicy:{minimumMinutes:30,maximumMinutes:60,startAfterRestoration:true,extendOnAnomalyOrWrite:true},
    laterGroupsAuthorized:false,groupEAuthorized:true};
  const input={environment:'production',projectId:'trade-list-a4297',approvalGroup:'E',cohortStage:'client-foundation-canary',
    mode:'synthetic-canary',cohortDigest,bindings,d3Closeout:D3_CLOSEOUT,evidenceDigest:evidenceDigest(evidence),provenance,
    securityBoundary,currentGates:disabledGatePlan(),activationGatePlan:activationGatePlan(),restorationGatePlan:disabledGatePlan(),
    budget,e2Reachable:false,readRateLimiterMode:'group-e-synthetic-read-v1',normalDurableLimiterChanged:false,
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

test('private readiness evidence and JIT artifacts must be independent mode-0600 files',()=>{
  const{readiness,input}=fixture(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'group-e-guard-'));
  const paths={};
  for(const[name,value]of Object.entries({readiness,evidence:readiness.evidence,jit:readiness.jit})){
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

test('closeout requires exact 2+2 calls zero writes restored gates and a proportional 30-60 minute observation',()=>{
  const value={schemaVersion:1,cohortDigest:'c'.repeat(64),startAt:'2030-01-01T13:00:00.000Z',
    endAt:'2030-01-01T13:45:00.000Z',durationMinutes:45,gatewayCalls:2,authorityCalls:2,successfulReads:2,
    applicationWrites:0,firestoreWrites:0,rtdbWrites:0,ordinaryUserWrites:0,stateDigest:D3_CLOSEOUT.stateDigest,
    d3DocumentCount:32,gatesRestored:true,iamAndExposureStable:true,anomaliesAbsent:true,healthy:true};
  assert.deepEqual(validateGroupEObservation(value),{ok:true,healthy:true});
  for(const mutate of [(v)=>{v.gatewayCalls=3;},(v)=>{v.firestoreWrites=1;},(v)=>{v.durationMinutes=20;v.endAt='2030-01-01T13:20:00.000Z';},
    (v)=>{v.gatesRestored=false;}]){const copy=clone(value);mutate(copy);assert.throws(()=>validateGroupEObservation(copy),/group_e_observation_invalid/);}
});
