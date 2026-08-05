const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {privateRoot}=require('../scripts/lib/identity-review-source-reader.cjs');
const {
  buildArtifact,verifyArtifact,applyDecision,writePrivateJson,readPrivateJson,
  privateInspection,aggregateOutput
}=require('../scripts/lib/private-share-migration-review.cjs');
const {parseArgs,run}=require('../scripts/review-share-visibility-migration.js');

const repoRoot=path.resolve(__dirname,'..');
function domain(){const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(repoRoot,'js/domain/shareMigrationReview.js'),'utf8'),context);return context.window.PogoDomain.shareMigrationReview;}
function row(name,id,overrides={}){
  return{
    trainerName:name,normalizedTrainerName:name.toLowerCase(),uid:`uid-${id}`,recordId:`share-${id}`,
    classification:'unresolved',reviewClassification:null,reasonCodes:[],seedEligible:false,
    facts:{directoryPresent:true,directoryReady:true,userPresent:true,authIndexConsistent:true,authIdentityPresent:true,authIdentityEnabled:true,protectedAccount:false,projectionPresent:true,projectionStatus:'published',projectionEntryCount:1,changedByTrimming:false,changedByNfkc:false},
    ...overrides
  };
}
function sourceReport(){
  const records=[
    row('Protected','protected',{classification:'protected_account',facts:{...row('x','x').facts,protectedAccount:true}}),
    row('ConflictA','conflict-a',{uid:'uid-shared',classification:'identity_mapping_conflict'}),
    row('ConflictB','conflict-b',{uid:'uid-shared',classification:'identity_mapping_conflict'}),
    row('BadIndex','bad-index',{reasonCodes:['auth_index_linkage_invalid'],facts:{...row('x','x').facts,authIndexConsistent:false}}),
    row('Reviewable','reviewable',{classification:'valid_complete_projection',reviewClassification:'individually_reviewable'}),
    row('Unresolved','unresolved',{classification:'unresolved',uid:null,reasonCodes:['user_uid_missing'],facts:{...row('x','x').facts,userPresent:false,authIndexConsistent:false,authIdentityPresent:false,authIdentityEnabled:null}}),
    row('Missing','missing',{classification:'missing_projection',facts:{...row('x','x').facts,projectionPresent:false,projectionStatus:'not_published',projectionEntryCount:null}}),
    row('Incomplete','incomplete',{classification:'incomplete_profile_only',reasonCodes:['projection_completeness_markers_missing','projection_missing_list_projection'],facts:{...row('x','x').facts,projectionStatus:'projection_incomplete',projectionEntryCount:null}})
  ];
  return{schemaVersion:1,toolVersion:'share-migration-audit-v1',generatedAt:'2026-08-05T16:08:25.000Z',source:{kind:'production',targetVerified:true,snapshotHashes:{loginDirectory:'a',users:'b',authIndex:'c',admins:'d',authInput:'e',publicShares:'f'}},records};
}
function sourceBytes(report=sourceReport()){return Buffer.from(`${JSON.stringify(report,null,2)}\n`);}
function derived(report=sourceReport()){const result=domain().deriveManualReview(report);assert.equal(result.ok,true);return result.value;}
function artifact(){const report=sourceReport(),bytes=sourceBytes(report);return{report,bytes,value:buildArtifact(derived(report),report,bytes,{createdAt:'2026-08-05T17:00:00.000Z'})};}

