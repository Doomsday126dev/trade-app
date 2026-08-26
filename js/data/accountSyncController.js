(function(global){
  const root=global.PogoData=global.PogoData||{};
  const model=global.PogoDomain?.accountSyncModel,merge=global.PogoDomain?.accountSyncMerge;
  if(!model||!merge)throw new Error('Account sync model and merge engine must load before the controller');

  function createAccountSyncController({journal,repository,ownerUid,enabled=false,writesEnabled=false,allowlistedUids=[],online=()=>global.navigator?.onLine!==false,onState,onEntities,onProjection,projectionAllowed=()=>true,clock=()=>Date.now(),crypto=global.crypto}={}){
    const owner=model.firebaseKey(ownerUid,128),allowlist=new Set((allowlistedUids||[]).map(String));
    if(!journal||!repository||!owner||journal.ownerUid!==owner||repository.ownerUid!==owner)throw new TypeError('Account sync controller owner binding is invalid');
    const eligible=enabled===true&&writesEnabled===true&&allowlist.has(owner);
    let active=false,lifecycleEpoch=0,optimisticRevision=0,drainPromise=null,drainRequested=false,mutationPromise=Promise.resolve(),remoteAcceptPromise=Promise.resolve(),stateEmitPromise=Promise.resolve(),unsubscribe=null,retryTimer=null,lastError='',lastProjectionError='',lastSyncAt=0;
    const entities=new Map(),acceptedEntities=new Map();
    function key(type,id){return`${type}|${id}`;}
    function getEntity(type,id){return entities.get(key(type,id))||null;}
    function retryableFailure(value){return!/permission|forbidden|owner|schema|invalid|unauth/i.test(String(value?.code||value?.message||value||''));}
    function emit(){
      stateEmitPromise=stateEmitPromise.then(()=>snapshot()).then(state=>onState?.(state)).catch(()=>{});
      try{onEntities?.(Object.freeze([...entities.values()]));}catch{}
      return stateEmitPromise;
    }
    async function snapshot(){
      const journalState=await journal.snapshot(),state=!eligible?'local-only':lastError||journalState.blockedCount?'sync-error':journalState.conflictCount?'conflict':journalState.recoveryCandidateCount?'review-required':!online()?'offline':journalState.pendingCount?'pending-sync':'saved';
      return Object.freeze({state,eligible,active,online:online(),lastSyncAt,lastError,lastProjectionError,pendingCount:journalState.pendingCount,blockedCount:journalState.blockedCount,conflictCount:journalState.conflictCount,recoveryCandidateCount:journalState.recoveryCandidateCount,entityCount:entities.size,privateValuesExposed:false});
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
      lastError='';emit();
    }
    function serializeCanonical(task){
      const result=remoteAcceptPromise.then(task);
      remoteAcceptPromise=result.catch(()=>{});
      return result;
    }
    function acceptRemote(value,epoch=lifecycleEpoch){
      return serializeCanonical(()=>applyRemote(value,epoch));
    }
    function acceptCanonicalCurrent(entity,binding){return serializeCanonical(()=>acceptCanonicalCurrentInternal(entity,binding));}
    async function publishAcceptedProjection(operation){
      if(!active||!eligible||projectionAllowed()!==true||typeof onProjection!=='function')return Object.freeze({ok:true,status:'deferred'});
      try{
        const projection=await serializeCanonical(()=>model.publicTradeProjection([...acceptedEntities.values()]));
        await onProjection(projection,operation);lastProjectionError='';return Object.freeze({ok:true,status:'published',count:projection.length});
      }catch(error){lastProjectionError=String(error?.code||error?.message||'account-sync/public-projection-failed');emit();return model.failure('account-sync/public-projection-failed','Private sync succeeded, but the public list projection is pending');}
    }
    async function activate(){
      if(active)return Object.freeze({ok:true,status:eligible?'active':'disabled'});
      const epoch=++lifecycleEpoch;active=true;
      const localEntities=await journal.listEntities();
      if(!active||epoch!==lifecycleEpoch)return Object.freeze({ok:true,status:'inactive'});
      for(const entity of localEntities)entities.set(key(entity.entityType,entity.entityId),entity);
      await overlayPending();
      if(!active||epoch!==lifecycleEpoch)return Object.freeze({ok:true,status:'inactive'});
      emit();
      if(!eligible)return Object.freeze({ok:true,status:'disabled'});
      unsubscribe=repository.listenAccount({onData:value=>acceptRemote(value,epoch).catch(error=>{if(active&&epoch===lifecycleEpoch){lastError=String(error?.code||error?.message||'account-sync/listener-failed');emit();}}),onError:error=>{if(active&&epoch===lifecycleEpoch){lastError=String(error?.code||'account-sync/listener-failed');emit();}}});
      if(online())await drain();
      return Object.freeze({ok:true,status:active&&epoch===lifecycleEpoch?'active':'inactive'});
    }
    async function deactivate(){
      lifecycleEpoch++;active=false;drainRequested=false;try{unsubscribe?.();}catch{}unsubscribe=null;clearTimeout(retryTimer);retryTimer=null;
      await Promise.allSettled([mutationPromise,remoteAcceptPromise,drainPromise].filter(Boolean));
      await emit();
      return Object.freeze({ok:true,status:'inactive'});
    }
    function scheduleDrain(nextAttemptAt){
      clearTimeout(retryTimer);retryTimer=null;
      if(!active||!eligible||!online()||!Number.isFinite(nextAttemptAt))return;
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
      const working=new Map(entities),prepared=[];
      for(const mutation of mutations){
        const result=await prepareMutation(mutation,{working});
        if(!result.ok)return result;
        prepared.push(result);
      }
      const optimisticEntities=[...new Set(prepared.map(item=>item.entityKey))].map(entityKey=>working.get(entityKey));
      try{await journal.enqueueOperations(prepared.map(item=>item.operation),optimisticEntities);}
      catch(error){lastError=String(error?.code||'account-sync/journal-write-failed');emit();return model.failure('account-sync/journal-write-failed','This change could not be saved on this device');}
      optimisticRevision++;for(const item of prepared)entities.set(item.entityKey,item.value);
      lastError='';emit();
      if(online())drain();
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
    async function dispatch(record,epoch){
      try{
        const result=await repository.applyOperation(record.operation);
        if(result.ok){
          const accepted=await acceptCanonicalCurrent(result.value,record.operation);
          if(result.conflicts?.length)await journal.markConflict(record.operationId,result.conflicts);else await journal.acknowledge(record.operationId,accepted);
          await serializeCanonical(()=>rebuildOptimisticEntities());
          lastSyncAt=Number(clock());lastError='';
          if(active&&epoch===lifecycleEpoch&&record.operation.entityType==='tradeEntry')await publishAcceptedProjection(record.operation);
          return true;
        }
        if(result.status==='conflict'||result.conflicts?.length){
          if(!Object.hasOwn(result,'current'))throw Object.assign(new Error('Canonical conflict response is incomplete'),{code:'account-sync/conflict-current-invalid'});
          await acceptCanonicalCurrent(result.current,record.operation);
          await journal.markConflict(record.operationId,result.conflicts||[]);await serializeCanonical(()=>rebuildOptimisticEntities());lastError='';return true;
        }
        const retryable=retryableFailure(result.error),next=await journal.markAttempt(record.operationId,{retryable,errorCode:result.error?.code||'account-sync/rejected'});lastError=next.status==='blocked'?String(result.error?.code||'account-sync/rejected'):'';scheduleDrain(next.nextAttemptAt);return false;
      }catch(error){
        const next=await journal.markAttempt(record.operationId,{retryable:retryableFailure(error),errorCode:String(error?.code||'account-sync/network-failed')});lastError=next.status==='blocked'?String(error?.code||'account-sync/network-failed'):'';scheduleDrain(next.nextAttemptAt);return false;
      }finally{emit();}
    }
    async function drain(){
      if(!active||!eligible||!online())return;
      if(drainPromise){drainRequested=true;return drainPromise;}
      const epoch=lifecycleEpoch;
      drainPromise=(async()=>{
        do{
          drainRequested=false;
          for(;;){const record=await journal.nextOperation();if(!record||!online()||!active||epoch!==lifecycleEpoch)break;const progressed=await dispatch(record,epoch);if(!progressed)break;}
          const pending=await journal.listOperations({statuses:['pending','sending']});
          if(pending.length)scheduleDrain(Math.min(...pending.map(record=>record.nextAttemptAt)));
          else{clearTimeout(retryTimer);retryTimer=null;}
        }while(drainRequested&&active&&epoch===lifecycleEpoch&&eligible&&online());
      })();
      try{return await drainPromise;}
      finally{drainPromise=null;emit();}
    }
    async function retry(operationId){
      const blocked=(await journal.listOperations({statuses:['blocked']})).some(record=>record.operationId===operationId);
      if(!blocked)return model.failure('account-sync/retry-not-available','Only blocked sync changes can be retried');
      lastError='';await journal.retryBlocked(operationId);emit();return drain();
    }
    async function retryBlocked(){
      const blocked=await journal.listOperations({statuses:['blocked']});
      for(const record of blocked)await journal.retryBlocked(record.operationId);
      lastError='';emit();await drain();return Object.freeze({ok:true,retried:blocked.length});
    }
    async function conflictDetails(){
      const conflicts=await journal.listConflicts(),records=await journal.listOperations({statuses:['conflict']}),byOperation=new Map(records.map(record=>[record.operationId,record.operation]));
      return Object.freeze(conflicts.map(conflict=>{
        const operation=byOperation.get(conflict.operationId),current=getEntity(conflict.entityType,conflict.entityId);
        const fields=(conflict.fields||[]).filter(path=>operation&&Object.hasOwn(operation.patch||{},path)).map(path=>Object.freeze({path,deviceValue:operation.patch[path],accountValue:merge.getPath(current?.values||{},path)}));
        return Object.freeze({conflictId:conflict.conflictId,code:conflict.code,entityType:conflict.entityType,entityId:conflict.entityId,identity:current?.identity||null,fields:Object.freeze(fields)});
      }));
    }
    async function acceptConflict(conflictId){
      const resolved=await journal.resolveConflict(conflictId);if(!resolved)return model.failure('account-sync/conflict-missing','This sync conflict is no longer available');
      lastError='';emit();return Object.freeze({ok:true,status:'accepted-account-value'});
    }
    async function reapplyConflict(conflictId){
      const details=(await conflictDetails()).find(item=>item.conflictId===conflictId),records=await journal.listOperations({statuses:['conflict']}),record=records.find(item=>item.operationId===String(conflictId||'').replace(/^conflict_/,''));
      if(!details||!record||record.operation.kind!=='patch'||!details.fields.length)return model.failure('account-sync/conflict-not-reapplicable','This conflict must be reviewed without retrying its original operation');
      const patch=Object.fromEntries(details.fields.map(field=>[field.path,field.deviceValue])),result=await patchEntity({entityType:details.entityType,entityId:details.entityId,patch});
      if(!result.ok)return result;
      await journal.resolveConflict(conflictId);lastError='';emit();return Object.freeze({...result,status:'reapplied'});
    }
    function activeEntities(type){return[...entities.values()].filter(entity=>(!type||entity.entityType===type)&&entity.deleted!==true);}
    function publicProjection(){return model.publicTradeProjection([...acceptedEntities.values()]);}
    return Object.freeze({ownerUid:owner,eligible,activate,deactivate,snapshot,getEntity,activeEntities,publicProjection,publishAcceptedProjection,mutateBatch,addEntity,patchEntity,addMigrationEntity,patchMigrationEntity,deleteMigrationEntity,deleteEntity,drain,retry,retryBlocked,conflictDetails,acceptConflict,reapplyConflict,acceptRemote});
  }

  root.accountSyncController=Object.freeze({createAccountSyncController});
})(window);
