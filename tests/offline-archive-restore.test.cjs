'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const f=require('../scripts/archive-proof/format.cjs');
const {adaptSyntheticSource}=require('../scripts/archive-proof/source-adapter.cjs');
const fixture=require('../scripts/archive-proof/fixtures/synthetic-source.cjs');
const {prove}=require('../scripts/archive-proof/prove.cjs');
const ROOT=path.resolve(__dirname,'..');
const plain=value=>JSON.parse(JSON.stringify(value));
const temp=t=>{const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'archive-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
let source,archive,receipt;
test.before(async()=>{source=await fixture.makeSource();archive=f.exportArchive(adaptSyntheticSource(source));receipt=f.createCaptureReceipt(archive);});
// Simulate an attacker capable of recomputing checksums. Hashing is not signing.
function reseal(value){const {integrity,...payload}=value;return{...payload,integrity:{algorithm:'sha256',canonicalization:'trade-archive-json-v1',sections:Object.fromEntries(Object.keys(payload).sort().map(key=>[key,f.digest(payload[key],`section:${key}`)])),payloadHash:f.digest(payload,'payload')}};}
function want(value,lane='wishlist'){return value.canonical.entities.find(item=>item.entityType==='tradeEntry'&&item.identity.lane===lane);}
function rejected(t,mutate,code,{seal=true}={}){
  const value=f.clone(archive);mutate(value);const candidate=seal?reseal(value):value;
  const root=temp(t),target=path.join(root,'target');
  assert.throws(()=>f.restoreArchive(candidate,target,receipt),error=>!code||error.code===code);
  assert.deepEqual(fs.readdirSync(root),[],'Failure must not create target/staging files');
}

test('full offline round trip destroys source, preserves wire records and byte-identical second export',async t=>{
  const output=path.join(temp(t),'proof');const result=await prove(output);
  assert.equal(result.sourceDestroyed,true);assert.equal(fs.existsSync(path.join(output,'synthetic-source.json')),false);
  assert.equal(result.fullSourceRecordEvidenceEqual,true);assert.equal(result.secondExportByteIdentical,true);
  assert.deepEqual(result.counts,{activeWants:10,favorites:1,privateTags:2,sourceEntities:15,historicalRecords:5,capturedDevices:1,pendingOperations:2,conflicts:1,recoveryCandidates:1});
});

test('fixture represents real .100 wire contracts, not invented current account operations',async()=>{
  const api=fixture.loadCurrentContracts();
  assert.equal(api.product.canonicalSyncState(source.accountSync,fixture.OWNER).ok,true);
  assert.equal(api.product.normalSyncEligibility({authenticatedUid:fixture.OWNER,username:fixture.HANDLE,indexRecord:source.identity.authIndex[fixture.OWNER],userAuthUid:source.identity.userRecord.authUid,account:source.accountSync}).ok,true);
  for(const record of [...Object.values(source.accountSync.tradeEntries),...Object.values(source.accountSync.favorites),...Object.values(source.accountSync.tags)])assert.equal(api.merge.validateEntity(record,{ownerUid:fixture.OWNER,entityType:record.entityType,entityId:record.entityId}).ok,true);
  for(const record of source.devices[0].journal.operations)assert.equal((await api.model.verifyOperation(record.operation)).ok,true);
  assert.equal(api.publication.publicShareProjectionStatus(source.publicShare,{username:fixture.HANDLE}).ok,true);
});

test('inspectable standard JSON Schema is current and expands to the exact closed reader shape',()=>{
  const document=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/verification/archive-proof/archive-v1.schema.json'),'utf8'));
  assert.equal(f.canonicalJson(document),f.canonicalJson(f.schemaDocument));
  function expand(value,stack=[]){
    if(Array.isArray(value))return value.map(item=>expand(item,stack));
    if(!value||typeof value!=='object')return value;
    if(value.$ref){
      const match=/^#\/\$defs\/([A-Za-z0-9]+)$/.exec(value.$ref);assert.ok(match);assert.ok(!stack.includes(match[1]));assert.ok(document.$defs[match[1]]);
      return expand(document.$defs[match[1]],[...stack,match[1]]);
    }
    return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='$defs').map(([key,item])=>[key,expand(item,stack)]));
  }
  const expanded=expand(document);assert.equal(f.canonicalJson(expanded),f.canonicalJson(f.schema));f.checkShape(archive,expanded);
});

