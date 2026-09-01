(function(global){
  const root=global.PogoData=global.PogoData||{};
  const model=global.PogoDomain?.accountSyncModel,migration=global.PogoDomain?.accountSyncMigration,product=global.PogoDomain?.accountSyncProduct;
  const controllerApi=root.accountSyncController;
  if(!model||!migration||!product||!controllerApi)throw new Error('Account sync runtime dependencies must load first');
  const MIGRATION_COMPLETE_META='migration-complete';
  const MIGRATION_RECORD_KEYS=Object.freeze(['schemaVersion','ownerUid','deviceMigrationId','sourceFingerprint','deviceInstallHash','createdAt','completedAt','seedCount','candidateCount','verified','legacyRetained']);
  const META_RECORD_KEYS=Object.freeze(['schemaVersion','ownerUid','initialized','initializedAt','updatedAt','featureVersion']);
  const RECOVERY_REVIEW_KIND='recovery-review-acceptance';
  const HISTORICAL_RETRY_CODE='account-sync/committed-entity-invalid';
  const INITIALIZATION_KINDS=Object.freeze(['legacy-migration','provider-only']);
  const PROVIDER_PROFILE_PENDING_META='provider-profile-pending-v1';
  const PROFILE_PENDING_KEYS=Object.freeze(['schemaVersion','ownerUid','values','baseRevision','queuedAt']);

  function count(value){const number=Number(value);return Number.isSafeInteger(number)&&number>0?number:0;}
  function diagnosticCode(value,fallback='account-sync/unknown'){
    const code=String(value?.code||value||'');return/^account-sync\/[a-z0-9-]{1,80}$/.test(code)?code:fallback;
  }
  function diagnosticCategory(value,fallback='runtime'){
    const category=String(value||'');return new Set(['blocked-operation','canonical','conflict','healthy','journal','listener','migration','offline','pending-sync','profile','projection','retained-change','review-required','runtime','session','startup','unsafe-evidence']).has(category)?category:fallback;
  }
  function blockedEvidence(snapshot,blockedCount,code){
    let recoverableBlockedCount=count(snapshot.recoverableBlockedCount),unsafeBlockedCount=count(snapshot.unsafeBlockedCount);
    if(recoverableBlockedCount+unsafeBlockedCount!==blockedCount){
      recoverableBlockedCount=0;unsafeBlockedCount=0;
      if(blockedCount){if(model.blockedRetryCategory(code)!=='unsafe')recoverableBlockedCount=blockedCount;else unsafeBlockedCount=blockedCount;}
    }
    return Object.freeze({recoverableBlockedCount,unsafeBlockedCount});
  }
  function recoveryPlan({snapshot={},runtimePresent=false,projectionReady=false,sessionCurrent=true}={}){
    const pendingCount=count(snapshot.pendingCount),blockedCount=count(snapshot.blockedCount),conflictCount=count(snapshot.conflictCount),reviewCount=count(snapshot.recoveryCandidateCount),state=String(snapshot.state||'sync-error');
    const code=diagnosticCode(snapshot.lastError||snapshot.blockedErrorCode,blockedCount?'account-sync/blocked-operation':'account-sync/unknown');
    const{recoverableBlockedCount,unsafeBlockedCount}=blockedEvidence(snapshot,blockedCount,code),base={pendingCount,blockedCount,recoverableBlockedCount,unsafeBlockedCount,conflictCount,reviewCount};
    if(!sessionCurrent||code==='account-sync/session-changed'||code==='account-sync/session-inactive')return Object.freeze({action:'none',category:'session',code:'account-sync/session-changed',...base});
    if(model.unsafeRecoveryCode(snapshot.lastError||code)||snapshot.lastErrorCategory==='canonical'||snapshot.lastErrorCategory==='unsafe-evidence'||unsafeBlockedCount)return Object.freeze({action:'none',category:'unsafe-evidence',code,...base});
    if(conflictCount||state==='conflict')return Object.freeze({action:'review-conflict',category:'conflict',code:'account-sync/conflict',...base});
    if(reviewCount||state==='review-required')return projectionReady
      ?Object.freeze({action:'none',category:'review-required',code:'account-sync/review-required',...base})
      :Object.freeze({action:'restart-runtime',category:'projection',code:'account-sync/review-not-ready',...base});
    if(blockedCount&&recoverableBlockedCount===blockedCount&&snapshot.listenerHealthy===true&&snapshot.controllerHealthy===true)return Object.freeze({action:'retry-blocked',category:'retained-change',code,...base});
    if(state==='offline'||state==='pending-sync'||['starting','listening'].includes(snapshot.listenerState))return Object.freeze({action:'none',category:state==='offline'?'offline':'pending-sync',code:state==='offline'?'account-sync/offline':'account-sync/pending',...base});
    if(state==='sync-error'||state==='inactive'||!runtimePresent||!projectionReady||snapshot.active!==true||snapshot.listenerHealthy!==true||snapshot.controllerHealthy!==true)return Object.freeze({action:'restart-runtime',category:diagnosticCategory(snapshot.lastErrorCategory,!projectionReady?'projection':'runtime'),code,...base});
    return Object.freeze({action:'none',category:'healthy',code:'account-sync/healthy',...base});
  }
  function healthySnapshot({snapshot={},runtimePresent=false,projectionReady=false,sessionCurrent=true}={}){
    return sessionCurrent&&runtimePresent&&projectionReady&&snapshot.state==='saved'&&snapshot.active===true&&snapshot.listenerHealthy===true&&snapshot.controllerHealthy===true&&!snapshot.lastError&&!count(snapshot.pendingCount)&&!count(snapshot.blockedCount)&&!count(snapshot.conflictCount)&&!count(snapshot.recoveryCandidateCount);
  }
  function sanitizedDiagnostic({snapshot={},runtimePresent=false,projectionReady=false,sessionCurrent=true,recoveryOutcome='idle',release='unknown'}={}){
    const plan=recoveryPlan({snapshot,runtimePresent,projectionReady,sessionCurrent}),outcome=/^(?:idle|running|recovered|failed|pending|review)$/.test(String(recoveryOutcome))?String(recoveryOutcome):'failed';
    return Object.freeze({code:plan.code,category:plan.category,pendingCount:plan.pendingCount,blockedCount:plan.blockedCount,recoverableBlockedCount:plan.recoverableBlockedCount,unsafeBlockedCount:plan.unsafeBlockedCount,conflictCount:plan.conflictCount,reviewCount:plan.reviewCount,runtime:runtimePresent&&snapshot.active===true?'active':'inactive',listener:snapshot.listenerHealthy===true?'healthy':snapshot.listenerState==='failed'?'failed':'not-ready',projection:projectionReady?'ready':'not-ready',recoveryOutcome:outcome,release:/^\d{4}-\d{2}-\d{2}\.\d+$/.test(String(release))?String(release):'unknown'});
  }
  function createRecoveryCoordinator({capture,isCurrent,retryBlocked,restart,recapture,onProgress=()=>{}}={}){
    if(typeof capture!=='function'||typeof isCurrent!=='function'||typeof retryBlocked!=='function'||typeof restart!=='function'||typeof recapture!=='function')throw new TypeError('Account sync recovery coordinator dependencies are incomplete');
    let inFlight=null,attempts=0;
    function publish(value){try{onProgress(Object.freeze(value));}catch{}}
    function result(ok,status,plan,attempt,extra={}){return Object.freeze({ok,status,action:plan.action,category:plan.category,attempt,...extra,code:diagnosticCode(extra.code||plan.code)});}
    function recover(){
      if(inFlight)return inFlight;
      const work=(async()=>{
        let context,plan,attempt=0,retried=0;
        try{
          context=await capture();plan=recoveryPlan(context);
          if(plan.action==='review-conflict')return result(false,'review',plan,attempt,{code:'account-sync/conflict'});
          if(plan.action==='none')return result(false,'unavailable',plan,attempt);
          attempt=++attempts;publish({status:'running',attempt,action:plan.action,category:plan.category});
          if(!isCurrent(context))return result(false,'failed',plan,attempt,{code:'account-sync/session-changed'});
          if(plan.action==='retry-blocked'){
            const retriedResult=await retryBlocked(context);retried=count(retriedResult?.retried);
            if(!retriedResult?.ok||!retried)return result(false,'failed',plan,attempt,{code:retriedResult?.error?.code||'account-sync/retry-empty',retried});
            if(!isCurrent(context))return result(false,'failed',plan,attempt,{code:'account-sync/session-changed',retried});
            context=await recapture(context);const afterRetry=recoveryPlan(context);
            if(healthySnapshot(context))return result(true,'recovered',plan,attempt,{code:'account-sync/recovered',retried});
            if(afterRetry.action==='restart-runtime'&&!afterRetry.pendingCount&&!afterRetry.blockedCount&&!afterRetry.conflictCount&&!afterRetry.reviewCount)context=await restart(context);
            else return result(false,afterRetry.category==='pending-sync'?'pending':['conflict','review-required'].includes(afterRetry.category)?'review':'failed',afterRetry,attempt,{retried});
          }else{
            context=await restart(context);
            if(!isCurrent(context))return result(false,'failed',plan,attempt,{code:'account-sync/session-changed',retried});
            context=await recapture(context);const afterRestart=recoveryPlan(context);
            if(afterRestart.action==='retry-blocked'){
              const retriedResult=await retryBlocked(context);retried=count(retriedResult?.retried);
              if(!retriedResult?.ok||!retried)return result(false,'failed',afterRestart,attempt,{code:retriedResult?.error?.code||'account-sync/retry-empty',retried});
            }
          }
          if(!isCurrent(context))return result(false,'failed',plan,attempt,{code:'account-sync/session-changed',retried});
          context=await recapture(context);
          if(healthySnapshot(context))return result(true,'recovered',plan,attempt,{code:'account-sync/recovered',retried});
          const after=recoveryPlan(context);return result(false,after.category==='pending-sync'?'pending':['conflict','review-required'].includes(after.category)?'review':'failed',after,attempt,{retried});
        }catch(error){return result(false,'failed',plan||Object.freeze({action:'none',category:'runtime',code:'account-sync/recovery-failed'}),attempt,{code:diagnosticCode(error,'account-sync/recovery-failed'),retried});}
      })();
      inFlight=work.then(value=>{publish({status:value.status,attempt:value.attempt,action:value.action,category:value.category,code:value.code});return value;}).finally(()=>{inFlight=null;});
      return inFlight;
    }
    return Object.freeze({recover,get active(){return!!inFlight;}});
  }

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
  function compatibleRecoveryCandidate(value,expected){
    if(!model.plainObject(value)||Object.keys(value).sort().join(',')!==Object.keys(expected).sort().join(',')||model.integer(value.createdAt)===null)return false;
    const actualComparable={...value},expectedComparable={...expected};delete actualComparable.createdAt;delete expectedComparable.createdAt;
    return model.canonicalJson(actualComparable)===model.canonicalJson(expectedComparable);
  }
  function compatibleMetaRecord(value,expected,previous){
    if(!model.plainObject(value)||Object.keys(value).sort().join(',')!==[...META_RECORD_KEYS].sort().join(','))return false;
    if(value.schemaVersion!==model.SCHEMA_VERSION||value.ownerUid!==expected.ownerUid||value.initialized!==true||value.featureVersion!==expected.featureVersion)return false;
    const initializedAt=model.integer(value.initializedAt),updatedAt=model.integer(value.updatedAt);
    if(initializedAt===null||updatedAt===null||updatedAt<initializedAt)return false;
    const priorInitializedAt=model.integer(previous?.initializedAt);
    return priorInitializedAt===null||initializedAt===priorInitializedAt;
  }
  function createAccountSyncRuntime({
    ownerUid,username,journal,repository,enabled,writesEnabled,allowlistedUids,readMigrationSources,
    onState,onCanonicalEntities,onProviderProfile,onPublicProjection,onMigrationState,initialProviderProfile={},online=()=>global.navigator?.onLine!==false,
    clock=()=>Date.now(),crypto=global.crypto,listenerReadyTimeoutMs=8000,initializationKind='legacy-migration'
  }={}){
    const owner=model.firebaseKey(ownerUid,128),name=model.exactText(username,64);
    if(!owner||!name||!journal||!repository||!INITIALIZATION_KINDS.includes(initializationKind)||
      initializationKind==='legacy-migration'&&typeof readMigrationSources!=='function')throw new TypeError('Account sync runtime binding is invalid');
    let projectionReady=false,profileReady=initializationKind!=='provider-only',providerProfile=null,providerProfilePending=null,profileMutationPromise=Promise.resolve(),stopped=false,startPromise=null,stopPromise=null,lastPlan=null,startupError='',startupErrorCategory='',migrationState='inactive';
    function runtimeState(state){
      const lastError=startupError||state.lastError||'',lastErrorCategory=startupErrorCategory||state.lastErrorCategory||'',currentState=lastError?'sync-error':state.state==='saved'&&!projectionReady?'pending-sync':state.state;
      return Object.freeze({...state,state:currentState,lastError,lastErrorCategory,projectionReady,profileReady,migrationReady:projectionReady,migrationState,runtimeHealthy:currentState==='saved'&&projectionReady&&profileReady&&state.controllerHealthy===true});
    }
    function notifyState(state){if(!stopped)onState?.(runtimeState(state));}
    const controller=controllerApi.createAccountSyncController({
      journal,repository,ownerUid:owner,enabled,writesEnabled,allowlistedUids,online,clock,crypto,
      onState:notifyState,
      onEntities:entities=>{
        if(!projectionReady||stopped)return;
        try{
          if(onCanonicalEntities?.(entities)===false)throw Object.assign(new Error('Canonical account projection is unresolved'),{code:'account-sync/catalog-projection-unresolved'});
        }catch(error){
          projectionReady=false;startupError=diagnosticCode(error,'account-sync/catalog-projection-unresolved');startupErrorCategory='canonical';notifyMigration('blocked',{code:startupError});
          Promise.resolve(controller.snapshot()).then(notifyState).catch(()=>{});
        }
      },
      onAccount:account=>acceptProviderAccountProfile(account),
      onProjection:onPublicProjection,projectionAllowed:()=>projectionReady&&!stopped
    });
    function requireRunning(){if(stopped)throw Object.assign(new Error('Account sync runtime is closed'),{code:'account-sync/runtime-closed'});}
    function notifyMigration(state,detail={}){migrationState=state;onMigrationState?.(Object.freeze({state,...detail}));}
    function pendingProfileRecord(value){
      const keys=model.plainObject(value)?Object.keys(value).sort():[],expected=[...PROFILE_PENDING_KEYS].sort(),normalized=model.normalizeProfileValues(value?.values),baseRevision=model.integer(value?.baseRevision),queuedAt=model.integer(value?.queuedAt);
      return keys.length===expected.length&&keys.every((key,index)=>key===expected[index])&&value.schemaVersion===model.SCHEMA_VERSION&&value.ownerUid===owner&&normalized.ok&&model.canonicalJson(normalized.value)===model.canonicalJson(value.values)&&baseRevision!==null&&queuedAt!==null
        ?Object.freeze({...value,values:normalized.value}):null;
    }
    function exactProviderProfile(value){
      const valid=model.validateProfileRecord(value,{ownerUid:owner});
      if(!valid.ok)throw Object.assign(new Error('Canonical provider profile is invalid'),{code:'account-sync/profile-invalid'});
      return valid.value;
    }
    function notifyProviderProfile(profile,{pending=false,resolution=''}={}){
      const projected=Object.freeze({...profile,...model.profileValues(profile),pending,...(resolution?{resolution}: {})});
      if(onProviderProfile?.(projected)===false)throw Object.assign(new Error('Provider profile projection is unresolved'),{code:'account-sync/profile-projection-unresolved'});
    }
    async function acceptProviderAccountProfile(account){
      if(initializationKind!=='provider-only')return;
      if(account?.profile==null){
        if(profileReady)throw Object.assign(new Error('Canonical provider profile disappeared'),{code:'account-sync/profile-missing'});
        return;
      }
      const profile=exactProviderProfile(account.profile);providerProfile=profile;profileReady=true;notifyProviderProfile(profile);
    }
    async function flushProviderProfile(pending){
      requireRunning();
      let resolution='';
      const result=await controller.runAuthorizedWatchedMutation({
        write:()=>repository.writeProfile(pending.values,{baseRevision:pending.baseRevision}),timeoutMs:listenerReadyTimeoutMs,
        reconcile:({account})=>{
          const valid=model.validateProfileRecord(account?.profile,{ownerUid:owner});
          if(!valid.ok)return model.failure('account-sync/profile-conflict','Canonical provider profile differs or is missing');
          if(model.canonicalJson(model.profileValues(valid.value))===model.canonicalJson(pending.values))return Object.freeze({ok:true,status:'reconciled',value:valid.value});
          if(valid.value.revision>pending.baseRevision){resolution='canonical-won';return Object.freeze({ok:true,status:resolution,value:valid.value});}
          return model.failure('account-sync/profile-conflict','Canonical provider profile differs or is missing');
        }
      });
      requireRunning();providerProfile=exactProviderProfile(result.value);profileReady=true;providerProfilePending=null;
      await journal.removeMeta(PROVIDER_PROFILE_PENDING_META);requireRunning();notifyProviderProfile(providerProfile,{resolution});return providerProfile;
    }
    async function ensureProviderProfile(){
      requireRunning();
      const account=await repository.readAccount(),storedPending=await journal.getMeta(PROVIDER_PROFILE_PENDING_META);requireRunning();
      await controller.acceptRemote(account);requireRunning();
      const pending=storedPending==null?null:pendingProfileRecord(storedPending);
      if(storedPending!=null&&!pending)throw Object.assign(new Error('Pending provider profile evidence is invalid'),{code:'account-sync/profile-pending-invalid'});
      providerProfilePending=pending;
      if(account?.profile!=null){
        const canonical=exactProviderProfile(account.profile);
        if(!pending){providerProfile=canonical;profileReady=true;notifyProviderProfile(canonical);return canonical;}
        if(model.canonicalJson(model.profileValues(canonical))===model.canonicalJson(pending.values)){
          providerProfile=canonical;profileReady=true;providerProfilePending=null;await journal.removeMeta(PROVIDER_PROFILE_PENDING_META);notifyProviderProfile(canonical);return canonical;
        }
        if(canonical.revision>pending.baseRevision){
          providerProfile=canonical;profileReady=true;providerProfilePending=null;await journal.removeMeta(PROVIDER_PROFILE_PENDING_META);
          notifyProviderProfile(canonical,{resolution:'canonical-won'});return canonical;
        }
      }
      let queued=pending;
      if(!queued){
        const normalized=model.normalizeProfileValues(initialProviderProfile);
        if(!normalized.ok)throw Object.assign(new Error(normalized.error.message),{code:normalized.error.code});
        queued=Object.freeze({schemaVersion:model.SCHEMA_VERSION,ownerUid:owner,values:normalized.value,baseRevision:account?.profile?.revision||0,queuedAt:Number(clock())});
        await journal.setMeta(PROVIDER_PROFILE_PENDING_META,queued);requireRunning();providerProfilePending=queued;
      }
      return flushProviderProfile(queued);
    }
    function updateProviderProfile(patch={}){
      const work=profileMutationPromise.then(async()=>{
        requireRunning();
        if(initializationKind!=='provider-only'||!profileReady||!providerProfile)return model.failure('account-sync/profile-not-ready','Provider profile is not ready');
        if(!model.plainObject(patch)||Object.keys(patch).some(key=>!model.PROFILE_VALUE_FIELDS.includes(key)))return model.failure('account-sync/profile-invalid','Provider profile edit contains unknown fields');
        const baseValues=providerProfilePending?.values||model.profileValues(providerProfile),normalized=model.normalizeProfileValues({...baseValues,...patch});
        if(!normalized.ok)return normalized;
        if(!providerProfilePending&&model.canonicalJson(normalized.value)===model.canonicalJson(model.profileValues(providerProfile)))return Object.freeze({ok:true,status:'unchanged',value:providerProfile});
        const pending=Object.freeze({schemaVersion:model.SCHEMA_VERSION,ownerUid:owner,values:normalized.value,baseRevision:providerProfilePending?.baseRevision??providerProfile.revision,queuedAt:Number(clock())});
        await journal.setMeta(PROVIDER_PROFILE_PENDING_META,pending);requireRunning();providerProfilePending=pending;notifyProviderProfile({...providerProfile,...pending.values},{pending:true});
        try{return Object.freeze({ok:true,status:'updated',value:await flushProviderProfile(pending)});}
        catch(error){notifyState(await controller.snapshot());return Object.freeze({...model.failure('account-sync/profile-pending','Provider profile change is saved on this device and will retry'),causeCode:diagnosticCode(error,'account-sync/network-failed')});}
      });
      profileMutationPromise=work.then(()=>undefined,()=>undefined);return work;
    }
    function retryProviderProfile(){
      const work=profileMutationPromise.then(async()=>{
        requireRunning();const stored=providerProfilePending||pendingProfileRecord(await journal.getMeta(PROVIDER_PROFILE_PENDING_META));
        if(!stored)return Object.freeze({ok:true,status:'unchanged',value:providerProfile});
        return Object.freeze({ok:true,status:'updated',value:await flushProviderProfile(stored)});
      });
      profileMutationPromise=work.then(()=>undefined,()=>undefined);return work;
    }
    async function requireListenerAuthority(){
      const ready=await controller.waitForListenerReady({timeoutMs:listenerReadyTimeoutMs});
      requireRunning();
      if(!ready?.ok)throw Object.assign(new Error('The live account sync listener did not become ready'),{code:ready?.error?.code||'account-sync/listener-failed'});
    }
    async function addSeed(seed){
      requireRunning();await requireListenerAuthority();
      const result=await controller.addMigrationEntity({entityType:seed.entityType,entityId:seed.entityId,identity:seed.identity,values:flattenSeed(seed)});
      requireRunning();
      if(!result.ok)throw Object.assign(new Error(result.error.message),{code:result.error.code});
      await controller.drain();requireRunning();
    }
    async function replayMutation(mutation){
      requireRunning();await requireListenerAuthority();
      const result=mutation.kind==='patch'
        ?await controller.patchMigrationEntity({entityType:mutation.entityType,entityId:mutation.entityId,patch:mutation.patch})
        :mutation.kind==='delete'
          ?await controller.deleteMigrationEntity({entityType:mutation.entityType,entityId:mutation.entityId})
          :model.failure('account-sync/migration-replay-invalid','Migration replay operation is invalid');
      requireRunning();
      if(!result.ok)throw Object.assign(new Error(result.error.message),{code:result.error.code});
      await controller.drain();requireRunning();
    }
    async function putCandidate(raw){
      requireRunning();
      const candidate=Object.freeze({...raw,createdAt:Number(clock())});
      await journal.putRecoveryCandidate(candidate);
      requireRunning();
      notifyState(await controller.snapshot());
      requireRunning();
      const created=await controller.runAuthorizedWatchedMutation({
        write:()=>repository.createRecoveryCandidate(candidate),
        timeoutMs:listenerReadyTimeoutMs,
        reconcile:({account,result})=>{
          const existing=account?.recoveryCandidates?.[candidate.candidateId];
          if(!compatibleRecoveryCandidate(existing,candidate))return model.failure('account-sync/recovery-candidate-conflict','Canonical recovery candidate evidence differs or is missing');
          return Object.freeze({ok:true,status:result?.ok&&result.status==='created'?'created':'idempotent',value:existing});
        }
      });
      requireRunning();return created;
    }
    function recoveryEvidenceComparable(value){return{schemaVersion:value.schemaVersion,ownerUid:value.ownerUid,candidateId:value.candidateId,reason:value.reason,entityType:value.entityType,entityId:value.entityId,identity:value.identity,values:value.values,source:value.source};}
    async function recoveryReviewEvidence(candidates){
      const values=[...candidates].sort((a,b)=>String(a?.candidateId||'').localeCompare(String(b?.candidateId||'')));
      if(!values.length)return null;
      const ids=new Set();
      for(const value of values){
        if(value?.schemaVersion!==model.SCHEMA_VERSION||value?.ownerUid!==owner||!/^candidate_[a-f0-9]{64}$/.test(String(value?.candidateId||''))||ids.has(value.candidateId)||!model.plainObject(value.identity)||!model.plainObject(value.values))throw Object.assign(new Error('Recovery review evidence is invalid'),{code:'account-sync/recovery-review-evidence-invalid'});
        ids.add(value.candidateId);
      }
      const evidenceFingerprint=await model.sha256Hex(model.canonicalJson([model.SCHEMA_VERSION,'pogo-account-sync-recovery-review',owner,values.map(recoveryEvidenceComparable)]),crypto);
      return Object.freeze({candidates:Object.freeze(values),record:Object.freeze({schemaVersion:model.SCHEMA_VERSION,kind:RECOVERY_REVIEW_KIND,ownerUid:owner,trainerUsername:name,evidenceFingerprint,candidateCount:values.length,acceptedAt:Number(clock())})});
    }
    async function readRecoveryReviewAcceptance(evidence){
      const result=await controller.runAuthorizedMutation(()=>repository.readRecoveryReviewAcceptance(evidence.record));
      if(!result?.ok)throw Object.assign(new Error(result?.error?.message||'Recovery review acceptance could not be read'),{code:result?.error?.code||'account-sync/recovery-review-acceptance-unreconciled'});
      return result.value;
    }
    async function persistRecoveryReviewAcceptance(evidence){
      const result=await controller.runAuthorizedMutation(()=>repository.createRecoveryReviewAcceptance(evidence.record));
      if(!result?.ok)throw Object.assign(new Error(result?.error?.message||'Recovery review acceptance could not be saved'),{code:result?.error?.code||'account-sync/recovery-review-acceptance-unreconciled'});
      return result.value;
    }
    async function synchronizeRecoveryReviewAcceptance(){
      requireRunning();
      const candidates=await journal.listRecoveryCandidates({unresolvedOnly:false}),evidence=await recoveryReviewEvidence(candidates);
      requireRunning();if(!evidence)return Object.freeze({ok:true,status:'empty',count:0});
      const unresolved=evidence.candidates.filter(value=>value.resolved!==true),accepted=await readRecoveryReviewAcceptance(evidence);requireRunning();
      if(!unresolved.length){if(!accepted)await persistRecoveryReviewAcceptance(evidence);return Object.freeze({ok:true,status:accepted?'current':'published',count:evidence.candidates.length});}
      if(!accepted)return Object.freeze({ok:true,status:'review-required',count:unresolved.length});
      const resolved=await journal.resolveRecoveryCandidates(unresolved.map(value=>value.candidateId));requireRunning();
      if(resolved!==unresolved.length)throw Object.assign(new Error('Recovery review acceptance did not match the local candidate set'),{code:'account-sync/recovery-review-changed'});
      notifyState(await controller.snapshot());return Object.freeze({ok:true,status:'inherited',count:resolved});
    }
    function providerInitializationContaminated(account,{initialized=false}={}){
      const forbidden=initialized
        ?['migrations','recoveryCandidates','recoveryReviewAcceptances']
        :['tradeEntries','favorites','tags','migrations','recoveryCandidates','recoveryReviewAcceptances'];
      return forbidden
        .some(key=>model.plainObject(account?.[key])&&Object.keys(account[key]).length>0);
    }
    async function ensureProviderInitialization(){
      requireRunning();notifyMigration('reading');
      const accountBefore=await repository.readAccount(),legacyCompletion=await journal.getMeta(MIGRATION_COMPLETE_META);
      requireRunning();await controller.acceptRemote(accountBefore);requireRunning();
      const existingMeta=accountBefore?.meta;
      if(existingMeta?.initialized===true){
        if(legacyCompletion||providerInitializationContaminated(accountBefore,{initialized:true}))throw Object.assign(
          new Error('Provider-only account contains legacy migration or recovery evidence'),
          {code:'account-sync/provider-initialization-conflict'}
        );
        const expected={ownerUid:owner,featureVersion:model.SCHEMA_VERSION};
        if(!compatibleMetaRecord(existingMeta,expected,existingMeta))throw Object.assign(
          new Error('Provider-only canonical metadata is malformed'),{code:'account-sync/meta-conflict'}
        );
        lastPlan=Object.freeze({ok:true,schemaVersion:model.SCHEMA_VERSION,ownerUid:owner,
          initializationKind:'provider-only',resumed:true,sourceDeletionAllowed:false,deviceMigrationId:null});
        notifyMigration('verified',{initializationKind:'provider-only',resumed:true});return lastPlan;
      }
      if(legacyCompletion||providerInitializationContaminated(accountBefore))throw Object.assign(
        new Error('Provider-only account contains legacy or partial canonical evidence'),
        {code:'account-sync/provider-initialization-conflict'}
      );
      if(existingMeta&&Object.keys(existingMeta).length)throw Object.assign(
        new Error('Provider-only canonical metadata is partial'),{code:'account-sync/meta-conflict'}
      );
      const expectedMeta={ownerUid:owner,initialized:true,initializedAt:Number(clock()),featureVersion:model.SCHEMA_VERSION};
      await controller.runAuthorizedWatchedMutation({
        write:()=>repository.updateMeta(expectedMeta),timeoutMs:listenerReadyTimeoutMs,
        reconcile:({account})=>compatibleMetaRecord(account?.meta,expectedMeta,existingMeta)
          ?Object.freeze({ok:true,status:'reconciled',value:account.meta})
          :model.failure('account-sync/meta-conflict','Canonical provider account metadata differs or is incomplete')
      });
      requireRunning();
      lastPlan=Object.freeze({ok:true,schemaVersion:model.SCHEMA_VERSION,ownerUid:owner,
        initializationKind:'provider-only',resumed:false,sourceDeletionAllowed:false,deviceMigrationId:null});
      notifyMigration('verified',{initializationKind:'provider-only',resumed:false});return lastPlan;
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
        const created=await controller.runAuthorizedWatchedMutation({
          write:()=>repository.createMigration(record),
          timeoutMs:listenerReadyTimeoutMs,
          reconcile:({account,result})=>{
            const existingRecord=migrationRecord(account,plan.deviceMigrationId);
            if(!compatibleMigrationRecord(existingRecord,record))return model.failure('account-sync/migration-evidence-conflict','Canonical migration evidence differs or is missing');
            return Object.freeze({ok:true,status:result?.ok&&result.status==='created'?'created':'idempotent',value:existingRecord});
          }
        });
        requireRunning();record=created.value;
      }else if(existing.sourceFingerprint!==plan.sourceFingerprint||existing.verified!==true||existing.legacyRetained!==true){
        throw Object.assign(new Error('Persisted migration evidence does not match this device source'),{code:'account-sync/migration-evidence-conflict'});
      }
      const verified=await migration.verifyMigration(plan,{canonicalEntities:[...Object.values(accountVerified?.tradeEntries||{}),...Object.values(accountVerified?.favorites||{}),...Object.values(accountVerified?.tags||{})],migrationRecord:record,recoveryCandidates:Object.values(accountVerified?.recoveryCandidates||{}),requireExact:accountBefore?.meta?.initialized!==true});
      requireRunning();
      if(!verified.ok)throw Object.assign(new Error(verified.error.message),{code:verified.error.code});
      if(accountBefore?.meta?.initialized!==true){
        const expectedMeta={ownerUid:owner,initialized:true,initializedAt:accountBefore?.meta?.initializedAt??record.createdAt,featureVersion:model.SCHEMA_VERSION};
        await controller.runAuthorizedWatchedMutation({
          write:()=>repository.updateMeta(expectedMeta),
          timeoutMs:listenerReadyTimeoutMs,
          reconcile:({account})=>compatibleMetaRecord(account?.meta,expectedMeta,accountBefore?.meta)
            ?Object.freeze({ok:true,status:'reconciled',value:account.meta})
            :model.failure('account-sync/meta-conflict','Canonical account metadata differs or is incomplete')
        });
        requireRunning();
      }
      await journal.setMeta(MIGRATION_COMPLETE_META,{schemaVersion:model.SCHEMA_VERSION,ownerUid:owner,deviceMigrationId:record.deviceMigrationId,sourceFingerprint:record.sourceFingerprint,deviceInstallHash:record.deviceInstallHash,createdAt:record.createdAt,completedAt:record.completedAt,seedCount:record.seedCount,candidateCount:record.candidateCount,verified:true,legacyRetained:true});
      requireRunning();
      notifyMigration('verified',{deviceMigrationId:plan.deviceMigrationId});
      return plan;
    }
    function start(){
      if(startPromise)return startPromise;
      startPromise=(async()=>{
        try{
          requireRunning();startupError='';startupErrorCategory='';migrationState='activating';
          const activated=await controller.activate();requireRunning();
          if(!controller.eligible)return activated;
          const listenerReady=await controller.waitForListenerReady({timeoutMs:listenerReadyTimeoutMs});requireRunning();
          if(!listenerReady?.ok)throw Object.assign(new Error('The live account sync listener did not become ready'),{code:listenerReady?.error?.code||'account-sync/listener-failed'});
          migrationState='reading';const plan=initializationKind==='provider-only'?await ensureProviderInitialization():await ensureMigration();requireRunning();
          if(initializationKind==='provider-only'){migrationState='profile';await ensureProviderProfile();requireRunning();}
          if(initializationKind==='legacy-migration')await synchronizeRecoveryReviewAcceptance();requireRunning();projectionReady=true;
          if(onCanonicalEntities?.(Object.freeze(controller.activeEntities()))===false)throw Object.assign(new Error('Canonical account projection is unresolved'),{code:'account-sync/catalog-projection-unresolved'});
          await controller.publishAcceptedProjection(initializationKind==='provider-only'
            ?Object.freeze({kind:'provider-account-initialized'})
            :Object.freeze({kind:'migration-complete',deviceMigrationId:plan.deviceMigrationId}));requireRunning();
          startupError='';startupErrorCategory='';notifyState(await controller.snapshot());return Object.freeze({ok:true,status:'active',plan});
        }catch(error){
          projectionReady=false;startupError=diagnosticCode(error,'account-sync/migration-failed');startupErrorCategory=startupError==='account-sync/catalog-projection-unresolved'?'canonical':/^account-sync\/listener-/.test(startupError)?'listener':/^account-sync\/profile-/.test(startupError)?'profile':migrationState==='activating'?'startup':'migration';
          if(!stopped){notifyMigration('blocked',{code:startupError});try{notifyState(await controller.snapshot());}catch{}}
          throw error;
        }
      })();
      return startPromise;
    }
    async function recordRecoveryCandidate({reason,entityType,entityId,identity,values,source}={}){
      const createdAt=Number(clock()),digest=await model.sha256Hex(model.canonicalJson([model.SCHEMA_VERSION,'pogo-account-sync-runtime-recovery',owner,reason,entityType,entityId,identity,values,source]),crypto);
      return putCandidate({schemaVersion:model.SCHEMA_VERSION,ownerUid:owner,candidateId:`candidate_${digest}`,reason:String(reason||'runtime-unresolved').slice(0,64),entityType,entityId:String(entityId||'unresolved').slice(0,700),identity:identity||{unresolved:true},values:values||{unresolved:true},source:String(source||'runtime').slice(0,64),createdAt,resolved:false});
    }
    async function listRecoveryCandidates(options){requireRunning();return Object.freeze(await journal.listRecoveryCandidates(options));}
    async function completeRecoveryReview(candidateId){
      requireRunning();const candidates=await journal.listRecoveryCandidates({unresolvedOnly:false}),evidence=await recoveryReviewEvidence(candidates),unresolved=candidates.filter(value=>value.resolved!==true);
      if(evidence&&unresolved.length===1&&unresolved[0].candidateId===candidateId)await persistRecoveryReviewAcceptance(evidence);
      requireRunning();const resolved=await journal.resolveRecoveryCandidate(candidateId);requireRunning();notifyState(await controller.snapshot());
      return Object.freeze({ok:true,status:resolved?'resolved':'not_found'});
    }
    async function completeRecoveryReviews(candidateIds){
      requireRunning();
      const before=await controller.snapshot(),ids=Array.isArray(candidateIds)?[...candidateIds]:[];
      if(!projectionReady||!before.active||!before.listenerHealthy||!before.controllerHealthy||before.state!=='review-required'||before.pendingCount||before.blockedCount||before.conflictCount||before.recoveryCandidateCount!==ids.length)return model.failure('account-sync/recovery-review-not-ready','Recovery review requires a healthy exact canonical account snapshot');
      const evidence=await recoveryReviewEvidence(await journal.listRecoveryCandidates({unresolvedOnly:false}));
      if(!evidence)return model.failure('account-sync/recovery-review-not-ready','Recovery review evidence is unavailable');
      const expectedIds=evidence.candidates.filter(value=>value.resolved!==true).map(value=>value.candidateId).sort(),reviewIds=ids.map(value=>String(value||'')).sort();
      if(new Set(reviewIds).size!==reviewIds.length||reviewIds.some((value,index)=>value!==expectedIds[index]))return model.failure('account-sync/recovery-review-changed','Recovery candidate set changed before review');
      await persistRecoveryReviewAcceptance(evidence);requireRunning();
      const resolved=await journal.resolveRecoveryCandidates(ids);requireRunning();
      const after=await controller.snapshot();
      if(resolved!==ids.length||after.recoveryCandidateCount!==0||after.state!=='saved')throw Object.assign(new Error('Recovery review did not reach the saved state'),{code:'account-sync/recovery-review-incomplete'});
      notifyState(after);return Object.freeze({ok:true,status:'resolved',count:resolved});
    }
    function stop(){
      if(stopPromise)return stopPromise;
      stopped=true;projectionReady=false;
      stopPromise=(async()=>{await controller.deactivate();await startPromise?.catch(()=>{});await journal.close?.();return Object.freeze({ok:true,status:'closed'});})();
      return stopPromise;
    }
    async function snapshot(){return runtimeState(await controller.snapshot());}
    return Object.freeze({ownerUid:owner,username:name,controller,start,stop,snapshot,updateProviderProfile,retryProviderProfile,recordRecoveryCandidate,listRecoveryCandidates,completeRecoveryReview,completeRecoveryReviews,retryBlocked:()=>controller.retryBlocked(),conflictDetails:()=>controller.conflictDetails(),acceptConflict:id=>controller.acceptConflict(id),reapplyConflict:id=>controller.reapplyConflict(id),get migrationPlan(){return lastPlan;},get providerProfile(){return providerProfile;},get profileReady(){return profileReady;},get projectionReady(){return projectionReady;}});
  }

  root.accountSyncRuntime=Object.freeze({HISTORICAL_RETRY_CODE,PROVIDER_PROFILE_PENDING_META,diagnosticCode,diagnosticCategory,recoveryPlan,healthySnapshot,sanitizedDiagnostic,createRecoveryCoordinator,createAccountSyncRuntime});
})(window);
