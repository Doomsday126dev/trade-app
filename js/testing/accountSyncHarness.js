(function(global){
  const root=global.PogoTesting=global.PogoTesting||{};
  const model=global.PogoDomain?.accountSyncModel,merge=global.PogoDomain?.accountSyncMerge,controllerApi=global.PogoData?.accountSyncController;
  if(!model||!merge||!controllerApi)throw new Error('Account sync runtime must load before its test harness');

  function createMemoryJournalState(){return{entities:new Map(),operations:new Map(),conflicts:new Map(),meta:new Map(),recoveryCandidates:new Map()};}
  function createMemoryJournal(ownerUid,state=createMemoryJournalState(),clock=()=>Date.now()){
    const owner=ownerUid;
    const own=record=>{if(record?.ownerUid!==owner)throw Object.assign(new Error('owner mismatch'),{code:'account-sync/owner-mismatch'});};
    async function enqueueOperations(operations,optimisticEntities=[]){
      for(const operation of operations)own(operation);
      for(const entity of optimisticEntities)own(entity);
      const seen=new Set(),existing=[];
      for(const operation of operations){
        if(seen.has(operation.operationId))throw Object.assign(new Error('idempotency conflict'),{code:'account-sync/idempotency-conflict'});
        seen.add(operation.operationId);
        const prior=state.operations.get(operation.operationId);
        if(prior&&prior.operation.inputHash!==operation.inputHash)throw Object.assign(new Error('idempotency conflict'),{code:'account-sync/idempotency-conflict'});
        existing.push(prior||null);
      }
      const results=[];
      operations.forEach((operation,index)=>{
        if(existing[index]){results.push({ok:true,status:'idempotent',record:existing[index]});return;}
        const record={ownerUid:owner,operationId:operation.operationId,operation,status:'pending',attempts:0,nextAttemptAt:0,lastErrorCode:'',createdAt:clock(),updatedAt:clock()};
        state.operations.set(operation.operationId,record);results.push({ok:true,status:'queued',record});
      });
      for(const entity of optimisticEntities)state.entities.set(`${entity.entityType}|${entity.entityId}`,entity);
      return results;
    }
    async function enqueueOperation(operation){return(await enqueueOperations([operation]))[0];}
    return Object.freeze({
      ownerUid:owner,
      enqueueOperation,enqueueOperations,
      async listOperations({statuses=['pending','sending','blocked','conflict']}={}){return[...state.operations.values()].filter(record=>statuses.includes(record.status)).sort((a,b)=>a.createdAt-b.createdAt||a.operationId.localeCompare(b.operationId));},
      async nextOperation({includeBlocked=false}={}){return[...state.operations.values()].filter(record=>['pending','sending',...(includeBlocked?['blocked']:[])].includes(record.status)&&record.nextAttemptAt<=clock()).sort((a,b)=>a.createdAt-b.createdAt||a.operationId.localeCompare(b.operationId))[0]||null;},
      async markAttempt(id,{errorCode='',retryable=true}={}){const record=state.operations.get(id);record.attempts++;record.status=retryable?'pending':'blocked';record.lastErrorCode=errorCode;record.nextAttemptAt=clock()+model.retryDelay(record.attempts-1);return record;},
      async retainBlocked(id,{errorCode='account-sync/network-failed'}={}){const record=state.operations.get(id);if(!record||record.status!=='blocked')return null;record.attempts++;record.lastErrorCode=errorCode;record.nextAttemptAt=clock();record.updatedAt=clock();return record;},
      async acknowledge(id,entity){const record=state.operations.get(id);record.status='acknowledged';record.serverRevision=entity?.revision||0;return record;},
      async markConflict(id,conflicts){const record=state.operations.get(id);record.status='conflict';for(const item of conflicts){own(item);state.conflicts.set(item.conflictId,item);}return record;},
      async retryBlocked(id){const record=state.operations.get(id);if(!record||!model.blockedRetryEligible(record))return false;record.status='pending';record.attempts=0;record.nextAttemptAt=0;record.lastErrorCode='';return true;},
      async putEntity(entity){own(entity);state.entities.set(`${entity.entityType}|${entity.entityId}`,entity);return entity;},
      async deleteEntity(type,id){state.entities.delete(`${type}|${id}`);},
      async getEntity(type,id){return state.entities.get(`${type}|${id}`)||null;},
      async listEntities(){return[...state.entities.values()];},
      async listConflicts(){return[...state.conflicts.values()].filter(item=>!item.resolved);},
      async resolveConflict(id){const item=state.conflicts.get(id);if(!item)return false;state.conflicts.set(id,{...item,resolved:true,resolvedAt:clock()});const record=state.operations.get(item.operationId);if(record?.status==='conflict')state.operations.set(item.operationId,{...record,status:'resolved',nextAttemptAt:0,lastErrorCode:'',updatedAt:clock()});return true;},
      async setMeta(key,value){state.meta.set(key,value);},async getMeta(key){return state.meta.get(key)??null;},async removeMeta(key){state.meta.delete(key);},
      async putRecoveryCandidate(item){own(item);state.recoveryCandidates.set(item.candidateId,item);},
      async listRecoveryCandidates({unresolvedOnly=true}={}){return[...state.recoveryCandidates.values()].filter(item=>!unresolvedOnly||item.resolved!==true).sort((a,b)=>a.createdAt-b.createdAt||a.candidateId.localeCompare(b.candidateId));},
      async resolveRecoveryCandidate(id){const item=state.recoveryCandidates.get(id);if(!item||item.resolved===true)return false;state.recoveryCandidates.set(id,{...item,resolved:true,resolvedAt:clock()});return true;},
      async resolveRecoveryCandidates(ids){
        if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)throw new TypeError('invalid recovery candidate review');
        const expected=[...ids].sort(),unresolved=[...state.recoveryCandidates.values()].filter(item=>item.resolved!==true),actual=unresolved.map(item=>item.candidateId).sort();
        if(actual.length!==expected.length||actual.some((id,index)=>id!==expected[index]))throw Object.assign(new Error('recovery candidate set changed'),{code:'account-sync/recovery-review-changed'});
        const resolvedAt=clock();for(const item of unresolved)state.recoveryCandidates.set(item.candidateId,{...item,resolved:true,resolvedAt});return unresolved.length;
      },
      async snapshot(){
        const blocked=[...state.operations.values()].filter(item=>item.status==='blocked'),codes=[...new Set(blocked.map(item=>String(item.lastErrorCode||'')).filter(code=>/^account-sync\/[a-z0-9-]{1,80}$/.test(code)))];
        const recoverableBlocked=blocked.filter(model.blockedRetryEligible),blockedCategories=[...new Set(blocked.map(item=>model.blockedRetryCategory(item.lastErrorCode)))].sort();
        return{ownerUid:owner,pendingCount:[...state.operations.values()].filter(item=>['pending','sending'].includes(item.status)).length,blockedCount:blocked.length,recoverableBlockedCount:recoverableBlocked.length,unsafeBlockedCount:blocked.length-recoverableBlocked.length,blockedCategories,blockedErrorCode:blocked.length?(codes.length===1?codes[0]:'account-sync/blocked-operation'):'',conflictCount:[...state.conflicts.values()].filter(item=>!item.resolved).length,entityCount:state.entities.size,recoveryCandidateCount:[...state.recoveryCandidates.values()].filter(item=>item.resolved!==true).length};
      }
    });
  }
  function createDeterministicServer({ownerUid,clock=(()=>{let value=1000;return()=>++value;})()}={}){
    const entities=new Map(),listeners=new Set(),attempts=[],responseLoss=new Set();let failNext=null;
    const accountSnapshot=()=>{
      const value={tradeEntries:{},favorites:{},tags:{}};
      for(const entity of entities.values())value[{tradeEntry:'tradeEntries',favorite:'favorites',tag:'tags'}[entity.entityType]][entity.entityId]=entity;
      return value;
    };
    function publish(){const value=accountSnapshot();for(const listener of listeners)listener(value);}
    const repository={
      ownerUid,
      listenAccount({onData}){listeners.add(onData);queueMicrotask(()=>onData(accountSnapshot()));return()=>listeners.delete(onData);},
      async applyOperation(operation){
        attempts.push(operation.operationId);if(failNext){const error=failNext;failNext=null;throw error;}
        const key=`${operation.entityType}|${operation.entityId}`,current=entities.get(key)||null,result=merge.mergeOperation(current,operation,{acceptedAt:clock()});
        if(!result.ok)return{ok:false,status:'conflict',error:result.error,conflicts:result.conflicts,current};
        entities.set(key,result.value);publish();
        if(responseLoss.delete(operation.operationId))throw Object.assign(new Error('response lost'),{code:'network/response-lost'});
        return{ok:true,status:result.status,value:result.value,conflicts:result.conflicts};
      },
      loseResponseOnce(operationId){responseLoss.add(operationId);},
      failNext(error=Object.assign(new Error('offline'),{code:'network/offline'})){failNext=error;},
      snapshot:accountSnapshot,attempts,entities
    };
    return repository;
  }
  function createMultiDeviceHarness({ownerUid='uid-owner',crypto=global.crypto}={}){
    let time=10_000;const clock=()=>++time,server=createDeterministicServer({ownerUid,clock});const devices=new Map();
    function createDevice(name,{state=createMemoryJournalState(),online=true}={}){
      const runtime={online,authenticated:true,states:[],projections:[],state};
      const journal=createMemoryJournal(ownerUid,state,clock);
      const controller=controllerApi.createAccountSyncController({journal,repository:server,ownerUid,enabled:true,writesEnabled:true,allowlistedUids:[ownerUid],online:()=>runtime.online,onState:value=>runtime.states.push(value),onProjection:value=>runtime.projections.push(value),clock,crypto});
      Object.assign(runtime,{name,journal,controller,async start(){if(runtime.authenticated){await controller.activate();await controller.waitForListenerReady({timeoutMs:1000});}return runtime;},async disconnect(){runtime.online=false;await controller.deactivate();},async reconnect(){runtime.online=true;if(runtime.authenticated){await controller.activate();await controller.waitForListenerReady({timeoutMs:1000});await controller.drain();}},async detachAuth(){runtime.authenticated=false;await controller.deactivate();},async reattachAuth(){runtime.authenticated=true;await controller.activate();await controller.waitForListenerReady({timeoutMs:1000});if(runtime.online)await controller.drain();},async setOnline(value){runtime.online=value;if(value&&runtime.authenticated)await controller.drain();}});
      devices.set(name,runtime);return runtime;
    }
    async function settle(){for(const device of devices.values())if(device.online)await device.controller.drain();await Promise.resolve();await Promise.resolve();}
    function advance(milliseconds){time+=Math.max(0,Number(milliseconds)||0);return time;}
    return Object.freeze({ownerUid,clock,server,devices,createDevice,settle,advance,createMemoryJournalState});
  }

  root.accountSyncHarness=Object.freeze({createMemoryJournalState,createMemoryJournal,createDeterministicServer,createMultiDeviceHarness});
})(window);
