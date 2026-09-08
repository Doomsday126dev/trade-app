#!/usr/bin/env node
'use strict';

// The only executable path constructs its own synthetic input. There is no
// import-from-Firebase flag, credential flag, user selector or live restore mode.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const f=require('./format.cjs');
const {adaptSyntheticSource}=require('./source-adapter.cjs');
const {makeSource,loadCurrentContracts,SECRET_MARKERS,OWNER,SOURCE_COMMIT}=require('./fixtures/synthetic-source.cjs');

function writeNew(file,value){fs.writeFileSync(file,f.inspectableJson(value),{flag:'wx',mode:0o600});}
function recordDigest(records){return f.digest([...records].sort((a,b)=>f.entityKey(a)<f.entityKey(b)?-1:1),'source-records');}
function currentSemanticDigest(records,catalog,profile){
  const {product}=loadCurrentContracts();
  const entries=new Map(catalog.entries.map(item=>[item.catalogId,item]));
  const active=records.filter(item=>item.entityType!=='tradeEntry'||!item.deleted&&item.identity.lane!=='for-trade');
  const projected=product.projectTradeEntities({entities:active,catalogEntryForId:id=>{const item=entries.get(id);return item?{name:item.name,displayName:item.name,no:item.speciesId}:null;},encodePriority:values=>JSON.stringify(values)});
  const organization=product.organizerProjection(active);
  // Convert trusted VM values across the realm boundary before canonical hashing.
  return f.digest(JSON.parse(JSON.stringify({projected,organization,profile})),'current-model-semantics');
}
async function prove(output){
  const root=output?path.resolve(output):fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'trade-archive-proof-'));
  if(output)fs.mkdirSync(root,{mode:0o700});
  const sourcePath=path.join(root,'synthetic-source.json');
  let source=await makeSource();
  writeNew(sourcePath,source);
  const allSourceRecords=[...Object.values(source.accountSync.tradeEntries),...Object.values(source.accountSync.favorites),...Object.values(source.accountSync.tags)];
  const expectedRecordsHash=recordDigest(allSourceRecords);
  const profileFields=['friendCode','bio','discord','avatarPokemon','wallpaper'];
  const expectedSemanticHash=currentSemanticDigest(allSourceRecords,source.catalog,Object.fromEntries(profileFields.map(key=>[key,source.identity.userRecord[key]])));
  const expectedHistoryHash=f.digest(source.devices[0].history,'device-history');
  const expectedPublicHash=f.digest(source.publicShare,'public-share');
  const expectedRecoveryHash=f.digest({migrations:Object.values(source.accountSync.migrations),candidates:Object.values(source.accountSync.recoveryCandidates),reviewAcceptances:Object.values(source.identity.authIndex[OWNER].accountSyncRecoveryReviews)},'server-recovery');
  // Keep comparison digests, not a second recoverable copy of the source state.
  allSourceRecords.length=0;
  const archive=f.exportArchive(adaptSyntheticSource(JSON.parse(fs.readFileSync(sourcePath,'utf8'))));
  const receipt=f.createCaptureReceipt(archive),archivePath=path.join(root,'synthetic.archive.json');
  writeNew(archivePath,archive);writeNew(path.join(root,'capture-receipt.json'),receipt);
  writeNew(path.join(root,'archive-v1.schema.json'),f.schemaDocument);
  const archiveBytes=fs.readFileSync(archivePath,'utf8');
  for(const marker of SECRET_MARKERS)assert.ok(!archiveBytes.includes(marker),'Excluded credential marker entered archive');
  f.validateArchive(f.parseArchive(archiveBytes),receipt);

  fs.unlinkSync(sourcePath);source=null;
  assert.equal(fs.existsSync(sourcePath),false);
  const target=path.join(root,'restored');
  const active=f.restoreArchive(f.parseArchive(fs.readFileSync(archivePath,'utf8')),target,JSON.parse(fs.readFileSync(path.join(root,'capture-receipt.json'),'utf8')));
  const second=f.reexportTarget(target,receipt);
  const restoredRecords=[...second.canonical.entities,...second.historical.records.filter(item=>item.kind==='retired-sync-entity').map(item=>item.value)];
  assert.equal(recordDigest(restoredRecords),expectedRecordsHash,'Full source wire records (including tombstones/FT) did not survive');
  assert.equal(currentSemanticDigest(second.canonical.entities,second.catalog,second.canonical.profile.values),expectedSemanticHash,'Current-model semantic canonical state differs');
  assert.equal(f.digest(second.knownDevices[0].history,'device-history'),expectedHistoryHash);
  assert.equal(f.digest(second.canonical.publicShare.snapshot,'public-share'),expectedPublicHash);
  assert.equal(f.digest(second.canonical.recoveryEvidence,'server-recovery'),expectedRecoveryHash);
  assert.equal(f.canonicalJson(second),f.canonicalJson(archive),'Canonical second export differs');
  assert.equal(f.inspectableJson(second),archiveBytes,'Inspectable second export is not byte deterministic');

  // Independent source-model validation: these contracts only construct/check
  // fixtures. The standalone archive reader does not need the old runtime files.
  const contracts=loadCurrentContracts();
  for(const record of restoredRecords)assert.equal(contracts.merge.validateEntity(record,{ownerUid:OWNER,entityType:record.entityType,entityId:record.entityId}).ok,true);
  for(const item of second.knownDevices[0].journal.operations)assert.equal((await contracts.model.verifyOperation(item.operation)).ok,true);
  assert.equal(contracts.publication.publicShareProjectionStatus(second.canonical.publicShare.snapshot,{username:second.provenance.currentHandle}).ok,true);
  assert.equal(active.wants.length,10);
  assert.deepEqual([...new Set(active.wants.map(item=>item.priority))].sort(),['','H','L','M']);
  for(const flag of ['lucky','xxl','xxs'])assert.ok(active.wants.some(item=>item.priority===''&&item[flag]));
  assert.ok(active.wants.filter(item=>item.pokemon.speciesId===25).length>=4);
  assert.ok(active.wants.every(item=>item.lane!=='for-trade'&&!Object.hasOwn(item,'quantity')&&!Object.hasOwn(item,'backgroundId')&&!Object.hasOwn(item,'mirror')));
  assert.ok(!active.wants.some(item=>item.note==='Device-only note waiting for connection'));
  assert.equal(active.favorites.length,1);assert.equal(active.tags.length,2);
  const results={
    proof:'offline-synthetic-archive-restore-v1',baseCommit:SOURCE_COMMIT,runtimeRelease:'2026-09-07.100',
    sourceDestroyed:true,cleanTarget:true,canonicalStateEqual:true,fullSourceRecordEvidenceEqual:true,
    historicalInert:true,pendingWorkQuarantined:true,publicationNotReactivated:true,credentialsExcluded:true,
    historyBaselinesEqual:true,serverRecoveryEvidenceEqual:true,publicSnapshotEqual:true,secondExportByteIdentical:true,
    counts:{activeWants:active.wants.length,favorites:active.favorites.length,privateTags:active.tags.length,sourceEntities:restoredRecords.length,historicalRecords:second.historical.records.length,capturedDevices:second.knownDevices.length,pendingOperations:second.knownDevices[0].journal.operations.length,conflicts:second.knownDevices[0].journal.conflicts.length,recoveryCandidates:second.knownDevices[0].journal.recoveryCandidates.length},
    archiveBytes:Buffer.byteLength(archiveBytes),payloadHash:archive.integrity.payloadHash,
    captureReceipt:receipt,limitations:['No real accounts captured or migrated','No server-only capture can include unseen device work','Authentication requires independent re-verification','Current fixture adapter is not a complete production capture adapter'],
    artifacts:{archive:archivePath,captureReceipt:path.join(root,'capture-receipt.json'),schema:path.join(root,'archive-v1.schema.json'),restored:target}
  };
  writeNew(path.join(root,'proof-results.json'),results);return results;
}
if(require.main===module){
  const args=process.argv.slice(2);
  if(args.length!==0&&(args.length!==2||args[0]!=='--output')){console.error('Usage: node scripts/archive-proof/prove.cjs [--output NEW_DIRECTORY]');process.exitCode=2;}
  else prove(args[1]).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={prove};
