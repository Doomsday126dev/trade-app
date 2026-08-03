const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {privateRoot}=require('../scripts/lib/identity-review-source-reader.cjs');
const {buildPrivateReviewArtifact,writePrivateReviewArtifact,reviewAggregateLines}=require('../scripts/lib/private-identity-review.cjs');
const {run,parseArgs}=require('../scripts/build-identity-review.js');
const {fixture,writeFixtureFiles}=require('./helpers/identity-review-fixture.cjs');
const vm=require('vm');

function diagnostics(stale=false){
  const value=fixture();
  const context={window:{}};vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/domain/identityConflictDiagnostics.js'),'utf8'),context);
  const hashes={...value.snapshotHashes,...(stale?{users:'changed'}:{})};
  return{value:context.window.PogoDomain.identityConflictDiagnostics.deriveIdentityConflictDiagnostics({report:value.report,sources:value.sources,actualSnapshotHashes:hashes}).value,metadata:{sourceReportHash:'a'.repeat(64),expectedSnapshotHashes:value.snapshotHashes,actualSnapshotHashes:hashes}};
}

test('private artifact is non-executable, unreviewed, and never seed eligible',()=>{
  const input=diagnostics();
  const artifact=buildPrivateReviewArtifact(input.value,input.metadata,{generatedAt:'2026-08-03T00:00:00.000Z'});
  const text=JSON.stringify(artifact);
  assert.equal(artifact.constraints.executable,false);
  assert.equal(artifact.constraints.createsOwnershipDecision,false);
  assert.ok(artifact.records.every(record=>record.reviewDecision==='unreviewed'&&record.seedEligible===false));
  assert.doesNotMatch(text,/approvalManifest|firebaseUpdate|rollbackWrite|seedCommand|reservationRequest|writePayload|curl\s|firebase\s+database/i);
});

test('artifact records source report hash and clearly marks stale inputs',()=>{
  const input=diagnostics(true);
  const artifact=buildPrivateReviewArtifact(input.value,input.metadata);
  assert.equal(artifact.sourceReport.sha256,'a'.repeat(64));
  assert.equal(artifact.sourceReport.expectedSnapshotHashes.users,input.metadata.expectedSnapshotHashes.users);
  assert.equal(artifact.sourceReport.actualSnapshotHashes.users,'changed');
  assert.equal(artifact.freshness.stale,true);
  assert.match(artifact.freshness.warning,/Do not use this artifact for decisions/);
});

test('artifact writer confines output and enforces mode 0600',()=>{
  const input=diagnostics();
  const artifact=buildPrivateReviewArtifact(input.value,input.metadata);
  const output=path.join(privateRoot,'reviews','permission-test.json');
  try{
    writePrivateReviewArtifact(artifact,output);
    assert.equal(fs.statSync(output).mode&0o777,0o600);
    assert.equal(fs.statSync(path.dirname(output)).mode&0o777,0o700);
    assert.throws(()=>writePrivateReviewArtifact(artifact,path.join(os.tmpdir(),'outside-review.json')),error=>error.code==='review_output_outside_private_root');
  }finally{fs.rmSync(output,{force:true});}
});

test('artifact writer rejects a symlinked parent outside the private root',()=>{
  const input=diagnostics();
  const artifact=buildPrivateReviewArtifact(input.value,input.metadata);
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'identity-review-output-'));
  const link=path.join(privateRoot,'review-escape-link');
  try{
    fs.rmSync(link,{recursive:true,force:true});
    fs.symlinkSync(outside,link);
    assert.throws(()=>writePrivateReviewArtifact(artifact,path.join(link,'review.json')),error=>error.code==='review_output_outside_private_root');
    assert.equal(fs.existsSync(path.join(outside,'review.json')),false);
  }finally{fs.rmSync(link,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});

test('aggregate output contains counts only and no private identity details',()=>{
  const input=diagnostics();
  const artifact=buildPrivateReviewArtifact(input.value,input.metadata);
  const text=reviewAggregateLines(artifact).join('\n');
  assert.match(text,/conflict_review:/);
  assert.doesNotMatch(text,/DuplicateTrainer|uid-duplicate|@/);
});

test('thin CLI creates a private synthetic review without production access',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'identity-review-cli-'));
  const output=path.join(privateRoot,'reviews','cli-test.json');
  const lines=[];const original=console.log;
  try{
    const value=writeFixtureFiles(directory);
    console.log=line=>lines.push(String(line));
    await run(['--source','fixture','--report',value.files.report,'--rtdb-input',value.files.rtdb,'--auth-input',value.files.auth,'--output',output]);
    const artifact=JSON.parse(fs.readFileSync(output,'utf8'));
    assert.equal(artifact.freshness.stale,false);
    assert.ok(artifact.records.every(record=>record.reviewDecision==='unreviewed'));
    assert.doesNotMatch(lines.join('\n'),/DuplicateTrainer|uid-duplicate/);
  }finally{console.log=original;fs.rmSync(directory,{recursive:true,force:true});fs.rmSync(output,{force:true});}
});

test('CLI rejects credential, network, and write-oriented options',()=>{
  for(const option of ['--production','--auth-token','--service-account','--write','--seed']){
    assert.throws(()=>parseArgs([option,'x']),/Unsupported CLI option/);
  }
});