test('exact costume/form/region/max identities and duplicate species remain distinct',()=>{
  const active=f.projectCanonical(archive),rows=active.wants;
  const moon=rows.find(item=>item.pokemon.name==='Pikachu (Moon)'),sun=rows.find(item=>item.pokemon.name==='Pikachu (Sun)');
  assert.notEqual(moon.catalogId,sun.catalogId);assert.equal(moon.pokemon.costumeId,'PIKACHU_GOFEST_2024_MTIARA');assert.equal(sun.pokemon.costumeId,'PIKACHU_GOFEST_2024_STIARA');
  assert.deepEqual([moon.priority,moon.xxl,sun.priority,sun.xxs,sun.shiny],['',true,'',true,true]);
  assert.equal(rows.find(item=>item.pokemon.name==='A-Raichu').pokemon.regionalForm,'A');
  assert.equal(rows.find(item=>item.lane==='dynamax').pokemon.maxState,'dynamax');assert.equal(rows.find(item=>item.lane==='gmax').pokemon.maxState,'gmax');
  assert.deepEqual(rows.filter(item=>item.pokemon.speciesId===201).map(item=>item.pokemon.formId),['UNOWN_A','UNOWN_B']);
  assert.equal(rows.filter(item=>item.pokemon.name==='Pikachu').length,3,'Same species across source lanes must not be collapsed');
});

test('High/Medium/Low plus non-priority Lucky/XXL/XXS, notes and ordering survive',()=>{
  const rows=f.projectCanonical(archive).wants;
  assert.deepEqual(rows.map(item=>item.sortOrder),[1,2,3,4,5,6,7,8,9,10]);
  assert.deepEqual(rows.map(item=>item.priority),['','M','','','L','H','H','M','L','']);
  for(const trait of ['lucky','xxl','xxs'])assert.ok(rows.some(item=>item.priority===''&&item[trait]));
  const female=rows.find(item=>item.sortOrder===7);assert.equal(female.gender,'f');assert.equal(female.variant,'f');assert.equal(female.note,'Keep this exact base species want');
});

test('Favorites/tags and device checked baseline declaration arrays retain target UID and timestamps',t=>{
  const target=path.join(temp(t),'restored');f.restoreArchive(archive,target,receipt);const restored=f.reexportTarget(target,receipt);
  const active=f.projectCanonical(restored);assert.deepEqual(active.favorites[0].tagIds,{tag_synthetic_event:true,tag_synthetic_friends:true});
  assert.deepEqual(active.tags.map(item=>item.label),['September meetup','Friends']);
  const before=source.devices[0].history.snapshots.syntheticfriend,after=restored.knownDevices[0].history.snapshots.syntheticfriend;
  assert.deepEqual(after,before);assert.equal(after.targetUid,'synthetic_friend_uid');assert.equal(after.seenAt,fixture.AT-5000);assert.equal(after.snapshot.declarations[0].note,'Baseline before new wants');
  assert.deepEqual(restored.knownDevices[0].orders,source.devices[0].orders);assert.deepEqual(restored.knownDevices[0].viewedSnapshots,source.devices[0].viewedSnapshots);
});

test('pending and conflicted edits remain representable but do not overwrite canonical state',t=>{
  const target=path.join(temp(t),'restored'),active=f.restoreArchive(archive,target,receipt);
  const review=JSON.parse(fs.readFileSync(path.join(target,'device-review.json'),'utf8'));
  assert.equal(review.disposition,'quarantine-never-replay');assert.deepEqual(review.devices[0].journal.operations.map(item=>item.status),['pending','conflict']);
  assert.ok(review.devices[0].journal.entities.some(item=>item.values.note==='Device-only note waiting for connection'));
  assert.ok(!active.wants.some(item=>item.note==='Device-only note waiting for connection'));
  assert.equal(active.wants.find(item=>item.pokemon.name==='A-Raichu').priority,'M','Conflict requesting H must not silently win');
  assert.equal(review.devices[0].journal.conflicts[0].resolved,false);assert.equal(review.devices[0].journal.recoveryCandidates[0].resolved,false);
  assert.equal(active.profile.bio,'Synthetic account; no real trainer');assert.equal(review.devices[0].journal.meta.find(item=>item.name==='provider-profile-pending-v1').value.values.bio,'Device-only profile choice');
});

