'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const inventory=require('../scripts/sec02/request-inventory.cjs');
const cli=require('../scripts/sec02/inventory-request-access.cjs');
const fixturePath=path.join(root,'scripts/sec02/fixtures/request-inventory.json');
const fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
const now=Date.parse('2026-01-01T00:00:00Z');

test('fixture matrix produces aggregate-only deterministic output and digest',()=>{
  const first=inventory.aggregateRequests(fixture,{executionTimeMs:now});
  const second=inventory.aggregateRequests(JSON.parse(JSON.stringify(fixture)),{executionTimeMs:now});
  assert.equal(inventory.stableJson(first),inventory.stableJson(second));
  assert.equal(inventory.digestReport(first),inventory.digestReport(second));
  assert.match(inventory.digestReport(first),/^[0-9a-f]{64}$/u);
  const output=inventory.stableJson(first);
  for(const value of ['Alpha Trainer','Unicode ポケモン','first synthetic duplicate-looking name','req_1700000000000_a'])assert.doesNotMatch(output,new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'u'));
});

test('field shapes and unknown children contain names and aggregate counts only',()=>{
  const report=inventory.aggregateRequests(fixture,{executionTimeMs:now});
  assert.equal(report.recordCount,27);
  assert.equal(report.fieldSets.exactCanonicalFourFieldShape,23);
  assert.equal(report.fieldSets.missing.note,1);
  assert.equal(report.fieldSets.missing.status,1);
  assert.deepEqual(report.unknownChildren,[{field:'legacyFlag',count:1},{field:'metadata',count:1}]);
  assert.equal(report.fieldSets.nestedObjectCount,2);
  assert.ok(report.fieldSets.distinctShapes.some(shape=>shape.fields.join(',')==='note,requestedAt,status,username'));
});

test('key classifier covers canonical and every reviewed noncanonical family without IDs',()=>{
  const report=inventory.aggregateRequests(fixture,{executionTimeMs:now});
  assert.equal(report.keys.canonical,21);
  assert.equal(report.keys.noncanonical,6);
  assert.deepEqual(report.keys.classifications,{wrongPrefix:1,timestampInvalid:1,suffixMissing:1,suffixTooLong:1,uppercaseOrNonBase36Suffix:2,other:0});
  assert.equal(report.keys.suffixLengthDistribution['1'],4);
  assert.equal(report.keys.suffixLengthDistribution['5'],1);
});

test('inventory buckets, Unicode, controls and types remain compatibility evidence rather than limits',()=>{
  const report=inventory.aggregateRequests(fixture,{executionTimeMs:now});
  assert.equal(report.username.typeCounts.number,1);
  assert.equal(report.username.unicodeNonAscii,1);
  assert.equal(report.username.controlCharacterBearing,2);
  assert.equal(report.username.underCurrentMinimumTwo,1);
  assert.equal(report.note.missing,1);
  assert.equal(report.note.typeCounts.object,1);
  assert.equal(report.note.whitespaceOnly,1);
  assert.equal(report.note.controlCharacterBearing,2);
  assert.equal(report.note.leadingOrTrailingWhitespace,1);
  assert.match(report.note.trimmedCodePointLength.label,/not validation policy/u);
  assert.equal(report.compatibility.automaticPolicySelection,false);
});

test('timestamp analysis reports types, invalid values, range, skew and future evidence',()=>{
  const report=inventory.aggregateRequests(fixture,{executionTimeMs:now});
  assert.equal(report.requestedAt.typeCounts.string,1);
  assert.ok(report.requestedAt.nonInteger>=2);
  assert.equal(report.requestedAt.negative,1);
  assert.equal(report.requestedAt.numericMinimum,-1);
  assert.equal(report.requestedAt.numericMaximum,4102444800000);
  assert.ok(report.requestedAt.keyPayloadRelationship.equal>0);
  assert.ok(report.requestedAt.keyPayloadRelationship.payloadAfterKey>0);
  assert.equal(report.requestedAt.obviousFuture,1);
});