test('every finding becomes one unreviewed and permanently non-seedable record',()=>{
  const value=derived();assert.equal(value.records.length,8);assert.ok(value.records.every(record=>record.reviewerDecision==='unreviewed'&&record.seedEligible===false));
});
test('queue ordering is protected conflict linkage reviewable unresolved then projections',()=>{
  assert.deepEqual(Array.from(derived().records.map(record=>record.queue)),['protected_accounts','duplicate_conflicts','duplicate_conflicts','invalid_uid_authindex_linkage','individually_reviewable','unresolved_records','missing_incomplete_projections','missing_incomplete_projections']);
});
test('duplicate candidates are private report IDs and no winning UID is selected',()=>{
  const record=derived().records.find(item=>item.recordId==='share-conflict-a');assert.deepEqual(Array.from(record.duplicateCandidates),['share-conflict-b']);assert.equal(Object.hasOwn(record,'winningUid'),false);
});
test('high confidence requires complete authoritative identity corroboration',()=>{
  const records=derived().records;assert.equal(records.find(item=>item.recordId==='share-reviewable').confidence,'high');assert.equal(records.find(item=>item.recordId==='share-bad-index').confidence,'low');assert.equal(records.find(item=>item.recordId==='share-unresolved').confidence,'unknown');
  assert.ok(records.find(item=>item.recordId==='share-reviewable').evidenceSummary.excludedAsAuthority.includes('community_membership'));
});
test('projection states distinguish no projection markers missing and incomplete lists',()=>{
  const records=derived().records;assert.equal(records.find(item=>item.recordId==='share-missing').publicProjectionStatus,'no_projection');assert.equal(records.find(item=>item.recordId==='share-incomplete').publicProjectionStatus,'projection_incomplete');
});
test('private artifact records source hashes immutable evidence and diagnostic constraints',()=>{
  const input=artifact();assert.equal(input.value.sourceAudit.sha256,require('crypto').createHash('sha256').update(input.bytes).digest('hex'));assert.equal(input.value.constraints.diagnosticOnly,true);assert.equal(input.value.constraints.productionWrites,0);assert.ok(input.value.records.every(record=>record.evidenceHash&&record.seedEligible===false));assert.equal(verifyArtifact(input.value,input.bytes),true);
});
test('review decisions update only local fields and append hash-chained history',()=>{
  const input=artifact(),record=input.value.records.find(item=>item.recordId==='share-reviewable');const beforeEvidence=record.evidenceHash;
  const next=applyDecision(input.value,input.bytes,{recordId:record.recordId,decision:'confirmed_valid_identity',note:'Owner reviewed locally.',reviewedAt:'2026-08-05T18:00:00.000Z',allowedDecision:domain().allowedDecision});
  const updated=next.records.find(item=>item.recordId===record.recordId);assert.equal(updated.evidenceHash,beforeEvidence);assert.equal(updated.seedEligible,false);assert.equal(next.reviewHistory.length,1);assert.equal(next.reviewHistory[0].previousDecision,'unreviewed');assert.equal(verifyArtifact(next,input.bytes),true);
});
test('a second local decision retains the first action in append-only history',()=>{
  const input=artifact(),record=input.value.records.find(item=>item.recordId==='share-unresolved');let next=applyDecision(input.value,input.bytes,{recordId:record.recordId,decision:'insufficient_evidence',reviewedAt:'2026-08-05T18:00:00.000Z',allowedDecision:domain().allowedDecision});next=applyDecision(next,input.bytes,{recordId:record.recordId,decision:'requires_owner_confirmation',reviewedAt:'2026-08-05T19:00:00.000Z',allowedDecision:domain().allowedDecision});assert.equal(next.reviewHistory.length,2);assert.equal(next.reviewHistory[1].previousEventHash,next.reviewHistory[0].eventHash);assert.equal(next.reviewHistory[0].newDecision,'insufficient_evidence');
});
test('invalid decisions and unsafe protected or conflict labels are rejected',()=>{
  const input=artifact(),allow=domain().allowedDecision;assert.throws(()=>applyDecision(input.value,input.bytes,{recordId:'share-reviewable',decision:'approve_seed',allowedDecision:allow}),error=>error.code==='review/decision_invalid');assert.throws(()=>applyDecision(input.value,input.bytes,{recordId:'share-protected',decision:'confirmed_valid_identity',allowedDecision:allow}),error=>error.code==='review/decision_invalid');assert.throws(()=>applyDecision(input.value,input.bytes,{recordId:'share-conflict-a',decision:'confirmed_valid_identity',allowedDecision:allow}),error=>error.code==='review/decision_invalid');
});
test('evidence and history tampering are detected',()=>{
  const input=artifact(),evidence=JSON.parse(JSON.stringify(input.value));evidence.records[0].classification='valid_complete_projection';assert.throws(()=>verifyArtifact(evidence,input.bytes),error=>error.code==='review/evidence_tampered');
  const next=applyDecision(input.value,input.bytes,{recordId:'share-reviewable',decision:'confirmed_valid_identity',allowedDecision:domain().allowedDecision}),history=JSON.parse(JSON.stringify(next));history.reviewHistory[0].newDecision='confirmed_conflict';assert.throws(()=>verifyArtifact(history,input.bytes),error=>error.code==='review/history_tampered');
});
test('a changed source audit hash requires regeneration',()=>{const input=artifact();assert.throws(()=>verifyArtifact(input.value,Buffer.from('changed')),error=>error.code==='review/source_audit_changed');});
test('missing projections never produce a projection or migration payload',()=>{const input=artifact(),text=JSON.stringify(input.value);assert.doesNotMatch(text,/firebaseUpdate|migrationPayload|seedManifest|writePayload|reservationRequest|projectionPayload|seedCommand/);assert.equal(input.value.records.find(record=>record.recordId==='share-missing').seedEligible,false);});
test('private reports and inspections are confined and mode 0600',()=>{
  const input=artifact(),review=path.join(privateRoot,'reviews','share-review-test.json'),inspection=path.join(privateRoot,'reviews','share-inspection-test.json');
  try{writePrivateJson(input.value,review,'review');writePrivateJson(privateInspection(input.value,'share-conflict-a'),inspection,'inspection');assert.equal(fs.statSync(review).mode&0o777,0o600);assert.equal(fs.statSync(inspection).mode&0o777,0o600);assert.throws(()=>writePrivateJson(input.value,path.join('/tmp','outside-review.json'),'review'),error=>error.code==='review/private_path_outside_root');}finally{fs.rmSync(review,{force:true});fs.rmSync(inspection,{force:true});}
});
test('aggregate output contains only approved counts and hashes',()=>{
  const input=artifact(),bytes=Buffer.from(`${JSON.stringify(input.value)}\n`),output=aggregateOutput(input.value,bytes);const text=JSON.stringify(output);assert.equal(output.writes,0);assert.match(text,/queueCounts/);assert.doesNotMatch(text,/Protected|ConflictA|uid-|share-conflict|\.local|public_projection_entry_count/);
});
test('CLI creates summarizes inspects and decides using private files only',async()=>{
  const base=path.join(privateRoot,'tests'),source=path.join(base,'share-review-source.json'),review=path.join(base,'share-review-cli.json'),inspection=path.join(base,'share-review-inspection.json'),note=path.join(base,'share-review-note.txt');const report=sourceReport(),lines=[],original=console.log;
  try{
    fs.mkdirSync(base,{recursive:true,mode:0o700});fs.writeFileSync(source,sourceBytes(report),{mode:0o600});fs.writeFileSync(note,'Private local note\n',{mode:0o600});console.log=value=>lines.push(String(value));
    await run(['create','--source-audit',source,'--output',review]);await run(['inspect','--source-audit',source,'--review',review,'--record-id','share-conflict-a','--private-output',inspection]);await run(['decide','--source-audit',source,'--review',review,'--record-id','share-conflict-a','--decision','confirmed_conflict','--note-file',note]);await run(['summary','--source-audit',source,'--review',review]);
    const saved=readPrivateJson(review,'review').value;assert.equal(saved.records.find(record=>record.recordId==='share-conflict-a').reviewerDecision,'confirmed_conflict');assert.equal(saved.reviewHistory.length,1);assert.doesNotMatch(lines.join('\n'),/ConflictA|uid-shared|share-conflict|Private local note|\.local/);
  }finally{console.log=original;for(const file of [source,review,inspection,note])fs.rmSync(file,{force:true});}
});
test('CLI rejects production credentials and write-oriented options',()=>{for(const option of ['--production','--firebase-cli','--auth-token','--service-account','--credential','--apply','--write','--seed','--repair'])assert.throws(()=>parseArgs(['create',option,'x']),/Unsupported CLI option/);});
test('review implementation has no network Firebase or Admin SDK capability',()=>{
  const text=['scripts/review-share-visibility-migration.js','scripts/lib/private-share-migration-review.cjs'].map(file=>fs.readFileSync(path.join(repoRoot,file),'utf8')).join('\n');assert.doesNotMatch(text,/firebase-admin|database:(?:set|update|remove)|fetch\s*\(|https?:\/\//i);
});
