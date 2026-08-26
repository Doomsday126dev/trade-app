(function(global){
  const root=global.PogoData=global.PogoData||{};
  const model=global.PogoDomain?.accountSyncModel,merge=global.PogoDomain?.accountSyncMerge;
  if(!model||!merge)throw new Error('Account sync model and merge engine must load before the repository');

  function createAccountSyncRepository({database,ref,get,onValue,runTransaction,serverTimestamp,ownerUid,clock=()=>Date.now()}={}){
    const owner=model.firebaseKey(ownerUid,128);
    if(!database||typeof ref!=='function'||typeof get!=='function'||typeof onValue!=='function'||typeof runTransaction!=='function'||typeof serverTimestamp!=='function'||!owner){
      throw new TypeError('Account sync repository dependencies are incomplete');
    }
    const accountPath=`accountSync/${owner}`;
    const dbRef=path=>ref(database,path);
    function assertOwner(value){if(value?.ownerUid!==owner)throw Object.assign(new Error('Account sync owner mismatch'),{code:'account-sync/owner-mismatch'});}
    async function readAccount(){const snapshot=await get(dbRef(accountPath));return snapshot.exists()?snapshot.val():null;}
    function listenAccount({onData,onError}={}){
      if(typeof onData!=='function')throw new TypeError('Account sync listener requires onData');
      return onValue(dbRef(accountPath),snapshot=>onData(snapshot.exists()?snapshot.val():null,snapshot),onError);
    }
    function serverStamped(value,current){
      if(value===current)return current;
      const timestamp=serverTimestamp(),next={...value,updatedAt:timestamp};
      if(current==null)next.createdAt=timestamp;
      if(value.deleted===true&&current?.deleted!==true)next.deletedAt=timestamp;
      return next;
    }
    async function applyOperation(operation){
      assertOwner(operation);const verified=await model.verifyOperation(operation);if(!verified.ok)return verified;
      const path=model.entityPath(owner,operation.entityType,operation.entityId);let finalMerge=null;
      const transaction=await runTransaction(dbRef(path),current=>{
        const acceptedAt=Number(clock());
        finalMerge=merge.mergeOperation(current,operation,{acceptedAt});
        return finalMerge.ok?serverStamped(finalMerge.value,current):undefined;
      },{applyLocally:false});
      if(!transaction.committed){
        if(finalMerge?.conflicts?.length)return Object.freeze({ok:false,status:'conflict',error:finalMerge.error,conflicts:finalMerge.conflicts,current:transaction.snapshot?.val?.()||null});
        return model.failure('account-sync/transaction-aborted','Account sync transaction was not committed');
      }
      const value=transaction.snapshot?.val?.()||finalMerge?.value||null;
      const valid=merge.validateEntity(value,{ownerUid:owner,entityType:operation.entityType,entityId:operation.entityId});
      if(!valid.ok)return model.failure('account-sync/committed-entity-invalid','Committed account sync data is invalid');
      return Object.freeze({ok:true,status:finalMerge?.status||'applied',value,conflicts:finalMerge?.conflicts||Object.freeze([])});
    }
    async function createOnly(path,value,existingCode){
      assertOwner(value);let existed=false;
      const result=await runTransaction(dbRef(`${accountPath}/${path}`),current=>{if(current!=null){existed=true;return;}return value;},{applyLocally:false});
      if(!result.committed)return model.failure(existingCode,'Create-only account sync record already exists');
      return Object.freeze({ok:true,status:'created',value:result.snapshot.val()});
    }
    function createMigration(record){
      const id=model.firebaseKey(record?.deviceMigrationId,700);
      if(!/^migration_[a-f0-9]{64}$/.test(id))return Promise.resolve(model.failure('account-sync/migration-id-invalid','Migration record ID is invalid'));
      return createOnly(`migrations/${id}`,record,'account-sync/migration-exists');
    }
    function createRecoveryCandidate(record){
      const id=model.firebaseKey(record?.candidateId,700);
      if(!/^candidate_[a-f0-9]{64}$/.test(id))return Promise.resolve(model.failure('account-sync/recovery-candidate-id-invalid','Recovery candidate ID is invalid'));
      return createOnly(`recoveryCandidates/${id}`,record,'account-sync/recovery-candidate-exists');
    }
    async function updateMeta(patch){
      assertOwner(patch);const allowed=['schemaVersion','ownerUid','initialized','initializedAt','updatedAt','featureVersion'];
      if(Object.keys(patch).some(key=>!allowed.includes(key)))return model.failure('account-sync/meta-invalid','Account sync metadata contains unknown fields');
      const timestamp=serverTimestamp();
      const result=await runTransaction(dbRef(`${accountPath}/meta`),current=>{
        if(current?.ownerUid&&current.ownerUid!==owner)return;
        return{...(current||{}),...patch,ownerUid:owner,schemaVersion:model.SCHEMA_VERSION,initializedAt:current?.initializedAt??timestamp,updatedAt:timestamp};
      },{applyLocally:false});
      return result.committed?Object.freeze({ok:true,status:'updated',value:result.snapshot.val()}):model.failure('account-sync/meta-conflict','Account sync metadata update was rejected');
    }
    return Object.freeze({ownerUid:owner,accountPath,readAccount,listenAccount,applyOperation,createMigration,createRecoveryCandidate,updateMeta});
  }

  root.accountSyncRepository=Object.freeze({createAccountSyncRepository});
})(window);