test('status aggregation may expose categorical labels but no record-level values',()=>{
  const report=inventory.aggregateRequests(fixture,{executionTimeMs:now});
  assert.ok(report.status.counts.pending>0);
  assert.equal(report.status.counts.approved,1);
  assert.equal(report.status.counts.denied,1);
  assert.equal(report.status.counts.reviewing,1);
  assert.equal(report.status.missing,1);
  assert.equal(report.status.wrongType,1);
});

test('current .46, cached .40 and candidate Rules comparisons remain separate and evidence-only',()=>{
  const report=inventory.aggregateRequests(fixture,{executionTimeMs:now});
  assert.equal(report.compatibility.current46.result,'HISTORICAL EXCEPTION EXISTS');
  assert.equal(report.compatibility.legacy40.result,'HISTORICAL EXCEPTION EXISTS');
  assert.ok(report.compatibility.candidateRules.wouldRejectObservedCount>0);
  assert.deepEqual(report.compatibility.current46.unresolvedPolicies,['username maximum','note maximum','requestedAt skew']);
  assert.ok(report.compatibility.current46.rejectedRecordCount<=report.recordCount);
  assert.ok(report.compatibility.candidateRules.wouldRejectObservedCount<=report.recordCount);
});

test('programmatic stress fixtures cover very long username and note buckets without raw output',()=>{
  const username='U'.repeat(5000),note='N'.repeat(20000);
  const report=inventory.aggregateRequests({req_1_a:{username,note,requestedAt:1,status:'pending'}},{executionTimeMs:now});
  assert.equal(report.username.trimmedCodePointLength.max,5000);
  assert.equal(report.note.trimmedCodePointLength.max,20000);
  assert.equal(report.username.trimmedCodePointLength.buckets['>1024'],1);
  assert.equal(report.note.trimmedCodePointLength.buckets['>1024'],1);
  assert.doesNotMatch(inventory.stableJson(report),/UUUUUUUUUU|NNNNNNNNNN/u);
});

test('production mode refuses before D2, missing/wrong confirmation and unsafe configuration',()=>{
  const valid={now:Date.parse('2026-08-15T20:17:40Z'),confirmation:inventory.PRODUCTION_CONFIRMATION,origin:inventory.PRODUCTION_ORIGIN,token:'x'.repeat(40),commitSha:'a'.repeat(40)};
  assert.throws(()=>cli.assertProductionGate({...valid,now:Date.parse('2026-08-15T20:17:39.999Z')}),/SEC02_D2_BOUNDARY_NOT_COMPLETE/u);
  assert.throws(()=>cli.assertProductionGate({...valid,confirmation:''}),/SEC02_CONFIRMATION_INVALID/u);
  assert.throws(()=>cli.assertProductionGate({...valid,confirmation:'READ SEC02'}),/SEC02_CONFIRMATION_INVALID/u);
  assert.throws(()=>cli.assertProductionGate({...valid,origin:'http://localhost:9000'}),/SEC02_PRODUCTION_ORIGIN_INVALID/u);
  assert.equal(cli.assertProductionGate(valid),true);
});