test('server/device migration evidence and unresolved Favorite identity remain lossless and non-authoritative',t=>{
  const target=path.join(temp(t),'restored');f.restoreArchive(archive,target,receipt);const restored=f.reexportTarget(target,receipt);
  assert.deepEqual(restored.canonical.recoveryEvidence.candidates,Object.values(source.accountSync.recoveryCandidates));
  assert.deepEqual(restored.canonical.recoveryEvidence.migrations,Object.values(source.accountSync.migrations));
  assert.deepEqual(restored.canonical.recoveryEvidence.reviewAcceptances,Object.values(source.identity.authIndex[fixture.OWNER].accountSyncRecoveryReviews));
  const candidate=restored.knownDevices[0].journal.recoveryCandidates[0];
  assert.equal(candidate.reason,'favorite-uid-unresolved');assert.equal(candidate.identity.targetUid,'');assert.match(candidate.entityId,/^unresolved:/);
  const backup=restored.knownDevices[0].journal.meta.find(item=>item.name.startsWith('legacy-source:'));
  assert.equal(backup.value.favorites[0].displayName,'SyntheticDormantFriend');
  assert.ok(!f.projectCanonical(restored).favorites.some(item=>item.displayName==='SyntheticDormantFriend'));
});

test('FT, inventory, quantities, backgrounds, trade history and deletion evidence remain inert',t=>{
  const target=path.join(temp(t),'restored'),active=f.restoreArchive(archive,target,receipt);
  const inert=JSON.parse(fs.readFileSync(path.join(target,'historical-inert.json'),'utf8'));
  assert.equal(inert.disposition,'inert-only');assert.equal(inert.records.length,5);
  assert.ok(inert.records.some(item=>item.kind==='inventory'&&item.value.qty===9));
  assert.ok(inert.records.some(item=>item.kind==='retired-sync-entity'&&item.value.identity.lane==='for-trade'&&item.value.values.quantity===7));
  assert.ok(inert.records.some(item=>item.kind==='retired-sync-entity'&&item.value.deleted===true));
  assert.ok(inert.retainedWantFields.some(item=>item.backgroundId==='synthetic-retired-background-choice'));
  assert.ok(active.wants.every(item=>item.lane!=='for-trade'&&!('backgroundId'in item)&&!('quantity'in item)&&!('mirror'in item)));
  assert.ok(!active.wants.some(item=>item.note==='User deliberately deleted this want'));
});

test('public-share state is preserved without publishing, URL reservation or authentication restoration',t=>{
  const target=path.join(temp(t),'restored');f.restoreArchive(archive,target,receipt);
  const publication=JSON.parse(fs.readFileSync(path.join(target,'publication-review.json'),'utf8'));
  assert.equal(publication.disposition,'never-auto-publish');assert.deepEqual(publication.state.snapshot,source.publicShare);
  const identity=JSON.parse(fs.readFileSync(path.join(target,'identity-catalog.json'),'utf8')).provenance;
  assert.equal(identity.retiredUids[0].replacementUid,fixture.OWNER);assert.equal(identity.aliases.length,2);assert.equal(identity.accessMethods.length,2);
  assert.ok(!fs.readdirSync(target).some(file=>/auth-session|credential|firebase/i.test(file)));
});

test('server-only capture explicitly excludes unknown device data instead of claiming completeness',()=>{
  const serverOnly=f.clone(source);serverOnly.devices=[];
  const result=f.exportArchive(adaptSyntheticSource(serverOnly));
  assert.equal(result.knownDevices.length,0);assert.deepEqual(result.coverage.capturedDevices,[]);assert.equal(result.coverage.otherDevices,'unknown-not-captured');
  assert.equal(result.coverage.volatileUnsavedEdits,'not-captured');assert.equal(f.projectCanonical(result).wants.length,10);
  assert.ok(!f.canonicalJson(result).includes('Device-only note waiting for connection'));
});

test('all explicit secret sources are excluded, including hashes and browser credential persistence',()=>{
  const bytes=f.inspectableJson(archive);
  for(const marker of fixture.SECRET_MARKERS)assert.ok(!bytes.includes(marker));
  for(const marker of fixture.SECRET_MARKERS)assert.ok(!bytes.includes(f.sha256(marker)),'Do not archive a hash of secret material as provenance');
  assert.ok(!bytes.includes('synthetic-derived-address@example.invalid'));
  assert.ok(archive.dispositions.some(item=>item.path==='identity.userRecord.pin'&&item.action==='excluded-secret'));
});

