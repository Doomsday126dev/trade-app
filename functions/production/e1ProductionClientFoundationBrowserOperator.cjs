'use strict';

const crypto = require('node:crypto');
const {
  sessionGenerationContext,
  sessionGenerationDigest
} = require('../e1-gateway/groupEAdmission');

const SCHEMA_VERSION = 1;
const ENVIRONMENT = 'production';
const PROJECT_ID = 'trade-list-a4297';
const RECORD_TYPE = 'group-e-pre-dispatch-readiness';
const OPERATOR_LIFECYCLE_VERSION = 1;
const PRE_DISPATCH_MAX_AGE_MS = 2 * 60 * 1000;
const OPERATOR_LEASE_KEY = '__pogoGroupELiveOperatorLease';
const LEGACY_OPERATOR_STATE_KEY = '__groupELiveOperatorActive';
const BUTTON_ATTRIBUTE = 'data-group-e-live-operator-state';
const HASH = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RELEASE_ID = /^\d{4}-\d{2}-\d{2}\.\d+$/u;
const SLOTS = Object.freeze(['A', 'B']);
const EXPECTED_FIELDS = Object.freeze([
  'releaseId', 'sourceSha', 'origin', 'pathname', 'runId', 'cohortDigest', 'slot', 'uidHash', 'trainerHash',
  'generationId', 'sessionGeneration', 'firebaseAppIdHash', 'browserContextDigest', 'runtimeInstanceDigest',
  'sessionGenerationDigest'
]);
const READINESS_FIELDS = Object.freeze([
  'schemaVersion', 'recordType', 'operatorLifecycleVersion', 'environment', 'projectId', ...EXPECTED_FIELDS,
  'priorOperatorStateClean', 'operatorLeaseExclusive', 'legacyOperatorStateAbsent', 'runtimeRecordMatched',
  'controllerFactoryAvailable', 'staleControllerAbsent', 'staleTerminalRecordAbsent',
  'staleAttemptFailureAbsent', 'staleCapabilityStateAbsent', 'callableConstructed', 'callableInvoked',
  'capturedAt', 'readinessDigest'
]);
const RUNTIME_RECORD_FIELDS = Object.freeze([
  'schemaVersion', 'recordType', 'releaseId', 'sourceSha', 'environment', 'projectId', 'runId', 'cohortDigest', 'slot',
  'uidHash', 'trainerHash', 'generationId', 'sessionGeneration', 'firebaseAppIdHash', 'browserContextDigest',
  'runtimeInstanceDigest', 'sessionGenerationDigest', 'capturedAt'
]);
const BOOLEAN_PROOFS = Object.freeze([
  'priorOperatorStateClean', 'operatorLeaseExclusive', 'legacyOperatorStateAbsent', 'runtimeRecordMatched',
  'controllerFactoryAvailable', 'staleControllerAbsent', 'staleTerminalRecordAbsent',
  'staleAttemptFailureAbsent', 'staleCapabilityStateAbsent'
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactFields(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

function validExpected(value) {
  return exactFields(value, EXPECTED_FIELDS) && RELEASE_ID.test(value.releaseId || '') &&
    GIT_SHA.test(value.sourceSha || '') && value.origin === 'https://doomsday126dev.github.io' &&
    value.pathname === '/trade-app/' && UUID_V4.test(value.runId || '') && HASH.test(value.cohortDigest || '') &&
    SLOTS.includes(value.slot) && HASH.test(value.uidHash || '') && HASH.test(value.trainerHash || '') &&
    UUID_V4.test(value.generationId || '') && Number.isSafeInteger(value.sessionGeneration) &&
    value.sessionGeneration >= 0 && HASH.test(value.firebaseAppIdHash || '') &&
    HASH.test(value.browserContextDigest || '') && HASH.test(value.runtimeInstanceDigest || '') &&
    HASH.test(value.sessionGenerationDigest || '') &&
    sessionGenerationDigest(sessionGenerationContext({
      schemaVersion: SCHEMA_VERSION,
      environment: ENVIRONMENT,
      projectId: PROJECT_ID,
      runId: value.runId,
      cohortDigest: value.cohortDigest,
      slot: value.slot,
      uidHash: value.uidHash,
      trainerHash: value.trainerHash,
      generationId: value.generationId,
      sessionGeneration: value.sessionGeneration,
      firebaseAppIdHash: value.firebaseAppIdHash,
      browserContextDigest: value.browserContextDigest,
      runtimeInstanceDigest: value.runtimeInstanceDigest
    })) === value.sessionGenerationDigest;
}

function canonicalReadiness(value) {
  return [
    SCHEMA_VERSION,
    'group-e-pre-dispatch-readiness',
    ...READINESS_FIELDS.filter((field) => field !== 'readinessDigest').map((field) => value?.[field])
  ];
}

function readinessDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalReadiness(value)), 'utf8').digest('hex');
}

