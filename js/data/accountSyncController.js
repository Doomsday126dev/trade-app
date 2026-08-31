(function(global){
  const root=global.PogoData=global.PogoData||{};
  const model=global.PogoDomain?.accountSyncModel,merge=global.PogoDomain?.accountSyncMerge;
  if(!model||!merge)throw new Error('Account sync model and merge engine must load before the controller');

  function createAccountSyncController({journal,repository,ownerUid,enabled=false,writesEnabled=false,allowlistedUids=[],online=()=>global.navigator?.onLine!==false,onState,onEntities,onProjection,projectionAllowed=()=>true,clock=()=>Date.now(),crypto=global.crypto}={}){
    const owner=model.firebaseKey(ownerUid,128),allowlist=new Set((allowlistedUids||[]).map(String));
    if(!journal||!repository||!owner||journal.ownerUid!==owner||repository.ownerUid!==owner)throw new TypeError('Account sync controller owner binding is invalid');
    const eligible=enabled===true&&writesEnabled===true&&allowlist.has(owner);
    let active=false,lifecycleEpoch=0,listenerAuthorityVersion=0,optimisticRevision=0,drainPromise=null,drainRequested=false,manualRetryPromise=null,mutationPromise=Promise.resolve(),repositoryMutationPromise=Promise.resolve(),remoteAcceptPromise=Promise.resolve(),drainQueue=Promise.resolve(),stateEmitPromise=Promise.resolve(),unsubscribe=null,retryTimer=null,lastError='',lastErrorCategory='',lastProjectionError='',lastSyncAt=0,listenerState='inactive';
    const listenerWaiters=new Set();
    const entities=new Map(),acceptedEntities=new Map();
    function key(type,id){return`${type}|${id}`;}
    function getEntity(type,id){return entities.get(key(type,id))||null;}
    function retryableFailure(value){return!/permission|forbidden|owner|schema|invalid|unauth/i.test(String(value?.code||value?.message||value||''));}
    function safeErrorCode(value,fallback){const code=String(value?.code||value||'');return/^account-sync\/[a-z0-9-]{1,80}$/.test(code)?code:fallback;}
    function setError(value,category,fallback){lastError=safeErrorCode(value,fallback);lastErrorCategory=category;}
    function clearError(...categories){if(!categories.length||categories.includes(lastErrorCategory)){lastError='';lastErrorCategory='';}}
    function settleListenerWaiters(result){
      for(const waiter of listenerWaiters){clearTimeout(waiter.timer);waiter.resolve(result);}
      listenerWaiters.clear();
    }
    function listenerFailure(code,message='The live account sync listener is not ready'){return model.failure(code,message);}
    function listenerAuthorityError(){return Object.assign(new Error('The live account sync listener authority changed'),{code:'account-sync/listener-authority-lost'});}
    function watchedWriteError(code,message){return Object.assign(new Error(message),{code});}
    function closeListenerAuthority(nextState){listenerAuthorityVersion++;listenerState=nextState;clearTimeout(retryTimer);retryTimer=null;return listenerAuthorityVersion;}
    function listenerAuthority(epoch=lifecycleEpoch){return active&&eligible&&online()&&epoch===lifecycleEpoch&&listenerState==='healthy'?Object.freeze({epoch,version:listenerAuthorityVersion}):null;}
    function listenerAuthorityCurrent(binding){return!!binding&&active&&eligible&&online()&&binding.epoch===lifecycleEpoch&&binding.version===listenerAuthorityVersion&&listenerState==='healthy';}
    function listenerLifecycleCurrent(binding){return!!binding&&active&&eligible&&binding.epoch===lifecycleEpoch;}
    function watchedWriteAuthorityError(binding){
      if(!listenerLifecycleCurrent(binding))return watchedWriteError('account-sync/session-changed','The account sync session changed during the watched write');
      if(lastErrorCategory==='canonical'||model.unsafeRecoveryCode(lastError))return watchedWriteError(lastError||'account-sync/canonical-validation-failed','Canonical account sync evidence became unsafe during the watched write');
      if(listenerState==='failed')return watchedWriteError(lastError||'account-sync/listener-failed','The live account sync listener failed during the watched write');
      return listenerAuthorityError();
    }
    function serializeRepositoryMutation(task){
      const result=repositoryMutationPromise.then(task);
      repositoryMutationPromise=result.then(()=>undefined,()=>undefined);
      return result;
    }
    function executeAuthorizedMutation(task,binding=listenerAuthority()){
      return serializeRepositoryMutation(async()=>{
        if(!listenerAuthorityCurrent(binding))return Object.freeze({started:false,current:false});
        try{const value=await task();return Object.freeze({started:true,current:listenerAuthorityCurrent(binding),value});}
        catch(error){return Object.freeze({started:true,current:listenerAuthorityCurrent(binding),error});}
      });
    }
    async function requireWatchedWriteListener(binding,timeoutMs){
      if(!listenerLifecycleCurrent(binding))throw watchedWriteAuthorityError(binding);
      if(listenerState!=='healthy'){
        const ready=await waitForListenerReady({timeoutMs});
        if(!ready?.ok)throw watchedWriteAuthorityError(binding);
      }
      if(!listenerLifecycleCurrent(binding)||!listenerAuthority(binding.epoch))throw watchedWriteAuthorityError(binding);
    }
    function runAuthorizedWatchedMutation({write,reconcile,timeoutMs=8000}={}){
      if(typeof write!=='function'||typeof reconcile!=='function')throw new TypeError('Watched mutation write and reconciliation callbacks are required');
      const binding=listenerAuthority();
      if(!binding)return Promise.reject(listenerAuthorityError());
      return serializeRepositoryMutation(async()=>{
        if(!listenerAuthorityCurrent(binding))throw watchedWriteAuthorityError(binding);
        let result,writeError;
        try{result=await write();}catch(error){writeError=error;}
        await requireWatchedWriteListener(binding,timeoutMs);
        let account;
        try{account=await repository.readAccount();}
        catch{throw watchedWriteError('account-sync/watched-write-unreconciled','The watched write could not be reconciled from canonical account data');}
        await requireWatchedWriteListener(binding,timeoutMs);
        await serializeCanonical(()=>acceptedSnapshot(account));
        const proof=await reconcile(Object.freeze({account,result,writeError}));
        if(!proof?.ok)throw watchedWriteError(proof?.error?.code||'account-sync/watched-write-unreconciled',proof?.error?.message||'The watched write could not be reconciled exactly');
        await requireWatchedWriteListener(binding,timeoutMs);
        return Object.freeze({ok:true,status:proof.status||result?.status||'reconciled',value:proof.value,writeErrorCode:safeErrorCode(writeError,'')});
      });
    }
    async function runAuthorizedMutation(task){
      if(typeof task!=='function')throw new TypeError('Authorized mutation callback is required');
      const binding=listenerAuthority(),execution=await executeAuthorizedMutation(task,binding);
      if(!execution.started||!execution.current)throw listenerAuthorityError();
      if(execution.error)throw execution.error;
      return execution.value;
    }
    function waitForListenerReady({timeoutMs=8000}={}){
      if(!eligible)return Promise.resolve(Object.freeze({ok:true,status:'disabled'}));
      if(!active)return Promise.resolve(listenerFailure('account-sync/session-inactive'));
      if(listenerState==='healthy')return Promise.resolve(Object.freeze({ok:true,status:'healthy'}));
      if(listenerState==='failed')return Promise.resolve(listenerFailure(lastError||'account-sync/listener-failed'));
      const bounded=Math.min(30000,Math.max(1,Number(timeoutMs)||8000)),epoch=lifecycleEpoch;
      return new Promise(resolve=>{
        const waiter={resolve,timer:null};
        waiter.timer=setTimeout(()=>{
          if(!listenerWaiters.delete(waiter))return;
          if(active&&epoch===lifecycleEpoch&&listenerState!=='healthy'){
            closeListenerAuthority('failed');setError('account-sync/listener-timeout','listener','account-sync/listener-timeout');emit();
          }
          resolve(listenerFailure('account-sync/listener-timeout'));
        },bounded);
        listenerWaiters.add(waiter);
      });
    }
    function emit(){
      stateEmitPromise=stateEmitPromise.then(()=>snapshot()).then(state=>onState?.(state)).catch(()=>{});
      try{onEntities?.(Object.freeze([...entities.values()]));}catch{}
      return stateEmitPromise;
    }
    async function snapshot(){
      const journalState=await journal.snapshot(),listenerHealthy=!eligible||active&&listenerState==='healthy',effectiveError=lastError||journalState.blockedErrorCode||'';
      const recoverableBlockedCount=Number(journalState.recoverableBlockedCount)||0,unsafeBlockedCount=Number(journalState.unsafeBlockedCount)||0;
      const unsafeCurrent=lastErrorCategory==='canonical'||model.unsafeRecoveryCode(lastError),unsafeEvidence=unsafeCurrent||unsafeBlockedCount>0;
      const state=!eligible?'local-only':unsafeEvidence?'sync-error':journalState.conflictCount?'conflict':journalState.recoveryCandidateCount?'review-required':journalState.blockedCount?'sync-error':!online()?'offline':journalState.pendingCount||['starting','listening'].includes(listenerState)?'pending-sync':effectiveError||listenerState==='failed'?'sync-error':!active?'inactive':'saved';
      const effectiveCategory=unsafeEvidence?'unsafe-evidence':lastErrorCategory||(journalState.blockedCount?'blocked-operation':'');
      return Object.freeze({state,eligible,active,online:online(),listenerState,listenerHealthy,controllerHealthy:active&&listenerHealthy&&!lastError&&!unsafeBlockedCount,lastSyncAt,lastError:effectiveError,lastErrorCategory:effectiveCategory,lastProjectionError,pendingCount:journalState.pendingCount,blockedCount:journalState.blockedCount,recoverableBlockedCount,unsafeBlockedCount,blockedCategories:Object.freeze([...(journalState.blockedCategories||[])]),conflictCount:journalState.conflictCount,recoveryCandidateCount:journalState.recoveryCandidateCount,entityCount:entities.size,privateValuesExposed:false});
    }
    function accountEntities(value){
      const allowedCollections=new Set(['meta','tradeEntries','favorites','tags','migrations','recoveryCandidates']);
      if(value!=null&&!model.plainObject(value))throw Object.assign(new Error('Canonical account sync data is invalid'),{code:'account-sync/remote-entity-invalid'});
      if(Object.keys(value||{}).some(collectionName=>!allowedCollections.has(collectionName)))throw Object.assign(new Error('Canonical account sync data is invalid'),{code:'account-sync/remote-entity-invalid'});
      const out=[];
      for(const [entityType,collectionName] of [['tradeEntry','tradeEntries'],['favorite','favorites'],['tag','tags']]){
        const collection=value?.[collectionName];
        if(collection!=null&&!model.plainObject(collection))throw Object.assign(new Error('Canonical account sync data is invalid'),{code:'account-sync/remote-entity-invalid'});
        for(const [entityId,entity] of Object.entries(collection||{})){
          const valid=merge.validateEntity(entity,{ownerUid:owner,entityType,entityId});
          if(!valid.ok)throw Object.assign(new Error('Canonical account sync data is invalid'),{code:'account-sync/remote-entity-invalid'});
          out.push(entity);
        }
      }
      return out;
    }
    function monotonicEntity(prior,incoming){
      if(!prior)return incoming;
      const priorGeneration=prior.generation,incomingGeneration=incoming.generation,priorRevision=prior.revision,incomingRevision=incoming.revision;
      if(incomingGeneration===priorGeneration&&incomingRevision===priorRevision){
        if(model.canonicalJson(incoming)!==model.canonicalJson(prior))throw Object.assign(new Error('Canonical account sync version was substituted'),{code:'account-sync/remote-version-substitution'});
        return prior;
      }
      if(incomingGeneration<=priorGeneration&&incomingRevision<=priorRevision)return prior;
      if(incomingGeneration<priorGeneration||incomingRevision<=priorRevision)throw Object.assign(new Error('Canonical account sync revision is inconsistent'),{code:'account-sync/remote-revision-invalid'});
      if(incomingRevision===priorRevision+1){
        const transition=merge.validateTransition(prior,incoming);
        if(!transition.ok)throw Object.assign(new Error('Canonical account sync transition is invalid'),{code:transition.error.code});
      }
      return incoming;
    }
    function acceptedSnapshot(value){
      const next=new Map();
      for(const entity of accountEntities(value)){
        const entityKey=key(entity.entityType,entity.entityId);
        next.set(entityKey,monotonicEntity(acceptedEntities.get(entityKey)||null,entity));
      }
      for(const entityKey of acceptedEntities.keys())if(!next.has(entityKey))throw Object.assign(new Error('Canonical account sync entity disappeared'),{code:'account-sync/remote-entity-missing'});
      return next;
    }
    async function acceptCanonicalCurrentInternal(entity,{entityType,entityId}){
      const entityKey=key(entityType,entityId),prior=acceptedEntities.get(entityKey)||null;
      if(entity==null){
        if(prior)throw Object.assign(new Error('Canonical account sync entity disappeared'),{code:'account-sync/remote-entity-missing'});
        acceptedEntities.delete(entityKey);entities.delete(entityKey);await journal.deleteEntity(entityType,entityId);return null;
      }
      const valid=merge.validateEntity(entity,{ownerUid:owner,entityType,entityId});
      if(!valid.ok)throw Object.assign(new Error('Canonical account sync data is invalid'),{code:'account-sync/remote-entity-invalid'});
      const accepted=monotonicEntity(prior,entity);
      await journal.putEntity(accepted);acceptedEntities.set(entityKey,accepted);return accepted;
    }
    async function overlayPending(target=entities){
      const pending=await journal.listOperations({statuses:['pending','sending','blocked','conflict']});
      for(const record of pending){
        const operation=record.operation,entityKey=key(operation.entityType,operation.entityId),current=target.get(entityKey)||null,result=merge.mergeOperation(current,operation,{acceptedAt:operation.clientAt});
        if(result.ok)target.set(entityKey,result.value);
      }
    }
    async function rebuildOptimisticEntities(){
      for(;;){
        const observedRevision=optimisticRevision,nextEntities=new Map(acceptedEntities);
        await overlayPending(nextEntities);
        if(observedRevision!==optimisticRevision)continue;
        entities.clear();for(const [entityKey,entity] of nextEntities)entities.set(entityKey,entity);
        return;
      }
    }
    async function applyRemote(value,epoch){
      if(!active||epoch!==lifecycleEpoch)return;
      const accepted=acceptedSnapshot(value);
      for(const entity of accepted.values()){
        await journal.putEntity(entity);
        if(!active||epoch!==lifecycleEpoch)return;
      }
      if(!active||epoch!==lifecycleEpoch)return;
      acceptedEntities.clear();for(const [entityKey,entity] of accepted)acceptedEntities.set(entityKey,entity);
      await rebuildOptimisticEntities();
      clearError('listener','canonical');emit();
    }
    function serializeCanonical(task){
      const result=remoteAcceptPromise.then(task);
      remoteAcceptPromise=result.catch(()=>{});
      return result;
    }
    function acceptRemote(value,epoch=lifecycleEpoch){
      return serializeCanonical(()=>applyRemote(value,epoch));
    }
    async function acceptCanonicalResult(entity,operation,authority){
      return serializeCanonical(async()=>{
        if(listenerAuthorityCurrent(authority)){
          const accepted=await acceptCanonicalCurrentInternal(entity,operation);
          if(!listenerAuthorityCurrent(authority))throw listenerAuthorityError();
          return Object.freeze({accepted,authority});
        }
        const observed=acceptedEntities.get(key(operation.entityType,operation.entityId))||null;
        if(!active||model.canonicalJson(observed)!==model.canonicalJson(entity))throw listenerAuthorityError();
        const nextAuthority=listenerAuthority();
        if(!nextAuthority)throw listenerAuthorityError();
        return Object.freeze({accepted:observed,authority:nextAuthority});
      });
    }
    async function publishAcceptedProjection(operation,authority=listenerAuthority()){
      if(!active||!eligible||projectionAllowed()!==true||typeof onProjection!=='function')return Object.freeze({ok:true,status:'deferred'});
      try{
        const projection=await serializeCanonical(()=>{if(!listenerAuthorityCurrent(authority))throw listenerAuthorityError();return model.publicTradeProjection([...acceptedEntities.values()]);});
        const execution=await executeAuthorizedMutation(()=>onProjection(projection,operation),authority);
        if(!execution.started||!execution.current)throw listenerAuthorityError();
        if(execution.error)throw execution.error;
        lastProjectionError='';return Object.freeze({ok:true,status:'published',count:projection.length});
      }catch(error){lastProjectionError=String(error?.code||error?.message||'account-sync/public-projection-failed');emit();return model.failure('account-sync/public-projection-failed','Private sync succeeded, but the public list projection is pending');}
    }
    function handleListenerData(value,epoch){
      if(!active||epoch!==lifecycleEpoch)return;
      const version=closeListenerAuthority('listening');
      serializeCanonical(async()=>{
        await applyRemote(value,epoch);
        if(!active||epoch!==lifecycleEpoch||version!==listenerAuthorityVersion)return false;
        listenerState='healthy';clearError('listener','canonical');return true;
      }).then(accepted=>{
        if(!accepted||!active||epoch!==lifecycleEpoch||version!==listenerAuthorityVersion||listenerState!=='healthy')return;
        settleListenerWaiters(Object.freeze({ok:true,status:'healthy'}));emit();if(online())drain();
      }).catch(error=>{
        if(!active||epoch!==lifecycleEpoch||version!==listenerAuthorityVersion)return;
        closeListenerAuthority('failed');setError(error,'canonical','account-sync/canonical-validation-failed');settleListenerWaiters(listenerFailure(lastError));emit();
      });
    }
    async function activate(){
      if(active)return Object.freeze({ok:true,status:eligible?'active':'disabled'});
      const epoch=++lifecycleEpoch;active=true;if(eligible)closeListenerAuthority('starting');
      const localEntities=await journal.listEntities();
      if(!active||epoch!==lifecycleEpoch)return Object.freeze({ok:true,status:'inactive'});
      for(const entity of localEntities)entities.set(key(entity.entityType,entity.entityId),entity);
      await overlayPending();
      if(!active||epoch!==lifecycleEpoch)return Object.freeze({ok:true,status:'inactive'});
      emit();
      if(!eligible)return Object.freeze({ok:true,status:'disabled'});
      let subscription;
      try{subscription=repository.listenAccount({
        onData:value=>handleListenerData(value,epoch),
        onError:()=>{if(active&&epoch===lifecycleEpoch){closeListenerAuthority('failed');setError('account-sync/listener-failed','listener','account-sync/listener-failed');settleListenerWaiters(listenerFailure(lastError));emit();}}
      });}catch(error){
        closeListenerAuthority('failed');setError(error,'listener','account-sync/listener-failed');settleListenerWaiters(listenerFailure(lastError));emit();throw Object.assign(new Error('Account sync listener failed to attach'),{code:lastError});
      }
      unsubscribe=typeof subscription==='function'?subscription:null;if(listenerState==='starting')listenerState='listening';
      return Object.freeze({ok:true,status:active&&epoch===lifecycleEpoch?'active':'inactive'});
    }
    async function deactivate(){
      lifecycleEpoch++;active=false;closeListenerAuthority('inactive');settleListenerWaiters(listenerFailure('account-sync/session-inactive'));try{unsubscribe?.();}catch{}unsubscribe=null;
      await Promise.allSettled([mutationPromise,repositoryMutationPromise,remoteAcceptPromise,drainPromise,manualRetryPromise].filter(Boolean));
      await emit();
      return Object.freeze({ok:true,status:'inactive'});
    }
    function scheduleDrain(nextAttemptAt){
      clearTimeout(retryTimer);retryTimer=null;
      if(!active||!eligible||!online()||listenerState!=='healthy'||!Number.isFinite(nextAttemptAt))return;
      retryTimer=setTimeout(()=>{retryTimer=null;drain();},Math.max(0,nextAttemptAt-Number(clock())));
    }
    async function prepareMutation({entityType,entityId,identity,kind,patch={},migration=false},{working}){
      const entityKey=key(entityType,entityId),current=working.get(entityKey)||null,paths=Object.keys(patch),base=merge.operationBase(current,paths);
      let baseGeneration=base.baseGeneration,generation=base.generation;
      if(kind==='add'||kind==='delete')generation=baseGeneration+1;
      const operationId=migration===true?`op_${await model.sha256Hex(model.canonicalJson([
        model.SCHEMA_VERSION,'pogo-account-sync-migration-operation',owner,entityType,entityId,kind,
        kind==='add'?identity:null,baseGeneration,generation,base.baseFieldRevisions,patch
      ]),crypto)}`:undefined;
      const operation=await model.createOperation({ownerUid:owner,entityType,entityId,identity,kind,patch,baseGeneration,generation,baseFieldRevisions:base.baseFieldRevisions,clientAt:migration===true?0:Number(clock()),operationId},{crypto});
      if(!operation.ok)return operation;
      const optimistic=merge.mergeOperation(current,operation.value,{acceptedAt:operation.value.clientAt});
      if(!optimistic.ok)return optimistic;
      working.set(entityKey,optimistic.value);
      return Object.freeze({ok:true,operation:operation.value,value:optimistic.value,entityKey});
    }
    async function performMutationBatch(mutations){
      if(!eligible)return model.failure('account-sync/disabled','Cross-device sync is not enabled for this account');
      if(!active)return model.failure('account-sync/session-inactive','Cross-device sync session is not active');
      if(!Array.isArray(mutations)||!mutations.length)return Object.freeze({ok:true,status:'unchanged',count:0,operations:Object.freeze([]),values:Object.freeze([])});
      if(listenerState!=='healthy')return model.failure('account-sync/listener-not-ready','The live account sync listener is not ready');
      const working=new Map(entities),prepared=[];
      for(const mutation of mutations){
        const result=await prepareMutation(mutation,{working});
        if(!result.ok)return result;
        prepared.push(result);
      }
      const optimisticEntities=[...new Set(prepared.map(item=>item.entityKey))].map(entityKey=>working.get(entityKey));
      try{await journal.enqueueOperations(prepared.map(item=>item.operation),optimisticEntities);}
      catch(error){setError(error,'journal','account-sync/journal-write-failed');emit();return model.failure('account-sync/journal-write-failed','This change could not be saved on this device');}
      optimisticRevision++;for(const item of prepared)entities.set(item.entityKey,item.value);
      clearError('journal','blocked-operation');emit();
      if(online()&&listenerState==='healthy')drain();
      return Object.freeze({ok:true,status:'queued',count:prepared.length,operations:Object.freeze(prepared.map(item=>item.operation)),values:Object.freeze(prepared.map(item=>item.value))});
    }
    function mutateBatch(mutations){
      const result=mutationPromise.then(()=>performMutationBatch(mutations));
      mutationPromise=result.then(()=>undefined,()=>undefined);
      return result;
    }
    async function buildMutation(mutation){
      const result=await mutateBatch([mutation]);
      if(!result.ok)return result;
      return Object.freeze({...result,operation:result.operations[0],value:result.values[0]});
    }
    function addEntity({entityType,entityId,identity,values}){return buildMutation({entityType,entityId,identity,kind:'add',patch:values});}
    function patchEntity({entityType,entityId,patch}){return buildMutation({entityType,entityId,kind:'patch',patch});}
    function addMigrationEntity({entityType,entityId,identity,values}){return buildMutation({entityType,entityId,identity,kind:'add',patch:values,migration:true});}
    function patchMigrationEntity({entityType,entityId,patch}){return buildMutation({entityType,entityId,kind:'patch',patch,migration:true});}
    function deleteMigrationEntity({entityType,entityId}){return buildMutation({entityType,entityId,kind:'delete',migration:true});}
    function deleteEntity({entityType,entityId}){return buildMutation({entityType,entityId,kind:'delete'});}
    function dispatchResult({ok=false,called=false,progressed=false,errorCode=''}={}){return Object.freeze({ok,called,progressed,errorCode});}
    async function recordDispatchFailure(record,error,{manual=false}={}){
      const code=safeErrorCode(error,'account-sync/network-failed');
      if(manual){
        const retained=await journal.retainBlocked(record.operationId,{errorCode:code});
        if(retained)lastErrorCategory='blocked-operation';
        return dispatchResult({called:true,errorCode:code});
      }
      const next=await journal.markAttempt(record.operationId,{retryable:retryableFailure(error),errorCode:code});
      if(next.status==='blocked')lastErrorCategory='blocked-operation';
      scheduleDrain(next.nextAttemptAt);return dispatchResult({called:true,errorCode:code});
    }
    async function dispatch(record,epoch,{manual=false}={}){
      const authority=listenerAuthority(epoch);
      try{
        const execution=await executeAuthorizedMutation(()=>repository.applyOperation(record.operation),authority);
        if(!execution.started)return dispatchResult({errorCode:'account-sync/listener-not-ready'});
        if(execution.error){
          if(!execution.current)return dispatchResult({called:true,errorCode:'account-sync/listener-authority-lost'});
          return recordDispatchFailure(record,execution.error,{manual});
        }
        const result=execution.value;
        if(result.ok){
          const canonical=await acceptCanonicalResult(result.value,record.operation,authority);
          if(!listenerAuthorityCurrent(canonical.authority))return dispatchResult({called:true,errorCode:'account-sync/listener-authority-lost'});
          if(result.conflicts?.length)await journal.markConflict(record.operationId,result.conflicts);else await journal.acknowledge(record.operationId,canonical.accepted);
          if(!listenerAuthorityCurrent(canonical.authority))return dispatchResult({called:true,errorCode:'account-sync/listener-authority-lost'});
          await serializeCanonical(()=>{if(!listenerAuthorityCurrent(canonical.authority))throw listenerAuthorityError();return rebuildOptimisticEntities();});
          lastSyncAt=Number(clock());clearError('blocked-operation');
          if(active&&epoch===lifecycleEpoch&&record.operation.entityType==='tradeEntry')await publishAcceptedProjection(record.operation,canonical.authority);
          return dispatchResult({ok:true,called:true,progressed:true});
        }
        if(result.status==='conflict'||result.conflicts?.length){
          if(!Object.hasOwn(result,'current'))throw Object.assign(new Error('Canonical conflict response is incomplete'),{code:'account-sync/conflict-current-invalid'});
          const canonical=await acceptCanonicalResult(result.current,record.operation,authority);
          if(!listenerAuthorityCurrent(canonical.authority))return dispatchResult({called:true,errorCode:'account-sync/listener-authority-lost'});
          await journal.markConflict(record.operationId,result.conflicts||[]);
          await serializeCanonical(()=>{if(!listenerAuthorityCurrent(canonical.authority))throw listenerAuthorityError();return rebuildOptimisticEntities();});
          clearError('blocked-operation');return dispatchResult({ok:true,called:true,progressed:true});
        }
        if(!execution.current)return dispatchResult({called:true,errorCode:'account-sync/listener-authority-lost'});
        return recordDispatchFailure(record,result.error||'account-sync/rejected',{manual});
      }catch(error){
        if(error?.code==='account-sync/listener-authority-lost')return dispatchResult({called:true,errorCode:error.code});
        return recordDispatchFailure(record,error,{manual});
      }finally{emit();}
    }
    function drain(){
      if(drainPromise){drainRequested=true;return drainPromise;}
      if(!active||!eligible||!online()||listenerState!=='healthy')return Promise.resolve();
      const epoch=lifecycleEpoch;
      const current=drainQueue.then(async()=>{
        if(!active||!eligible||!online()||epoch!==lifecycleEpoch||listenerState!=='healthy')return;
        do{
          drainRequested=false;
          for(;;){const record=await journal.nextOperation();if(!record||!online()||!active||epoch!==lifecycleEpoch||listenerState!=='healthy')break;const result=await dispatch(record,epoch);if(!result.progressed)break;}
        }while(drainRequested&&active&&eligible&&online()&&epoch===lifecycleEpoch&&listenerState==='healthy');
        const pending=await journal.listOperations({statuses:['pending','sending']});
        if(pending.length&&listenerState==='healthy')scheduleDrain(Math.min(...pending.map(record=>record.nextAttemptAt)));
        else{clearTimeout(retryTimer);retryTimer=null;}
      });
      drainQueue=current.catch(()=>{});drainPromise=current;
      return current.finally(()=>{if(drainPromise===current)drainPromise=null;emit();});
    }
    function retryFailure(code,message,retried=0){return Object.freeze({...model.failure(code,message),retried});}
    function serializeManualRetry(task){
      if(manualRetryPromise)return manualRetryPromise;
      manualRetryPromise=(async()=>{if(drainPromise)await drainPromise;return task();})();
      const result=manualRetryPromise;result.finally(()=>{if(manualRetryPromise===result)manualRetryPromise=null;}).catch(()=>{});return result;
    }
    async function performManualRetry(records){
      if(listenerState!=='healthy')return retryFailure('account-sync/listener-not-ready','The live account sync listener is not ready');
      let retried=0,firstError='';
      for(const requested of records){
        const record=(await journal.listOperations({statuses:['blocked']})).find(item=>item.operationId===requested.operationId);
        if(!record||!model.blockedRetryEligible(record))continue;
        const result=await dispatch(record,lifecycleEpoch,{manual:true});if(result.called)retried++;
        if(!result.ok){firstError=firstError||result.errorCode||'account-sync/network-failed';if(listenerState!=='healthy')break;}
      }
      if(firstError)return retryFailure(firstError,'One or more retained sync changes remain safely retained',retried);
      if(!retried)return retryFailure('account-sync/retry-not-available','This retained sync change is no longer available');
      clearError('blocked-operation');emit();return Object.freeze({ok:true,retried});
    }
    function retry(operationId){return serializeManualRetry(async()=>{
      const record=(await journal.listOperations({statuses:['blocked']})).find(item=>item.operationId===operationId);
      if(!record)return retryFailure('account-sync/retry-not-available','Only blocked sync changes can be retried');
      if(!model.blockedRetryEligible(record))return retryFailure('account-sync/retry-unsafe','This retained sync change requires review');
      return performManualRetry([record]);
    });}
    function retryBlocked(){return serializeManualRetry(async()=>{
      const blocked=await journal.listOperations({statuses:['blocked']});
      if(!blocked.length)return retryFailure('account-sync/retry-empty','No retained sync change is available to retry');
      const recoverable=blocked.filter(model.blockedRetryEligible),unsafe=blocked.filter(record=>!model.blockedRetryEligible(record));
      if(unsafe.length)return retryFailure('account-sync/retry-unsafe','One or more retained sync changes require review');
      if(!recoverable.length)return retryFailure('account-sync/retry-empty','No retained sync change is available to retry');
      return performManualRetry(recoverable);
    });}
    async function conflictDetails(){
      const conflicts=await journal.listConflicts(),records=await journal.listOperations({statuses:['conflict']}),byOperation=new Map(records.map(record=>[record.operationId,record.operation]));
      return Object.freeze(conflicts.map(conflict=>{
        const operation=byOperation.get(conflict.operationId),current=getEntity(conflict.entityType,conflict.entityId);
        const fields=(conflict.fields||[]).filter(path=>operation&&Object.hasOwn(operation.patch||{},path)).map(path=>Object.freeze({path,deviceValue:operation.patch[path],accountValue:merge.getPath(current?.values||{},path)}));
        return Object.freeze({conflictId:conflict.conflictId,code:conflict.code,entityType:conflict.entityType,entityId:conflict.entityId,identity:current?.identity||null,fields:Object.freeze(fields)});
      }));
    }
    async function acceptConflict(conflictId){
      const authority=await snapshot();if(!authority.listenerHealthy||!authority.controllerHealthy||authority.lastErrorCategory==='unsafe-evidence')return model.failure('account-sync/conflict-baseline-unhealthy','Conflict resolution requires a healthy canonical account snapshot');
      const resolved=await journal.resolveConflict(conflictId);if(!resolved)return model.failure('account-sync/conflict-missing','This sync conflict is no longer available');
      clearError('blocked-operation');await emit();return Object.freeze({ok:true,status:'accepted-account-value'});
    }
    async function reapplyConflict(conflictId){
      const authority=await snapshot();if(!authority.listenerHealthy||!authority.controllerHealthy||authority.lastErrorCategory==='unsafe-evidence')return model.failure('account-sync/conflict-baseline-unhealthy','Conflict resolution requires a healthy canonical account snapshot');
      const details=(await conflictDetails()).find(item=>item.conflictId===conflictId),records=await journal.listOperations({statuses:['conflict']}),record=records.find(item=>item.operationId===String(conflictId||'').replace(/^conflict_/,''));
      if(!details||!record||record.operation.kind!=='patch'||!details.fields.length)return model.failure('account-sync/conflict-not-reapplicable','This conflict must be reviewed without retrying its original operation');
      const patch=Object.fromEntries(details.fields.map(field=>[field.path,field.deviceValue])),result=await patchEntity({entityType:details.entityType,entityId:details.entityId,patch});
      if(!result.ok)return result;
      await journal.resolveConflict(conflictId);clearError('blocked-operation');await emit();return Object.freeze({...result,status:'reapplied'});
    }
    function activeEntities(type){return[...entities.values()].filter(entity=>(!type||entity.entityType===type)&&entity.deleted!==true);}
    function publicProjection(){return model.publicTradeProjection([...acceptedEntities.values()]);}
    return Object.freeze({ownerUid:owner,eligible,activate,deactivate,waitForListenerReady,snapshot,getEntity,activeEntities,publicProjection,publishAcceptedProjection,runAuthorizedMutation,runAuthorizedWatchedMutation,mutateBatch,addEntity,patchEntity,addMigrationEntity,patchMigrationEntity,deleteMigrationEntity,deleteEntity,drain,retry,retryBlocked,conflictDetails,acceptConflict,reapplyConflict,acceptRemote});
  }

  root.accountSyncController=Object.freeze({createAccountSyncController});
})(window);