test('unknown source fields stop capture before any ambiguous data is omitted',()=>{
  const changed=f.clone(source);changed.identity.userRecord.futureUserPreference='must be classified';
  assert.throws(()=>adaptSyntheticSource(changed),{code:'archive/source'});
});
test('foreign source auth-index and profile pair fails capture',()=>{
  const changed=f.clone(source);changed.identity.authIndex[fixture.OWNER].username='AnotherTrainer';
  assert.throws(()=>adaptSyntheticSource(changed),{code:'archive/source'});
});
test('foreign IndexedDB owner fails capture',()=>{
  const changed=f.clone(source);changed.devices[0].journal.operations[0].ownerUid='synthetic_other';
  assert.throws(()=>adaptSyntheticSource(changed),{code:'archive/source'});
});
test('IndexedDB entity wrapper cannot point at a different nested entity',()=>{
  const changed=f.clone(source);changed.devices[0].journal.entities[0].entityId='foreign-key';
  assert.throws(()=>adaptSyntheticSource(changed),{code:'archive/source'});
});
test('unknown retained legacy snapshot fields are not silently copied or dropped',()=>{
  const changed=f.clone(source);changed.devices[0].journal.meta.find(item=>item.name.startsWith('legacy-source:')).value.credentials={pin:'secret'};
  assert.throws(()=>adaptSyntheticSource(changed),{code:'archive/shape'});
});

