'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { disabledGatePlan } = require('./e1ProductionFirstMutationGuard.cjs');
const {
  APP_CHECK_MODE,
  appCheckRuntimeProofDigest,
  validAppCheckProvenance
} = require('./e1ProductionThirdMutationBrowserHarness.cjs');
const {
  D3_CLOSEOUT,
  IDENTITY_BASELINE,
  PRIVATE_EXECUTION_LEDGER_PATH,
  SECURITY_BOUNDARY,
  STAGES,
  groupEActivationGatePlan,
  validateExecutionLedger,
  validateLedgerDirectory
} = require('./e1ProductionClientFoundationExecution.cjs');
const {
  appIdHash,
  digestArray,
  validateRunManifest
} = require('../e1-gateway/groupEAdmission');
const {
  requireDeployedControlPlane
} = require('./e1GroupEControlPlane.cjs');

const ENABLE_CONFIRMATION = 'ENABLE E1 GROUP E CLIENT FOUNDATION CANARY';
const RESTORE_CONFIRMATION = 'RESTORE E1 GROUP E CLIENT FOUNDATION GATES';
const PRIVATE_READINESS_PATH = path.resolve(__dirname, '../.local/e1-production-group-e-client-foundation-readiness.json');
const PRIVATE_INPUT_PATH = path.resolve(__dirname, '../.local/e1-production-group-e-client-foundation-input.json');
const PRIVATE_EVIDENCE_PATH = path.resolve(__dirname, '../.local/e1-production-group-e-client-foundation-evidence.json');
const PRIVATE_JIT_PATH = path.resolve(__dirname, '../.local/e1-production-group-e-client-foundation-jit.json');
const PRIVATE_REPLAY_LEDGER_PATH = path.resolve(__dirname, '../.local/e1-production-group-e-client-foundation-replay-ledger.json');
const PRIVATE_CONTROL_DEPLOYMENT_PATH = path.resolve(__dirname, '../.local/e1-production-group-e-control-deployment.json');
const HASH = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const SAFE_HASH = /^[a-f0-9]{16}$/u;
const REVISION = /^e1-identity-authority-[0-9]{5}-[a-z0-9]{3}$/u;
const IMAGE = /^sha256:[a-f0-9]{64}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_JIT_MS = 15 * 60 * 1000;
const MAX_ACTIVATION_MS = 45 * 60 * 1000;
const MAX_CONTROL_EVIDENCE_AGE_MS = 15 * 60 * 1000;
const MIN_OBSERVATION_MS = 30 * 60 * 1000;
const TARGET_OBSERVATION_MS = 60 * 60 * 1000;
const OBSERVATION_CLOSEOUT_GRACE_MS = 15 * 60 * 1000;
const MAX_OBSERVATION_MS = TARGET_OBSERVATION_MS + OBSERVATION_CLOSEOUT_GRACE_MS;
const EVIDENCE_ASSEMBLY_MAX_MS = 5 * 60 * 1000;
const SLOTS = Object.freeze(['A', 'B']);
const RELEASE_ID = /^\d{4}-\d{2}-\d{2}\.\d+$/u;
const PRODUCTION_FIREBASE_APP_ID = '1:1053781218847:web:378b312470943152d9a72a';
const EVIDENCE_FIELDS = Object.freeze([
  'schemaVersion','slot','capturedAt','expiresAt','pagesReleaseId','pagesSourceSha','pagesArtifactDigest',
  'uidHash','trainerHash','cohortDigest','browserContextHash','appCheckMode','appCheckProvenance',
  'callableConstructed','callableInvoked','credentialsOrTokensPersisted','sanitizedSentinel'
]);
const REPLAY_LEDGER_FIELDS = Object.freeze([
  'schemaVersion','cohortDigest','generationId','createdAt','entries','callableInvocations','ledgerDigest'
]);
const REPLAY_LEDGER_ENTRY_FIELDS = Object.freeze(['slot','capturedAt','runtimeProofDigest','tokenFingerprint']);
const PROVENANCE_FIELDS = Object.freeze([
  'toolingSourceSha','pagesReleaseId','pagesSourceSha','pagesArtifactDigest','gatewaySourceSha','gatewaySourceFingerprint',
  'authorityRevision','authorityImageDigest'
]);
const SECURITY_FIELDS = Object.freeze([
  'authorityPrivate','gatewayOnlyInvoker','projectWideInvoker','gatewayForbiddenRolesPresent','iamDrift',
  'productionDebugTokensRegistered','providerLinkRoutePresent','controlDatabaseRules'
]);
const BUDGET_FIELDS = Object.freeze([
  'expectedBrowserAttempts','expectedGatewayInvocations','expectedAdmittedClaims','expectedAuthorityCalls',
  'expectedSuccessfulReads','expectedControlWrites','phaseEIdentityWrites','rtdbUserDataWrites','ordinaryUserWrites',
  'maxAdmittedA','maxAdmittedB','maxAuthorityCallsAfterA','maxAuthorityCallsAfterB','maxSuccessfulReads',
  'authoritativeReplayBoundary'
]);
const JIT_FIELDS = Object.freeze([
  'approvedAt','expiresAt','cohortDigest','evidenceDigest','replayLedgerDigest','activationWindowStart','activationWindowEnd',
  'confirmation','humanOperatorPresent','restorationOwnerPresent'
]);
const READINESS_FIELDS = Object.freeze([
  'schemaVersion','environment','projectId','approvalGroup','cohortStage','mode','cohortDigest','bindings',
  'd3Closeout','evidence','replayLedger','replayLedgerDigest','jit','provenance','securityBoundary','startingGates',
  'activationGatePlan','restorationGatePlan','clientControllerContract','budget','executionSequence','runManifest',
  'executionLedgerDigest','controlPlaneDeploymentDigest','observationPolicy','laterGroupsAuthorized','groupEAuthorized'
]);
const INPUT_FIELDS = Object.freeze([
  'environment','projectId','approvalGroup','cohortStage','mode','cohortDigest','bindings','d3Closeout',
  'evidenceDigest','replayLedgerDigest','runManifestDigest','executionLedgerDigest','controlPlaneDeploymentDigest',
  'provenance','securityBoundary','currentGates','activationGatePlan','restorationGatePlan','clientControllerContract',
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
function privateDirectoryMode(directory){try{return(fs.statSync(directory).mode&0o777)===0o700;}catch{return false;}}
function activationGatePlan(){return groupEActivationGatePlan();}
function evidenceDigest(evidence){return sha256(JSON.stringify(evidence));}
function bindingDigest(bindings){return sha256(JSON.stringify([1,'group-e-client-foundation-cohort',
  ...SLOTS.flatMap((slot)=>[slot,bindings[slot].uidHash,bindings[slot].trainerHash])]));}
function replayLedgerDigest(ledger){return sha256(JSON.stringify([1,'group-e-client-foundation-evidence-ledger',
  ledger.schemaVersion,ledger.cohortDigest,ledger.generationId,ledger.createdAt,ledger.entries,ledger.callableInvocations]));}
function jitDigest(jit){return sha256(JSON.stringify([1,'group-e-client-foundation-jit',jit]));}
function d3CloseoutDigest(){return digestArray('group-e-d3-closeout',[D3_CLOSEOUT]);}
function clientControllerContract(){return Object.freeze({persistentBrowserStorage:false,deploymentArmsController:false,
  explicitSameRuntimeControllerRequired:true,oneTerminalAttemptPerController:true,browserIntegrityDefenseOnly:true,
  serverControlMarkerAuthoritative:true,reconciliationRequiredBeforeNextSlot:true});}
function expectedBudget(){return Object.freeze({expectedBrowserAttempts:2,expectedGatewayInvocations:2,
  expectedAdmittedClaims:2,expectedAuthorityCalls:2,expectedSuccessfulReads:2,expectedControlWrites:6,
  phaseEIdentityWrites:0,rtdbUserDataWrites:0,ordinaryUserWrites:0,maxAdmittedA:1,maxAdmittedB:1,
  maxAuthorityCallsAfterA:1,maxAuthorityCallsAfterB:1,maxSuccessfulReads:2,
  authoritativeReplayBoundary:'e1-group-e-control-create-only-consumption'});}

function validateBindings(bindings){
  if(!bindings||!exactFields(bindings,SLOTS)||SLOTS.some((slot)=>!exactFields(bindings[slot],['uidHash','trainerHash'])||
      !HASH.test(bindings[slot].uidHash||'')||!HASH.test(bindings[slot].trainerHash||''))||
      bindings.A.uidHash===bindings.B.uidHash||bindings.A.trainerHash===bindings.B.trainerHash)fail('group_e_bindings_invalid');
}

function validateEvidence(evidence,cohortDigest,provenance,now){
  if(!Array.isArray(evidence)||evidence.length!==2||evidence.map((entry)=>entry.slot).join('')!=='AB')fail('group_e_evidence_invalid');
  evidence.forEach((entry)=>{
    const captured=Date.parse(entry.capturedAt),expires=Date.parse(entry.expiresAt);
    const runtimeArtifact={bindingDigest:cohortDigest,verifiedAt:entry.capturedAt};
    const runtimeSubject={slot:entry.slot,uidHash:entry.uidHash,trainerHash:entry.trainerHash};
    const finalStage=Date.parse(entry.appCheckProvenance?.limitedUseToken?.settledAt);
    if(!exactFields(entry,EVIDENCE_FIELDS)||entry.schemaVersion!==2||!SLOTS.includes(entry.slot)||
      !RELEASE_ID.test(entry.pagesReleaseId||'')||entry.pagesReleaseId!==provenance.pagesReleaseId||
      entry.pagesSourceSha!==provenance.pagesSourceSha||entry.pagesArtifactDigest!==provenance.pagesArtifactDigest||
      !HASH.test(entry.uidHash||'')||!HASH.test(entry.trainerHash||'')||!HASH.test(entry.browserContextHash||'')||
      entry.cohortDigest!==cohortDigest||entry.appCheckMode!==APP_CHECK_MODE||
      !validAppCheckProvenance(entry.appCheckProvenance,runtimeArtifact,runtimeSubject)||
      entry.appCheckProvenance.runtimeProofDigest!==appCheckRuntimeProofDigest(entry.appCheckProvenance)||
      !Number.isFinite(finalStage)||captured<finalStage||captured-finalStage>EVIDENCE_ASSEMBLY_MAX_MS||
      entry.callableConstructed!==false||entry.callableInvoked!==false||entry.credentialsOrTokensPersisted!==false||
      !SAFE_HASH.test(entry.sanitizedSentinel||'')||!Number.isFinite(captured)||!Number.isFinite(expires)||
      captured>=expires||expires-captured>MAX_JIT_MS||now>=expires)fail('group_e_evidence_invalid');
  });
  if(new Set(evidence.map((entry)=>entry.uidHash)).size!==2||new Set(evidence.map((entry)=>entry.trainerHash)).size!==2||
      new Set(evidence.map((entry)=>entry.browserContextHash)).size!==2||
      new Set(evidence.map((entry)=>entry.appCheckProvenance.limitedUseToken.tokenFingerprint)).size!==2){
    fail('group_e_evidence_invalid');
  }
}

function validateReplayLedger(ledger,evidence,cohortDigest){
  const created=Date.parse(ledger?.createdAt);
  if(!exactFields(ledger,REPLAY_LEDGER_FIELDS)||ledger.schemaVersion!==1||ledger.cohortDigest!==cohortDigest||
      !UUID_V4.test(ledger.generationId||'')||!Number.isFinite(created)||!Array.isArray(ledger.entries)||
      ledger.entries.length!==2||ledger.entries.map((entry)=>entry.slot).join('')!=='AB'||ledger.callableInvocations!==0||
      !HASH.test(ledger.ledgerDigest||'')||ledger.ledgerDigest!==replayLedgerDigest(ledger))fail('group_e_replay_ledger_invalid');
  ledger.entries.forEach((entry,index)=>{
    const record=evidence[index];
    if(!exactFields(entry,REPLAY_LEDGER_ENTRY_FIELDS)||entry.slot!==record.slot||entry.capturedAt!==record.capturedAt||
      entry.runtimeProofDigest!==record.appCheckProvenance.runtimeProofDigest||
      entry.tokenFingerprint!==record.appCheckProvenance.limitedUseToken.tokenFingerprint||
      !HASH.test(entry.runtimeProofDigest||'')||!HASH.test(entry.tokenFingerprint||'')||Date.parse(entry.capturedAt)<created){
      fail('group_e_replay_ledger_invalid');
    }
  });
}

function validateProvenance(value){
  if(!exactFields(value,PROVENANCE_FIELDS)||!GIT_SHA.test(value.toolingSourceSha||'')||!RELEASE_ID.test(value.pagesReleaseId||'')||
      !GIT_SHA.test(value.pagesSourceSha||'')||!HASH.test(value.pagesArtifactDigest||'')||
      !GIT_SHA.test(value.gatewaySourceSha||'')||!HASH.test(value.gatewaySourceFingerprint||'')||
      !REVISION.test(value.authorityRevision||'')||!IMAGE.test(value.authorityImageDigest||''))fail('group_e_provenance_invalid');
}
function validateSecurity(value){
  if(!exactFields(value,SECURITY_FIELDS)||!sameJson(value,SECURITY_BOUNDARY))fail('group_e_security_boundary_invalid');
}
function validateBudget(value){if(!exactFields(value,BUDGET_FIELDS)||!sameJson(value,expectedBudget()))fail('group_e_budget_invalid');}
function validateJit(value,cohortDigest,digest,replayDigest,evidence,now){
  const approved=Date.parse(value?.approvedAt),expires=Date.parse(value?.expiresAt),start=Date.parse(value?.activationWindowStart),
    end=Date.parse(value?.activationWindowEnd),lastEvidence=Math.max(...evidence.map((entry)=>Date.parse(entry.capturedAt)));
  if(!exactFields(value,JIT_FIELDS)||value.cohortDigest!==cohortDigest||value.evidenceDigest!==digest||
      value.replayLedgerDigest!==replayDigest||value.confirmation!==ENABLE_CONFIRMATION||value.humanOperatorPresent!==true||
      value.restorationOwnerPresent!==true||!Number.isFinite(approved)||!Number.isFinite(expires)||!Number.isFinite(start)||
      !Number.isFinite(end)||approved<lastEvidence||expires-approved>MAX_JIT_MS||now<approved||now>=expires||start<approved||
      end<=start||end-start>MAX_ACTIVATION_MS||now<start||now>=end)fail('group_e_jit_invalid');
}
function validateObservationPolicy(value){
  if(!exactFields(value,['minimumMinutes','targetMaximumMinutes','closeoutGraceMinutes','startAfterRestoration','extendOnAnomalyOrWrite'])||
      value.minimumMinutes!==30||value.targetMaximumMinutes!==60||value.closeoutGraceMinutes!==15||
      value.startAfterRestoration!==true||value.extendOnAnomalyOrWrite!==true)fail('group_e_observation_policy_invalid');
}

function validateGroupEGuard(readiness,input,{now=Date.now(),executionLedger,controlPlaneDeployment}={}){
  if(!exactFields(readiness,READINESS_FIELDS)||!exactFields(input,INPUT_FIELDS)||readiness.schemaVersion!==2||
      readiness.environment!=='production'||input.environment!=='production'||readiness.projectId!=='trade-list-a4297'||
      input.projectId!=='trade-list-a4297'||readiness.approvalGroup!=='E'||input.approvalGroup!=='E'||
      readiness.cohortStage!=='client-foundation-canary'||input.cohortStage!=='client-foundation-canary'||
      readiness.mode!=='durable-at-most-once-admission'||input.mode!=='durable-at-most-once-admission'||
      !HASH.test(readiness.cohortDigest||'')||input.cohortDigest!==readiness.cohortDigest)fail('group_e_contract_invalid');
  validateBindings(readiness.bindings);validateBindings(input.bindings);
  if(!sameJson(readiness.bindings,input.bindings)||readiness.cohortDigest!==bindingDigest(readiness.bindings)||
      !sameJson(readiness.d3Closeout,D3_CLOSEOUT)||!sameJson(input.d3Closeout,D3_CLOSEOUT))fail('group_e_d3_closeout_invalid');
  validateProvenance(readiness.provenance);validateProvenance(input.provenance);
  if(!sameJson(readiness.provenance,input.provenance))fail('group_e_provenance_invalid');
  validateEvidence(readiness.evidence,readiness.cohortDigest,readiness.provenance,now);
  if(SLOTS.some((slot)=>{const entry=readiness.evidence.find((candidate)=>candidate.slot===slot);
    return entry.uidHash!==readiness.bindings[slot].uidHash||entry.trainerHash!==readiness.bindings[slot].trainerHash;})){
    fail('group_e_evidence_binding_invalid');
  }
  const digest=evidenceDigest(readiness.evidence);
  if(input.evidenceDigest!==digest)fail('group_e_evidence_digest_invalid');
  validateReplayLedger(readiness.replayLedger,readiness.evidence,readiness.cohortDigest);
  if(readiness.replayLedgerDigest!==readiness.replayLedger.ledgerDigest||
      input.replayLedgerDigest!==readiness.replayLedgerDigest)fail('group_e_replay_ledger_invalid');
  validateJit(readiness.jit,readiness.cohortDigest,digest,readiness.replayLedgerDigest,readiness.evidence,now);
  validateSecurity(readiness.securityBoundary);validateSecurity(input.securityBoundary);
  if(!sameJson(readiness.securityBoundary,input.securityBoundary))fail('group_e_security_boundary_invalid');
  const disabled=disabledGatePlan(),enabled=activationGatePlan();
  if(!sameJson(readiness.startingGates,disabled)||!sameJson(input.currentGates,disabled)||
      !sameJson(readiness.activationGatePlan,enabled)||!sameJson(input.activationGatePlan,enabled)||
      !sameJson(readiness.restorationGatePlan,disabled)||!sameJson(input.restorationGatePlan,disabled))fail('group_e_gate_plan_invalid');
  const controller=clientControllerContract();
  if(!sameJson(readiness.clientControllerContract,controller)||!sameJson(input.clientControllerContract,controller)){
    fail('group_e_client_controller_contract_invalid');
  }
  validateBudget(readiness.budget);validateBudget(input.budget);
  if(!executionLedger)fail('group_e_execution_ledger_absent');
  const execution=validateExecutionLedger(executionLedger,{requireStage:STAGES.A_READY,requirePristine:true});
  if(readiness.executionLedgerDigest!==execution.transitionDigest||input.executionLedgerDigest!==execution.transitionDigest||
      executionLedger.runId!==readiness.runManifest?.runId||!sameJson(executionLedger.bindings,readiness.bindings)||
      !sameJson(executionLedger.provenance,readiness.provenance)||
      executionLedger.admission.evidenceDigest!==digest||
      executionLedger.admission.replayLedgerDigest!==readiness.replayLedgerDigest||
      executionLedger.admission.jitDigest!==jitDigest(readiness.jit))fail('group_e_execution_ledger_invalid');
  const run=validateRunManifest(readiness.runManifest,{now});
  if(input.runManifestDigest!==run.manifestDigest||run.cohortDigest!==readiness.cohortDigest||
      !sameJson(run.bindings,readiness.bindings)||!sameJson(run.provenance,readiness.provenance)||
      run.firebaseAppIdHash!==appIdHash(PRODUCTION_FIREBASE_APP_ID)||run.d3CloseoutDigest!==d3CloseoutDigest()||
      !sameJson(run.identityBaseline,IDENTITY_BASELINE)||run.admissionEvidenceDigest!==digest||
      run.preCallReplayLedgerDigest!==readiness.replayLedgerDigest||
      run.initialExecutionLedgerDigest!==execution.transitionDigest||
      Date.parse(run.issuedAt)<Date.parse(readiness.jit.approvedAt)||
      Date.parse(run.expiresAt)>Date.parse(readiness.jit.activationWindowEnd))fail('group_e_run_manifest_invalid');
  const deployed=requireDeployedControlPlane(controlPlaneDeployment,{now,maxAgeMs:MAX_CONTROL_EVIDENCE_AGE_MS});
  if(readiness.controlPlaneDeploymentDigest!==deployed.deploymentDigest||
      input.controlPlaneDeploymentDigest!==deployed.deploymentDigest)fail('group_e_control_deployment_invalid');
  if(!sameJson(readiness.executionSequence,['create-run','commit-A-dispatch','A-read','verify-session-boundary',
      'create-A-reconciliation','commit-B-dispatch','B-read','create-B-reconciliation','restore','observe','create-closeout'])||
      readiness.laterGroupsAuthorized!==false||readiness.groupEAuthorized!==true||input.e2Reachable!==false||
      input.readRateLimiterMode!=='group-e-synthetic-read-v1'||input.normalDurableLimiterChanged!==false||
      input.confirmation!==ENABLE_CONFIRMATION)fail('group_e_contract_invalid');
  validateObservationPolicy(readiness.observationPolicy);
  return Object.freeze({ok:true,environment:'production',approvalGroup:'E',cohortStage:'client-foundation-canary',
    targetVerified:true,cohortSize:2,cohortDigest:readiness.cohortDigest,bindings:readiness.bindings,
    groupEAuthorized:true,laterGroupsAuthorized:false,executionAuthorized:true,
    entryEvidenceExpiresAt:readiness.jit.expiresAt,activationWindowStart:readiness.jit.activationWindowStart,
    activationWindowEnd:readiness.jit.activationWindowEnd,activationGatePlan:enabled,restorationGatePlan:disabled,
    budget:readiness.budget,provenance:readiness.provenance,securityBoundary:readiness.securityBoundary,
    runId:run.runId,runManifestDigest:run.manifestDigest,keyId:run.keyId,publicKeySpki:run.publicKeySpki,
    firebaseAppIdHash:run.firebaseAppIdHash,controlPlaneDeploymentDigest:deployed.deploymentDigest,
    controlDatabaseId:deployed.databaseId,executionLedgerDigest:execution.transitionDigest,
    executionStage:execution.stage,nextOperation:execution.nextAction,cloudOperations:0});
}

function validateGroupEObservation(value){
  const fields=['schemaVersion','cohortDigest','execution','postRestorationObservation','healthy'];
  const executionFields=['startAt','endAt','gatewayInvocations','admittedClaims','authorityCalls','successfulReads',
    'controlWritesBeforeCloseout','phaseEIdentityWrites','rtdbUserDataWrites','ordinaryUserWrites','stateDigest',
    'd3DocumentCount','gatesRestored'];
  const observationFields=['startAt','endAt','durationMinutes','additionalGatewayInvocations','additionalAdmittedClaims',
    'additionalAuthorityCalls','additionalSuccessfulReads','closeoutControlWrites','totalControlWrites',
    'phaseEIdentityWrites','rtdbUserDataWrites','ordinaryUserWrites','gatesRestored','iamAndExposureStable','anomaliesAbsent'];
  const execution=value?.execution,observation=value?.postRestorationObservation;
  const executionStart=Date.parse(execution?.startAt),executionEnd=Date.parse(execution?.endAt);
  const start=Date.parse(observation?.startAt),end=Date.parse(observation?.endAt),duration=end-start;
  if(!exactFields(value,fields)||value.schemaVersion!==3||!HASH.test(value.cohortDigest||'')||
      !exactFields(execution,executionFields)||!Number.isFinite(executionStart)||!Number.isFinite(executionEnd)||
      executionEnd<executionStart||execution.gatewayInvocations!==2||execution.admittedClaims!==2||
      execution.authorityCalls!==2||execution.successfulReads!==2||execution.controlWritesBeforeCloseout!==5||
      execution.phaseEIdentityWrites!==0||execution.rtdbUserDataWrites!==0||execution.ordinaryUserWrites!==0||
      execution.stateDigest!==D3_CLOSEOUT.stateDigest||execution.d3DocumentCount!==32||execution.gatesRestored!==true||
      !exactFields(observation,observationFields)||!Number.isFinite(start)||!Number.isFinite(end)||start<executionEnd||
      duration<MIN_OBSERVATION_MS||duration>MAX_OBSERVATION_MS||observation.durationMinutes!==duration/60000||
      observation.additionalGatewayInvocations!==0||observation.additionalAdmittedClaims!==0||
      observation.additionalAuthorityCalls!==0||observation.additionalSuccessfulReads!==0||
      observation.closeoutControlWrites!==1||observation.totalControlWrites!==6||
      observation.phaseEIdentityWrites!==0||observation.rtdbUserDataWrites!==0||observation.ordinaryUserWrites!==0||
      observation.gatesRestored!==true||observation.iamAndExposureStable!==true||
      observation.anomaliesAbsent!==true||value.healthy!==true)fail('group_e_observation_invalid');
  return Object.freeze({ok:true,healthy:true});
}

function loadPrivateGuard(options={}){
  const files={readiness:options.readinessPath||PRIVATE_READINESS_PATH,input:options.inputPath||PRIVATE_INPUT_PATH,
    evidence:options.evidencePath||PRIVATE_EVIDENCE_PATH,jit:options.jitPath||PRIVATE_JIT_PATH,
    replayLedger:options.replayLedgerPath||PRIVATE_REPLAY_LEDGER_PATH,
    controlDeployment:options.controlDeploymentPath||PRIVATE_CONTROL_DEPLOYMENT_PATH};
  const executionDirectory=options.executionLedgerPath||PRIVATE_EXECUTION_LEDGER_PATH;
  if(Object.values(files).some((file)=>!privateMode(file))||!privateDirectoryMode(executionDirectory)){
    fail('group_e_private_artifact_mode_invalid');
  }
  const readiness=JSON.parse(fs.readFileSync(files.readiness,'utf8'));
  const input=JSON.parse(fs.readFileSync(files.input,'utf8'));
  const evidence=JSON.parse(fs.readFileSync(files.evidence,'utf8'));
  const jit=JSON.parse(fs.readFileSync(files.jit,'utf8'));
  const replayLedger=JSON.parse(fs.readFileSync(files.replayLedger,'utf8'));
  const controlPlaneDeployment=JSON.parse(fs.readFileSync(files.controlDeployment,'utf8'));
  const executionLedger=validateLedgerDirectory(executionDirectory).latest;
  if(!sameJson(readiness.evidence,evidence)||!sameJson(readiness.jit,jit)||
      !sameJson(readiness.replayLedger,replayLedger))fail('group_e_private_artifact_mismatch');
  return validateGroupEGuard(readiness,input,{...options,executionLedger,controlPlaneDeployment});
}

function guardProductionClientFoundation(input,options={}){
  if(options.inputPath&&(!privateMode(options.inputPath)||
      !sameJson(input,JSON.parse(fs.readFileSync(options.inputPath,'utf8')))))fail('group_e_private_artifact_mismatch');
  return loadPrivateGuard({...options,inputPath:options.inputPath||PRIVATE_INPUT_PATH});
}

module.exports=Object.freeze({
  D3_CLOSEOUT,ENABLE_CONFIRMATION,RESTORE_CONFIRMATION,MAX_ACTIVATION_MS,MAX_CONTROL_EVIDENCE_AGE_MS,MAX_JIT_MS,
  MIN_OBSERVATION_MS,TARGET_OBSERVATION_MS,OBSERVATION_CLOSEOUT_GRACE_MS,MAX_OBSERVATION_MS,
  PRIVATE_CONTROL_DEPLOYMENT_PATH,PRIVATE_EVIDENCE_PATH,PRIVATE_INPUT_PATH,PRIVATE_JIT_PATH,PRIVATE_READINESS_PATH,
  PRIVATE_REPLAY_LEDGER_PATH,PRIVATE_EXECUTION_LEDGER_PATH,activationGatePlan,bindingDigest,clientControllerContract,
  d3CloseoutDigest,disabledGatePlan,evidenceDigest,expectedBudget,guardProductionClientFoundation,jitDigest,
  loadPrivateGuard,privateMode,replayLedgerDigest,validateGroupEGuard,validateGroupEObservation
});
