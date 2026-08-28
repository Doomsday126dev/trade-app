(function(global){
  const root=global.PogoData=global.PogoData||{};
  const model=global.PogoDomain?.accountSyncModel;
  if(!model)throw new Error('Account sync model must load before the journal');
  const STORE_NAMES=Object.freeze(['entities','operations','conflicts','meta','recoveryCandidates']);

  function requestResult(request){
    return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('IndexedDB request failed'));});
  }
  function transactionDone(transaction){
    return new Promise((resolve,reject)=>{
      transaction.oncomplete=()=>resolve();
      transaction.onabort=()=>reject(transaction.error||new Error('IndexedDB transaction aborted'));
      transaction.onerror=()=>reject(transaction.error||new Error('IndexedDB transaction failed'));
    });
  }
  function recordKey(ownerUid,...parts){return[ownerUid,...parts].join('|');}
  function openDatabase(indexedDB,databaseName=model.DATABASE_NAME){
    if(!indexedDB||typeof indexedDB.open!=='function')return Promise.reject(new TypeError('IndexedDB is unavailable'));
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(databaseName,1);
      request.onupgradeneeded=()=>{
        const database=request.result;
        for(const name of STORE_NAMES)if(!database.objectStoreNames.contains(name)){
          const store=database.createObjectStore(name,{keyPath:'key'});
          store.createIndex('ownerUid','ownerUid',{unique:false});
          if(name==='operations')store.createIndex('ownerStatusNext',['ownerUid','status','nextAttemptAt'],{unique:false});
        }
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('Could not open account sync journal'));
      request.onblocked=()=>reject(new Error('Account sync journal upgrade is blocked'));
    });
  }
  function createAccountSyncJournal({indexedDB=global.indexedDB,ownerUid,databaseName=model.DATABASE_NAME,now=()=>Date.now(),maxAutomaticAttempts=12}={}){
    const owner=model.firebaseKey(ownerUid,128);
    if(!owner)throw new TypeError('Account sync journal requires an owner UID');
    let databasePromise=null,closed=false;
    const database=()=>closed?Promise.reject(Object.assign(new Error('Account sync journal is closed'),{code:'account-sync/journal-closed'})):(databasePromise||(databasePromise=openDatabase(indexedDB,databaseName)));
    async function read(storeName,key){
      const db=await database(),transaction=db.transaction(storeName,'readonly');
      return requestResult(transaction.objectStore(storeName).get(key));
    }
    async function write(storeName,record){
      const db=await database(),transaction=db.transaction(storeName,'readwrite');
      transaction.objectStore(storeName).put(record);await transactionDone(transaction);return record;
    }
    async function remove(storeName,key){
      const db=await database(),transaction=db.transaction(storeName,'readwrite');
      transaction.objectStore(storeName).delete(key);await transactionDone(transaction);
    }
    async function ownerRecords(storeName){
      const db=await database(),transaction=db.transaction(storeName,'readonly'),index=transaction.objectStore(storeName).index('ownerUid');
      const range=global.IDBKeyRange?.only?global.IDBKeyRange.only(owner):owner;
      return requestResult(index.getAll(range));
    }
    function requireOwner(value){if(value?.ownerUid!==owner)throw Object.assign(new Error('Journal owner mismatch'),{code:'account-sync/owner-mismatch'});}
    async function enqueueOperations(operations,optimisticEntities=[]){
      if(!Array.isArray(operations)||!operations.length)throw new TypeError('Account sync operation batch is empty');
      if(!Array.isArray(optimisticEntities))throw new TypeError('Account sync optimistic entity batch is invalid');
      for(const operation of operations)requireOwner(operation);
      for(const entity of optimisticEntities)requireOwner(entity);
      const operationIds=new Set();
      for(const operation of operations){
        if(operationIds.has(operation.operationId))throw Object.assign(new Error('Operation batch contains a duplicate ID'),{code:'account-sync/idempotency-conflict'});
        operationIds.add(operation.operationId);
      }
      const db=await database(),storeNames=optimisticEntities.length?['operations','entities']:['operations'];
      const transaction=db.transaction(storeNames,'readwrite'),done=transactionDone(transaction),operationStore=transaction.objectStore('operations');
      const keys=operations.map(operation=>recordKey(owner,operation.operationId));
      let existing;
      try{existing=await Promise.all(keys.map(key=>requestResult(operationStore.get(key))));}
      catch(error){try{transaction.abort();}catch{}await done.catch(()=>{});throw error;}
      const results=[],time=Number(now());
      try{
        for(let index=0;index<operations.length;index++){
          const operation=operations[index],prior=existing[index],key=keys[index];
          if(prior){
            if(prior.operation?.inputHash!==operation.inputHash)throw Object.assign(new Error('Operation ID already has different contents'),{code:'account-sync/idempotency-conflict'});
            results.push(Object.freeze({ok:true,status:'idempotent',record:prior}));continue;
          }
          const record={key,ownerUid:owner,operationId:operation.operationId,status:'pending',attempts:0,nextAttemptAt:time,lastErrorCode:'',createdAt:time,updatedAt:time,operation};
          operationStore.put(record);results.push(Object.freeze({ok:true,status:'queued',record}));
        }
        if(optimisticEntities.length){
          const entityStore=transaction.objectStore('entities');
          for(const entity of optimisticEntities)entityStore.put({key:recordKey(owner,entity.entityType,entity.entityId),ownerUid:owner,entityType:entity.entityType,entityId:entity.entityId,entity});
        }
        await done;return Object.freeze(results);
      }catch(error){try{transaction.abort();}catch{}await done.catch(()=>{});throw error;}
    }
    async function enqueueOperation(operation){
      return(await enqueueOperations([operation]))[0];
    }
    async function listOperations({statuses=['pending','sending','blocked','conflict']}={}){
      const allowed=new Set(statuses);return(await ownerRecords('operations')).filter(record=>allowed.has(record.status)).sort((a,b)=>a.createdAt-b.createdAt||a.operationId.localeCompare(b.operationId));
    }
    async function nextOperation({includeBlocked=false}={}){
      const time=Number(now()),statuses=includeBlocked?['pending','sending','blocked']:['pending','sending'];
      return(await listOperations({statuses})).find(record=>includeBlocked||record.nextAttemptAt<=time)||null;
    }
    async function markAttempt(operationId,{errorCode='',retryable=true}={}){
      const key=recordKey(owner,operationId),record=await read('operations',key);if(!record)throw new Error('Operation is missing');
      const attempts=record.attempts+1,time=Number(now()),blocked=!retryable||attempts>=maxAutomaticAttempts;
      const next={...record,attempts,status:blocked?'blocked':'pending',lastErrorCode:String(errorCode||''),nextAttemptAt:blocked?time:time+model.retryDelay(attempts-1),updatedAt:time};
      await write('operations',next);return next;
    }
    async function retainBlocked(operationId,{errorCode='account-sync/network-failed'}={}){
      const key=recordKey(owner,operationId),record=await read('operations',key);if(!record||record.status!=='blocked')return null;
      const time=Number(now()),next={...record,attempts:record.attempts+1,status:'blocked',lastErrorCode:String(errorCode||'account-sync/network-failed'),nextAttemptAt:time,updatedAt:time};
      await write('operations',next);return next;
    }
    async function acknowledge(operationId,serverEntity){
      const key=recordKey(owner,operationId),record=await read('operations',key);if(!record)throw new Error('Operation is missing');
      const time=Number(now()),next={...record,status:'acknowledged',serverRevision:serverEntity?.revision||0,nextAttemptAt:0,updatedAt:time,lastErrorCode:''};
      await write('operations',next);return next;
    }
    async function markConflict(operationId,conflicts){
      const key=recordKey(owner,operationId),record=await read('operations',key);if(!record)throw new Error('Operation is missing');
      const time=Number(now()),next={...record,status:'conflict',nextAttemptAt:0,updatedAt:time,lastErrorCode:'account-sync/conflict'};
      const db=await database(),transaction=db.transaction(['operations','conflicts'],'readwrite');
      transaction.objectStore('operations').put(next);
      for(const item of conflicts||[]){requireOwner(item);transaction.objectStore('conflicts').put({...item,key:recordKey(owner,item.conflictId)});}
      await transactionDone(transaction);return next;
    }
    async function retryBlocked(operationId){
      const key=recordKey(owner,operationId),record=await read('operations',key);if(!record||record.status!=='blocked')return false;
      if(!model.blockedRetryEligible(record))return false;
      await write('operations',{...record,status:'pending',attempts:0,nextAttemptAt:Number(now()),lastErrorCode:'',updatedAt:Number(now())});return true;
    }
    async function putEntity(entity){
      requireOwner(entity);const key=recordKey(owner,entity.entityType,entity.entityId);return write('entities',{key,ownerUid:owner,entityType:entity.entityType,entityId:entity.entityId,entity});
    }
    async function deleteEntity(entityType,entityId){return remove('entities',recordKey(owner,entityType,entityId));}
    async function getEntity(entityType,entityId){return(await read('entities',recordKey(owner,entityType,entityId)))?.entity||null;}
    async function listEntities(){return(await ownerRecords('entities')).map(record=>record.entity);}
    async function listConflicts({unresolvedOnly=true}={}){return(await ownerRecords('conflicts')).filter(item=>!unresolvedOnly||item.resolved!==true).sort((a,b)=>a.createdAt-b.createdAt);}
    async function resolveConflict(conflictId){
      const key=recordKey(owner,conflictId),db=await database(),transaction=db.transaction(['conflicts','operations'],'readwrite'),done=transactionDone(transaction);
      const conflictStore=transaction.objectStore('conflicts'),operationStore=transaction.objectStore('operations'),record=await requestResult(conflictStore.get(key));
      if(!record){await done;return false;}
      const operationKey=recordKey(owner,record.operationId),operation=await requestResult(operationStore.get(operationKey)),time=Number(now());
      conflictStore.put({...record,resolved:true,resolvedAt:time});
      if(operation?.status==='conflict')operationStore.put({...operation,status:'resolved',nextAttemptAt:0,lastErrorCode:'',updatedAt:time});
      await done;return true;
    }
    async function setMeta(key,value){const name=model.firebaseKey(key,180);if(!name)throw new TypeError('Meta key is invalid');return write('meta',{key:recordKey(owner,name),ownerUid:owner,name,value});}
    async function getMeta(key){return(await read('meta',recordKey(owner,key)))?.value??null;}
    async function putRecoveryCandidate(candidate){
      requireOwner(candidate);const id=model.firebaseKey(candidate.candidateId,700);if(!id)throw new TypeError('Recovery candidate ID is invalid');
      return write('recoveryCandidates',{...candidate,key:recordKey(owner,id)});
    }
    async function listRecoveryCandidates({unresolvedOnly=true}={}){
      return(await ownerRecords('recoveryCandidates')).filter(item=>!unresolvedOnly||item.resolved!==true).sort((a,b)=>a.createdAt-b.createdAt||a.candidateId.localeCompare(b.candidateId));
    }
    async function resolveRecoveryCandidate(candidateId){
      const id=model.firebaseKey(candidateId,700);if(!id)throw new TypeError('Recovery candidate ID is invalid');
      const key=recordKey(owner,id),record=await read('recoveryCandidates',key);if(!record||record.resolved===true)return false;
      await write('recoveryCandidates',{...record,resolved:true,resolvedAt:Number(now())});return true;
    }
    async function resolveRecoveryCandidates(candidateIds){
      if(!Array.isArray(candidateIds)||!candidateIds.length)throw new TypeError('Recovery candidate review is empty');
      const ids=candidateIds.map(candidateId=>{
        const id=model.firebaseKey(candidateId,700);if(!id||id!==candidateId)throw new TypeError('Recovery candidate ID is invalid');return id;
      });
      if(new Set(ids).size!==ids.length)throw new TypeError('Recovery candidate review contains duplicate IDs');
      const expected=[...ids].sort(),db=await database(),transaction=db.transaction('recoveryCandidates','readwrite'),done=transactionDone(transaction),store=transaction.objectStore('recoveryCandidates'),index=store.index('ownerUid'),range=global.IDBKeyRange?.only?global.IDBKeyRange.only(owner):owner;
      try{
        const records=await requestResult(index.getAll(range)),unresolved=records.filter(item=>item.resolved!==true),actual=unresolved.map(item=>item.candidateId).sort();
        if(actual.length!==expected.length||actual.some((id,index)=>id!==expected[index]))throw Object.assign(new Error('Recovery candidate set changed before review'),{code:'account-sync/recovery-review-changed'});
        const time=Number(now());for(const record of unresolved)store.put({...record,resolved:true,resolvedAt:time});
        await done;return unresolved.length;
      }catch(error){try{transaction.abort();}catch{}await done.catch(()=>{});throw error;}
    }
    async function snapshot(){
      const[operations,entities,conflicts,recoveryCandidates]=await Promise.all([ownerRecords('operations'),ownerRecords('entities'),ownerRecords('conflicts'),listRecoveryCandidates()]);
      const blocked=operations.filter(item=>item.status==='blocked'),blockedCodes=[...new Set(blocked.map(item=>String(item.lastErrorCode||'')).filter(code=>/^account-sync\/[a-z0-9-]{1,80}$/.test(code)))];
      const blockedErrorCode=blocked.length?(blockedCodes.length===1?blockedCodes[0]:'account-sync/blocked-operation'):'';
      const recoverableBlocked=blocked.filter(model.blockedRetryEligible),unsafeBlockedCount=blocked.length-recoverableBlocked.length;
      const blockedCategories=[...new Set(blocked.map(item=>model.blockedRetryCategory(item.lastErrorCode)))].sort();
      return Object.freeze({ownerUid:owner,pendingCount:operations.filter(item=>['pending','sending'].includes(item.status)).length,blockedCount:blocked.length,recoverableBlockedCount:recoverableBlocked.length,unsafeBlockedCount,blockedCategories:Object.freeze(blockedCategories),blockedErrorCode,conflictCount:conflicts.filter(item=>!item.resolved).length,entityCount:entities.length,recoveryCandidateCount:recoveryCandidates.length});
    }
    async function close(){
      if(closed)return;
      closed=true;
      const pending=databasePromise;databasePromise=null;
      if(pending)(await pending).close();
    }
    return Object.freeze({ownerUid:owner,enqueueOperation,enqueueOperations,listOperations,nextOperation,markAttempt,retainBlocked,acknowledge,markConflict,retryBlocked,putEntity,deleteEntity,getEntity,listEntities,listConflicts,resolveConflict,setMeta,getMeta,putRecoveryCandidate,listRecoveryCandidates,resolveRecoveryCandidate,resolveRecoveryCandidates,snapshot,close,_remove:remove});
  }

  root.accountSyncJournal=Object.freeze({STORE_NAMES,openDatabase,createAccountSyncJournal});
})(window);