test('corrupt root hash fails without writing target',t=>rejected(t,value=>{value.integrity.payloadHash='0'.repeat(64);},'archive/integrity',{seal:false}));
test('corrupt section hash fails without writing target',t=>rejected(t,value=>{value.integrity.sections.canonical='0'.repeat(64);},'archive/integrity',{seal:false}));
test('missing required hash fails without writing target',t=>rejected(t,value=>{delete value.integrity.payloadHash;},'archive/shape',{seal:false}));
test('changed data with old hashes fails',t=>rejected(t,value=>{want(value).values.note='modified';},'archive/integrity',{seal:false}));
test('recomputed hashes cannot substitute the separately pinned snapshot',t=>rejected(t,value=>{want(value).values.note='modified';},'archive/provenance'));
test('unsupported future archive schema fails closed',t=>rejected(t,value=>{value.archiveSchemaVersion=2;},'archive/future-schema'));
test('unsupported future source schema fails closed',t=>rejected(t,value=>{value.source.accountSyncSchema=2;},'archive/shape'));
test('changed restore compatibility cannot enable operation replay',t=>rejected(t,value=>{value.compatibility.pendingWork='replay';},'archive/shape'));
test('malformed canonical ownership fails even with recomputed hashes',t=>rejected(t,value=>{value.canonical.meta.ownerUid='synthetic_other';},'archive/ownership'));
test('conflicting duplicate canonical entity authority fails',t=>rejected(t,value=>{value.canonical.entities.push({...f.clone(want(value)),values:{...want(value).values,note:'conflicting writer'}});},'archive/authority'));
test('duplicate proven handle assigned twice fails',t=>rejected(t,value=>{value.provenance.aliases.push(f.clone(value.provenance.aliases[0]));},'archive/authority'));
test('non-overlapping handle reuse is preserved as history rather than deduplicated',()=>{
  const payload=adaptSyntheticSource(source),prior=f.clone(payload.provenance.aliases.find(item=>item.validUntil===null));prior.validFrom=fixture.AT-10000;prior.validUntil=fixture.AT-9000;
  payload.provenance.aliases.push(prior);const result=f.exportArchive(payload);assert.equal(result.provenance.aliases.length,3);
});
test('foreign alias owner fails',t=>rejected(t,value=>{value.provenance.aliases[0].ownerUid='synthetic_other';},'archive/ownership'));
test('missing alias evidence fails',t=>rejected(t,value=>{value.provenance.aliases[0].evidenceId='unproven';},'archive/provenance'));
test('retired UID cannot become canonical owner',t=>rejected(t,value=>{value.provenance.retiredUids[0].uid=fixture.OWNER;},'archive/ownership'));
test('conflicting canonical account ID fails',t=>rejected(t,value=>{value.provenance.accountId='synthetic_other';},'archive/ownership'));
test('missing canonical entity lifecycle evidence fails',t=>rejected(t,value=>{want(value).lifecycleMutation='not-an-operation';},'archive/entity'));
test('impossible simultaneous XXL/XXS fails',t=>rejected(t,value=>{const row=want(value);row.values.xxl=true;row.values.xxs=true;},'archive/variant'));
test('genderless exact form cannot be restored with an impossible gender',t=>rejected(t,value=>{const row=value.canonical.entities.find(item=>item.entityType==='tradeEntry'&&item.identity.catalogId.includes('Unown'));row.values.gender='f';},'archive/variant'));
test('free-text want qualifiers and notes remain exact rather than treated as species/form aliases',()=>{
  const payload=adaptSyntheticSource(source),row=want(payload);row.values.variant='CP1500; F; user qualifier';row.values.note='  Keep whitespace and e\u0301 exactly.  ';
  const result=f.exportArchive(payload),restored=want(result);assert.equal(restored.values.variant,row.values.variant);assert.equal(restored.values.note,row.values.note);
});
test('unknown exact catalog identity fails rather than collapsing to species',t=>rejected(t,value=>{const row=want(value);row.identity.catalogId='pokemon:25:unknown:costume';row.entityId=f.tradeEntryId(row.identity);},'archive/variant'));
test('Dynamax and Gigantamax cannot be substituted',t=>rejected(t,value=>{const row=want(value,'dynamax');row.identity.lane='gmax';row.entityId=f.tradeEntryId(row.identity);},'archive/variant'));
test('untrusted catalog cannot authorize impossible species mapping by rehashing',t=>rejected(t,value=>{value.catalog.entries[0].speciesId=999;},'archive/provenance'));
test('foreign checked-baseline target fails',t=>rejected(t,value=>{value.knownDevices[0].history.snapshots.syntheticfriend.targetUid='synthetic_someone_else';},'archive/ownership'));
test('foreign journal operation fails',t=>rejected(t,value=>{value.knownDevices[0].journal.operations[0].operation.ownerUid='synthetic_other';},'archive/ownership'));
test('foreign server migration/recovery evidence fails',t=>rejected(t,value=>{value.canonical.recoveryEvidence.migrations[0].ownerUid='synthetic_other';},'archive/ownership'));
test('unresolved Favorite recovery cannot claim a fabricated target UID',t=>rejected(t,value=>{value.knownDevices[0].journal.recoveryCandidates[0].identity.targetUid='synthetic_invented_uid';},'archive/ownership'));
test('journal metadata name cannot be paired with another metadata shape',t=>rejected(t,value=>{value.knownDevices[0].journal.meta.find(item=>item.name==='migration-complete').name='provider-publication-pending-v1';},'archive/shape'));
test('corrupt pending-operation input hash fails independently of archive hashes',t=>rejected(t,value=>{value.knownDevices[0].journal.operations[0].operation.inputHash='0'.repeat(64);},'archive/operation'));
test('conflicting operation ID from a second device fails',t=>rejected(t,value=>{
  const device=f.clone(value.knownDevices[0]);device.deviceId='synthetic-known-device-2';
  const op=device.journal.operations[0].operation;op.patch.note='Different payload for identical operation ID';op.inputHash=f.sha256(f.canonicalJson(f.operationInput(op)));
  value.knownDevices.push(device);value.coverage.capturedDevices.push(device.deviceId);
},'archive/authority'));
test('orphan conflict cannot be treated as supported pending state',t=>rejected(t,value=>{value.knownDevices[0].journal.conflicts[0].operationId='op_00000000000000000000000000000999';},'archive/ownership'));
test('legacy queue cannot target another account',t=>rejected(t,value=>{value.knownDevices[0].legacyQueue.entries[0].path='wishlist/SomeOtherTrainer';},'archive/ownership'));
test('historical record cannot conflict with active canonical authority',t=>rejected(t,value=>{const record=value.historical.records.find(item=>item.kind==='retired-sync-entity');record.value=f.clone(want(value));},'archive/authority'));
test('deleted record cannot be reintroduced into active wants',t=>rejected(t,value=>{const historical=value.historical.records.find(item=>item.kind==='retired-sync-entity'&&item.value.deleted);value.canonical.entities.push(f.clone(historical.value));},'archive/inert'));
test('archive credential field injection is rejected at any structured boundary',t=>rejected(t,value=>{value.canonical.profile.values.refreshToken='SYNTHETIC_EXCLUDED_REFRESH_TOKEN';},'archive/shape'));
test('historical opaque secret bag is rejected rather than archived wholesale',t=>rejected(t,value=>{value.historical.records[0].value={pin:'SYNTHETIC_EXCLUDED_PIN_9274'};},'archive/shape'));
test('device history cannot smuggle raw Firebase Auth storage',t=>rejected(t,value=>{value.knownDevices[0].history.firebaseAuth={refreshToken:'SYNTHETIC_EXCLUDED_REFRESH_TOKEN'};},'archive/shape'));

