'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ALL_GATES, disabledGatePlan } = require('./e1ProductionFirstMutationGuard.cjs');

const ENABLE_CONFIRMATION = 'ENABLE E1 GROUP E CLIENT FOUNDATION CANARY';
const RESTORE_CONFIRMATION = 'RESTORE E1 GROUP E CLIENT FOUNDATION GATES';
const PRIVATE_READINESS_PATH = path.resolve(__dirname, '../.local/e1-production-group-e-client-foundation-readiness.json');
const PRIVATE_INPUT_PATH = path.resolve(__dirname, '../.local/e1-production-group-e-client-foundation-input.json');
const PRIVATE_EVIDENCE_PATH = path.resolve(__dirname, '../.local/e1-production-group-e-client-foundation-evidence.json');
const PRIVATE_JIT_PATH = path.resolve(__dirname, '../.local/e1-production-group-e-client-foundation-jit.json');
const D3_CLOSEOUT = Object.freeze({
  totalDocuments: 32,
  accounts: 8,
  trainerHandles: 8,
  rateLimits: 8,
  operationRequests: 8,
  identityMigrations: 0,
  identityConflicts: 0,
  stateDigest: '6f0caa5435ac7ef027fc8640bce814bd3bd3bbdd272e6c5d5cee46885916f2bb',
  gatesRestored: true,
  observationCompleted: true,
  observationHealthy: true
});
const EXPECTED_APP_ID = '1:1053781218847:web:378b312470943152d9a72a';
const HASH = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const SAFE_HASH = /^[a-f0-9]{16}$/u;
const REVISION = /^e1-identity-authority-[0-9]{5}-[a-z0-9]{3}$/u;
const IMAGE = /^sha256:[a-f0-9]{64}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_JIT_MS = 15 * 60 * 1000;
const MAX_ACTIVATION_MS = 45 * 60 * 1000;
const MIN_OBSERVATION_MS = 30 * 60 * 1000;
const MAX_OBSERVATION_MS = 60 * 60 * 1000;
const SLOTS = Object.freeze(['A', 'B']);
const EVIDENCE_FIELDS = Object.freeze([
  'slot','capturedAt','expiresAt','origin','pathname','appId','uidHash','trainerHash','cohortDigest',
  'samePageRuntime','existingAppCheckInstanceReused','limitedUseTokenAcquired','limitedUseTokenFingerprint',
  'callableConstructed','callableInvoked','credentialsOrTokensPersisted','sanitizedSentinel'
]);
const PROVENANCE_FIELDS = Object.freeze([
  'toolingSourceSha','pagesSourceSha','pagesArtifactDigest','gatewaySourceSha','gatewaySourceFingerprint',
  'authorityRevision','authorityImageDigest'
]);
const SECURITY_FIELDS = Object.freeze([
  'authorityPrivate','gatewayOnlyInvoker','projectWideInvoker','gatewayForbiddenRolesPresent','iamDrift',
  'productionDebugTokensRegistered','providerLinkRoutePresent'
]);
const BUDGET_FIELDS = Object.freeze([
  'expectedGatewayCalls','expectedAuthorityCalls','expectedSuccessfulReads','applicationWrites','firestoreWrites',
  'rtdbWrites','ordinaryUserWrites','processLocalCounterAuthoritative','authoritativeReconciliationRequired'
]);
const JIT_FIELDS = Object.freeze([
  'approvedAt','expiresAt','cohortDigest','evidenceDigest','activationWindowStart','activationWindowEnd',
  'confirmation','humanOperatorPresent','restorationOwnerPresent'
]);
const READINESS_FIELDS = Object.freeze([
  'schemaVersion','environment','projectId','approvalGroup','cohortStage','mode','cohortDigest','bindings',
  'd3Closeout','evidence','jit','provenance','securityBoundary','startingGates','activationGatePlan',
  'restorationGatePlan','budget','executionSequence','observationPolicy','laterGroupsAuthorized','groupEAuthorized'
]);
const INPUT_FIELDS = Object.freeze([
  'environment','projectId','approvalGroup','cohortStage','mode','cohortDigest','bindings','d3Closeout',
  'evidenceDigest','provenance','securityBoundary','currentGates','activationGatePlan','restorationGatePlan',
  'budget','e2Reachable','readRateLimiterMode','normalDurableLimiterChanged','confirmation'
]);

