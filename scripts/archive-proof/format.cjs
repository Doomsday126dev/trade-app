'use strict';

// No SDK, browser globals, network, runtime boot, or authentication capability.
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {schema,schemaDocument,payloadSchema,wireSchema,operationSchema}=require('./schema.cjs');
const MAX_BYTES=16*1024*1024;
const UNSAFE_KEYS=new Set(['__proto__','prototype','constructor']);
const TRADE_FIELDS=['priority','variant','gender','lucky','xxl','xxs','shiny','backgroundId','sortOrder','quantity','note','mirror'];
const CATEGORIES=['wishlist','dynamax','gmax','costumes'];
const clone=value=>JSON.parse(canonicalJson(value));
function fail(code,message){throw Object.assign(new Error(`${code}: ${message}`),{code});}
function requireThat(condition,code,message){if(!condition)fail(code,message);}
function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);}
function assertJson(value,depth=0){
  requireThat(depth<=80,'archive/limits','JSON nesting exceeds the reader limit');
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='number'){requireThat(Number.isSafeInteger(value)&&!Object.is(value,-0),'archive/json','Only exact safe integers are supported');return;}
  if(typeof value==='string'){
    requireThat(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value),'archive/json','Unpaired Unicode surrogate');return;
  }
  requireThat(Array.isArray(value)||plain(value),'archive/json','Only plain JSON values are supported');
  requireThat(Object.getOwnPropertySymbols(value).length===0,'archive/json','Symbol keys are unsupported');
  for(const key of Object.keys(value)){
    requireThat(!UNSAFE_KEYS.has(key),'archive/json','Unsafe object key');
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    requireThat(descriptor&&Object.hasOwn(descriptor,'value'),'archive/json','Accessors are unsupported');
    assertJson(key,depth+1);assertJson(descriptor.value,depth+1);
  }
  if(Array.isArray(value))requireThat(Object.keys(value).length===value.length&&Object.keys(value).every((key,i)=>key===String(i)),'archive/json','Sparse or decorated arrays are unsupported');
}
function serialize(value){
  if(Array.isArray(value))return`[${value.map(serialize).join(',')}]`;
  if(plain(value))return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${serialize(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function canonicalJson(value){assertJson(value);return serialize(value);}
function sha256(value){return crypto.createHash('sha256').update(value,'utf8').digest('hex');}
function digest(value,domain){return sha256(`trade-archive-v1\0${domain}\0${canonicalJson(value)}`);}

// A deliberately bounded evaluator for the schema constructs in schema.cjs.
// An unknown construct is an implementation error, never silently ignored.
const KEYWORDS=new Set(['$schema','$id','title','type','properties','required','additionalProperties','items','anyOf','const','enum','pattern','minLength','maxLength','minimum','maximum','maxItems','maxProperties']);
function checkShape(value,definition,location='$'){
  for(const key of Object.keys(definition))requireThat(KEYWORDS.has(key),'archive/schema-implementation',`Unsupported schema keyword ${key}`);
  if(Object.hasOwn(definition,'const'))requireThat(value===definition.const,'archive/shape',`${location} must equal ${JSON.stringify(definition.const)}`);
  if(definition.enum)requireThat(definition.enum.includes(value),'archive/shape',`${location} has an unsupported value`);
  if(definition.anyOf){
    const matches=definition.anyOf.some(choice=>{try{checkShape(value,choice,location);return true;}catch(error){if(error.code!=='archive/shape')throw error;return false;}});
    requireThat(matches,'archive/shape',`${location} matches no supported shape`);return;
  }
  if(!definition.type)return;
  const type=definition.type;
  requireThat(type==='null'?value===null:type==='object'?plain(value):type==='array'?Array.isArray(value):type==='integer'?Number.isSafeInteger(value):typeof value===type,'archive/shape',`${location} must be ${type}`);
  if(type==='string'){
    const length=Array.from(value).length;
    requireThat((definition.minLength===undefined||length>=definition.minLength)&&(definition.maxLength===undefined||length<=definition.maxLength)&&(!definition.pattern||new RegExp(definition.pattern,'u').test(value)),'archive/shape',`${location} has invalid text`);
  }else if(type==='integer')requireThat((definition.minimum===undefined||value>=definition.minimum)&&(definition.maximum===undefined||value<=definition.maximum),'archive/shape',`${location} is out of range`);
  else if(type==='array'){
    requireThat(value.length<=(definition.maxItems??20000),'archive/shape',`${location} has too many items`);
    value.forEach((item,index)=>checkShape(item,definition.items,`${location}/${index}`));
  }else if(type==='object'){
    requireThat(Object.keys(value).length<=(definition.maxProperties??20000),'archive/shape',`${location} has too many fields`);
    for(const key of definition.required||[])requireThat(Object.hasOwn(value,key),'archive/shape',`${location}/${key} is missing`);
    for(const key of Object.keys(value)){
      if(Object.hasOwn(definition.properties||{},key))checkShape(value[key],definition.properties[key],`${location}/${key}`);
      else{requireThat(definition.additionalProperties!==false,'archive/shape',`${location}/${key} is not allowlisted`);checkShape(value[key],definition.additionalProperties,`${location}/${key}`);}
    }
  }
}
function unique(items,key,location){
  const map=new Map();for(const item of items){const id=key(item);requireThat(!map.has(id),'archive/authority',`Duplicate ${location}`);map.set(id,item);}return map;
}
function chronological(start,end,location){requireThat(end>=start,'archive/shape',`${location} timestamps run backwards`);}
function date(value){requireThat(Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value,'archive/shape','Invalid capture timestamp');}
function base64(value){return Buffer.from(value,'utf8').toString('base64url');}
function tradeEntryId(identity){return`te_${base64(canonicalJson([1,'pogo-account-trade-entry',identity.surface,identity.lane,identity.catalogId]))}`;}
function entityKey(entity){return`${entity.entityType}|${entity.entityId}`;}
function identityValid(type,id,identity){
  if(type==='tradeEntry')return plain(identity)&&Object.keys(identity).sort().join(',')==='catalogId,lane,surface'&&tradeEntryId(identity)===id;
  if(type==='favorite')return plain(identity)&&Object.keys(identity).join(',')==='targetUid'&&identity.targetUid===id;
  return plain(identity)&&Object.keys(identity).join(',')==='tagId'&&identity.tagId===id&&/^tag_[A-Za-z0-9_-]+$/.test(id);
}
function valueFields(type,values){
  if(type==='favorite')return[['displayName',values.displayName],...Object.entries(values.tagIds||{}).map(([key,value])=>[`tagIds/${key}`,value])];
  return Object.entries(values);
}
function fieldValid(type,key,value){
  if(type==='favorite')return key==='displayName'?typeof value==='string'&&value.trim().length>0&&Array.from(value).length<=64:/^tagIds\/tag_[A-Za-z0-9_-]+$/.test(key)&&typeof value==='boolean';
  if(type==='tag')return key==='label'&&typeof value==='string'&&value.trim().length>0&&Array.from(value).length<=40;
  return Object.hasOwn(wireSchema.properties.values.anyOf[0].properties,key)&&(()=>{try{checkShape(value,wireSchema.properties.values.anyOf[0].properties[key]);return true;}catch{return false;}})();
}
function leaves(value,prefix=''){
  return Object.entries(value).flatMap(([key,item])=>plain(item)?leaves(item,`${prefix}${key}/`):[[`${prefix}${key}`,item]]);
}
function validateEntity(entity,ownerUid){
  checkShape(entity,wireSchema);
  requireThat(entity.ownerUid===ownerUid&&identityValid(entity.entityType,entity.entityId,entity.identity),'archive/ownership','Entity ownership or identity mismatch');
  const shape=entity.entityType==='tradeEntry'?wireSchema.properties.values.anyOf[0]:entity.entityType==='favorite'?wireSchema.properties.values.anyOf[1]:wireSchema.properties.values.anyOf[2];
  checkShape(entity.values,shape);
  requireThat(entity.deleted===Object.hasOwn(entity,'deletedAt'),'archive/entity','Deletion evidence is inconsistent');
  chronological(entity.createdAt,entity.updatedAt,'entity');
  if(entity.deleted)chronological(entity.createdAt,entity.deletedAt,'deletion');
  const fields=valueFields(entity.entityType,entity.values);
  requireThat(fields.length>0&&fields.every(([key,value])=>fieldValid(entity.entityType,key,value)),'archive/entity','Invalid entity values');
  const expected=fields.map(([key])=>entity.entityType==='favorite'&&key.startsWith('tagIds/')?key:`f_${base64(key)}`).sort();
  for(const [name,validator] of [['fieldRevisions',value=>Number.isSafeInteger(value)&&value>=1],['fieldMutations',value=>/^op_[A-Za-z0-9_-]{16,96}$/.test(value)],['fieldMutationHashes',value=>/^[a-f0-9]{64}$/.test(value)]]){
    const entries=leaves(entity[name]);
    requireThat(canonicalJson(entries.map(([key])=>key).sort())===canonicalJson(expected)&&entries.every(([,value])=>validator(value)),'archive/entity','Field mutation evidence mismatch');
  }
  requireThat(/^op_[A-Za-z0-9_-]{16,96}$/.test(entity.lifecycleMutation),'archive/entity','Invalid lifecycle operation');
}
function validateExactVariant(entity,catalog){
  if(entity.entityType!=='tradeEntry')return;
  const entry=catalog.get(entity.identity.catalogId),values=entity.values;
  requireThat(!!entry,'archive/variant','Unresolved exact catalog identity');
  requireThat(entry.allowedGenders.includes(values.gender)&&!(values.xxl&&values.xxs),'archive/variant','Impossible or unsupported exact variant');
  const {surface,lane}=entity.identity;
  requireThat(surface!=='special-board'||['looking-for','for-trade'].includes(lane),'archive/variant','Invalid special-board lane');
  if(['dynamax','gmax'].includes(lane))requireThat(entry.maxState===lane,'archive/variant','Max state does not match lane');
  if(lane==='costumes')requireThat(entry.costumeId!==''||entry.formId!=='','archive/variant','Costume/form lane has no exact variant');
}
function operationInput(value){return[1,'pogo-account-sync-operation',value.operationId,value.ownerUid,value.entityType,value.entityId,value.kind,value.baseGeneration,value.generation,value.baseFieldRevisions,value.patch,value.clientAt];}
function validateOperation(operation,ownerUid,catalog,entities){
  checkShape(operation,operationSchema);
  requireThat(operation.ownerUid===ownerUid,'archive/ownership','Pending operation owner mismatch');
  requireThat(/^op_[A-Za-z0-9_-]{16,96}$/.test(operation.operationId),'archive/operation','Invalid operation ID');
  requireThat(sha256(canonicalJson(operationInput(operation)))===operation.inputHash,'archive/operation','Pending operation hash mismatch');
  const keys=Object.keys(operation.patch).sort();
  requireThat(canonicalJson(keys)===canonicalJson(Object.keys(operation.baseFieldRevisions).sort())&&keys.every(key=>fieldValid(operation.entityType,key,operation.patch[key])),'archive/operation','Invalid patch or base field revisions');
  requireThat(operation.kind==='delete'?keys.length===0:keys.length>0,'archive/operation','Invalid operation patch cardinality');
  requireThat(operation.kind==='patch'?operation.generation===operation.baseGeneration&&operation.generation>=1:operation.generation===operation.baseGeneration+1,'archive/operation','Invalid lifecycle generation');
  const current=entities.get(entityKey(operation));
  if(operation.kind==='add')requireThat(identityValid(operation.entityType,operation.entityId,operation.identity),'archive/ownership','Pending add identity mismatch');
  else requireThat(operation.identity===null,'archive/operation','Unexpected patch/delete identity');
  // Pending work is retained, not applied. Validate representable variant fields
  // against its identity/current evidence; missing targets remain review items.
  if(operation.entityType==='tradeEntry'&&operation.kind!=='delete'){
    const identity=operation.identity||current?.identity;
    requireThat(!!identity,'archive/variant','Pending variant has no exact identity evidence');
    const values={...(current?.values||{}),...operation.patch};
    checkShape(values,wireSchema.properties.values.anyOf[0]);
    validateExactVariant({entityType:'tradeEntry',identity,values},catalog);
  }
}
function activeWant(entity){return entity.entityType==='tradeEntry'&&!entity.deleted&&entity.identity.lane!=='for-trade';}
function validateRecovery(candidate,owner){
  requireThat(candidate.ownerUid===owner&&/^candidate_[a-f0-9]{64}$/.test(candidate.candidateId),'archive/ownership','Recovery evidence owner/identifier mismatch');
  if(candidate.reason==='favorite-uid-unresolved')requireThat(candidate.entityType==='favorite'&&candidate.identity.targetUid===''&&candidate.entityId.startsWith('unresolved:'),'archive/ownership','Unresolved Favorite cannot assert an invented UID');
  // Unresolved records intentionally do not pass active exact-variant validation.
  // Their uncertainty is preserved in the review area, never repaired by guessing.
}
function validateMigration(record,owner){
  requireThat(record.ownerUid===owner&&/^migration_[a-f0-9]{64}$/.test(record.deviceMigrationId),'archive/ownership','Migration evidence owner/identifier mismatch');
  chronological(record.createdAt,record.completedAt,'migration evidence');
}
function validateSemantics(payload){
  const p=payload.provenance,owner=p.ownerUid;
  requireThat(p.accountId===owner&&payload.canonical.meta.ownerUid===owner,'archive/ownership','Canonical account authority mismatch');
  chronological(payload.canonical.meta.initializedAt,payload.canonical.meta.updatedAt,'canonical meta');
  date(payload.capture.capturedAt);
  const evidence=unique(p.evidence,item=>item.evidenceId,'provenance evidence');
  requireThat(p.evidence.every(item=>item.ownerUid===owner)&&p.evidence.some(item=>item.kind==='canonical-meta'),'archive/ownership','Canonical provenance evidence is missing or foreign');
  function proof(id,kind){requireThat(evidence.get(id)?.kind===kind,'archive/provenance','Missing or conflicting evidence reference');}
  unique(p.aliases,item=>canonicalJson([item.handle.normalize('NFKC').toLowerCase(),item.validFrom,item.validUntil]),'alias authority');
  requireThat(p.aliases.some(item=>item.handle===p.currentHandle&&item.validUntil===null),'archive/ownership','Current handle has no proven active alias');
  for(const alias of p.aliases){requireThat(alias.ownerUid===owner,'archive/ownership','Alias owner mismatch');proof(alias.evidenceId,'alias-proof');if(alias.validUntil!==null)chronological(alias.validFrom,alias.validUntil,'alias');}
  const intervals=new Map();
  for(const alias of p.aliases){const key=alias.handle.normalize('NFKC').toLowerCase(),items=intervals.get(key)||[];items.push(alias);intervals.set(key,items);}
  for(const aliases of intervals.values()){
    aliases.sort((a,b)=>a.validFrom-b.validFrom);
    for(let index=1;index<aliases.length;index++)requireThat((aliases[index-1].validUntil??Infinity)<aliases[index].validFrom,'archive/authority','Overlapping handle-history authority');
  }
  unique(p.accessMethods,item=>item.kind,'access method');
  for(const method of p.accessMethods){requireThat(method.ownerUid===owner,'archive/ownership','Access method owner mismatch');proof(method.evidenceId,'access-link');requireThat(method.kind==='legacy-pin'?method.providerSubjectKey===null:method.providerSubjectKey!==null,'archive/provenance','Invalid access linkage evidence');}
  unique(p.retiredUids,item=>item.uid,'retired UID');
  for(const retired of p.retiredUids){requireThat(retired.uid!==owner&&retired.replacementUid===owner,'archive/ownership','Retired UID contradicts canonical owner');proof(retired.evidenceId,'retired-uid-fence');}
  const catalog=unique(payload.catalog.entries,item=>item.catalogId,'catalog identity');
  for(const entry of catalog.values())unique(entry.allowedGenders,item=>item,'catalog gender');
  const entities=unique(payload.canonical.entities,entityKey,'canonical entity authority');
  for(const entity of entities.values()){validateEntity(entity,owner);validateExactVariant(entity,catalog);requireThat(entity.entityType!=='tradeEntry'||activeWant(entity),'archive/inert','Retired/deleted trade record cannot be canonical active data');}
  for(const entity of entities.values())if(entity.entityType==='favorite'&&!entity.deleted)for(const [tagId,selected] of Object.entries(entity.values.tagIds||{}))if(selected){
    const tag=entities.get(`tag|${tagId}`);requireThat(tag?.entityType==='tag'&&!tag.deleted,'archive/reference','Favorite references a missing active tag');
  }
  unique(payload.canonical.recoveryEvidence.migrations,item=>item.deviceMigrationId,'canonical migration evidence');
  unique(payload.canonical.recoveryEvidence.candidates,item=>item.candidateId,'canonical recovery evidence');
  unique(payload.canonical.recoveryEvidence.reviewAcceptances,item=>item.evidenceFingerprint,'canonical recovery review');
  payload.canonical.recoveryEvidence.migrations.forEach(item=>validateMigration(item,owner));
  payload.canonical.recoveryEvidence.candidates.forEach(item=>validateRecovery(item,owner));
  for(const review of payload.canonical.recoveryEvidence.reviewAcceptances)requireThat(review.ownerUid===owner&&p.aliases.some(item=>item.handle===review.trainerUsername),'archive/ownership','Recovery review is bound to another account');
  requireThat(payload.canonical.profile.ownerUid===owner&&payload.canonical.publicShare.ownerUid===owner,'archive/ownership','Profile/public state owner mismatch');
  const share=payload.canonical.publicShare;
  requireThat(share.status==='not-published'?share.snapshot===null:share.snapshot!==null,'archive/public-share','Share status and snapshot disagree');
  if(share.snapshot){
    const snap=share.snapshot;
    requireThat(p.aliases.some(alias=>alias.handle===snap.username),'archive/ownership','Public snapshot is not bound to a proven handle');
    requireThat(snap.version===2?snap.declarationCount===snap.declarations?.length:!Object.hasOwn(snap,'declarations')&&!Object.hasOwn(snap,'declarationCount'),'archive/public-share','Public declaration count/version mismatch');
    requireThat(canonicalJson([...snap.publishedListTypes].sort())===canonicalJson([...CATEGORIES].sort()),'archive/public-share','Incomplete public surface evidence');
  }
  const historical=unique(payload.historical.records,item=>item.recordId,'historical record');
  for(const item of historical.values()){
    requireThat(item.ownerUid===owner,'archive/ownership','Historical record owner mismatch');
    const historicalShapes=payloadSchema.properties.historical.properties.records.items.properties.value.anyOf;
    checkShape(item.value,historicalShapes[['retired-sync-entity','inventory','trade','background'].indexOf(item.kind)]);
    if(item.kind==='retired-sync-entity'){
      validateEntity(item.value,owner);requireThat(!entities.has(entityKey(item.value)),'archive/authority','Canonical and retired records claim the same entity');
      requireThat(item.value.entityType!=='tradeEntry'||!activeWant(item.value),'archive/inert','Active want misclassified as retired');
    }
  }
  unique(payload.knownDevices,item=>item.deviceId,'device capture');
  requireThat(canonicalJson([...payload.coverage.capturedDevices].sort())===canonicalJson(payload.knownDevices.map(item=>item.deviceId).sort()),'archive/coverage','Device coverage does not match captures');
  const operationIds=new Map();
  for(const device of payload.knownDevices){
    requireThat(device.ownerUid===owner&&device.history.owner.uid===owner&&p.aliases.some(item=>item.handle===device.history.owner.username),'archive/ownership','Device history owner mismatch');date(device.capturedAt);
    const deviceEntities=unique(device.journal.entities,entityKey,'device entity');
    for(const entity of deviceEntities.values()){validateEntity(entity,owner);if(activeWant(entity))validateExactVariant(entity,catalog);}
    const localOperations=unique(device.journal.operations,item=>item.operationId,'device operation');
    const evidenceEntities=new Map([...entities,...deviceEntities]);
    for(const record of localOperations.values()){
      requireThat(record.ownerUid===owner&&record.operationId===record.operation.operationId,'archive/ownership','Journal operation binding mismatch');
      validateOperation(record.operation,owner,catalog,evidenceEntities);
      const previous=operationIds.get(record.operationId),serialized=canonicalJson(record.operation);
      requireThat(previous===undefined||previous===serialized,'archive/authority','Operation ID has conflicting device authority');operationIds.set(record.operationId,serialized);
      chronological(record.createdAt,record.updatedAt,'journal');
    }
    unique(device.journal.conflicts,item=>item.conflictId,'device conflict');
    for(const conflict of device.journal.conflicts){
      const operation=localOperations.get(conflict.operationId)?.operation;
      requireThat(conflict.ownerUid===owner&&operation&&conflict.entityId===operation.entityId&&conflict.entityType===operation.entityType&&conflict.conflictId===`conflict_${operation.operationId}`,'archive/ownership','Conflict operation evidence mismatch');
      requireThat(conflict.fields.every(key=>Object.hasOwn(operation.patch,key)),'archive/operation','Conflict fields do not belong to operation');
    }
    unique(device.journal.recoveryCandidates,item=>item.candidateId,'recovery candidate');
    for(const candidate of device.journal.recoveryCandidates)validateRecovery(candidate,owner);
    unique(device.journal.meta,item=>item.name,'journal metadata');
    for(const item of device.journal.meta){
      const legacy=item.name.startsWith('legacy-source:');
      requireThat(item.ownerUid===owner&&(legacy||item.value.ownerUid===owner),'archive/ownership','Journal metadata owner mismatch');
      const choices=payloadSchema.properties.knownDevices.items.properties.journal.properties.meta.items.properties.value.anyOf;
      checkShape(item.value,choices[legacy?3:['provider-profile-pending-v1','provider-publication-pending-v1','migration-complete'].indexOf(item.name)]);
      if(item.name==='migration-complete')validateMigration(item.value,owner);
      if(item.name==='provider-publication-pending-v1')requireThat(item.value.fingerprint===sha256(canonicalJson([1,'pogo-provider-publication',owner,item.value.rows])),'archive/integrity','Pending publication fingerprint mismatch');
      if(legacy){
        for(const order of Object.values(item.value.orders))requireThat(order.owner.uid===owner&&p.aliases.some(alias=>alias.handle===order.owner.username),'archive/ownership','Retained legacy order belongs to another owner');
        for(const queued of Object.values(item.value.legacyQueue)){
          const parts=queued.path.split('/');
          requireThat(CATEGORIES.includes(parts[0])&&p.aliases.some(alias=>alias.handle===parts[1]),'archive/ownership','Retained legacy queue belongs to another owner');
        }
      }
    }
    for(const order of device.orders)requireThat(order.owner.uid===owner&&p.aliases.some(item=>item.handle===order.owner.username),'archive/ownership','Local order owner mismatch');
    for(const item of [...device.legacyQueue.entries,...device.legacyQueue.quarantined]){
      const parts=item.path.split('/');
      requireThat(CATEGORIES.includes(parts[0])&&parts.length>=2&&parts.length<=3&&parts[1]===device.history.owner.username,'archive/ownership','Legacy queue path is outside captured owned lists');
    }
    for(const [key,snapshot] of Object.entries(device.history.snapshots)){
      const favorite=device.history.favorites.find(item=>item.key===key);
      requireThat(!favorite||String(favorite.targetUid||'')===snapshot.targetUid,'archive/ownership','Checked baseline target UID mismatch');
    }
  }
  unique(payload.dispositions,item=>item.path,'field disposition');
}
function normalizePayload(input){
  assertJson(input);checkShape(input,payloadSchema);
  const value=clone(input),by=(items,key)=>items.sort((a,b)=>{const x=key(a),y=key(b);return x<y?-1:x>y?1:0;});
  by(value.provenance.evidence,item=>item.evidenceId);by(value.provenance.aliases,item=>canonicalJson([item.handle,item.validFrom,item.validUntil]));by(value.provenance.accessMethods,item=>item.kind);by(value.provenance.retiredUids,item=>item.uid);
  by(value.catalog.entries,item=>item.catalogId);value.catalog.entries.forEach(item=>item.allowedGenders.sort());
  by(value.canonical.entities,entityKey);by(value.historical.records,item=>item.recordId);by(value.knownDevices,item=>item.deviceId);by(value.dispositions,item=>item.path);value.coverage.capturedDevices.sort();
  by(value.canonical.recoveryEvidence.migrations,item=>item.deviceMigrationId);by(value.canonical.recoveryEvidence.candidates,item=>item.candidateId);by(value.canonical.recoveryEvidence.reviewAcceptances,item=>item.evidenceFingerprint);
  for(const device of value.knownDevices){
    by(device.journal.entities,entityKey);by(device.journal.operations,item=>item.operationId);by(device.journal.conflicts,item=>item.conflictId);by(device.journal.recoveryCandidates,item=>item.candidateId);by(device.journal.meta,item=>item.name);
    by(device.orders,item=>item.lane);
    // Do not sort favorite/history/list/public arrays: their existing order is
    // user/source information. Their semantics differ from keyed entity sets.
  }
  validateSemantics(value);return value;
}
function exportArchive(input){
  const payload=normalizePayload(input),sections=Object.fromEntries(Object.keys(payload).sort().map(key=>[key,digest(payload[key],`section:${key}`)]));
  const archive={...payload,integrity:{algorithm:'sha256',canonicalization:'trade-archive-json-v1',sections,payloadHash:digest(payload,'payload')}};
  requireThat(Buffer.byteLength(canonicalJson(archive))<=MAX_BYTES,'archive/limits','Archive exceeds v1 proof reader limit');return archive;
}
function createCaptureReceipt(archive){
  // Persist separately at capture time. A receipt supplied by an untrusted archive
  // sender is NOT authentication or an independently trusted ownership proof.
  return{ownerUid:archive.provenance.ownerUid,sourceCommit:archive.source.sourceCommit,snapshotId:archive.capture.snapshotId,provenanceHash:digest(archive.provenance,'provenance'),catalogHash:digest(archive.catalog,'catalog'),archiveHash:archive.integrity.payloadHash};
}
function validateArchive(archive,receipt){
  assertJson(archive);requireThat(archive.archiveSchemaVersion===1,'archive/future-schema','Unsupported archive schema');checkShape(archive,schema);
  requireThat(Buffer.byteLength(canonicalJson(archive))<=MAX_BYTES,'archive/limits','Archive exceeds v1 proof reader limit');
  requireThat(plain(receipt)&&['ownerUid','sourceCommit','snapshotId','provenanceHash','catalogHash','archiveHash'].every(key=>typeof receipt[key]==='string'&&receipt[key]),'archive/trust','Separate capture receipt is required');
  const {integrity,...payload}=archive;
  const expected=exportArchive(payload);
  requireThat(canonicalJson(payload)===canonicalJson((({integrity,...rest})=>rest)(expected)),'archive/canonical','Keyed collections are not canonically ordered');
  requireThat(canonicalJson(integrity)===canonicalJson(expected.integrity),'archive/integrity','Archive integrity hash mismatch');
  requireThat(canonicalJson(createCaptureReceipt(archive))===canonicalJson(receipt),'archive/provenance','Archive does not match the separately expected capture provenance');
  return clone(payload);
}
function inspectableJson(value){return`${JSON.stringify(JSON.parse(canonicalJson(value)),null,2)}\n`;}
function parseArchive(bytes){
  requireThat(typeof bytes==='string'&&Buffer.byteLength(bytes)<=MAX_BYTES,'archive/limits','Invalid archive input or byte limit');
  let value;try{value=JSON.parse(bytes);}catch{fail('archive/json','Malformed JSON');}
  // Exactly the human-readable writer encoding, or the compact canonical encoding.
  // This rejects duplicate keys and alternate/ambiguous number spellings before use.
  requireThat(bytes===inspectableJson(value)||bytes===canonicalJson(value),'archive/encoding','Use the canonical or inspectable archive encoding (duplicate/ambiguous keys rejected)');return value;
}
function projectCanonical(payload){
  const catalog=new Map(payload.catalog.entries.map(item=>[item.catalogId,item]));
  const active=payload.canonical.entities.filter(item=>!item.deleted);
  const wants=active.filter(activeWant).map(item=>{
    const pokemon=catalog.get(item.identity.catalogId),v=item.values;
    return{recordId:item.entityId,...item.identity,pokemon:{catalogId:pokemon.catalogId,speciesId:pokemon.speciesId,name:pokemon.name,formId:pokemon.formId,costumeId:pokemon.costumeId,regionalForm:pokemon.regionalForm,maxState:pokemon.maxState},priority:v.priority,variant:v.variant,gender:v.gender,lucky:v.lucky,xxl:v.xxl,xxs:v.xxs,shiny:v.shiny,note:v.note,sortOrder:v.sortOrder};
  }).sort((a,b)=>a.sortOrder-b.sortOrder||(a.recordId<b.recordId?-1:a.recordId>b.recordId?1:0));
  return{ownerUid:payload.provenance.ownerUid,wants,favorites:active.filter(item=>item.entityType==='favorite').map(item=>({targetUid:item.entityId,...clone(item.values)})),tags:active.filter(item=>item.entityType==='tag').map(item=>({tagId:item.entityId,label:item.values.label})),profile:clone(payload.canonical.profile.values)};
}
const TARGET_FILES=['capture.json','identity-catalog.json','account-records.json','active.json','device-review.json','historical-inert.json','publication-review.json'];
function pathExists(value){try{fs.lstatSync(value);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function splitTarget(payload){
  const {provenance,catalog,canonical,knownDevices,historical,...capture}=payload;
  const {publicShare,...account}=canonical;
  return{
    'capture.json':capture,'identity-catalog.json':{provenance,catalog},'account-records.json':account,
    'active.json':projectCanonical(payload),'device-review.json':{disposition:'quarantine-never-replay',devices:knownDevices},
    'historical-inert.json':{disposition:'inert-only',records:historical.records,retainedWantFields:canonical.entities.filter(item=>item.entityType==='tradeEntry').map(item=>({entityId:item.entityId,backgroundId:item.values.backgroundId,quantity:item.values.quantity,mirror:item.values.mirror}))},
    'publication-review.json':{disposition:'never-auto-publish',state:publicShare}
  };
}
function restoreArchive(archive,target,receipt){
  const payload=validateArchive(archive,receipt),files=splitTarget(payload);
  const resolved=path.resolve(target),parent=path.dirname(resolved);
  requireThat(fs.realpathSync(parent)===parent,'archive/target','Target parent must be a real isolated directory');
  requireThat(!pathExists(resolved),'archive/target','Restore requires a new target; existing data is never overwritten');
  const staging=fs.mkdtempSync(path.join(parent,'.archive-restore-'));
  try{
    const hashes={};
    for(const name of TARGET_FILES){const bytes=inspectableJson(files[name]);fs.writeFileSync(path.join(staging,name),bytes,{flag:'wx',mode:0o600});hashes[name]=sha256(bytes);}
    fs.writeFileSync(path.join(staging,'restore-receipt.json'),inspectableJson({version:1,captureReceipt:receipt,files:hashes}),{flag:'wx',mode:0o600});
    requireThat(!pathExists(resolved),'archive/target','Target appeared during restore');
    fs.renameSync(staging,resolved);
  }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
  return projectCanonical(payload);
}
function reexportTarget(target,receipt){
  const root=path.resolve(target);
  requireThat(fs.realpathSync(root)===root,'archive/target','Target must not be a symlink');
  const names=fs.readdirSync(root).sort();
  requireThat(canonicalJson(names)===canonicalJson([...TARGET_FILES,'restore-receipt.json'].sort()),'archive/target','Unexpected or missing target file');
  function read(name){const file=path.join(root,name);requireThat(fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink(),'archive/target','Target contains a non-regular file');const bytes=fs.readFileSync(file,'utf8');return{bytes,value:parseArchive(bytes)};}
  const restoredReceipt=read('restore-receipt.json').value;
  requireThat(plain(restoredReceipt)&&Object.keys(restoredReceipt).sort().join(',')==='captureReceipt,files,version'&&plain(restoredReceipt.files)&&canonicalJson(Object.keys(restoredReceipt.files).sort())===canonicalJson([...TARGET_FILES].sort()),'archive/target','Unexpected restore receipt shape');
  requireThat(restoredReceipt.version===1&&canonicalJson(restoredReceipt.captureReceipt)===canonicalJson(receipt),'archive/provenance','Target receipt provenance mismatch');
  const files={};for(const name of TARGET_FILES){const file=read(name);requireThat(restoredReceipt.files[name]===sha256(file.bytes),'archive/integrity','Restored target file hash mismatch');files[name]=file.value;}
  const archive=exportArchive({...files['capture.json'],...files['identity-catalog.json'],canonical:{...files['account-records.json'],publicShare:files['publication-review.json'].state},knownDevices:files['device-review.json'].devices,historical:{records:files['historical-inert.json'].records}});
  const payload=validateArchive(archive,receipt);
  requireThat(canonicalJson(splitTarget(payload))===canonicalJson(files),'archive/inert','Restored projections/dispositions disagree with preserved records');
  return archive;
}
module.exports={MAX_BYTES,schema,schemaDocument,checkShape,canonicalJson,inspectableJson,parseArchive,sha256,digest,clone,tradeEntryId,entityKey,operationInput,validateEntity,validateOperation,validateSemantics,normalizePayload,exportArchive,createCaptureReceipt,validateArchive,projectCanonical,restoreArchive,reexportTarget,TARGET_FILES,activeWant};