test('canonical serialization preserves Unicode, array order and integer precision without normalization',()=>{
  assert.equal(f.canonicalJson({'2':'two','10':'ten',z:['e\u0301','é'],a:9007199254740991}),'{'+'"10":"ten","2":"two","a":9007199254740991,"z":["é","é"]}');
  assert.notEqual(f.digest(['a','b'],'test'),f.digest(['b','a'],'test'));
  assert.notEqual(f.digest('é','test'),f.digest('e\u0301','test'));
  assert.throws(()=>f.canonicalJson({n:9007199254740992}),{code:'archive/json'});assert.throws(()=>f.canonicalJson({n:NaN}),{code:'archive/json'});assert.throws(()=>f.canonicalJson({n:-0}),{code:'archive/json'});
});
test('keyed entity input order does not change second export',()=>{
  const payload=adaptSyntheticSource(source);payload.canonical.entities.reverse();payload.provenance.aliases.reverse();payload.catalog.entries.reverse();
  assert.equal(f.canonicalJson(f.exportArchive(payload)),f.canonicalJson(archive));
});
test('duplicate JSON keys, noncanonical number spellings, prototype keys and corrupt JSON fail',()=>{
  assert.throws(()=>f.parseArchive('{"a":1,"a":2}'),{code:'archive/encoding'});
  assert.throws(()=>f.parseArchive('{"a":1e0}'),{code:'archive/encoding'});
  assert.throws(()=>f.parseArchive('{"__proto__":{"polluted":true}}'),{code:'archive/json'});
  assert.throws(()=>f.parseArchive('{'),{code:'archive/json'});
  assert.equal({}.polluted,undefined);
});
test('getter execution, lone surrogates, sparse arrays and oversized archives fail',()=>{
  let ran=false;const getter={get x(){ran=true;return 1;}};assert.throws(()=>f.canonicalJson(getter),{code:'archive/json'});assert.equal(ran,false);
  assert.throws(()=>f.canonicalJson('\ud800'),{code:'archive/json'});assert.throws(()=>f.canonicalJson(new Array(2)),{code:'archive/json'});
  assert.throws(()=>f.parseArchive(' '.repeat(f.MAX_BYTES+1)),{code:'archive/limits'});
});
test('validation requires a separate expected receipt; archive assertions alone are insufficient',()=>{
  assert.throws(()=>f.validateArchive(archive),{code:'archive/trust'});
  assert.throws(()=>f.validateArchive(archive,{...receipt,ownerUid:'synthetic_someone_else'}),{code:'archive/provenance'});
});
test('restore refuses an existing target without modifying its sentinel',t=>{
  const root=temp(t),target=path.join(root,'existing');fs.mkdirSync(target);fs.writeFileSync(path.join(target,'sentinel'),'keep');
  assert.throws(()=>f.restoreArchive(archive,target,receipt),{code:'archive/target'});assert.equal(fs.readFileSync(path.join(target,'sentinel'),'utf8'),'keep');
});
test('restore refuses a symlink parent',t=>{
  const root=temp(t),real=path.join(root,'real'),link=path.join(root,'link');fs.mkdirSync(real);fs.symlinkSync(real,link);
  assert.throws(()=>f.restoreArchive(archive,path.join(link,'target'),receipt),{code:'archive/target'});assert.deepEqual(fs.readdirSync(real),[]);
});
test('restore refuses a dangling target symlink without replacing it',t=>{
  const root=temp(t),target=path.join(root,'target');fs.symlinkSync(path.join(root,'missing'),target);
  assert.throws(()=>f.restoreArchive(archive,target,receipt),{code:'archive/target'});assert.equal(fs.lstatSync(target).isSymbolicLink(),true);
});
test('restored target tampering fails re-export even after its local file checksum is replaced',t=>{
  const target=path.join(temp(t),'restored');f.restoreArchive(archive,target,receipt);
  const file=path.join(target,'active.json'),active=JSON.parse(fs.readFileSync(file,'utf8'));active.wants[0].priority='H';const bytes=f.inspectableJson(active);fs.writeFileSync(file,bytes);
  assert.throws(()=>f.reexportTarget(target,receipt),{code:'archive/integrity'});
  const proofFile=path.join(target,'restore-receipt.json'),proof=JSON.parse(fs.readFileSync(proofFile,'utf8'));proof.files['active.json']=f.sha256(bytes);fs.writeFileSync(proofFile,f.inspectableJson(proof));
  assert.throws(()=>f.reexportTarget(target,receipt),{code:'archive/inert'});
});
test('inert file removal fails re-export',t=>{
  const target=path.join(temp(t),'restored');f.restoreArchive(archive,target,receipt);fs.unlinkSync(path.join(target,'historical-inert.json'));
  assert.throws(()=>f.reexportTarget(target,receipt),{code:'archive/target'});
});
test('archive source paths are inert strings and never drive target filesystem locations',t=>{
  const payload=adaptSyntheticSource(source);payload.historical.records[0].sourcePath='../../escape.json';const changed=f.exportArchive(payload),root=temp(t);
  f.restoreArchive(changed,path.join(root,'target'),f.createCaptureReceipt(changed));assert.deepEqual(fs.readdirSync(root),['target']);
  assert.deepEqual(fs.readdirSync(path.join(root,'target')).sort(),[...f.TARGET_FILES,'restore-receipt.json'].sort());
});
test('archived text remains data; it is never evaluated during restore',t=>{
  const payload=adaptSyntheticSource(source);want(payload).values.note='globalThis.archiveInjected=true; </script><script>alert(1)</script>';
  const changed=f.exportArchive(payload);f.restoreArchive(changed,path.join(temp(t),'restored'),f.createCaptureReceipt(changed));assert.equal(globalThis.archiveInjected,undefined);
});

