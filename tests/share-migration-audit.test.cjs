const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {loadDomain,parseArgs}=require('../scripts/audit-share-visibility-migration.js');
const {MAX_EXACT_SHARE_READS,exactNames,cliGet,readShareMigrationSources}=require('../scripts/lib/share-migration-source-reader.cjs');
const {outputPath,buildReport,writeReport,aggregateLines}=require('../scripts/lib/private-share-migration-report.cjs');
const {privateRoot}=require('../scripts/lib/private-identity-report.cjs');

function auth(uid,extra={}){return{uid,disabled:false,emailVerified:false,providers:['password'],expectedSyntheticEmailMatches:true,...extra};}
function complete(name){return{version:1,username:name,profile:{bio:''},lists:{wishlist:{Pikachu:'H'},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:1};}
function sources(){return{
  loginDirectory:{Ready:{authReady:true},Incomplete:{authReady:true},Missing:{authReady:true},Malformed:{authReady:true},Conflict:{authReady:true},CaseName:{authReady:true},casename:{authReady:true},Protected:{authReady:true},Unresolved:{authReady:true}},
  users:{Ready:{authUid:'u-ready'},Incomplete:{authUid:'u-incomplete'},Missing:{authUid:'u-missing'},Malformed:{authUid:'u-malformed'},Conflict:{authUid:'u-conflict'},CaseName:{authUid:'u-case-a'},casename:{authUid:'u-case-b'},Protected:{authUid:'u-protected'},Unresolved:{},Legacy:{authUid:'u-legacy'}},
  authIndex:{'u-ready':{username:'Ready'},'u-incomplete':{username:'Incomplete'},'u-missing':{username:'Missing'},'u-malformed':{username:'Malformed'},'u-conflict':{username:'OtherName'},'u-case-a':{username:'CaseName'},'u-case-b':{username:'casename'},'u-protected':{username:'Protected'},'u-legacy':{username:'Legacy'}},
  admins:{'u-protected':true},
  authInput:{schemaVersion:1,identities:['u-ready','u-incomplete','u-missing','u-malformed','u-conflict','u-case-a','u-case-b','u-protected','u-legacy'].map(uid=>auth(uid))},
  publicShares:{Ready:complete('Ready'),Incomplete:{version:1,username:'Incomplete',profile:{}},Malformed:{version:2,username:'Malformed',profile:{},lists:{}},Conflict:complete('Conflict'),CaseName:complete('CaseName'),casename:complete('casename'),Protected:complete('Protected'),Legacy:complete('Legacy')}
};}
function audit(){const result=loadDomain().auditShareMigration(sources());assert.equal(result.ok,true);return result.value;}

test('audit classifies every required identity and projection category',()=>{
  const records=Object.fromEntries(audit().records.map(record=>[record.trainerName,record]));
  assert.equal(records.Ready.classification,'valid_complete_projection');assert.equal(records.Ready.reviewClassification,'individually_reviewable');
  assert.equal(records.Incomplete.classification,'incomplete_profile_only');assert.equal(records.Missing.classification,'missing_projection');
  assert.equal(records.Malformed.classification,'unsupported_malformed');assert.equal(records.Conflict.classification,'identity_mapping_conflict');
  assert.equal(records.CaseName.classification,'normalized_name_collision');assert.equal(records.casename.classification,'normalized_name_collision');
  assert.equal(records.Protected.classification,'protected_account');assert.equal(records.Legacy.classification,'inactive_or_legacy');assert.equal(records.Unresolved.classification,'unresolved');
  assert.ok(audit().records.every(record=>record.seedEligible===false));
});
test('identity conflict precedence wins over projection state',()=>{const record=audit().records.find(value=>value.trainerName==='Conflict');assert.equal(record.classification,'identity_mapping_conflict');assert.equal(record.facts.projectionStatus,'published');});
test('projection username drift is recorded without changing display names',()=>{const input=sources();input.publicShares.Ready=complete('ready');const record=loadDomain().auditShareMigration(input).value.records.find(value=>value.trainerName==='Ready');assert.equal(record.trainerName,'Ready');assert.ok(record.reasonCodes.includes('projection_username_mismatch'));assert.equal(record.classification,'unsupported_malformed');});
test('incomplete projection records missing completeness markers',()=>{const record=audit().records.find(value=>value.trainerName==='Incomplete');assert.ok(record.reasonCodes.includes('projection_completeness_markers_missing'));});
test('sanitized Auth input is mandatory for resolution',()=>{const input=sources();input.authInput=null;assert.equal(loadDomain().auditShareMigration(input).error.code,'share-audit/auth-input-required');});
test('exact share names are bounded and reject illegal Firebase keys',()=>{const input=sources();assert.ok(exactNames(input).includes('Ready'));assert.throws(()=>exactNames({loginDirectory:Object.fromEntries(Array.from({length:MAX_EXACT_SHARE_READS+1},(_,i)=>[`N${i}`,{}])),users:{},authIndex:{}}),error=>error.code==='share_read_bound_exceeded');assert.throws(()=>exactNames({loginDirectory:{'bad/name':{}},users:{},authIndex:{}}),error=>error.code==='share_read_key_invalid');});
test('production reader performs four approved root GETs followed only by exact public-share GETs',async()=>{
  const calls=[],payload=sources(),authFile=path.join(privateRoot,'inputs','share-audit-test-auth.json');fs.mkdirSync(path.dirname(authFile),{recursive:true,mode:0o700});fs.writeFileSync(authFile,JSON.stringify(payload.authInput),{mode:0o600});
  const rootValues={loginDirectory:{Ready:{authReady:true}},users:{Ready:{authUid:'u-ready'}},authIndex:{'u-ready':{username:'Ready'}},admins:{}};
  try{
    const result=await readShareMigrationSources({source:'production',allowProductionRead:true,projectId:'project-example',databaseId:'project-example-default-rtdb',databaseUrl:'https://project-example-default-rtdb.firebaseio.com',confirmProject:'project-example',confirmDatabase:'project-example-default-rtdb',authTokenEnv:'TOKEN',authInput:authFile},{env:{TOKEN:'secret'},fetchImpl:async(url,init)=>{calls.push({url:String(url),init});const pathname=new URL(url).pathname;const key=pathname.split('/').pop().replace('.json','');return{ok:true,json:async()=>pathname.includes('/publicShares/')?complete(decodeURIComponent(key)):rootValues[key]};}});
    assert.equal(calls.length,5);assert.ok(calls.every(call=>call.init.method==='GET'));assert.equal(calls.filter(call=>/publicShares\.json/.test(call.url)).length,0);assert.match(calls[4].url,/publicShares\/Ready\.json/);assert.equal(result.metadata.requestCount,5);
  }finally{fs.rmSync(authFile,{force:true});}
});
test('source reader contains no write-capable network method',()=>{const text=fs.readFileSync(path.join(__dirname,'../scripts/lib/share-migration-source-reader.cjs'),'utf8');assert.doesNotMatch(text,/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);});
test('Firebase CLI adapter is locked to database:get with exact target confirmation',()=>{const calls=[];const value=cliGet('/private/firebase','publicShares/Ready',{projectId:'project-example',databaseId:'project-example-default-rtdb'},(command,args)=>{calls.push({command,args});return{status:0,stdout:'null'};});assert.equal(value,null);assert.deepEqual(calls[0].args.slice(0,2),['database:get','/publicShares/Ready']);assert.equal(calls[0].args.some(arg=>/set|update|remove|delete/i.test(arg)),false);});
test('private reports use mode 0600 report-specific IDs and no seed-capable payload',()=>{const report=buildReport(audit(),{source:'production',targetVerified:true,sourceCounts:{exactPublicShareReads:9},sourceSnapshotHashes:{a:'b'},requestCount:13},{secret:Buffer.from('secret')});const file=path.join(privateRoot,'reports','share-audit-test.json');try{writeReport(report,file);assert.equal(fs.statSync(file).mode&0o777,0o600);assert.ok(report.records.every(record=>record.seedEligible===false));assert.doesNotMatch(JSON.stringify(report),/firebaseUpdate|migrationPayload|approvalManifest|seedCommand|reservationRequest/);}finally{fs.rmSync(file,{force:true});}});
test('report paths cannot escape the ignored private directory',()=>{assert.throws(()=>outputPath('../outside-share-audit.json'),error=>error.code==='report_path_outside_private_root');});
test('aggregate output contains counts and reasons without private identities',()=>{const report=buildReport(audit(),{source:'production',targetVerified:true,sourceCounts:{exactPublicShareReads:9},sourceSnapshotHashes:{a:'b'},requestCount:13},{secret:Buffer.from('secret')});const text=aggregateLines(report).join('\n');assert.match(text,/valid_complete_projection: 1/);assert.match(text,/Writes: 0/);assert.doesNotMatch(text,/Ready|u-ready|share-[a-f0-9]+/);});
test('CLI rejects service-account credentials apply and write options',()=>{for(const option of ['--service-account','--credential','--apply','--seed'])assert.throws(()=>parseArgs([option,'x']),/Unsupported CLI option/);});
