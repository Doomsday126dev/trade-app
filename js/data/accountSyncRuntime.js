(function(global){
  const root=global.PogoData=global.PogoData||{};
  const model=global.PogoDomain?.accountSyncModel,migration=global.PogoDomain?.accountSyncMigration,product=global.PogoDomain?.accountSyncProduct;
  const controllerApi=root.accountSyncController;
  if(!model||!migration||!product||!controllerApi)throw new Error('Account sync runtime dependencies must load first');
  const MIGRATION_COMPLETE_META='migration-complete';
  const MIGRATION_RECORD_KEYS=Object.freeze(['schemaVersion','ownerUid','deviceMigrationId','sourceFingerprint','deviceInstallHash','createdAt','completedAt','seedCount','candidateCount','verified','legacyRetained']);

  function migrationRecord(account,deviceMigrationId){return account?.migrations?.[deviceMigrationId]||null;}
  function flattenSeed(seed){
    if(seed.entityType!=='favorite')return seed.values;
    return product.favoritePatch({displayName:seed.values.displayName,tagIds:Object.keys(seed.values.tagIds||{}).filter(id=>seed.values.tagIds[id]===true)});
  }
  function compatibleMigrationRecord(value,expected){
    if(!model.plainObject(value)||Object.keys(value).sort().join(',')!==[...MIGRATION_RECORD_KEYS].sort().join(','))return false;
    if(model.integer(value.createdAt)===null||model.integer(value.completedAt)===null||value.completedAt<value.createdAt)return false;
    return['schemaVersion','ownerUid','deviceMigrationId','sourceFingerprint','deviceInstallHash','seedCount','candidateCount','verified','legacyRetained'].every(key=>value[key]===expected[key]);
  }
  function createAccountSyncRuntime({
    ownerUid,username,journal,repository,enabled,writesEnabled,allowlistedUids,readMigrationSources,
    onState,onCanonicalEntities,onPublicProjection,onMigrationState,online=()=>global.navigator?.onLine!==false,
    clock=()=>Date.now(),crypto=global.crypto
  }={}){
    const owner=model.firebaseKey(ownerUid,128),name=model.exactText(username,64);
    if(!owner||!name||!journal||!repository||typeof readMigrationSources!=='function')throw new TypeError('Account sync runtime binding is invalid');
    let projectionReady=false,stopped=false,startPromise=null,stopPromise=null,lastPlan=null;
    function notifyState(state){if(!stopped)onState?.(Object.freeze({...state,migrationReady:projectionReady}));}
    const controller=controllerApi.createAccountSyncController({
      journal,repository,ownerUid:owner,enabled,writesEnabled,allowlistedUids,online,clock,crypto,
      onState:notifyState,
      onEntities:entities=>{if(projectionReady&&!stopped)onCanonicalEntities?.(entities);},
      onProjection:onPublicProjection,projectionAllowed:()=>projectionReady&&!stopped
    });
    function requireRunning(){if(stopped)throw Object.assign(new Error('Account sync runtime is closed'),{code:'account-sync/runtime-closed'});}
    function notifyMigration(state,detail={}){onMigrationState?.(Object.freeze({state,...detail}));}
    async function addSeed(seed){
      requireRunning();
      const result=await controller.addMigrationEntity({entityType:seed.entityType,entityId:seed.entityId,identity:seed.identity,values:flattenSeed(seed)});
      requireRunning();
      if(!result.ok)throw Object.assign(new Error(result.error.message),{code:result.error.code});
    }
    async function replayMutation(mutation){
      requireRunning();
      const result=mutation.kind==='patch'
        ?await controller.patchMigrationEntity({entityType:mutation.entityType,entityId:mutation.entityId,patch:mutation.patch})
        :mutation.kind==='delete'
          ?await controller.deleteMigrationEntity({entityType:mutation.entityType,entityId:mutation.entityId})
          :model.failure('account-sync/migration-replay-invalid','Migration replay operation is invalid');
      requireRunning();
      if(!result.ok)throw Object.assign(new Error(result.error.message),{code:result.error.code});
    }
    async function putCandidate(raw){
      requireRunning();
      const candidate=Object.freeze({...raw,createdAt:Number(clock())});
      await journal.putRecoveryCandidate(candidate);
      requireRunning();
      notifyState(await controller.snapshot());
      requireRunning();
      const created=await repository.createRecoveryCandidate(candidate);
      requireRunning();
      if(created.ok)return created;
      if(created.error?.code!=='account-sync/recovery-candidate-exists')throw Object.assign(new Error(created.error?.message||'Recovery candidate write failed'),{code:created.error?.code});
      const account=await repository.readAccount(),existing=account?.recoveryCandidates?.[candidate.candidateId];
      const comparable=value=>{const copy={...(value||{})};delete copy.createdAt;return copy;};
      if(model.canonicalJson(comparable(existing))!==model.canonicalJson(comparable(candidate)))throw Object.assign(new Error('Existing recovery candidate differs'),{code:'account-sync/recovery-candidate-conflict'});
      return Object.freeze({ok:true,status:'idempotent',value:existing});
    }
    async function ensureMigration(){
      requireRunning();
      notifyMigration('reading');
      const accountBefore=await repository.readAccount(),completed=await journal.getMeta(MIGRATION_COMPLETE_META);
      requireRunning();
      await controller.acceptRemote(accountBefore);
      requireRunning();
      if(completed){
        const existing=migrationRecord(accountBefore,completed.deviceMigrationId);
        if(!model.plainObject(completed)||Object.keys(completed).sort().join(',')!==[...MIGRATION_RECORD_KEYS].sort().join(',')||completed.schemaVersion!==model.SCHEMA_VERSION||completed.ownerUid!==owner||completed.verified!==true||completed.legacyRetained!==true||accountBefore?.meta?.initialized!==true||!existing||MIGRATION_RECORD_KEYS.some(key=>completed[key]!==existing[key]))throw Object.assign(new Error('Completed device migration evidence is invalid'),{code:'account-sync/migration-evidence-conflict'});
        lastPlan=Object.freeze({ok:true,schemaVersion:model.SCHEMA_VERSION,ownerUid:owner,deviceMigrationId:completed.deviceMigrationId,sourceFingerprint:completed.sourceFingerprint,resumed:true,sourceDeletionAllowed:false});
        notifyMigration('verified',{deviceMigrationId:completed.deviceMigrationId,resumed:true});return lastPlan;
      }
      const sources=await readMigrationSources({account:accountBefore});
      requireRunning();
      const plan=await migration.buildMigrationPlan({
        ownerUid:owner,username:name,deviceInstallId:sources.deviceInstallId,
        legacyRemoteLists:sources.legacyRemoteLists,legacyLocalLists:sources.legacyLocalLists,
        legacyRemoteBoard:sources.legacyRemoteBoard,legacyLocalBoard:sources.legacyLocalBoard,
        legacyQueue:sources.legacyQueue,orders:sources.orders,favorites:sources.favorites,tags:sources.tags,
        remoteCanonical:[...Object.values(accountBefore?.tradeEntries||{}),...Object.values(accountBefore?.favorites||{}),...Object.values(accountBefore?.tags||{})],canonicalInitialized:accountBefore?.meta?.initialized===true
      },sources.dependencies||{});
      requireRunning();
      if(!plan.ok)throw Object.assign(new Error(plan.error.message),{code:plan.error.code});
      if(sources.legacyRetainedSnapshot){
        const backupKey=`legacy-source:${plan.deviceMigrationId}`;
        if(!await journal.getMeta(backupKey))await journal.setMeta(backupKey,sources.legacyRetainedSnapshot);
        requireRunning();
      }
      lastPlan=plan;notifyMigration('planned',{deviceMigrationId:plan.deviceMigrationId,seedCount:plan.tradeSeeds.length+plan.favoriteSeeds.length+plan.tagSeeds.length,candidateCount:plan.recoveryCandidates.length});
      const existing=migrationRecord(accountBefore,plan.deviceMigrationId);let record=existing,accountVerified=accountBefore;
      if(!existing){
        for(const seed of [...plan.tagSeeds,...plan.favoriteSeeds,...plan.tradeSeeds]){requireRunning();await addSeed(seed);}
        for(const mutation of plan.replayMutations||[]){requireRunning();await replayMutation(mutation);}
        await controller.drain();
        requireRunning();
        const journalState=await journal.snapshot();
        requireRunning();
        if(journalState.pendingCount||journalState.blockedCount||journalState.conflictCount)throw Object.assign(new Error('Migration mutations are not durably accepted'),{code:'account-sync/migration-pending'});
        for(const candidate of plan.recoveryCandidates){requireRunning();await putCandidate(candidate);}
        accountVerified=await repository.readAccount();const createdAt=Number(clock()),deviceInstallHash=await model.sha256Hex(model.canonicalJson([model.SCHEMA_VERSION,'pogo-account-sync-device-install',owner,sources.deviceInstallId]),crypto);
        requireRunning();
        record={schemaVersion:model.SCHEMA_VERSION,ownerUid:owner,deviceMigrationId:plan.deviceMigrationId,sourceFingerprint:plan.sourceFingerprint,deviceInstallHash,createdAt,completedAt:Number(clock()),seedCount:plan.verificationSeeds.length+(plan.verificationTombstones?.length||0),candidateCount:plan.recoveryCandidates.length,verified:true,legacyRetained:true};
        const verified=await migration.verifyMigration(plan,{canonicalEntities:[...Object.values(accountVerified?.tradeEntries||{}),...Object.values(accountVerified?.favorites||{}),...Object.values(accountVerified?.tags||{})],migrationRecord:record,recoveryCandidates:Object.values(accountVerified?.recoveryCandidates||{}),requireExact:true});
        if(!verified.ok)throw Object.assign(new Error(verified.error.message),{code:verified.error.code});
        const created=await repository.createMigration(record);
        requireRunning();
        if(!created.ok){
          if(created.error?.code!=='account-sync/migration-exists')throw Object.assign(new Error(created.error?.message||'Migration record write failed'),{code:created.error?.code});
          accountVerified=await repository.readAccount();requireRunning();
          const concurrent=migrationRecord(accountVerified,plan.deviceMigrationId);
          if(!compatibleMigrationRecord(concurrent,record))throw Object.assign(new Error('Existing migration evidence differs'),{code:'account-sync/migration-evidence-conflict'});
          record=concurrent;
        }
      }else if(existing.sourceFingerprint!==plan.sourceFingerprint||existing.verified!==true||existing.legacyRetained!==true){
        throw Object.assign(new Error('Persisted migration evidence does not match this device source'),{code:'account-sync/migration-evidence-conflict'});
      }
      const verified=await migration.verifyMigration(plan,{canonicalEntities:[...Object.values(accountVerified?.tradeEntries||{}),...Object.values(accountVerified?.favorites||{}),...Object.values(accountVerified?.tags||{})],migrationRecord:record,recoveryCandidates:Object.values(accountVerified?.recoveryCandidates||{}),requireExact:accountBefore?.meta?.initialized!==true});
      requireRunning();
      if(!verified.ok)throw Object.assign(new Error(verified.error.message),{code:verified.error.code});
      if(accountBefore?.meta?.initialized!==true){
        const meta=await repository.updateMeta({ownerUid:owner,initialized:true,initializedAt:accountBefore?.meta?.initializedAt??record.createdAt,featureVersion:model.SCHEMA_VERSION});
        requireRunning();
        if(!meta.ok)throw Object.assign(new Error(meta.error?.message||'Canonical sync metadata was not committed'),{code:meta.error?.code||'account-sync/meta-conflict'});
      }
      await journal.setMeta(MIGRATION_COMPLETE_META,{schemaVersion:model.SCHEMA_VERSION,ownerUid:owner,deviceMigrationId:record.deviceMigrationId,sourceFingerprint:record.sourceFingerprint,deviceInstallHash:record.deviceInstallHash,createdAt:record.createdAt,completedAt:record.completedAt,seedCount:record.seedCount,candidateCount:record.candidateCount,verified:true,legacyRetained:true});
      requireRunning();
      notifyMigration('verified',{deviceMigrationId:plan.deviceMigrationId});
      return plan;
    }
    function start(){
      if(startPromise)return startPromise;
      startPromise=(async()=>{
        requireRunning();
        const activated=await controller.activate();
        requireRunning();
        if(!controller.eligible)return activated;
        try{
          const plan=await ensureMigration();requireRunning();projectionReady=true;onCanonicalEntities?.(Object.freeze(controller.activeEntities()));await controller.publishAcceptedProjection(Object.freeze({kind:'migration-complete',deviceMigrationId:plan.deviceMigrationId}));requireRunning();notifyState(await controller.snapshot());return Object.freeze({ok:true,status:'active',plan});
        }catch(error){if(!stopped)notifyMigration('blocked',{code:String(error?.code||'account-sync/migration-failed')});throw error;}
      })();
      return startPromise;
    }
    async function recordRecoveryCandidate({reason,entityType,entityId,identity,values,source}={}){
      const createdAt=Number(clock()),digest=await model.sha256Hex(model.canonicalJson([model.SCHEMA_VERSION,'pogo-account-sync-runtime-recovery',owner,reason,entityType,entityId,identity,values,source]),crypto);
      return putCandidate({schemaVersion:model.SCHEMA_VERSION,ownerUid:owner,candidateId:`candidate_${digest}`,reason:String(reason||'runtime-unresolved').slice(0,64),entityType,entityId:String(entityId||'unresolved').slice(0,700),identity:identity||{unresolved:true},values:values||{unresolved:true},source:String(source||'runtime').slice(0,64),createdAt,resolved:false});
    }
    function stop(){
      if(stopPromise)return stopPromise;
      stopped=true;projectionReady=false;
      stopPromise=(async()=>{await controller.deactivate();await startPromise?.catch(()=>{});await journal.close?.();return Object.freeze({ok:true,status:'closed'});})();
      return stopPromise;
    }
    function snapshot(){return controller.snapshot();}
    return Object.freeze({ownerUid:owner,username:name,controller,start,stop,snapshot,recordRecoveryCandidate,retryBlocked:()=>controller.retryBlocked(),conflictDetails:()=>controller.conflictDetails(),acceptConflict:id=>controller.acceptConflict(id),reapplyConflict:id=>controller.reapplyConflict(id),get migrationPlan(){return lastPlan;},get projectionReady(){return projectionReady;}});
  }

  root.accountSyncRuntime=Object.freeze({createAccountSyncRuntime});
})(window);