function fail(code){const error=new Error(code);error.code=code;throw error;}
function sha256(value){return crypto.createHash('sha256').update(value,'utf8').digest('hex');}
function sameJson(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function exactFields(value,fields){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const actual=Object.keys(value).sort(),expected=[...fields].sort();
  return actual.length===expected.length&&actual.every((key,index)=>key===expected[index]);
}
function privateMode(file){try{return(fs.statSync(file).mode&0o777)===0o600;}catch{return false;}}
function activationGatePlan(){return Object.freeze({...disabledGatePlan(),CLIENT_FOUNDATION_USE_ENABLED:true,GATEWAY_INVOCATION_ENABLED:true,READ_ACCOUNT_FOUNDATION_ENABLED:true});}
function evidenceDigest(evidence){return sha256(JSON.stringify(evidence));}
function bindingDigest(bindings){return sha256(JSON.stringify([1,'group-e-client-foundation-cohort',
  ...SLOTS.flatMap((slot)=>[slot,bindings[slot].uidHash,bindings[slot].trainerHash]) ]));}

function validateBindings(bindings){
  if(!bindings||!exactFields(bindings,['A','B'])||SLOTS.some((slot)=>!exactFields(bindings[slot],['uidHash','trainerHash'])||
      !HASH.test(bindings[slot].uidHash||'')||!HASH.test(bindings[slot].trainerHash||''))||
      bindings.A.uidHash===bindings.B.uidHash||bindings.A.trainerHash===bindings.B.trainerHash)fail('group_e_bindings_invalid');
}

function validateEvidence(evidence,cohortDigest,now){
  if(!Array.isArray(evidence)||evidence.length!==2||evidence.map((entry)=>entry.slot).join('')!=='AB')fail('group_e_evidence_invalid');
  evidence.forEach((entry)=>{
    const captured=Date.parse(entry.capturedAt),expires=Date.parse(entry.expiresAt);
    if(!exactFields(entry,EVIDENCE_FIELDS)||!SLOTS.includes(entry.slot)||entry.origin!=='https://doomsday126dev.github.io'||
      entry.pathname!=='/trade-app/'||entry.appId!==EXPECTED_APP_ID||!HASH.test(entry.uidHash||'')||!HASH.test(entry.trainerHash||'')||
      entry.cohortDigest!==cohortDigest||entry.samePageRuntime!==true||entry.existingAppCheckInstanceReused!==true||
      entry.limitedUseTokenAcquired!==true||!HASH.test(entry.limitedUseTokenFingerprint||'')||entry.callableConstructed!==false||
      entry.callableInvoked!==false||entry.credentialsOrTokensPersisted!==false||!SAFE_HASH.test(entry.sanitizedSentinel||'')||
      !Number.isFinite(captured)||!Number.isFinite(expires)||captured>=expires||expires-captured>MAX_JIT_MS||now>=expires)fail('group_e_evidence_invalid');
  });
  if(new Set(evidence.map((entry)=>entry.uidHash)).size!==2||new Set(evidence.map((entry)=>entry.trainerHash)).size!==2||
      new Set(evidence.map((entry)=>entry.limitedUseTokenFingerprint)).size!==2)fail('group_e_evidence_invalid');
}

function validateProvenance(value){
  if(!exactFields(value,PROVENANCE_FIELDS)||!GIT_SHA.test(value.toolingSourceSha||'')||!GIT_SHA.test(value.pagesSourceSha||'')||
      !HASH.test(value.pagesArtifactDigest||'')||!GIT_SHA.test(value.gatewaySourceSha||'')||!HASH.test(value.gatewaySourceFingerprint||'')||
      !REVISION.test(value.authorityRevision||'')||!IMAGE.test(value.authorityImageDigest||''))fail('group_e_provenance_invalid');
}
function validateSecurity(value){
  if(!exactFields(value,SECURITY_FIELDS)||value.authorityPrivate!==true||value.gatewayOnlyInvoker!==true||
      value.projectWideInvoker!==false||value.gatewayForbiddenRolesPresent!==false||value.iamDrift!==false||
      value.productionDebugTokensRegistered!==false||value.providerLinkRoutePresent!==false)fail('group_e_security_boundary_invalid');
}
function validateBudget(value){
  const expected={expectedGatewayCalls:2,expectedAuthorityCalls:2,expectedSuccessfulReads:2,applicationWrites:0,
    firestoreWrites:0,rtdbWrites:0,ordinaryUserWrites:0,processLocalCounterAuthoritative:false,authoritativeReconciliationRequired:true};
  if(!exactFields(value,BUDGET_FIELDS)||!sameJson(value,expected))fail('group_e_budget_invalid');
}
function validateJit(value,cohortDigest,digest,evidence,now){
  const approved=Date.parse(value?.approvedAt),expires=Date.parse(value?.expiresAt),start=Date.parse(value?.activationWindowStart),
    end=Date.parse(value?.activationWindowEnd),lastEvidence=Math.max(...evidence.map((entry)=>Date.parse(entry.capturedAt)));
  if(!exactFields(value,JIT_FIELDS)||value.cohortDigest!==cohortDigest||value.evidenceDigest!==digest||
      value.confirmation!==ENABLE_CONFIRMATION||value.humanOperatorPresent!==true||value.restorationOwnerPresent!==true||
      !Number.isFinite(approved)||!Number.isFinite(expires)||!Number.isFinite(start)||!Number.isFinite(end)||
      approved<lastEvidence||expires-approved>MAX_JIT_MS||now<approved||now>=expires||start<approved||end<=start||
      end-start>MAX_ACTIVATION_MS||now<start||now>=end)fail('group_e_jit_invalid');
}
function validateObservationPolicy(value){
  if(!exactFields(value,['minimumMinutes','maximumMinutes','startAfterRestoration','extendOnAnomalyOrWrite'])||
      value.minimumMinutes!==30||value.maximumMinutes!==60||value.startAfterRestoration!==true||
      value.extendOnAnomalyOrWrite!==true)fail('group_e_observation_policy_invalid');
}

function validateGroupEGuard(readiness,input,{now=Date.now()}={}){
  if(!exactFields(readiness,READINESS_FIELDS)||!exactFields(input,INPUT_FIELDS)||readiness.schemaVersion!==1||
      readiness.environment!=='production'||input.environment!=='production'||readiness.projectId!=='trade-list-a4297'||
      input.projectId!=='trade-list-a4297'||readiness.approvalGroup!=='E'||input.approvalGroup!=='E'||
      readiness.cohortStage!=='client-foundation-canary'||input.cohortStage!=='client-foundation-canary'||
      readiness.mode!=='synthetic-canary'||input.mode!=='synthetic-canary'||!HASH.test(readiness.cohortDigest||'')||
      input.cohortDigest!==readiness.cohortDigest)fail('group_e_contract_invalid');
  validateBindings(readiness.bindings);validateBindings(input.bindings);
  if(!sameJson(readiness.bindings,input.bindings)||readiness.cohortDigest!==bindingDigest(readiness.bindings)||
      !sameJson(readiness.d3Closeout,D3_CLOSEOUT)||!sameJson(input.d3Closeout,D3_CLOSEOUT))fail('group_e_d3_closeout_invalid');
  validateEvidence(readiness.evidence,readiness.cohortDigest,now);
  if(SLOTS.some((slot)=>{const entry=readiness.evidence.find((candidate)=>candidate.slot===slot);
    return entry.uidHash!==readiness.bindings[slot].uidHash||entry.trainerHash!==readiness.bindings[slot].trainerHash;})){
    fail('group_e_evidence_binding_invalid');
  }
  const digest=evidenceDigest(readiness.evidence);
  if(input.evidenceDigest!==digest)fail('group_e_evidence_digest_invalid');
  validateJit(readiness.jit,readiness.cohortDigest,digest,readiness.evidence,now);
  validateProvenance(readiness.provenance);validateProvenance(input.provenance);
  if(!sameJson(readiness.provenance,input.provenance))fail('group_e_provenance_invalid');
  validateSecurity(readiness.securityBoundary);validateSecurity(input.securityBoundary);
  if(!sameJson(readiness.securityBoundary,input.securityBoundary))fail('group_e_security_boundary_invalid');
  const disabled=disabledGatePlan(),enabled=activationGatePlan();
  if(!sameJson(readiness.startingGates,disabled)||!sameJson(input.currentGates,disabled)||
      !sameJson(readiness.activationGatePlan,enabled)||!sameJson(input.activationGatePlan,enabled)||
      !sameJson(readiness.restorationGatePlan,disabled)||!sameJson(input.restorationGatePlan,disabled))fail('group_e_gate_plan_invalid');
  validateBudget(readiness.budget);validateBudget(input.budget);
  if(!sameJson(readiness.executionSequence,['A-read','A-reconcile','sign-out','B-read','B-reconcile','restore'])||
      readiness.laterGroupsAuthorized!==false||readiness.groupEAuthorized!==true||input.e2Reachable!==false||
      input.readRateLimiterMode!=='group-e-synthetic-read-v1'||input.normalDurableLimiterChanged!==false||
      input.confirmation!==ENABLE_CONFIRMATION)fail('group_e_contract_invalid');
  validateObservationPolicy(readiness.observationPolicy);
  return Object.freeze({ok:true,environment:'production',approvalGroup:'E',cohortStage:'client-foundation-canary',
    targetVerified:true,cohortSize:2,cohortDigest:readiness.cohortDigest,bindings:readiness.bindings,groupEAuthorized:true,laterGroupsAuthorized:false,
    executionAuthorized:true,activationWindowStart:readiness.jit.activationWindowStart,
    activationWindowEnd:readiness.jit.activationWindowEnd,entryEvidenceExpiresAt:readiness.jit.expiresAt,
    activationGatePlan:enabled,restorationGatePlan:disabled,budget:readiness.budget,provenance:readiness.provenance,
    securityBoundary:readiness.securityBoundary,cloudOperations:0});
}

function validateGroupEObservation(value){
  const fields=['schemaVersion','cohortDigest','startAt','endAt','durationMinutes','gatewayCalls','authorityCalls','successfulReads',
    'applicationWrites','firestoreWrites','rtdbWrites','ordinaryUserWrites','stateDigest','d3DocumentCount','gatesRestored',
    'iamAndExposureStable','anomaliesAbsent','healthy'];
  const start=Date.parse(value?.startAt),end=Date.parse(value?.endAt),duration=end-start;
  if(!exactFields(value,fields)||value.schemaVersion!==1||!HASH.test(value.cohortDigest||'')||!Number.isFinite(start)||
      !Number.isFinite(end)||duration<MIN_OBSERVATION_MS||duration>MAX_OBSERVATION_MS||value.durationMinutes!==duration/60000||
      value.gatewayCalls!==2||value.authorityCalls!==2||value.successfulReads!==2||value.applicationWrites!==0||
      value.firestoreWrites!==0||value.rtdbWrites!==0||value.ordinaryUserWrites!==0||value.stateDigest!==D3_CLOSEOUT.stateDigest||
      value.d3DocumentCount!==32||value.gatesRestored!==true||value.iamAndExposureStable!==true||
      value.anomaliesAbsent!==true||value.healthy!==true)fail('group_e_observation_invalid');
  return Object.freeze({ok:true,healthy:true});
}

function loadPrivateGuard(options={}){
  const paths={readiness:options.readinessPath||PRIVATE_READINESS_PATH,input:options.inputPath||PRIVATE_INPUT_PATH,
    evidence:options.evidencePath||PRIVATE_EVIDENCE_PATH,jit:options.jitPath||PRIVATE_JIT_PATH};
  if(Object.values(paths).some((file)=>!privateMode(file)))fail('group_e_private_artifact_mode_invalid');
  const readiness=JSON.parse(fs.readFileSync(paths.readiness,'utf8'));
  const input=JSON.parse(fs.readFileSync(paths.input,'utf8'));
  const evidence=JSON.parse(fs.readFileSync(paths.evidence,'utf8'));
  const jit=JSON.parse(fs.readFileSync(paths.jit,'utf8'));
  if(!sameJson(readiness.evidence,evidence)||!sameJson(readiness.jit,jit))fail('group_e_private_artifact_mismatch');
  return validateGroupEGuard(readiness,input,options);
}

function guardProductionClientFoundation(input,options={}){
  const paths={readiness:options.readinessPath||PRIVATE_READINESS_PATH,evidence:options.evidencePath||PRIVATE_EVIDENCE_PATH,
    jit:options.jitPath||PRIVATE_JIT_PATH};
  if(Object.values(paths).some((file)=>!privateMode(file)))fail('group_e_private_artifact_mode_invalid');
  const readiness=JSON.parse(fs.readFileSync(paths.readiness,'utf8'));
  const evidence=JSON.parse(fs.readFileSync(paths.evidence,'utf8'));
  const jit=JSON.parse(fs.readFileSync(paths.jit,'utf8'));
  if(!sameJson(readiness.evidence,evidence)||!sameJson(readiness.jit,jit))fail('group_e_private_artifact_mismatch');
  return validateGroupEGuard(readiness,input,options);
}

module.exports=Object.freeze({
  D3_CLOSEOUT,ENABLE_CONFIRMATION,RESTORE_CONFIRMATION,MAX_ACTIVATION_MS,MAX_JIT_MS,
  PRIVATE_EVIDENCE_PATH,PRIVATE_INPUT_PATH,PRIVATE_JIT_PATH,PRIVATE_READINESS_PATH,
  activationGatePlan,bindingDigest,disabledGatePlan,evidenceDigest,guardProductionClientFoundation,loadPrivateGuard,privateMode,
  validateGroupEGuard,validateGroupEObservation
});