test('standalone reader restores with no historical runtime architecture present and outbound APIs denied',t=>{
  const root=temp(t),portable=path.join(root,'portable');fs.mkdirSync(portable);
  for(const file of ['format.cjs','schema.cjs'])fs.copyFileSync(path.join(ROOT,'scripts/archive-proof',file),path.join(portable,file));
  fs.writeFileSync(path.join(root,'archive.json'),f.inspectableJson(archive));fs.writeFileSync(path.join(root,'receipt.json'),f.inspectableJson(receipt));
  const program=`
    const fs=require('node:fs'),path=require('node:path');
    const denied=()=>{throw new Error('Network or subprocess attempted');};
    global.fetch=denied;
    for(const name of ['node:http','node:https']){const m=require(name);m.request=denied;m.get=denied;}
    const net=require('node:net');net.connect=denied;net.createConnection=denied;net.Socket.prototype.connect=denied;
    require('node:tls').connect=denied;require('node:dns').lookup=denied;
    const child=require('node:child_process');for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[key]=denied;
    const root=process.argv[1],f=require(path.join(root,'portable/format.cjs'));
    const archive=f.parseArchive(fs.readFileSync(path.join(root,'archive.json'),'utf8')),receipt=JSON.parse(fs.readFileSync(path.join(root,'receipt.json'),'utf8'));
    const active=f.restoreArchive(archive,path.join(root,'restored'),receipt),again=f.reexportTarget(path.join(root,'restored'),receipt);
    if(active.wants.length!==10||f.canonicalJson(again)!==f.canonicalJson(archive))process.exit(3);
    console.log('portable-offline-restore-ok');
  `;
  const result=spawnSync(process.execPath,['-e',program,root],{encoding:'utf8',env:{},timeout:20000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/portable-offline-restore-ok/);
  assert.equal(fs.existsSync(path.join(root,'js')),false);assert.equal(fs.existsSync(path.join(root,'data.js')),false);
});
