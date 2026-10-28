(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  const STORES=Object.freeze(['entities','operations','conflicts','meta','recoveryCandidates']);
  function failure(code){return Object.assign(new Error(code),{code});}
  function requestValue(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(failure('recovery/journal-read-failed'));});}
  function createAccountRecoveryJournalSnapshot({ownerUid,indexedDB=global.indexedDB,databaseName=global.PogoDomain?.accountSyncModel?.DATABASE_NAME}={}){
    if(!global.PogoDomain?.accountSyncModel?.firebaseKey(ownerUid,128)||!indexedDB?.open||!databaseName)throw new TypeError('Readonly recovery journal dependencies required');
    function openExisting(){return new Promise((resolve,reject)=>{
      let settled=false,missing=false;
      const rejectOnce=error=>{if(!settled){settled=true;reject(error);}};
      const request=indexedDB.open(databaseName);
      // Export may never create an empty database and call it a complete snapshot.
      request.onupgradeneeded=()=>{missing=true;const database=request.result;request.transaction.abort();database.close();};
      request.onerror=()=>rejectOnce(failure(missing?'recovery/journal-missing':'recovery/journal-unavailable'));
      request.onblocked=()=>rejectOnce(failure('recovery/journal-unavailable'));
      request.onsuccess=()=>{if(settled)request.result.close();else{settled=true;resolve(request.result);}};
    });}
    async function captureOwnerSnapshot(){
      const database=await openExisting();
      try{
        if(database.version!==1||STORES.some(name=>!database.objectStoreNames.contains(name))||database.objectStoreNames.length!==STORES.length)throw failure('recovery/journal-version-unsupported');
        const transaction=database.transaction(STORES,'readonly');
        const done=new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onerror=transaction.onabort=()=>reject(failure('recovery/journal-read-failed'));});done.catch(()=>{});
        const range=global.IDBKeyRange?.only?global.IDBKeyRange.only(ownerUid):ownerUid;
        const values=await Promise.all(STORES.map(name=>requestValue(transaction.objectStore(name).index('ownerUid').getAll(range))));await done;
        for(const records of values)for(const record of records)if(record.ownerUid!==ownerUid)throw failure('recovery/journal-owner-mismatch');
        return{schemaVersion:1,ownerUid,stores:Object.fromEntries(STORES.map((name,index)=>[name,values[index]]))};
      }finally{database.close();}
    }
    return Object.freeze({ownerUid,captureOwnerSnapshot});
  }
  root.accountRecoveryJournalSnapshot=Object.freeze({STORES,createAccountRecoveryJournalSnapshot});
})(window);
