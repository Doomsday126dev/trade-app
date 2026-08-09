(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const SERVER_SCHEMA_VERSION=1;
  const LOCAL_SCHEMA_VERSION=3;
  const MAX_QUEUE_OPERATIONS=128;
  const MAX_RETRY_ATTEMPTS=8;
  const TOMBSTONE_RETENTION_DAYS=90;
  const MAX_FAVORITES=100;
  const MAX_TAGS=24;
  const MAX_TAGS_PER_TRAINER=24;
  const MAX_RECENTS=30;
  const MAX_HISTORY=1500;
  const MAX_OPERATION_ID_LENGTH=80;
  const MAX_OPERATION_JSON_LENGTH=8192;
  const MUTATION_KINDS=Object.freeze([
    'favorite-upsert','favorite-delete','metadata-upsert','metadata-delete',
    'tag-create','tag-rename','tag-delete','recents-merge','history-advance','migration-finalize'
  ]);
  const SYNCABLE_PRIVATE_DATA=Object.freeze([
    'favorite-trainer-identities','private-tag-definitions','trainer-tag-assignments',
    'bounded-recents','bounded-trainer-history'
  ]);
  const DEVICE_ONLY_DATA=Object.freeze([
    'open-dialogs','dirty-drafts','active-filters','scroll-position','temporary-search-text',
    'pending-confirmation-state','interface-locale'
  ]);
  const CONFLICT_MATRIX=Object.freeze({
    favoriteAddFavoriteAdd:'merge-earliest-timestamp-preserved',
    favoriteDeleteMetadataEdit:'tombstone-wins',
    tagRenameTagRename:'explicit-user-conflict',
    tagDeleteAssignment:'tombstone-wins',
    offlineEditNewerRemoteEdit:'reject',
    staleSchemaClientCurrentServer:'reject',
    accountSwitchPendingOperation:'reject'
  });

  function failure(code,message){return Object.freeze({ok:false,error:Object.freeze({code,message})});}
  function text(value){return String(value??'').normalize('NFKC').trim();}
  function identityText(value){return String(value??'').trim();}
  function exactKey(value,maxLength=128){
    const clean=identityText(value);
    return clean&&Array.from(clean).length<=maxLength&&!/[.#$\[\]\/\u0000-\u001f\u007f]/u.test(clean)?clean:'';
  }
  function integer(value){const number=Number(value);return Number.isSafeInteger(number)&&number>=0?number:null;}
  function sameIdentity(a,b){return!!a&&!!b&&identityText(a.uid)===identityText(b.uid)&&identityText(a.username)===identityText(b.username);}
  function stable(value){
    if(Array.isArray(value))return value.map(stable);
    if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
    return value;
  }
  function fingerprint(value){
    const source=JSON.stringify(stable(value));
    const hashes=[2166136261,2246822507,3266489909,668265263];
    for(let index=0;index<source.length;index++)for(let lane=0;lane<hashes.length;lane++){
      hashes[lane]^=source.charCodeAt(index)+(lane*131);hashes[lane]=Math.imul(hashes[lane],16777619+(lane*2));
    }
    return`prefs_${hashes.map(hash=>(hash>>>0).toString(16).padStart(8,'0')).join('')}`;
  }
  function operationId(value){
    const id=identityText(value);
    return/^[a-z0-9][a-z0-9_-]{15,79}$/.test(id)?id:'';
  }
  function normalizeOperation(value={}){
    const id=operationId(value.operationId),kind=identityText(value.kind),viewerUid=exactKey(value.viewerUid),entityId=exactKey(value.entityId);
    const baseRevision=integer(value.baseRevision),createdAt=integer(value.createdAt),schemaVersion=integer(value.schemaVersion);
    if(!id)return failure('trainer-preference-sync/operation-id-invalid','Operation identifier is invalid');
    if(!MUTATION_KINDS.includes(kind))return failure('trainer-preference-sync/kind-invalid','Operation kind is invalid');
    if(!viewerUid||!entityId)return failure('trainer-preference-sync/target-invalid','Operation target is invalid');
    if(baseRevision===null||createdAt===null)return failure('trainer-preference-sync/revision-invalid','Operation revision is invalid');
    if(schemaVersion!==SERVER_SCHEMA_VERSION)return failure('trainer-preference-sync/schema-unsupported','Operation schema is unsupported');
    const payload=value.payload&&typeof value.payload==='object'&&!Array.isArray(value.payload)?stable(value.payload):{};
    if(JSON.stringify(payload).length>MAX_OPERATION_JSON_LENGTH)return failure('trainer-preference-sync/payload-too-large','Operation payload is too large');
    return Object.freeze({ok:true,value:Object.freeze({operationId:id,kind,viewerUid,entityId,baseRevision,createdAt,schemaVersion,payload:Object.freeze(payload),fingerprint:fingerprint({kind,viewerUid,entityId,baseRevision,createdAt,schemaVersion,payload})})});
  }
  function favoriteCallableRequest(rawOperation){
    const normalized=normalizeOperation(rawOperation);if(!normalized.ok)return normalized;
    const operation=normalized.value;
    if(!['favorite-upsert','favorite-delete'].includes(operation.kind))return failure('trainer-preference-sync/kind-invalid','Favorite operation kind is invalid');
    const canonicalTrainerLabel=text(operation.payload.trainerName);
    if(!canonicalTrainerLabel||Array.from(canonicalTrainerLabel).length>64)return failure('trainer-preference-sync/favorite-invalid','Favorite payload is invalid');
    return Object.freeze({ok:true,callable:'mutateFavoriteTrainer',request:Object.freeze({
      operation:operation.kind==='favorite-upsert'?'add':'remove',
      trainerUid:operation.entityId,
      canonicalTrainerLabel,
      expectedRevision:operation.baseRevision,
      requestId:operation.operationId,
      schemaVersion:SERVER_SCHEMA_VERSION
    }),operationFingerprint:operation.fingerprint});
  }
  function currentRevision(value){return integer(value?.revision)??0;}
  function exactReplay(current,operation){return!!current&&current.operationId===operation.operationId;}
  function nextRecord(current,operation,fields){
    return Object.freeze({...fields,revision:currentRevision(current)+1,updatedAt:operation.createdAt,operationId:operation.operationId,deleted:false});
  }
  function tombstone(current,operation){
    return Object.freeze({revision:currentRevision(current)+1,updatedAt:operation.createdAt,operationId:operation.operationId,deleted:true,deletedAt:operation.createdAt});
  }
  function resolveFavoriteMutation(current,rawOperation){
    const normalized=normalizeOperation(rawOperation);if(!normalized.ok)return normalized;
    const operation=normalized.value;
    if(!['favorite-upsert','favorite-delete'].includes(operation.kind))return failure('trainer-preference-sync/kind-invalid','Favorite operation kind is invalid');
    if(exactReplay(current,operation))return Object.freeze({ok:true,status:'idempotent',value:current});
    const revision=currentRevision(current);
    if(operation.kind==='favorite-delete'){
      if(!current)return Object.freeze({ok:true,status:'already-deleted',value:null});
      if(current?.deleted===true)return Object.freeze({ok:true,status:'idempotent',value:current});
      if(operation.baseRevision!==revision)return failure('trainer-preference-sync/conflict','Favorite changed on another device');
      return Object.freeze({ok:true,status:'applied',value:Object.freeze({...tombstone(current,operation),trainerName:text(current.trainerName),addedAt:Number(current.addedAt)})});
    }
    const trainerName=text(operation.payload.trainerName),addedAt=integer(operation.payload.addedAt);
    if(!trainerName||Array.from(trainerName).length>64||addedAt===null)return failure('trainer-preference-sync/favorite-invalid','Favorite payload is invalid');
    if(operation.baseRevision!==revision){
      if(!current||current.deleted===true)return failure('trainer-preference-sync/conflict','Favorite deletion conflicts with this edit');
      const merged=nextRecord(current,operation,{trainerName:operation.createdAt>=Number(current.updatedAt||0)?trainerName:current.trainerName,addedAt:Math.min(addedAt,Number(current.addedAt||addedAt))});
      return Object.freeze({ok:true,status:'merged-concurrent-add',value:merged});
    }
    return Object.freeze({ok:true,status:'applied',value:nextRecord(current,operation,{trainerName,addedAt:current?Math.min(addedAt,Number(current.addedAt??addedAt)):addedAt})});
  }
  function normalizeTagIds(value){return Object.freeze([...new Set((Array.isArray(value)?value:[]).map(text).filter(id=>/^tag_[a-z0-9_-]{1,80}$/.test(id)))].sort());}
  function resolveMetadataMutation(current,rawOperation,{tags={}}={}){
    const normalized=normalizeOperation(rawOperation);if(!normalized.ok)return normalized;
    const operation=normalized.value;
    if(!['metadata-upsert','metadata-delete'].includes(operation.kind))return failure('trainer-preference-sync/kind-invalid','Trainer metadata operation kind is invalid');
    if(exactReplay(current,operation))return Object.freeze({ok:true,status:'idempotent',value:current});
    if(operation.baseRevision!==currentRevision(current))return failure('trainer-preference-sync/conflict','Tag assignment changed on another device');
    if(operation.kind==='metadata-delete')return current?Object.freeze({ok:true,status:'applied',value:tombstone(current,operation)}):Object.freeze({ok:true,status:'already-deleted',value:null});
    const tagIds=normalizeTagIds(operation.payload.tagIds);
    if(tagIds.length>MAX_TAGS_PER_TRAINER)return failure('trainer-preference-sync/tag-limit','Too many tags are assigned');
    if(tagIds.some(id=>!tags[id]||tags[id].active!==true||tags[id].deleted===true))return failure('trainer-preference-sync/tag-unavailable','A tag assignment references a deleted or unavailable tag');
    return Object.freeze({ok:true,status:'applied',value:nextRecord(current,operation,{tagIds})});
  }
  function resolveTagMutation(current,rawOperation,{labelClaimAvailable=true}={}){
    const normalized=normalizeOperation(rawOperation);if(!normalized.ok)return normalized;
    const operation=normalized.value;
    if(!['tag-create','tag-rename','tag-delete'].includes(operation.kind))return failure('trainer-preference-sync/kind-invalid','Tag operation kind is invalid');
    if(exactReplay(current,operation))return Object.freeze({ok:true,status:'idempotent',value:current});
    if(operation.kind==='tag-create'&&current)return failure('trainer-preference-sync/conflict','Tag identifier already exists');
    if(operation.kind!=='tag-create'&&!current)return failure('trainer-preference-sync/tag-unavailable','Tag does not exist');
    if(operation.kind==='tag-rename'&&(current.deleted===true||current.active!==true))return failure('trainer-preference-sync/tag-unavailable','Deleted tags cannot be renamed');
    if(operation.kind==='tag-delete'&&current.deleted===true)return Object.freeze({ok:true,status:'idempotent',value:current});
    if(operation.baseRevision!==currentRevision(current))return failure('trainer-preference-sync/conflict','Tag changed on another device');
    if(operation.kind==='tag-delete')return Object.freeze({ok:true,status:'applied',value:Object.freeze({...current,...tombstone(current,operation),active:false})});
    const label=text(operation.payload.label),normalizedLabel=text(operation.payload.normalizedLabel),labelKey=text(operation.payload.labelKey);
    if(!label||Array.from(label).length>40||!normalizedLabel||!labelKey)return failure('trainer-preference-sync/tag-invalid','Tag payload is invalid');
    if(!labelClaimAvailable)return failure('trainer-preference-sync/tag-label-conflict','Normalized tag label is already claimed');
    const createdAt=current?.createdAt??operation.createdAt;
    return Object.freeze({ok:true,status:'applied',value:nextRecord(current,operation,{label,normalizedLabel,labelKey,active:true,createdAt})});
  }
  function preferenceSyncPresentation({featureEnabled=false,writesEnabled=false,state='local-only',pendingCount=0,lastSuccessfulSyncAt=0,conflictCount=0}={}){
    const allowed=['local-only','pending-sync','synced','conflict','sync-error'];
    const reachable=featureEnabled===true&&writesEnabled===true&&allowed.includes(state)?state:'local-only';
    return Object.freeze({state:reachable,interactive:featureEnabled===true&&writesEnabled===true,pendingCount:reachable==='local-only'?0:Math.max(0,Number(pendingCount)||0),conflictCount:reachable==='conflict'?Math.max(1,Number(conflictCount)||1):0,lastSuccessfulSyncAt:reachable==='local-only'?0:Math.max(0,Number(lastSuccessfulSyncAt)||0),statusKey:`trainer.syncState.${reachable}`});
  }
  function plainObject(value){return!!value&&typeof value==='object'&&!Array.isArray(value);}
  function migrationInvalid(){return failure('trainer-preference-sync/migration-source-invalid','Local organizer data is malformed');}
  function normalizeMigrationSource(local={}){
    if(!plainObject(local))return migrationInvalid();
    const tags={},labels=new Set();
    if(local.tags!=null&&!plainObject(local.tags))return migrationInvalid();
    for(const [rawId,raw] of Object.entries(local.tags||{})){
      const id=exactKey(rawId),label=text(raw?.label),createdAt=integer(raw?.createdAt),updatedAt=integer(raw?.updatedAt);
      const normalizedLabel=label.toLocaleLowerCase('en-US');
      if(!/^tag_[a-z0-9_-]{1,80}$/.test(id)||!label||Array.from(label).length>40||createdAt===null||updatedAt===null||labels.has(normalizedLabel))return migrationInvalid();
      labels.add(normalizedLabel);tags[id]={id,label,normalizedLabel,createdAt,updatedAt};
    }
    if(local.favorites!=null&&!Array.isArray(local.favorites))return migrationInvalid();
    const favoritesByKey=new Map();
    for(const raw of local.favorites||[]){
      const displayName=text(raw?.displayName||raw?.trainerName),key=text(raw?.key||displayName).toLocaleLowerCase('en-US');
      const createdAt=integer(raw?.createdAt??raw?.addedAt??0),updatedAt=integer(raw?.updatedAt??createdAt??0),tagIds=normalizeTagIds(raw?.tagIds).filter(id=>tags[id]);
      if(!displayName||!exactKey(key)||Array.from(displayName).length>64||createdAt===null||updatedAt===null)return migrationInvalid();
      const item={key,displayName,tagIds:[...tagIds],createdAt,updatedAt};
      const current=favoritesByKey.get(key);
      if(!current||updatedAt>current.updatedAt||(updatedAt===current.updatedAt&&JSON.stringify(stable(item))<JSON.stringify(stable(current))))favoritesByKey.set(key,item);
    }
    const favorites=[...favoritesByKey.values()].sort((a,b)=>a.key.localeCompare(b.key));
    if(local.recent!=null&&!Array.isArray(local.recent))return migrationInvalid();
    const recentsByKey=new Map();
    for(const raw of local.recent||[]){
      const displayName=text(raw?.displayName||raw?.trainerName),key=text(raw?.key||displayName).toLocaleLowerCase('en-US'),openedAt=integer(raw?.openedAt??raw?.lastOpenedAt);
      if(!displayName||!exactKey(key)||Array.from(displayName).length>64||openedAt===null)return migrationInvalid();
      const current=recentsByKey.get(key);if(!current||openedAt>current.openedAt)recentsByKey.set(key,{key,displayName,openedAt});
    }
    const recents=[...recentsByKey.values()].sort((a,b)=>b.openedAt-a.openedAt||a.key.localeCompare(b.key));
    if(local.snapshots!=null&&!plainObject(local.snapshots))return migrationInvalid();
    const history={};let historyEntries=0;
    for(const [rawKey,raw] of Object.entries(local.snapshots||{})){
      const key=exactKey(rawKey),seenAt=integer(raw?.seenAt),snapshot=raw?.snapshot;
      if(!key||seenAt===null||!plainObject(snapshot)||!plainObject(snapshot.lists))return migrationInvalid();
      let entryCount=0;
      for(const list of Object.values(snapshot.lists)){
        if(Array.isArray(list))entryCount+=list.length;
        else if(plainObject(list))entryCount+=Object.keys(list).length;
        else return migrationInvalid();
      }
      if(entryCount>MAX_HISTORY)return failure('trainer-preference-sync/migration-too-large','A local history snapshot exceeds the migration bound');
      historyEntries+=entryCount;history[key]={seenAt,entryCount,snapshot:stable(snapshot)};
    }
    return Object.freeze({ok:true,value:Object.freeze(stable({favorites,tags,recents,history})),counts:Object.freeze({favorites:favorites.length,tags:Object.keys(tags).length,recents:recents.length,history:Object.keys(history).length,historyEntries})});
  }
  function buildMigrationPlan({activeIdentity,partitionIdentity,localSchemaVersion,local={},server={},serverHydrated=false,hydrationGeneration=0,activeGeneration=0,userApproved=false,featureEnabled=false,writesEnabled=false}={}){
    if(!sameIdentity(activeIdentity,partitionIdentity))return failure('trainer-preference-sync/partition-mismatch','Local preferences belong to another account');
    if(Number(localSchemaVersion)!==LOCAL_SCHEMA_VERSION)return failure('trainer-preference-sync/local-schema-unsupported','Local organizer schema is unsupported');
    if(serverHydrated!==true||Number(hydrationGeneration)!==Number(activeGeneration))return failure('trainer-preference-sync/hydration-required','Exact current-session server hydration is required');
    if(server?.metadata?.schemaVersion!=null&&Number(server.metadata.schemaVersion)>SERVER_SCHEMA_VERSION)return failure('trainer-preference-sync/server-schema-newer','Cloud preferences use a newer schema');
    const normalized=normalizeMigrationSource(local);if(!normalized.ok)return normalized;
    const counts=normalized.counts;
    if(counts.favorites>MAX_FAVORITES||counts.tags>MAX_TAGS||counts.recents>MAX_RECENTS||counts.history>MAX_HISTORY)return failure('trainer-preference-sync/migration-too-large','Local organizer exceeds migration bounds');
    const sourceFingerprint=fingerprint(normalized.value),baselineRevision=currentRevision(server?.metadata);
    const preview=stable({...normalized.value,serverRevision:baselineRevision});
    const migrationFingerprint=fingerprint({owner:{uid:identityText(activeIdentity.uid),username:identityText(activeIdentity.username)},sourceFingerprint,baselineRevision});
    const executable=featureEnabled===true&&writesEnabled===true&&userApproved===true;
    return Object.freeze({ok:true,status:executable?'approved-for-future-execution':'review-required',owner:Object.freeze({uid:identityText(activeIdentity.uid),username:identityText(activeIdentity.username)}),counts,sourceFingerprint,migrationFingerprint,baselineRevision,resumable:true,idempotent:true,publicShareWrites:0,deleteLocal:false,executable,preview:Object.freeze(preview),favoriteMigration:Object.freeze({strategy:'one-at-a-time-trusted-callable',callable:'mutateFavoriteTrainer',operationCount:counts.favorites,batchEndpoint:false,stableUidResolutionRequired:true,sourceFingerprintRequired:true})});
  }
  function migrationSourceMatches(plan,local){const normalized=normalizeMigrationSource(local);return!!plan?.sourceFingerprint&&normalized.ok&&fingerprint(normalized.value)===plan.sourceFingerprint;}
  function verifyMigration(plan,serverMetadata={},currentLocal){
    if(!plan?.ok||!plan.migrationFingerprint)return failure('trainer-preference-sync/migration-plan-invalid','Migration plan is invalid');
    if(!migrationSourceMatches(plan,currentLocal))return failure('trainer-preference-sync/migration-source-changed','Local organizer changed after migration preview');
    const verified=serverMetadata.migrationFingerprint===plan.migrationFingerprint&&serverMetadata.migrationState==='verified';
    return Object.freeze({ok:verified,status:verified?'verified':'verification-failed',retainLocal:!verified,localDeletionAllowed:false});
  }
  function localeSyncRecommendation(){return Object.freeze({sync:false,storage:'device-local',reason:'device-language-intent',coupledToOrganizer:false,browserFallbackPreserved:true});}

  root.trainerPreferenceSync=Object.freeze({
    SERVER_SCHEMA_VERSION,LOCAL_SCHEMA_VERSION,MAX_QUEUE_OPERATIONS,MAX_RETRY_ATTEMPTS,TOMBSTONE_RETENTION_DAYS,
    MAX_FAVORITES,MAX_TAGS,MAX_TAGS_PER_TRAINER,MAX_RECENTS,MAX_HISTORY,MAX_OPERATION_ID_LENGTH,MAX_OPERATION_JSON_LENGTH,MUTATION_KINDS,
    SYNCABLE_PRIVATE_DATA,DEVICE_ONLY_DATA,CONFLICT_MATRIX,sameIdentity,fingerprint,normalizeOperation,favoriteCallableRequest,resolveFavoriteMutation,
    resolveMetadataMutation,resolveTagMutation,preferenceSyncPresentation,normalizeMigrationSource,buildMigrationPlan,migrationSourceMatches,verifyMigration,localeSyncRecommendation
  });
})(window);