test('fixture mode remains available before D2 and emits no production report',()=>{
  const run=spawnSync(process.execPath,['scripts/sec02/inventory-request-access.cjs','--fixture','scripts/sec02/fixtures/request-inventory.json','--now',String(now)],{cwd:root,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const result=JSON.parse(run.stdout);
  assert.equal(result.report.recordCount,27);
  assert.match(result.reportDigest,/^[0-9a-f]{64}$/u);
  assert.equal(fs.existsSync(path.join(root,inventory.REPORT_PATH)),false);
});

test('production reader issues one bounded GET to the exact requests subtree',async()=>{
  let call;
  const fetchImpl=async(url,options)=>{call={url,options};return new Response(JSON.stringify({req_1_a:{username:'AB',note:'',requestedAt:1,status:'pending'}}),{status:200,headers:{'content-type':'application/json'}});};
  const records=await cli.readProductionRequests({origin:inventory.PRODUCTION_ORIGIN,token:'secret-token-value-for-test',fetchImpl});
  assert.equal(call.url,`${inventory.PRODUCTION_ORIGIN}/requests.json`);
  assert.equal(call.options.method,'GET');
  assert.equal(call.options.redirect,'error');
  assert.deepEqual(Object.keys(records),['req_1_a']);
});

test('oversized, denied, malformed and network responses fail closed with sanitized errors',async()=>{
  const base={origin:inventory.PRODUCTION_ORIGIN,token:'secret-token-value-for-test'};
  await assert.rejects(cli.readProductionRequests({...base,maxBytes:2,fetchImpl:async()=>new Response('123',{status:200,headers:{'content-type':'application/json'}})}),/SEC02_RESPONSE_TOO_LARGE/u);
  await assert.rejects(cli.readProductionRequests({...base,fetchImpl:async()=>new Response('private payload',{status:403})}),error=>error.message==='SEC02_PERMISSION_DENIED');
  await assert.rejects(cli.readProductionRequests({...base,fetchImpl:async()=>new Response('{private',{status:200,headers:{'content-type':'application/json'}})}),error=>error.message==='SEC02_RESPONSE_JSON_INVALID');
  await assert.rejects(cli.readProductionRequests({...base,fetchImpl:async()=>{throw new Error('token and payload');}}),error=>error.message==='SEC02_NETWORK_READ_FAILED');
});

test('fixed production report path is ignored and rejects arbitrary output locations',()=>{
  const ignored=spawnSync('git',['check-ignore','-q',inventory.REPORT_PATH],{cwd:root});
  assert.equal(ignored.status,0);
  const report=inventory.aggregateRequests({}, {executionTimeMs:now});
  const envelope=cli.productionEnvelope({report,commitSha:'a'.repeat(40),executedAt:'2026-08-16T00:00:00.000Z'});
  assert.throws(()=>cli.writeEnvelopeAtomically(envelope,path.join(os.tmpdir(),'sec02-report.json')),/SEC02_OUTPUT_PATH_INVALID/u);
  assert.equal(envelope.audit.reportDigest,envelope.reportDigest);
});

test('inventory source has no Firebase mutation capability or broad data path',()=>{
  const sources=['scripts/sec02/request-inventory.cjs','scripts/sec02/inventory-request-access.cjs'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n');
  assert.doesNotMatch(sources,/\b(?:set|update|remove|push|runTransaction)\s*\(/u);
  assert.doesNotMatch(sources,/firebase-admin|firebase\/database|@firebase|users\.json|authIndex\.json|publicShares\.json/u);
  assert.match(sources,/method:'GET'/u);
  assert.match(sources,/\/requests\.json/u);
});

test('fixture report refuses unexpectedly large record collections',()=>{
  const oversized=Object.fromEntries(Array.from({length:inventory.MAX_RECORDS+1},(_,index)=>[`synthetic_${index}`,{}]));
  assert.throws(()=>inventory.aggregateRequests(oversized,{executionTimeMs:now}),/SEC02_RECORD_LIMIT_EXCEEDED/u);
});

test('review worksheet stays blank, local-only and explicitly not production evidence',()=>{
  const source=fs.readFileSync(path.join(root,'docs/SEC-02-HISTORICAL-INVENTORY-REVIEW.md'),'utf8');
  assert.match(source,/NOT YET RUN AGAINST PRODUCTION/u);
  assert.match(source,/Legacy `\.40` writer implications/u);
  assert.match(source,/Live `\.46` writer implications/u);
  assert.doesNotMatch(source,/Alpha Trainer|Unicode ポケモン/u);
});