function buildBrowserActionScript(options = {}) {
  const { label, body, origin, pathname, releaseId } = options;
  const requiresSignedIn = options.requiresSignedIn === true;
  const requireCleanExecutionState = options.requireCleanExecutionState === true;
  if (typeof label !== 'string' || !label || label.length > 80 || typeof body !== 'string' || !body ||
      origin !== 'https://doomsday126dev.github.io' || pathname !== '/trade-app/' ||
      !RELEASE_ID.test(releaseId || '') ||
      (options.requiresSignedIn !== undefined && typeof options.requiresSignedIn !== 'boolean') ||
      (options.requireCleanExecutionState !== undefined && typeof options.requireCleanExecutionState !== 'boolean')) {
    fail('GROUP_E_OPERATOR_SCRIPT_INVALID');
  }
  const cleanExecution = requireCleanExecutionState ?
    `if((typeof e1ClientFoundationCanary!=='undefined'&&e1ClientFoundationCanary!==null)||` +
      `window.__groupELiveCanaryController!=null||window.__groupELiveTerminalRecord!=null||` +
      `window.__groupELiveAttemptFailure!=null||window.__groupELiveCapability!=null)` +
      `fail('GROUP_E_STALE_EXECUTION_STATE');\n` : '';
  return `(async()=>{\n` +
    `const fail=c=>{const e=new Error(c);e.code=c;throw e};\n` +
    `const leaseKey=${JSON.stringify(OPERATOR_LEASE_KEY)},legacyKey=${JSON.stringify(LEGACY_OPERATOR_STATE_KEY)};\n` +
    `if(location.origin!==${JSON.stringify(origin)}||location.pathname!==${JSON.stringify(pathname)}||` +
      `window.__POGO_RELEASE_ID!==${JSON.stringify(releaseId)})fail('GROUP_E_WRONG_PRODUCTION_RUNTIME');\n` +
    `if(typeof auth==='undefined'||typeof fbApp==='undefined'||!window.PogoServices?.e1ClientFoundationCanary)` +
      `fail('GROUP_E_RUNTIME_DEPENDENCIES_UNAVAILABLE');\n` +
    `if(window[legacyKey]!==undefined)fail('GROUP_E_STALE_OPERATOR_STATE');\n` +
    `if(window[leaseKey]!==undefined)fail('GROUP_E_OPERATOR_ALREADY_ACTIVE');\n` +
    `const priorButtons=[...document.querySelectorAll('button')].filter(node=>node.dataset?.groupELiveOperatorState);\n` +
    `if(priorButtons.some(node=>node.dataset.groupELiveOperatorState==='active'))` +
      `fail('GROUP_E_STALE_OPERATOR_STATE');\n` +
    `priorButtons.forEach(node=>node.remove());\n` + cleanExecution +
    `const priorOperatorStateClean=true;\n` +
    `const operatorLease=Object.freeze({schemaVersion:1,state:'active',action:${JSON.stringify(label)}});\n` +
    `Object.defineProperty(window,leaseKey,{value:operatorLease,writable:true,configurable:true,enumerable:false});\n` +
    `let button=null,readinessTimer=null,expiryTimer=null;try{\n` +
    `button=document.createElement('button');button.type='button';button.textContent=${JSON.stringify(label)};` +
      `button.style.cssText='position:fixed;z-index:2147483647;right:18px;bottom:18px;padding:14px 18px;background:#087f5b;color:#fff;border:2px solid #fff;border-radius:6px;font:700 15px system-ui;cursor:pointer';` +
      `button.dataset.groupELiveOperator=${JSON.stringify(label)};button.dataset.groupELiveOperatorState='active';` +
      `document.body.appendChild(button);\n` +
    `const release=state=>{if(readinessTimer!==null)clearInterval(readinessTimer);` +
      `if(expiryTimer!==null)clearTimeout(expiryTimer);button.dataset.groupELiveOperatorState=state;` +
      `if(window[leaseKey]===operatorLease)delete window[leaseKey];};\n` +
    (requiresSignedIn ?
      `button.disabled=true;button.textContent='SIGN IN FIRST';readinessTimer=setInterval(()=>{` +
        `if(auth.currentUser?.uid&&typeof cur==='string'&&cur){clearInterval(readinessTimer);readinessTimer=null;` +
        `button.disabled=false;button.textContent=${JSON.stringify(label)};}},200);` +
        `expiryTimer=setTimeout(()=>{if(window[leaseKey]===operatorLease){button.disabled=true;` +
        `button.textContent='EXPIRED - RE-ARM';button.style.background='#6b7280';release('expired');}},5*60*1000);\n` :
      `expiryTimer=setTimeout(()=>{if(window[leaseKey]===operatorLease){button.disabled=true;` +
        `button.textContent='EXPIRED - RE-ARM';button.style.background='#6b7280';release('expired');}},5*60*1000);\n`) +
    `button.addEventListener('click',async()=>{if(button.disabled)return;button.disabled=true;let state='failed';try{${body}` +
      `button.textContent='COPIED - RETURN TO CODEX';button.style.background='#146c43';state='completed';}` +
      `catch(error){button.textContent='FAILED - '+String(error?.code||error?.message||'UNKNOWN').slice(0,80);` +
      `button.style.background='#b42318';throw error;}finally{release(state);}}, {once:true});\n` +
    `console.log(${JSON.stringify(`${label} - SIGN IN, THEN CLICK THE GREEN BUTTON`)});\n` +
    `}catch(error){if(readinessTimer!==null)clearInterval(readinessTimer);if(expiryTimer!==null)clearTimeout(expiryTimer);` +
      `if(window[leaseKey]===operatorLease)delete window[leaseKey];if(button)button.remove();throw error;}\n` +
    `})().catch(error=>{console.error('GROUP E OPERATOR ARM FAILED - '+` +
      `String(error?.code||error?.message||'UNKNOWN'));throw error;})`;
}

