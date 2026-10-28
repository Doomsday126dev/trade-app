'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createHash}=require('node:crypto');
function harness(){
  const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/dev/accountRecoveryBundle.js'),'utf8'),{window,TextEncoder,Uint8Array,Set,Map,Object,Number,String,JSON,Error});
  const api=window.PogoDev.accountRecoveryBundle;return{api,model:api.createAccountRecoveryBundle({sha256:async value=>createHash('sha256').update(value).digest('hex')})};
}
function snapshot(api,uid='synthetic-owner'){
  const sections=Object.fromEntries(api.SECTIONS.map(name=>[name,{complete:true,records:[]} ]));
  Object.assign(sections,{
    canonicalEntities:{complete:true,records:[{id:'entry-1',value:{entityType:'tradeEntry',generation:4,tombstone:false,fields:{note:'Pikachu',shiny:true}}}]},
    favorites:{complete:true,records:[{id:'favorite-1',value:{targetUid:'synthetic-favorite',tagIds:['tag-1']}}]},
    tags:{complete:true,records:[{id:'tag-1',value:{label:'Friends'}}]},
    groups:{complete:true,records:[{id:'group-1',value:{membership:'member'}}]},
    sharing:{complete:true,records:[{id:'url-1',value:{url:'https://example.test/?trainer=Synthetic',ownerUid:uid}}]},
    permissions:{complete:true,records:[{id:'grant-1',value:{subject:'synthetic-viewer',permission:'read'}}]},
    recovery:{complete:true,records:[{id:'evidence-1',value:{reviewed:true,reason:'synthetic'}}]}
  });
  return{source:{ownerUid:uid,trainerHandle:'Synthetic',capturedAt:1_800_000_000_000,revision:'accepted-v7'},sections};
}
test('all supported sections round-trip exactly with schema and SHA-256 integrity',async()=>{
  const {api,model}=harness(),source=snapshot(api),bundle=await model.create(source),verified=await model.verify(JSON.stringify(bundle));
  assert.deepEqual(JSON.parse(JSON.stringify(verified.sections)),source.sections);assert.equal(bundle.schemaVersion,1);assert.match(bundle.integrity.digest,/^[a-f0-9]{64}$/);
});
test('missing, incomplete or duplicate inventory fails instead of producing a partial recovery file',async()=>{
  const {api,model}=harness();for(const modify of[s=>delete s.sections.permissions,s=>s.sections.groups.complete=false,s=>s.sections.favorites.records.push(s.sections.favorites.records[0])]){
    const source=snapshot(api);modify(source);await assert.rejects(model.create(source));
  }
});
test('tampered data, unsupported versions and credential fields fail closed',async()=>{
  const {api,model}=harness(),bundle=JSON.parse(JSON.stringify(await model.create(snapshot(api))));bundle.sections.tags.records[0].value.label='Changed';
  await assert.rejects(model.verify(bundle),{code:'recovery/integrity-mismatch'});bundle.schemaVersion=2;await assert.rejects(model.verify(bundle),{code:'recovery/version-or-envelope-invalid'});
  for(const key of['pin','password','accessToken','refreshToken','customToken','privateKey','authorization']){
    const source=snapshot(api);source.sections.profile.records=[{id:'profile',value:{[key]:'never-export'}}];await assert.rejects(model.create(source),{code:'recovery/credential-or-key-forbidden'});
  }
});
test('malicious prototype keys and non-JSON values are rejected',async()=>{
  const {api,model}=harness(),source=snapshot(api);source.sections.profile.records=[{id:'profile',value:JSON.parse('{"__proto__":{"admin":true}}')}];
  await assert.rejects(model.create(source),{code:'recovery/credential-or-key-forbidden'});
  source.sections.profile.records[0].value={value:Infinity};await assert.rejects(model.create(source),{code:'recovery/json-invalid'});assert.equal({}.admin,undefined);
});
test('same-owner import planning is idempotent, additive and version bound',async()=>{
  const {api,model}=harness(),source=snapshot(api),bundle=await model.create(source),target=snapshot(api);target.sections.canonicalEntities.records=[];
  const args={bundle,currentSnapshot:target,targetOwnerUid:target.source.ownerUid},first=await model.planImport(args),again=await model.planImport(args);
  assert.deepEqual(first,again);assert.equal(first.automaticApply,false);assert.equal(first.expectedTargetRevision,'accepted-v7');
  assert.equal(first.operations.find(row=>row.section==='canonicalEntities').action,'propose-add');
  target.sections.canonicalEntities.records=source.sections.canonicalEntities.records;
  const repeated=await model.planImport(args);assert.equal(repeated.operations.find(row=>row.section==='canonicalEntities').action,'keep');
  assert.equal(repeated.operations[0].operationId,first.operations[0].operationId);assert.notEqual(repeated.expectedTargetDigest,first.expectedTargetDigest);
});
test('existing conflicts require review; grants, URLs and group memberships are never replayed',async()=>{
  const {api,model}=harness(),source=snapshot(api),target=snapshot(api),bundle=await model.create(source);
  target.sections.canonicalEntities.records[0].value.fields.note='Current edit';
  for(const section of['groups','sharing','permissions','recovery'])target.sections[section].records=[];
  const plan=await model.planImport({bundle,currentSnapshot:target,targetOwnerUid:target.source.ownerUid});
  assert.equal(plan.operations.find(row=>row.section==='canonicalEntities').action,'review-conflict');
  for(const section of['groups','sharing','permissions','recovery'])assert.equal(plan.operations.find(row=>row.section===section).action,'review-only');
  assert.ok(plan.operations.every(row=>!['delete','overwrite','grant'].includes(row.action)));
});
test('cross-account fallback always requires separately authorized server identity recovery',async()=>{
  const {api,model}=harness(),source=snapshot(api),target=snapshot(api,'synthetic-target'),bundle=await model.create(source);target.sections.canonicalEntities.records=[];
  const plan=await model.planImport({bundle,currentSnapshot:target,targetOwnerUid:target.source.ownerUid});
  assert.equal(plan.sameOwner,false);assert.equal(plan.requiresServerIdentityRecovery,true);assert.equal(plan.automaticApply,false);
  assert.ok(plan.operations.every(row=>['keep','review-only'].includes(row.action)));
  await assert.rejects(model.planImport({bundle,currentSnapshot:target,targetOwnerUid:'different-target'}),{code:'recovery/target-owner-mismatch'});
});
