(function(global){
  const root=global.PogoData=global.PogoData||{};
  const model=global.PogoDomain?.accountSyncModel,merge=global.PogoDomain?.accountSyncMerge;
  if(!model||!merge)throw new Error('Account sync model and merge engine must load before the repository');
  const RECOVERY_REVIEW_KIND='recovery-review-acceptance';
  const RECOVERY_REVIEW_KEYS=Object.freeze(['schemaVersion','kind','ownerUid','trainerUsername','evidenceFingerprint','candidateCount','acceptedAt']);

  function createAccountSyncRepository({database,ref,get,onValue,runTransaction,serverTimestamp,ownerUid,clock=()=>Date.now()}={}){
    const owner=model.firebaseKey(ownerUid,128);
    if(!database||typeof ref!=='function'||typeof get!=='function'||typeof onValue!=='function'||typeof runTransaction!=='function'||typeof serverTimestamp!=='function'||!owner){
      throw new TypeError('Account sync repository dependencies are incomplete');
    }
    const accountPath=`accountSync/${owner}`;
    const dbRef=path=>ref(database,path);
    function assertOwner(value){if(value?.ownerUid!==owner)throw Object.assign(new Error('Account sync owner mismatch'),{code:'account-sync/owner-mismatch'});}
    async function readAccount(){const snapshot=await get(dbRef(accountPath));return snapshot.exists()?snapshot.val():null;}
    async function readProfile(){const snapshot=await get(dbRef(`${accountPath}/profile`));return snapshot.exists()?snapshot.val():null;}
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
      const path=model.entityPath(owner,operation.entityType,operation.entityId);let finalMerge=null,idempotentAbort=false;
      const transaction=await runTransaction(dbRef(path),current=>{
        const acceptedAt=Number(clock());
        finalMerge=merge.mergeOperation(current,operation,{acceptedAt});
        if(finalMerge.ok&&finalMerge.status==='idempotent'){
          idempotentAbort=true;
          return;
        }
        return finalMerge.ok?serverStamped(finalMerge.value,current):undefined;
      },{applyLocally:false});
      if(!transaction.committed){
        if(idempotentAbort){
          const canonicalSnapshot=await get(dbRef(path)),value=canonicalSnapshot.exists()?canonicalSnapshot.val():null;
          const valid=merge.validateEntity(value,{ownerUid:owner,entityType:operation.entityType,entityId:operation.entityId});
          if(!valid.ok)return model.failure('account-sync/committed-entity-invalid','Committed account sync data is invalid');
          const proof=merge.mergeOperation(value,operation,{acceptedAt:Number(clock())});
          if(!proof.ok||proof.status!=='idempotent')return model.failure('account-sync/idempotency-conflict','Canonical account sync data does not prove this operation was already committed');
          return Object.freeze({ok:true,status:'idempotent',value,conflicts:Object.freeze([])});
        }
        if(finalMerge?.conflicts?.length)return Object.freeze({ok:false,status:'conflict',error:finalMerge.error,conflicts:finalMerge.conflicts,current:transaction.snapshot?.val?.()||null});
        return model.failure('account-sync/transaction-aborted','Account sync transaction was not committed');
      }
      const committedSnapshot=await get(dbRef(path));
      const value=committedSnapshot.exists()?committedSnapshot.val():null;
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
    function validRecoveryReviewAcceptance(value,expected=value){
      if(!model.plainObject(value)||Object.keys(value).sort().join(',')!==[...RECOVERY_REVIEW_KEYS].sort().join(','))return false;
      const fingerprint=String(expected?.evidenceFingerprint||''),username=model.exactText(expected?.trainerUsername,64);
      return value.schemaVersion===model.SCHEMA_VERSION&&value.kind===RECOVERY_REVIEW_KIND&&value.ownerUid===owner&&value.ownerUid===expected?.ownerUid&&
        value.trainerUsername===username&&value.trainerUsername===expected?.trainerUsername&&/^[a-f0-9]{64}$/.test(fingerprint)&&value.evidenceFingerprint===fingerprint&&
        Number.isSafeInteger(value.candidateCount)&&value.candidateCount>0&&value.candidateCount===expected?.candidateCount&&Number.isSafeInteger(value.acceptedAt)&&value.acceptedAt>=0;
    }
    function recoveryReviewPath(record){return`authIndex/${owner}/accountSyncRecoveryReviews/${String(record?.evidenceFingerprint||'')}`;}
    async function readRecoveryReviewAcceptance(expected){
      assertOwner(expected);
      if(!validRecoveryReviewAcceptance(expected))return model.failure('account-sync/recovery-review-acceptance-invalid','Recovery review acceptance is invalid');
      const snapshot=await get(dbRef(recoveryReviewPath(expected)));
      if(!snapshot.exists())return Object.freeze({ok:true,status:'missing',value:null});
      const value=snapshot.val();
      return validRecoveryReviewAcceptance(value,expected)
        ?Object.freeze({ok:true,status:'found',value})
        :model.failure('account-sync/recovery-review-acceptance-conflict','Recovery review acceptance differs from the exact evidence set');
    }
    async function createRecoveryReviewAcceptance(record){
      assertOwner(record);
      if(!validRecoveryReviewAcceptance(record))return model.failure('account-sync/recovery-review-acceptance-invalid','Recovery review acceptance is invalid');
      const target=dbRef(recoveryReviewPath(record));let result=null,writeError=null;
      try{result=await runTransaction(target,current=>current==null?record:undefined,{applyLocally:false});}catch(error){writeError=error;}
      if(result?.committed){
        const value=result.snapshot.val();
        return validRecoveryReviewAcceptance(value,record)
          ?Object.freeze({ok:true,status:'created',value})
          :model.failure('account-sync/recovery-review-acceptance-conflict','Committed recovery review acceptance is invalid');
      }
      let snapshot;
      try{snapshot=await get(target);}catch{return model.failure('account-sync/recovery-review-acceptance-unreconciled','Recovery review acceptance could not be reconciled');}
      const value=snapshot.exists()?snapshot.val():null;
      if(validRecoveryReviewAcceptance(value,record))return Object.freeze({ok:true,status:'idempotent',value,writeErrorCode:String(writeError?.code||'')});
      return model.failure('account-sync/recovery-review-acceptance-conflict','Recovery review acceptance differs from the exact evidence set');
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
    async function writeProfile(values,{baseRevision=0}={}){
      const normalized=model.normalizeProfileValues(values),base=model.integer(baseRevision);
      if(!normalized.ok||base===null)return model.failure('account-sync/profile-invalid','Provider profile write is invalid');
      const target=dbRef(`${accountPath}/profile`);let abortCode='account-sync/profile-conflict',same=false;
      const result=await runTransaction(target,current=>{
        if(current==null){
          if(base!==0)return;
          const timestamp=serverTimestamp();
          return{schemaVersion:model.SCHEMA_VERSION,ownerUid:owner,...normalized.value,revision:1,createdAt:timestamp,lastUpdated:timestamp};
        }
        const valid=model.validateProfileRecord(current,{ownerUid:owner});
        if(!valid.ok){abortCode='account-sync/profile-invalid';return;}
        if(model.canonicalJson(model.profileValues(valid.value))===model.canonicalJson(normalized.value)){same=true;return;}
        if(valid.value.revision!==base)return;
        return{...valid.value,...normalized.value,revision:valid.value.revision+1,lastUpdated:serverTimestamp()};
      },{applyLocally:false});
      const snapshot=result.committed?result.snapshot:await get(target),value=snapshot.exists()?snapshot.val():null,valid=model.validateProfileRecord(value,{ownerUid:owner});
      if(!valid.ok)return model.failure(abortCode,'Canonical provider profile is invalid or missing');
      if(model.canonicalJson(model.profileValues(valid.value))!==model.canonicalJson(normalized.value))return model.failure('account-sync/profile-conflict','Canonical provider profile changed on another device');
      return Object.freeze({ok:true,status:result.committed?'updated':same?'idempotent':'reconciled',value:valid.value});
    }
    return Object.freeze({ownerUid:owner,accountPath,readAccount,readProfile,listenAccount,applyOperation,createMigration,createRecoveryCandidate,readRecoveryReviewAcceptance,createRecoveryReviewAcceptance,updateMeta,writeProfile});
  }

  root.accountSyncRepository=Object.freeze({createAccountSyncRepository});
})(window);
