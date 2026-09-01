const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js/domain/authenticationReadiness.js'),'utf8');
function load(){const window={};window.window=window;vm.runInContext(source,vm.createContext({window}));return window.PogoDomain.legacyProvisioningFreeze;}
function freeze(overrides={}){return{schemaVersion:1,state:'active',provisioningModel:'bounded-legacy-provisioning-freeze',freezeId:'legacy-freeze-review-0001',provisioningContractDigest:'a'.repeat(64),activatedAt:100,releasedAt:null,...overrides};}
function certification(overrides={}){return{schemaVersion:2,state:'certified',provisioningModel:'bounded-legacy-provisioning-freeze',freezeId:'legacy-freeze-review-0001',provisioningContractDigest:'a'.repeat(64),legacyNamespaceCoverageCertified:true,activeLegacyHandleCount:58,certifiedHandleCount:58,expiresAt:1000,...overrides};}

test('legacy creation is open before activation and fail-closed for active or malformed freeze evidence',()=>{
  const model=load();assert.equal(model.legacyCreationDecision(null).ok,true);
  assert.equal(model.legacyCreationDecision(freeze()).code,'legacy-provisioning/frozen');
  assert.equal(model.legacyCreationDecision({...freeze(),unexpected:true}).code,'legacy-provisioning/freeze-invalid');
});

test('release reopens legacy creation and immediately invalidates provider certification',()=>{
  const model=load(),active=freeze(),released=freeze({state:'released',releasedAt:200});
  assert.equal(model.certificationMatches(active,certification(),500),true);
  assert.equal(model.legacyCreationDecision(released).ok,true);assert.equal(model.certificationMatches(released,certification(),500),false);
});

test('repair policy permits only an existing exact-handle identity repair',()=>{
  const model=load(),record={authUid:'uid-old'};
  assert.equal(model.existingIdentityRepairDecision({freeze:freeze(),existingHandle:'Trainer',targetHandle:'Trainer',existingRecord:record,nextRecord:{authUid:'uid-old'}}).ok,true);
  assert.equal(model.existingIdentityRepairDecision({freeze:freeze(),existingHandle:'Trainer',targetHandle:'Trainer',existingRecord:record,nextRecord:{authUid:'uid-new'}}).code,'legacy-provisioning/repair-uid-change');
  assert.equal(model.existingIdentityRepairDecision({existingHandle:'Trainer',targetHandle:'Trainer',existingRecord:record,nextRecord:{authUid:'uid-new'}}).ok,true);
  assert.equal(model.existingIdentityRepairDecision({existingHandle:'Trainer',targetHandle:'Renamed',existingRecord:record,nextRecord:{authUid:'uid-old'}}).ok,false);
});

test('candidate digest binds the exact generated Rules and guarded provisioning surfaces',()=>{
  const contract=require('../functions/production/legacy-provisioning-contract.json');
  const rules=fs.readFileSync(path.join(root,'tests/firebase/database.rules.legacy-provisioning-freeze.json'),'utf8');
  const crypto=require('node:crypto');
  assert.equal(crypto.createHash('sha256').update(rules).digest('hex'),contract.candidateRulesSha256);
  assert.deepEqual(contract.guardedPaths,['users/{username}','loginDirectory/{username}','requests/{requestId}:approved','authIndex/{uid}']);
  assert.match(contract.provisioningContractDigest,/^[a-f0-9]{64}$/);
});

test('every supported legacy activation path converges on the guarded creator while production enforcement remains false',()=>{
  const app=fs.readFileSync(path.join(root,'js/app/application.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const creator=app.slice(app.indexOf('async function createMemberNow'),app.indexOf('function generatedFirstTimePin'));
  assert.ok((creator.match(/assertLegacyProvisioningCreationAllowed\(\)/g)||[]).length>=2);
  assert.match(app,/await createMemberNow\(name,pin,isAdmin\)/);
  assert.match(app,/await createMemberNow\(username,pin,false,reqId\)/);
  assert.match(app,/freeze:await readLegacyProvisioningFreeze\(\),existingHandle:username,targetHandle:username/);
  assert.match(html,/window\.__POGO_LEGACY_PROVISIONING_ENFORCEMENT__=false/);
  assert.doesNotMatch(html,/window\.__POGO_LEGACY_PROVISIONING_ENFORCEMENT__=true/);
});