function buildPreDispatchReadinessScript(expected) {
  if (!validExpected(expected)) fail('GROUP_E_PRE_DISPATCH_EXPECTED_INVALID');
  const expectedJson = JSON.stringify(expected);
  const expectedFieldJson = JSON.stringify(EXPECTED_FIELDS);
  const runtimeFieldJson = JSON.stringify(RUNTIME_RECORD_FIELDS);
  const canonicalFieldJson = JSON.stringify(READINESS_FIELDS.filter((field) => field !== 'readinessDigest'));
  const body = `
    const expected=${expectedJson};
    const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&
      Object.keys(value).length===fields.length&&fields.every(field=>Object.prototype.hasOwnProperty.call(value,field));
    const runtime=window.__groupELiveRuntimeRecord;
    const runtimeFields=${runtimeFieldJson};
    if(!exact(runtime,runtimeFields))fail('GROUP_E_RUNTIME_RECORD_MISSING');
    for(const field of ${expectedFieldJson}){
      if(field==='origin'||field==='pathname')continue;
      if(runtime[field]!==expected[field])fail('GROUP_E_RUNTIME_RECORD_MISMATCH');
    }
    if(!auth.currentUser?.uid||typeof cur!=='string'||!cur)fail('GROUP_E_SIGNED_IN_SESSION_REQUIRED');
    const svc=window.PogoServices.e1ClientFoundationCanary;
    const uidHash=await svc.subjectHash('uid',auth.currentUser.uid,crypto);
    const trainerHash=await svc.subjectHash('trainer',cur,crypto);
    const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(JSON.stringify(value))))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
    const firebaseAppIdHash=await digest([1,'group-e-firebase-app-id',fbApp.options.appId]);
    const browserContextDigest=await svc.browserContextDigest(location.origin,location.pathname,fbApp.options.appId,crypto);
    const runtimeInstanceDigest=await svc.runtimeInstanceDigest(firebaseAppIdHash);
    const sessionContext={schemaVersion:1,environment:'production',projectId:'trade-list-a4297',
      runId:expected.runId,cohortDigest:expected.cohortDigest,slot:expected.slot,uidHash,trainerHash,
      generationId:expected.generationId,sessionGeneration:_sessionTransientGeneration,firebaseAppIdHash,
      browserContextDigest,runtimeInstanceDigest};
    const currentSessionDigest=await svc.sessionGenerationDigest(sessionContext,crypto);
    if(uidHash!==expected.uidHash||trainerHash!==expected.trainerHash||
      _sessionTransientGeneration!==expected.sessionGeneration||firebaseAppIdHash!==expected.firebaseAppIdHash||
      browserContextDigest!==expected.browserContextDigest||runtimeInstanceDigest!==expected.runtimeInstanceDigest||
      currentSessionDigest!==expected.sessionGenerationDigest)fail('GROUP_E_PRE_DISPATCH_RUNTIME_MISMATCH');
    if(window[legacyKey]!==undefined||window[leaseKey]!==operatorLease||priorOperatorStateClean!==true)
      fail('GROUP_E_PRE_DISPATCH_OPERATOR_INVALID');
    if(typeof window.__pogoCreateGroupEClientFoundationCanary!=='function')
      fail('GROUP_E_CONTROLLER_FACTORY_UNAVAILABLE');
    if((typeof e1ClientFoundationCanary!=='undefined'&&e1ClientFoundationCanary!==null)||
      window.__groupELiveCanaryController!=null||window.__groupELiveTerminalRecord!=null||
      window.__groupELiveAttemptFailure!=null||window.__groupELiveCapability!=null)
      fail('GROUP_E_STALE_EXECUTION_STATE');
    const record={schemaVersion:1,recordType:'group-e-pre-dispatch-readiness',operatorLifecycleVersion:1,
      environment:'production',projectId:'trade-list-a4297',...expected,priorOperatorStateClean:true,
      operatorLeaseExclusive:true,legacyOperatorStateAbsent:true,runtimeRecordMatched:true,
      controllerFactoryAvailable:true,staleControllerAbsent:true,staleTerminalRecordAbsent:true,
      staleAttemptFailureAbsent:true,staleCapabilityStateAbsent:true,callableConstructed:false,
      callableInvoked:false,capturedAt:new Date().toISOString(),readinessDigest:null};
    const canonical=[1,'group-e-pre-dispatch-readiness',...${canonicalFieldJson}.map(field=>record[field])];
    record.readinessDigest=await digest(canonical);
    await navigator.clipboard.writeText(JSON.stringify(record));
  `;
  return buildBrowserActionScript({
    label: `GROUP E ${expected.slot} PRE-DISPATCH READINESS`,
    body,
    origin: expected.origin,
    pathname: expected.pathname,
    releaseId: expected.releaseId,
    requiresSignedIn: true,
    requireCleanExecutionState: true
  });
}

