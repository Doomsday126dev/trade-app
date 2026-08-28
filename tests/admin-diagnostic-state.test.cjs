const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(path.join(__dirname,'..'));
function between(start,end){
  const from=html.indexOf(start),to=html.indexOf(end,from);
  assert.notEqual(from,-1);assert.notEqual(to,-1);
  return html.slice(from,to);
}
function diagnostic(overrides){
  const context=vm.createContext({Object});
  vm.runInContext(`const MULTI_COMMUNITY_ENABLED=true;const TRAINER_FIRST_INTERIM_ENABLED=true;${between('function communityFeatureDiagnostic','function ownerCommunityPreviewOn')}`,context);
  context.input=overrides;
  return vm.runInContext('communityFeatureDiagnostic(input)',context);
}

test('ADMIN-01 derives enabled-interim diagnostics from the current canonical flags',()=>{
  const value=diagnostic();
  assert.equal(value.state,'enabled-interim');
  assert.equal(value.messageKey,'admin.communityDiagnosticInterim');
  assert.equal(Object.isFrozen(value),true);
});

test('ADMIN-01 distinguishes disabled legacy compatibility and fully enabled states',()=>{
  assert.equal(diagnostic({multiCommunityEnabled:false,trainerFirstInterimEnabled:true}).state,'legacy-compatibility');
  assert.equal(diagnostic({multiCommunityEnabled:true,trainerFirstInterimEnabled:false}).state,'enabled');
});

test('ADMIN-01 diagnostic derivation never mutates the authoritative input flags',()=>{
  const input={multiCommunityEnabled:false,trainerFirstInterimEnabled:false};
  const before=JSON.stringify(input);
  diagnostic(input);
  assert.equal(JSON.stringify(input),before);
});

test('ADMIN-01 panel renders the current derived state and contains no stale hard-coded flag claim',()=>{
  const panel=between('function renderCommunityMigrationPanel','async function prepareDefaultCommunity');
  assert.match(panel,/const featureDiagnostic=communityFeatureDiagnostic\(\)/);
  assert.match(panel,/data-community-diagnostic-state="\$\{escAttr\(featureDiagnostic\.state\)\}"/);
  assert.match(panel,/i18nCore\.t\(featureDiagnostic\.messageKey\)/);
  assert.doesNotMatch(panel,/MULTI_COMMUNITY_ENABLED=false/);
});

