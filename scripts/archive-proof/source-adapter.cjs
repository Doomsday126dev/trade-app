'use strict';

// A fixture-only .100 adapter. This module has no filesystem or network access.
// Unknown source fields stop capture; they are never silently dropped into a blob.
const {clone,normalizePayload,validateEntity,activeWant}=require('./format.cjs');
const PROFILE_FIELDS=['friendCode','bio','discord','avatarPokemon','wallpaper'];
const USER_KEYS=['authUid','authVersion','authEmail','pin','pinHashed',...PROFILE_FIELDS,'lastUpdated'];
function reject(message){throw Object.assign(new Error(`archive/source: ${message}`),{code:'archive/source'});}
function exact(value,keys,label){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||!keys.every(key=>Object.hasOwn(value,key)))reject(`${label} contains missing/unknown fields; classify them before capture`);
}
function adaptSyntheticSource(input){
  const source=clone(input);
  exact(source,['synthetic','capturedAt','snapshotId','sourceCommit','identity','catalog','accountSync','publicShare','devices','historical'],'source');
  if(source.synthetic!==true)reject('Only the explicitly synthetic fixture source is supported');
  exact(source.identity,['provenance','authIndex','userRecord','credentials'],'identity');
  exact(source.identity.userRecord,USER_KEYS,'profile');
  exact(source.identity.credentials,['password','refreshToken','idToken','privateKey','pinHash'],'excluded credentials');
  exact(source.accountSync,['meta','tradeEntries','favorites','tags','migrations','recoveryCandidates'],'accountSync');
  const provenance=source.identity.provenance,owner=provenance.ownerUid,handle=provenance.currentHandle;
  exact(source.identity.authIndex,[owner],'auth index');
  exact(source.identity.authIndex[owner],['username','accountSyncRecoveryReviews'],'auth index pair');
  if(source.identity.authIndex[owner].username!==handle||source.identity.userRecord.authUid!==owner)reject('Current auth index/profile pair does not prove ownership');
  if(provenance.accessMethods.find(item=>item.kind==='legacy-pin')?.credentialEpoch!==source.identity.userRecord.authVersion)reject('Credential epoch evidence disagrees');
  for(const [records,field] of [[source.accountSync.migrations,'deviceMigrationId'],[source.accountSync.recoveryCandidates,'candidateId'],[source.identity.authIndex[owner].accountSyncRecoveryReviews,'evidenceFingerprint']]){
    for(const [key,record] of Object.entries(records))if(record?.[field]!==key||record.ownerUid!==owner)reject('Server recovery evidence key/owner mismatch');
  }
  const canonical=[],historical=[...source.historical];
  for(const [collection,type] of [['tradeEntries','tradeEntry'],['favorites','favorite'],['tags','tag']]){
    for(const [id,entity] of Object.entries(source.accountSync[collection])){
      if(id!==entity.entityId||entity.entityType!==type)reject('Source collection key/type mismatch');
      validateEntity(entity,owner);
      if(type==='tradeEntry'&&!activeWant(entity))historical.push({recordId:`retired:${type}:${id}`,ownerUid:owner,kind:'retired-sync-entity',sourcePath:`accountSync/${owner}/${collection}/${id}`,disposition:'inert-only',value:entity});
      else canonical.push(entity);
    }
  }
  const knownDevices=source.devices.map(device=>{
    exact(device,['deviceId','ownerUid','capturedAt','sourceVersions','history','journal','legacyQueue','cachedOwnedLists','orders','viewedSnapshots','preferences','browserCredentials'],'device');
    exact(device.browserCredentials,['firebaseAuth','sessionHint'],'excluded browser credentials');
    const {browserCredentials,...safe}=device;
    for(const store of ['entities','operations','conflicts','recoveryCandidates','meta']){
      if(!Array.isArray(safe.journal[store]))reject('Journal store is missing');
      safe.journal[store]=safe.journal[store].map(record=>{
        if(record.ownerUid!==owner||typeof record.key!=='string'||!record.key.startsWith(`${owner}|`))reject('IndexedDB record has foreign ownership');
        const {key,...value}=record;
        if(store==='entities'){
          exact(record,['key','ownerUid','entityType','entityId','entity'],'journal entity wrapper');
          if(record.entity.ownerUid!==owner||record.entityType!==record.entity.entityType||record.entityId!==record.entity.entityId||key!==`${owner}|${record.entityType}|${record.entityId}`)reject('Journal entity wrapper binding mismatch');
          return record.entity;
        }
        const suffix=store==='meta'?record.name:store==='operations'?record.operationId:store==='conflicts'?record.conflictId:record.candidateId;
        if(key!==`${owner}|${suffix}`)reject('Journal key does not match its bound record');
        return value;
      });
    }
    return safe;
  });
  const dispositions=[
    {path:'identity.provenance',action:'preserved',reason:'Account UID, proven aliases, non-secret access linkage and retired UID fencing; no authentication grant.'},
    {path:'identity.userRecord.profileChoices',action:'preserved',reason:'Exact allowlisted user profile values; no whole-record copy.'},
    {path:'identity.userRecord.pin',action:'excluded-secret',reason:'Exclude both plaintext and hashed PIN material; retain neither value nor value hash.'},
    {path:'identity.credentials.*',action:'excluded-secret',reason:'Exclude passwords, refresh/ID tokens, private keys and credential hashes at the source boundary.'},
    {path:'devices.*.browserCredentials',action:'excluded-secret',reason:'Do not capture Firebase Auth persistence, reusable credentials or session hints.'},
    {path:'identity.userRecord.authEmail',action:'derived',reason:'Legacy synthetic authentication address is derived routing metadata; never recreate a login from it.'},
    {path:'identity.userRecord.pinHashed',action:'non-restorable',reason:'Storage implementation flag does not grant access and is not needed after credential exclusion.'},
    {path:'accountSync.activeEntities',action:'preserved',reason:'Preserve full current v1 values and revision/lifecycle evidence; derive wants-only active projection.'},
    {path:'accountSync.migrations,recoveryCandidates,authIndex.accountSyncRecoveryReviews',action:'preserved',reason:'Retain non-secret server migration/recovery/review evidence; an old acceptance is never a new authentication or replay grant.'},
    {path:'accountSync.tradeEntry.values.backgroundId,quantity,mirror',action:'inert',reason:'.100 active wants omit these historical fields; source evidence retains them without activation.'},
    {path:'historical.records',action:'inert',reason:'Retired FT, inventory, quantity, background, trade and deletion evidence never enter active.json.'},
    {path:'devices.*.journal',action:'preserved',reason:'Pending, conflicts, optimistic entity copies and recovery evidence stay in a non-executable review area.'},
    {path:'devices.*.journal.*.key',action:'derived',reason:'IndexedDB key/index encoding is reconstructable from owner/entity/operation identity; it is not portable data authority.'},
    {path:'devices.*.history,orders,viewedSnapshots,preferences,cachedOwnedLists,legacyQueue',action:'preserved',reason:'Device-attributed capture; never claim these observations were present in the server snapshot.'},
    {path:'publicShare',action:'preserved',reason:'Retain published projection and publication state privately for review; restore never publishes or reserves URLs.'},
    {path:'authenticationSessions,adminClaims,appCheck,listenerGenerations',action:'non-restorable',reason:'Live authorization, privilege and session machinery must be independently recreated and verified.'},
    {path:'derivedSprites,serviceWorkerCaches,searchIndexes',action:'derived',reason:'Rebuild from reviewed product data; these caches are not pending user work.'}
  ];
  return normalizePayload({format:'trade-app-user-archive',archiveSchemaVersion:1,capture:{kind:'offline-synthetic',capturedAt:source.capturedAt,snapshotId:source.snapshotId},source:{runtimeRelease:'2026-09-07.100',sourceCommit:source.sourceCommit,adapterVersion:1,accountSyncSchema:1,trainerHistorySchema:3},provenance,catalog:source.catalog,canonical:{meta:source.accountSync.meta,entities:canonical,recoveryEvidence:{migrations:Object.values(source.accountSync.migrations),candidates:Object.values(source.accountSync.recoveryCandidates),reviewAcceptances:Object.values(source.identity.authIndex[owner].accountSyncRecoveryReviews)},profile:{ownerUid:owner,authority:'legacy-profile',revision:null,values:Object.fromEntries(PROFILE_FIELDS.map(field=>[field,source.identity.userRecord[field]])),updatedAt:source.identity.userRecord.lastUpdated},publicShare:{ownerUid:owner,status:source.publicShare===null?'not-published':'published',snapshot:source.publicShare}},knownDevices,historical:{records:historical},dispositions,coverage:{server:'synthetic-snapshot',capturedDevices:knownDevices.map(device=>device.deviceId),otherDevices:'unknown-not-captured',volatileUnsavedEdits:'not-captured'},compatibility:{minimumReaderVersion:1,target:'isolated-filesystem-v1',authentication:'reverify-never-recreate',pendingWork:'quarantine-never-replay',historical:'inert-only'}});
}
module.exports={adaptSyntheticSource,PROFILE_FIELDS};