function validatePreDispatchReadiness(value, expected, options = {}) {
  if (!validExpected(expected)) fail('GROUP_E_PRE_DISPATCH_EXPECTED_INVALID');
  const now = options.now === undefined ? Date.now() : options.now;
  const capturedAt = Date.parse(value?.capturedAt);
  if (!Number.isFinite(now) || !exactFields(value, READINESS_FIELDS) || value.schemaVersion !== SCHEMA_VERSION ||
      value.recordType !== RECORD_TYPE || value.operatorLifecycleVersion !== OPERATOR_LIFECYCLE_VERSION ||
      value.environment !== ENVIRONMENT || value.projectId !== PROJECT_ID ||
      EXPECTED_FIELDS.some((field) => value[field] !== expected[field]) ||
      BOOLEAN_PROOFS.some((field) => value[field] !== true) || value.callableConstructed !== false ||
      value.callableInvoked !== false || !Number.isFinite(capturedAt) || capturedAt > now + 5000 ||
      now - capturedAt > PRE_DISPATCH_MAX_AGE_MS || !HASH.test(value.readinessDigest || '') ||
      value.readinessDigest !== readinessDigest(value) ||
      sessionGenerationDigest(sessionGenerationContext(value)) !== value.sessionGenerationDigest) {
    fail('GROUP_E_PRE_DISPATCH_READINESS_INVALID');
  }
  return Object.freeze(structuredClone(value));
}

module.exports = Object.freeze({
  BUTTON_ATTRIBUTE,
  LEGACY_OPERATOR_STATE_KEY,
  OPERATOR_LEASE_KEY,
  OPERATOR_LIFECYCLE_VERSION,
  PRE_DISPATCH_MAX_AGE_MS,
  READINESS_FIELDS,
  buildBrowserActionScript,
  buildPreDispatchReadinessScript,
  canonicalReadiness,
  readinessDigest,
  validatePreDispatchReadiness
});
