(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const model=root.accountSyncModel;
  if(!model)throw new Error('Account sync model must load before migration');
  const LIST_TYPES=Object.freeze(['wishlist','dynamax','gmax','costumes']);

  function plain(value){return model.plainObject(value)?value:{};}
  function emptyBoard(value){return{lf:Array.isArray(value?.lf)?value.lf:[],ft:Array.isArray(value?.ft)?value.ft:[]};}
  function defaultCatalogIdentity(type,name){return{catalogId:`legacy:${type}:${String(name).normalize('NFC')}`};}
  function normalizeTradeValues(raw={},defaults={}){
    return Object.freeze({
      priority:['H','M','L'].includes(raw.priority||raw.p)?raw.priority||raw.p:'',
      variant:String(raw.variant??raw.mod??'').normalize('NFC').trim().slice(0,160),
      gender:['m','f'].includes(raw.gender)?raw.gender:'',
      lucky:raw.lucky===true,xxl:raw.xxl===true,xxs:raw.xxs===true,shiny:raw.shiny===true,
      backgroundId:String(raw.backgroundId||'').trim().slice(0,160),
      sortOrder:Number.isSafeInteger(raw.sortOrder)&&raw.sortOrder>=0?raw.sortOrder:Number(defaults.sortOrder)||0,
      quantity:Number.isSafeInteger(raw.quantity??raw.qty)&&Number(raw.quantity??raw.qty)>0?Math.min(999,Number(raw.quantity??raw.qty)):1,
      note:String(raw.note||'').normalize('NFC').trim().slice(0,160),mirror:raw.mirror===true
    });
  }
  function orderIndex(orders,type,name,priority){
    const values=orders?.[type]?.priorities?.[priority||'U'];
    const index=Array.isArray(values)?values.indexOf(name):-1;
    return index>=0?index:100000;
  }
  function sourceRows({legacyLists,parseListValue,catalogIdentity,genderForVariant,orders,source}){
    const rows=[],unresolved=[];
    for(const type of LIST_TYPES){
      for(const [name,encoded] of Object.entries(plain(legacyLists?.[type]))){
        const parsedInput=parseListValue(encoded,name,type)||{},parsed=normalizeTradeValues({...parsedInput,gender:parsedInput.gender||genderForVariant(parsedInput.mod||parsedInput.variant||'')},{}),catalog=catalogIdentity(type,name,encoded)||{};
        if(!catalog.catalogId){unresolved.push({entityType:'tradeEntry',entityId:`unresolved:${source}:my-list:${type}:${String(name).slice(0,500)}`,identity:{surface:'my-list',lane:type,catalogIdUnresolved:true},values:parsed,source,legacyName:name});continue;}
        const identity={surface:'my-list',lane:type,catalogId:String(catalog.catalogId)};
        rows.push({entityType:'tradeEntry',entityId:model.tradeEntryId(identity),identity,values:{...parsed,sortOrder:orderIndex(orders,type,name,parsed.priority)},source,legacyName:name});
      }
    }
    return{rows,unresolved};
  }
  function boardRows({board,catalogIdentity,source}){
    const rows=[],unresolved=[];
    for(const [side,lane] of [['lf','looking-for'],['ft','for-trade']]){
      emptyBoard(board)[side].forEach((raw,index)=>{
        const catalog=catalogIdentity('special-board',raw.name,raw)||{};
        if(!catalog.catalogId){unresolved.push({entityType:'tradeEntry',entityId:`unresolved:${source}:special-board:${lane}:${String(raw?.name||index).slice(0,500)}`,identity:{surface:'special-board',lane,catalogIdUnresolved:true},values:normalizeTradeValues(raw,{sortOrder:index}),source,legacyName:String(raw?.name||'')});return;}
        const identity={surface:'special-board',lane,catalogId:String(catalog.catalogId)};
        rows.push({entityType:'tradeEntry',entityId:model.tradeEntryId(identity),identity,values:normalizeTradeValues(raw,{sortOrder:index}),source,legacyName:String(raw.name||'')});
      });
    }
    return{rows,unresolved};
  }
  function queuedLegacyChanges(queue={},expectedUsername=''){
    const changes=new Map(),remember=(type,name,value)=>{if(LIST_TYPES.includes(type)&&name)changes.set(`${type}\n${name}`,value);};
    for(const item of Object.values(plain(queue))){
      if(item?.kind==='my-list-update'){
        const [type,username,...rest]=String(item.path||'').split('/');
        if(LIST_TYPES.includes(type)&&username===expectedUsername&&!rest.length)Object.entries(plain(item.data)).forEach(([name,value])=>remember(type,name,value));
      }
      else if(typeof item?.path==='string'){
        const parts=item.path.split('/');if(LIST_TYPES.includes(parts[0])&&parts.length===3&&parts[1]===expectedUsername)remember(parts[0],parts[2],item.data??null);
      }
    }
    return changes;
  }
  function queuedLegacyBoard(queue={},expectedUsername=''){
    const profilePath=`users/${expectedUsername}`,boardPath=`${profilePath}/specialTradeBoard`;let value=null,present=false;
    for(const item of Object.values(plain(queue))){
      if(item?.path===boardPath){value=item.data;present=true;continue;}
      if(item?.path===profilePath&&Object.prototype.hasOwnProperty.call(plain(item.data),'specialTradeBoard')){value=item.data.specialTradeBoard;present=true;}
    }
    return Object.freeze({present,board:emptyBoard(value)});
  }
  function canonicalKey(value){return`${String(value?.entityType||'')}|${String(value?.entityId||'')}`;}
  function partitionCanonicalRows(rows=[]){
    const grouped=new Map();
    for(const row of rows){const key=canonicalKey(row),values=grouped.get(key)||[];values.push(row);grouped.set(key,values);}
    const unique=[],ambiguous=[];
    for(const values of grouped.values()){
      const signatures=new Set(values.map(row=>model.canonicalJson([row.identity,row.values])));
      if(signatures.size>1)ambiguous.push(...values);
      else unique.push(values[0]);
    }
    return Object.freeze({unique:Object.freeze(unique),ambiguous:Object.freeze(ambiguous)});
  }
  async function candidate(ownerUid,reason,row,sourceFingerprint){
    const digest=await model.sha256Hex(model.canonicalJson([model.SCHEMA_VERSION,'pogo-account-sync-recovery',ownerUid,reason,row.entityType,row.entityId,row.identity,row.values,row.source,sourceFingerprint]));
    return Object.freeze({ownerUid,candidateId:`candidate_${digest}`,schemaVersion:model.SCHEMA_VERSION,reason,entityType:row.entityType,entityId:row.entityId,identity:row.identity,values:row.values,source:row.source,createdAt:0,resolved:false});
  }
  function canonicalEntitiesMap(value){
    const map=new Map();
    for(const entity of Array.isArray(value)?value:Object.values(plain(value)))if(entity?.entityType&&entity?.entityId)map.set(canonicalKey(entity),entity);
    return map;
  }
  async function buildMigrationPlan(input={},dependencies={}){
    const ownerUid=model.firebaseKey(input.ownerUid,128),username=model.exactText(input.username,64),deviceInstallId=model.firebaseKey(input.deviceInstallId,180);
    if(!ownerUid||!username||!deviceInstallId)return model.failure('account-sync/migration-binding-invalid','Migration owner or device binding is invalid');
    const parseListValue=typeof dependencies.parseListValue==='function'?dependencies.parseListValue:(value=>plain(value));
    const catalogIdentity=typeof dependencies.catalogIdentity==='function'?dependencies.catalogIdentity:defaultCatalogIdentity;
    const genderForVariant=typeof dependencies.genderForVariant==='function'?dependencies.genderForVariant:()=>'';
    const remoteLists=sourceRows({legacyLists:input.legacyRemoteLists,parseListValue,catalogIdentity,genderForVariant,orders:input.orders,source:'legacy-remote'}),remoteBoard=boardRows({board:input.legacyRemoteBoard,catalogIdentity,source:'legacy-remote-board'});
    const localLists=sourceRows({legacyLists:input.legacyLocalLists,parseListValue,catalogIdentity,genderForVariant,orders:input.orders,source:'legacy-local'}),localBoard=boardRows({board:input.legacyLocalBoard,catalogIdentity,source:'legacy-local-board'});
    const queued=queuedLegacyChanges(input.legacyQueue,username),queuedBoard=queuedLegacyBoard(input.legacyQueue,username),queuedLists=Object.fromEntries(LIST_TYPES.map(type=>[type,{}]));
    for(const [queueKey,value] of queued){const [type,name]=queueKey.split('\n');if(value!=null)queuedLists[type][name]=value;}
    const queuedListSource=sourceRows({legacyLists:queuedLists,parseListValue,catalogIdentity,genderForVariant,orders:input.orders,source:'legacy-queue'}),queuedBoardSource=boardRows({board:queuedBoard.board,catalogIdentity,source:'legacy-queue-board'});
    const rawRowsRemote=[...remoteLists.rows,...remoteBoard.rows],rawRowsLocal=[...localLists.rows,...localBoard.rows],rawRowsQueued=[...queuedListSource.rows,...(queuedBoard.present?queuedBoardSource.rows:[])],unresolvedRows=[...remoteLists.unresolved,...remoteBoard.unresolved,...localLists.unresolved,...localBoard.unresolved,...queuedListSource.unresolved,...(queuedBoard.present?queuedBoardSource.unresolved:[])];
    const remotePartition=partitionCanonicalRows(rawRowsRemote),localPartition=partitionCanonicalRows(rawRowsLocal),queuedPartition=partitionCanonicalRows(rawRowsQueued);
    const ambiguousKeys=new Set([...remotePartition.ambiguous,...localPartition.ambiguous,...queuedPartition.ambiguous].map(canonicalKey));
    const rowsRemote=remotePartition.unique.filter(row=>!ambiguousKeys.has(canonicalKey(row))&&!(queuedBoard.present&&row.identity?.surface==='special-board')),rowsLocal=localPartition.unique.filter(row=>!ambiguousKeys.has(canonicalKey(row))&&!(queuedBoard.present&&row.identity?.surface==='special-board')),rowsQueued=queuedPartition.unique.filter(row=>!ambiguousKeys.has(canonicalKey(row)));
    const tagSeeds=[];
    for(const [legacyId,raw] of Object.entries(plain(input.tags))){
      const label=model.exactText(raw?.label,40);if(!label)continue;
      const entityId=/^tag_(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(legacyId)?legacyId:await model.tagIdFromLegacy({ownerUid,label,legacyId});
      tagSeeds.push({entityType:'tag',entityId,identity:{tagId:entityId},values:{label},source:'legacy-tags',legacyId});
    }
    const favoriteInputs=[];
    for(const raw of Array.isArray(input.favorites)?input.favorites:[]){
      const displayName=model.exactText(raw?.displayName||raw?.trainerName,64);if(!displayName)continue;
      const targetUid=await dependencies.resolveFavoriteUid?.(displayName,raw),tagIds={};
      for(const oldId of Array.isArray(raw.tagIds)?raw.tagIds:[]){const seed=tagSeeds.find(tag=>tag.legacyId===oldId||tag.entityId===oldId);if(seed)tagIds[seed.entityId]=true;}
      favoriteInputs.push({displayName,targetUid:model.firebaseKey(targetUid,128),tagIds});
    }
    const sourceSnapshot={
      rowsRemote:rawRowsRemote,rowsLocal:rawRowsLocal,rowsQueued:rawRowsQueued,unresolvedRows,legacyQueue:[...queued.entries()],queuedBoardPresent:queuedBoard.present,
      tags:tagSeeds.map(seed=>({entityId:seed.entityId,label:seed.values.label})),
      favorites:favoriteInputs.map(item=>({displayName:item.displayName,targetUid:item.targetUid,tagIds:item.tagIds}))
    };
    const sourceFingerprint=await model.sha256Hex(model.canonicalJson([model.SCHEMA_VERSION,'pogo-account-sync-migration-source',ownerUid,sourceSnapshot]));
    const deviceMigrationId=`migration_${await model.sha256Hex(model.canonicalJson([model.SCHEMA_VERSION,'pogo-account-sync-device-migration',ownerUid,deviceInstallId,sourceFingerprint]))}`;
    const canonical=canonicalEntitiesMap(input.remoteCanonical),seeds=new Map(),verificationSeeds=new Map(),verificationTombstones=new Map(),recoveryCandidates=[],replayMutations=[],acceptedTagSeeds=[],favoriteSeeds=[];
    const rememberSeed=row=>verificationSeeds.set(canonicalKey(row),row);
    const rememberTombstone=row=>verificationTombstones.set(canonicalKey(row),Object.freeze({
      entityType:row.entityType,entityId:row.entityId,identity:row.identity,
      generation:row.generation+1,revision:row.revision+1,createdAt:row.createdAt,
      values:row.values,fieldRevisions:row.fieldRevisions,fieldMutations:row.fieldMutations,
      fieldMutationHashes:row.fieldMutationHashes,priorLifecycleMutation:row.lifecycleMutation,
      priorLifecycleMutationHash:row.lifecycleMutationHash
    }));
    for(const row of unresolvedRows)recoveryCandidates.push(await candidate(ownerUid,'catalog-identity-unresolved',row,sourceFingerprint));
    for(const row of [...rawRowsRemote,...rawRowsLocal,...rawRowsQueued].filter(row=>ambiguousKeys.has(canonicalKey(row))))recoveryCandidates.push(await candidate(ownerUid,'duplicate-canonical-identity',row,sourceFingerprint));
    const remoteById=new Map(rowsRemote.map(row=>[canonicalKey(row),row])),remoteByLaneName=new Map(rowsRemote.map(row=>[`${row.identity.lane}\n${row.legacyName}`,row])),localByLaneName=new Map(rowsLocal.map(row=>[`${row.identity.lane}\n${row.legacyName}`,row])),queuedByLaneName=new Map(rawRowsQueued.map(row=>[`${row.identity.lane}\n${row.legacyName}`,row]));
    for(const row of rowsRemote){
      const key=canonicalKey(row),current=canonical.get(key);
      const queueKey=`${row.identity.lane}\n${row.legacyName}`;
      if(queued.has(queueKey)&&(queued.get(queueKey)===null||queuedByLaneName.has(queueKey)))continue;
      if(!current&&!input.canonicalInitialized){seeds.set(key,row);rememberSeed(row);}
      else if(current&&!current.deleted&&model.canonicalJson(current.identity)===model.canonicalJson(row.identity)&&model.canonicalJson(current.values)===model.canonicalJson(row.values)){rememberSeed(row);continue;}
      else recoveryCandidates.push(await candidate(ownerUid,input.canonicalInitialized?'legacy-after-canonical':'remote-divergence',row,sourceFingerprint));
    }
    for(const row of rowsLocal){
      const key=canonicalKey(row),current=canonical.get(key),remote=remoteById.get(key),knownQueued=queued.has(`${row.identity.lane}\n${row.legacyName}`);
      if(knownQueued)continue;
      if(!input.canonicalInitialized&&!current&&!remote&&!seeds.has(key)){seeds.set(key,row);rememberSeed(row);continue;}
      if(current&&!current.deleted&&model.canonicalJson(current.identity)===model.canonicalJson(row.identity)&&model.canonicalJson(current.values)===model.canonicalJson(row.values)){rememberSeed(row);continue;}
      if(remote&&model.canonicalJson(remote.identity)===model.canonicalJson(row.identity)&&model.canonicalJson(remote.values)===model.canonicalJson(row.values))continue;
      recoveryCandidates.push(await candidate(ownerUid,input.canonicalInitialized?'stale-device-cache':'ambiguous-local-cache',row,sourceFingerprint));
    }
    for(const [queueKey,encoded] of queued){
      const [lane,legacyName]=queueKey.split('\n'),queuedRow=queuedByLaneName.get(queueKey);
      if(encoded==null){
        if(input.canonicalInitialized){
          let sourceRow=remoteByLaneName.get(queueKey)||localByLaneName.get(queueKey)||null;
          if(!sourceRow){
            const catalog=catalogIdentity(lane,legacyName,null)||{};
            if(catalog.catalogId){const identity={surface:'my-list',lane,catalogId:String(catalog.catalogId)};sourceRow={entityType:'tradeEntry',entityId:model.tradeEntryId(identity),identity,values:normalizeTradeValues({},{sortOrder:100000}),source:'legacy-queue',legacyName};}
          }
          if(sourceRow){
            const current=canonical.get(canonicalKey(sourceRow)),reason=current&&!current.deleted?'queued-delete-requires-review':'queued-delete-missing-base';
            recoveryCandidates.push(await candidate(ownerUid,reason,{...sourceRow,values:current&&!current.deleted?current.values:sourceRow.values,source:'legacy-queue'},sourceFingerprint));
          }else{
            recoveryCandidates.push(await candidate(ownerUid,'queued-delete-identity-unresolved',{entityType:'tradeEntry',entityId:`unresolved:legacy-queue-delete:${lane}:${String(legacyName).slice(0,500)}`,identity:{surface:'my-list',lane,catalogIdUnresolved:true},values:{legacyName:String(legacyName).slice(0,160),deleteRequested:true},source:'legacy-queue'},sourceFingerprint));
          }
        }
        continue;
      }
      if(!queuedRow)continue;
      if(ambiguousKeys.has(canonicalKey(queuedRow)))continue;
      const key=canonicalKey(queuedRow),current=canonical.get(key),seed={...queuedRow,source:'legacy-queued-edit'};
      if(!current){seeds.set(key,seed);rememberSeed(seed);continue;}
      if(!current.deleted&&model.canonicalJson(current.identity)===model.canonicalJson(seed.identity)&&model.canonicalJson(current.values)===model.canonicalJson(seed.values)){rememberSeed(seed);continue;}
      const remote=remoteById.get(key);
      if(input.canonicalInitialized&&remote&&!current.deleted&&model.canonicalJson(current.identity)===model.canonicalJson(remote.identity)&&model.canonicalJson(current.values)===model.canonicalJson(remote.values)){
        replayMutations.push(Object.freeze({entityType:seed.entityType,entityId:seed.entityId,identity:seed.identity,kind:'patch',patch:seed.values,source:'legacy-queued-edit'}));
        rememberSeed(seed);continue;
      }
      recoveryCandidates.push(await candidate(ownerUid,'queued-edit-requires-replay',seed,sourceFingerprint));
    }
    if(queuedBoard.present){
      const queuedBoardRows=rowsQueued.filter(row=>row.identity?.surface==='special-board'),queuedBoardById=new Map(queuedBoardRows.map(row=>[canonicalKey(row),row]));
      for(const row of queuedBoardRows){
        const key=canonicalKey(row),current=canonical.get(key),remote=rawRowsRemote.find(candidateRow=>canonicalKey(candidateRow)===key);
        if(!current){seeds.set(key,row);rememberSeed(row);continue;}
        if(!current.deleted&&model.canonicalJson(current.identity)===model.canonicalJson(row.identity)&&model.canonicalJson(current.values)===model.canonicalJson(row.values)){rememberSeed(row);continue;}
        if(input.canonicalInitialized&&current.deleted!==true&&remote&&model.canonicalJson(current.identity)===model.canonicalJson(remote.identity)&&model.canonicalJson(current.values)===model.canonicalJson(remote.values)){
          replayMutations.push(Object.freeze({entityType:row.entityType,entityId:row.entityId,identity:row.identity,kind:'patch',patch:row.values,source:'legacy-queue-board'}));
          rememberSeed(row);continue;
        }
        recoveryCandidates.push(await candidate(ownerUid,input.canonicalInitialized?'queued-board-edit-requires-review':'queued-board-concurrent-divergence',row,sourceFingerprint));
      }
      if(input.canonicalInitialized){
        const priorBoardRows=partitionCanonicalRows([...remoteBoard.rows,...localBoard.rows]).unique;
        for(const row of priorBoardRows){
          const key=canonicalKey(row);if(ambiguousKeys.has(key)||queuedBoardById.has(key))continue;
          const current=canonical.get(key),remote=remoteBoard.rows.find(candidateRow=>canonicalKey(candidateRow)===key);
          if(!current||current.deleted===true)continue;
          if(remote&&model.canonicalJson(current.identity)===model.canonicalJson(remote.identity)&&model.canonicalJson(current.values)===model.canonicalJson(remote.values)){
            replayMutations.push(Object.freeze({entityType:current.entityType,entityId:current.entityId,identity:current.identity,kind:'delete',patch:{},source:'legacy-queue-board'}));rememberTombstone(current);continue;
          }
          recoveryCandidates.push(await candidate(ownerUid,'queued-board-delete-requires-review',{...row,values:current.values,source:'legacy-queue-board'},sourceFingerprint));
        }
      }
    }
    for(const seed of tagSeeds){
      const current=canonical.get(canonicalKey(seed));
      if(!input.canonicalInitialized&&!current){acceptedTagSeeds.push(seed);rememberSeed(seed);continue;}
      if(current&&!current.deleted&&model.canonicalJson(current.identity)===model.canonicalJson(seed.identity)&&model.canonicalJson(current.values)===model.canonicalJson(seed.values)){rememberSeed(seed);continue;}
      recoveryCandidates.push(await candidate(ownerUid,input.canonicalInitialized?'stale-device-tag':'tag-divergence',seed,sourceFingerprint));
    }
    for(const item of favoriteInputs){
      if(!item.targetUid){
        const unresolved={entityType:'favorite',entityId:`unresolved:${item.displayName.toLocaleLowerCase('en-US')}`,identity:{targetUid:''},values:{displayName:item.displayName},source:'legacy-favorite'};
        recoveryCandidates.push(await candidate(ownerUid,'favorite-uid-unresolved',unresolved,sourceFingerprint));continue;
      }
      const seed={entityType:'favorite',entityId:item.targetUid,identity:{targetUid:item.targetUid},values:{displayName:item.displayName,tagIds:item.tagIds},source:'legacy-favorite'},current=canonical.get(canonicalKey(seed));
      if(!input.canonicalInitialized&&!current){favoriteSeeds.push(seed);rememberSeed(seed);continue;}
      if(current&&!current.deleted&&model.canonicalJson(current.identity)===model.canonicalJson(seed.identity)&&model.canonicalJson(current.values)===model.canonicalJson(seed.values)){rememberSeed(seed);continue;}
      recoveryCandidates.push(await candidate(ownerUid,input.canonicalInitialized?'stale-device-favorite':'favorite-divergence',seed,sourceFingerprint));
    }
    return Object.freeze({
      ok:true,schemaVersion:model.SCHEMA_VERSION,ownerUid,username,deviceInstallId,deviceMigrationId,sourceFingerprint,
      canonicalInitialized:input.canonicalInitialized===true,tradeSeeds:Object.freeze([...seeds.values()].sort((a,b)=>a.entityId.localeCompare(b.entityId))),
      favoriteSeeds:Object.freeze(favoriteSeeds.sort((a,b)=>a.entityId.localeCompare(b.entityId))),tagSeeds:Object.freeze(acceptedTagSeeds.sort((a,b)=>a.entityId.localeCompare(b.entityId))),
      replayMutations:Object.freeze(replayMutations.sort((a,b)=>canonicalKey(a).localeCompare(canonicalKey(b)))),
      verificationSeeds:Object.freeze([...verificationSeeds.values()].sort((a,b)=>canonicalKey(a).localeCompare(canonicalKey(b)))),
      verificationTombstones:Object.freeze([...verificationTombstones.values()].sort((a,b)=>canonicalKey(a).localeCompare(canonicalKey(b)))),
      recoveryCandidates:Object.freeze(recoveryCandidates.sort((a,b)=>a.candidateId.localeCompare(b.candidateId))),
      sourceDeletionAllowed:false,resumable:true,publicShareAuthority:false
    });
  }
  function migrationSeedComparable(value){return value&&{entityType:value.entityType,entityId:value.entityId,identity:value.identity,values:value.values};}
  function migrationTombstoneComparable(value){return value&&{
    entityType:value.entityType,entityId:value.entityId,identity:value.identity,generation:value.generation,revision:value.revision,
    createdAt:value.createdAt,values:value.values,fieldRevisions:value.fieldRevisions,fieldMutations:value.fieldMutations,
    fieldMutationHashes:value.fieldMutationHashes
  };}
  function migrationCandidateComparable(value){return value&&{schemaVersion:value.schemaVersion,ownerUid:value.ownerUid,candidateId:value.candidateId,reason:value.reason,entityType:value.entityType,entityId:value.entityId,identity:value.identity,values:value.values,source:value.source,resolved:value.resolved};}
  async function verifyMigration(plan,{canonicalEntities=[],migrationRecord,recoveryCandidates=[],requireExact=true}={}){
    const seedCount=(plan?.verificationSeeds?.length??0)+(plan?.verificationTombstones?.length??0),candidateCount=plan?.recoveryCandidates?.length??0;
    const expectedDeviceInstallHash=plan?.ok?await model.sha256Hex(model.canonicalJson([model.SCHEMA_VERSION,'pogo-account-sync-device-install',plan.ownerUid,plan.deviceInstallId])):'';
    if(!plan?.ok||migrationRecord?.schemaVersion!==model.SCHEMA_VERSION||migrationRecord?.ownerUid!==plan.ownerUid||migrationRecord?.sourceFingerprint!==plan.sourceFingerprint||migrationRecord?.deviceMigrationId!==plan.deviceMigrationId||migrationRecord?.deviceInstallHash!==expectedDeviceInstallHash||migrationRecord?.seedCount!==seedCount||migrationRecord?.candidateCount!==candidateCount||migrationRecord?.verified!==true||migrationRecord?.legacyRetained!==true||model.integer(migrationRecord?.createdAt)===null||model.integer(migrationRecord?.completedAt)===null||migrationRecord.completedAt<migrationRecord.createdAt)return model.failure('account-sync/migration-verification-failed','Migration fingerprint is not verified');
    const actual=canonicalEntitiesMap(canonicalEntities),actualCandidates=new Map(recoveryCandidates.map(item=>[item?.candidateId,item]));
    const missing=[],mismatched=[],tombstonesMissing=[],tombstonesMismatched=[],candidatesMissing=[],candidatesMismatched=[];
    for(const seed of plan.verificationSeeds||[]){const found=actual.get(canonicalKey(seed));if(!found)missing.push(canonicalKey(seed));else if(requireExact&&(found.deleted===true||model.canonicalJson(migrationSeedComparable(found))!==model.canonicalJson(migrationSeedComparable(seed))))mismatched.push(canonicalKey(seed));}
    for(const expected of plan.verificationTombstones||[]){
      const found=actual.get(canonicalKey(expected));
      if(!found)tombstonesMissing.push(canonicalKey(expected));
      else if(requireExact&&(found.deleted!==true||model.canonicalJson(migrationTombstoneComparable(found))!==model.canonicalJson(migrationTombstoneComparable(expected))||found.lifecycleMutation===expected.priorLifecycleMutation||found.lifecycleMutationHash===expected.priorLifecycleMutationHash||model.integer(found.updatedAt)===null||model.integer(found.deletedAt)===null))tombstonesMismatched.push(canonicalKey(expected));
    }
    for(const item of plan.recoveryCandidates||[]){const found=actualCandidates.get(item.candidateId);if(!found)candidatesMissing.push(item.candidateId);else if(requireExact&&model.canonicalJson(migrationCandidateComparable(found))!==model.canonicalJson(migrationCandidateComparable(item)))candidatesMismatched.push(item.candidateId);}
    if(missing.length||mismatched.length||tombstonesMissing.length||tombstonesMismatched.length||candidatesMissing.length||candidatesMismatched.length)return model.failure('account-sync/migration-incomplete','Canonical migration is incomplete',{missing,mismatched,tombstonesMissing,tombstonesMismatched,candidatesMissing,candidatesMismatched});
    return Object.freeze({ok:true,verified:true,sourceDeletionAllowed:false,legacyRetained:true});
  }

  root.accountSyncMigration=Object.freeze({LIST_TYPES,normalizeTradeValues,queuedLegacyBoard,buildMigrationPlan,verifyMigration});
})(window);
