const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {privateRoot,readIdentityReviewInputs}=require('../scripts/lib/identity-review-source-reader.cjs');
const {writeFixtureFiles}=require('./helpers/identity-review-fixture.cjs');

test('fixture reader loads only the report, four RTDB roots, and sanitized Auth input',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'identity-review-fixture-'));
  try{
    const value=writeFixtureFiles(directory);
    const result=readIdentityReviewInputs({source:'fixture',report:value.files.report,rtdbInput:value.files.rtdb,authInput:value.files.auth});
    assert.deepEqual(Object.keys(result.sources).sort(),['admins','authIndex','authInput','loginDirectory','users']);
    assert.equal(result.metadata.sourceReportHash.length,64);
    assert.deepEqual(result.metadata.actualSnapshotHashes,value.snapshotHashes);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('reader rejects production/network modes and unapproved RTDB roots',()=>{
  assert.throws(()=>readIdentityReviewInputs({source:'production'}),error=>error.code==='review_source_unsupported');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'identity-review-extra-'));
  try{
    const value=writeFixtureFiles(directory);
    const rtdb=JSON.parse(fs.readFileSync(value.files.rtdb,'utf8'));
    rtdb.wishlist={};
    fs.writeFileSync(value.files.rtdb,JSON.stringify(rtdb));
    assert.throws(()=>readIdentityReviewInputs({source:'fixture',report:value.files.report,rtdbInput:value.files.rtdb,authInput:value.files.auth}),error=>error.code==='review_source_root_unapproved');
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('private mode confines every input to the ignored private root',()=>{
  const directory=fs.mkdtempSync(path.join(privateRoot,'source-test-'));
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'identity-review-outside-'));
  try{
    const value=writeFixtureFiles(directory);
    Object.values(value.files).forEach(file=>fs.chmodSync(file,0o600));
    const result=readIdentityReviewInputs({source:'private',report:value.files.report,rtdbInput:value.files.rtdb,authInput:value.files.auth});
    assert.equal(result.metadata.source,'private');
    fs.chmodSync(value.files.auth,0o644);
    assert.throws(()=>readIdentityReviewInputs({source:'private',report:value.files.report,rtdbInput:value.files.rtdb,authInput:value.files.auth}),error=>error.code==='review_input_permissions');
    fs.chmodSync(value.files.auth,0o600);
    const outsideValue=writeFixtureFiles(outside);
    assert.throws(()=>readIdentityReviewInputs({source:'private',report:outsideValue.files.report,rtdbInput:value.files.rtdb,authInput:value.files.auth}),error=>error.code==='review_input_outside_private_root');
  }finally{fs.rmSync(directory,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});

test('source reader contains no network or write-capable Firebase method',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../scripts/lib/identity-review-source-reader.cjs'),'utf8');
  assert.doesNotMatch(source,/\bfetch\b|https?:|firebase-admin|serviceAccount|database\.(?:set|update|remove|push)|method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/i);
});
