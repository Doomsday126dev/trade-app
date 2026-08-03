const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {root,fixture}=require('./helpers/identity-review-fixture.cjs');

function domain(){
  const context={window:{}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,'js/domain/identityConflictDiagnostics.js'),'utf8'),context);
  return context.window.PogoDomain.identityConflictDiagnostics;
}

function diagnostics(){
  const value=fixture();
  const result=domain().deriveIdentityConflictDiagnostics({report:value.report,sources:value.sources,actualSnapshotHashes:value.snapshotHashes});
  assert.equal(result.ok,true);
  return result.value;
}

function record(value,name){return value.records.find(item=>item.trainerName===name);}

test('duplicate conflicts expose every UID candidate without selecting a winner',()=>{
  const item=record(diagnostics(),'DuplicateTrainer');
  assert.equal(item.suggestedDisposition,'conflict_review');
  assert.equal(item.reviewDecision,'unreviewed');
  assert.equal(item.seedEligible,false);
  assert.equal(item.uidEvidence.length,2);
  assert.equal(item.uidEvidence.filter(evidence=>evidence.matchesUserAuthUid).length,1);
  assert.equal(item.uidEvidence.filter(evidence=>evidence.authIndexUsernameMatchesTrainer).length,2);
  assert.equal(Object.prototype.hasOwnProperty.call(item,'winningUid'),false);
});

test('UID mismatches distinguish the bound UID from the conflicting index UID',()=>{
  const item=record(diagnostics(),'MismatchTrainer');
  assert.equal(item.suggestedDisposition,'conflict_review');
  assert.equal(item.uidEvidence.length,2);
  assert.equal(item.uidEvidence.filter(evidence=>evidence.matchesUserAuthUid&&evidence.existsInSanitizedAuth).length,1);
  assert.equal(item.uidEvidence.filter(evidence=>evidence.authIndexUsernameMatchesTrainer&&!evidence.matchesUserAuthUid).length,1);
});

test('protected records remain manual even when their mappings agree',()=>{
  const item=record(diagnostics(),'ProtectedTrainer');
  assert.equal(item.suggestedDisposition,'protected_review');
  assert.equal(item.uidEvidence[0].protectedAdmin,true);
  assert.equal(item.reviewDecision,'unreviewed');
});

test('unassociated Auth identities remain holds with provider facts only',()=>{
  const value=diagnostics();
  const item=value.records.find(record=>record.trainerName===null&&record.reasonCodes.includes('username_missing'));
  assert.equal(item.suggestedDisposition,'unassociated_hold');
  assert.equal(item.uidEvidence.length,1);
  assert.equal(item.uidEvidence[0].existsInSanitizedAuth,true);
  assert.equal(item.uidEvidence[0].authIndexPresent,false);
});

test('clean missing indexes remain passive login candidates and legacy records remain held',()=>{
  const value=diagnostics();
  assert.equal(record(value,'PassiveTrainer').suggestedDisposition,'passive_login');
  assert.equal(record(value,'LegacyTrainer').suggestedDisposition,'legacy_hold');
  assert.equal(record(value,'ReadyTrainer').suggestedDisposition,'no_action');
});

test('source evidence includes only approved account state and history facts',()=>{
  const item=record(diagnostics(),'DuplicateTrainer');
  assert.deepEqual(JSON.parse(JSON.stringify(item.sourceEvidence.user)),{
    present:true,valid:true,authUid:'uid-duplicate-current',joinedAt:1,lastSeenAt:2,lastUpdatedAt:3
  });
  assert.equal(item.sourceEvidence.authIndex.rowsForUsername,2);
  assert.equal(JSON.stringify(item).includes('email'),true);
  assert.equal(JSON.stringify(item).includes('@'),false);
});

test('hash mismatches mark diagnostics stale without making ownership decisions',()=>{
  const value=fixture();
  const hashes={...value.snapshotHashes,authIndex:'changed'};
  const result=domain().deriveIdentityConflictDiagnostics({report:value.report,sources:value.sources,actualSnapshotHashes:hashes});
  assert.equal(result.ok,true);
  assert.equal(result.value.freshness.stale,true);
  assert.deepEqual(Array.from(result.value.freshness.mismatchedSources),['authIndex']);
  assert.ok(result.value.records.every(item=>item.reviewDecision==='unreviewed'&&item.seedEligible===false));
});

test('authority exclusions and domain identifiers remain locale independent',()=>{
  const value=diagnostics();
  assert.deepEqual(Array.from(value.ignoredAuthoritySignals),[
    'email_prefix','firebase_display_name','pokemon_lists','public_shares','community_membership','profile_privilege_flags','similar_trainer_names'
  ]);
  assert.ok(value.records.every(item=>/^[a-z0-9_]+$/.test(item.suggestedDisposition)));
});

test('raw Auth fields and malformed sanitized identities are rejected',()=>{
  const value=fixture();
  value.sources.authInput.identities[0].email='private@example.test';
  let result=domain().deriveIdentityConflictDiagnostics({report:value.report,sources:value.sources,actualSnapshotHashes:value.snapshotHashes});
  assert.equal(result.ok,false);
  assert.equal(result.error.code,'forbidden_auth_input_field');
  delete value.sources.authInput.identities[0].email;
  delete value.sources.authInput.identities[0].disabled;
  result=domain().deriveIdentityConflictDiagnostics({report:value.report,sources:value.sources,actualSnapshotHashes:value.snapshotHashes});
  assert.equal(result.ok,false);
  assert.equal(result.error.code,'malformed_auth_identity');
});
