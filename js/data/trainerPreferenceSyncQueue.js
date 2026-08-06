(function(global){
  const root=global.PogoData=global.PogoData||{};
  const PREFIX='pogoTrainerPreferenceSync_v1:';

  function error(code,message){return Object.freeze({ok:false,error:Object.freeze({code,message})});}
  function identity(value){const uid=String(value?.uid||'').trim(),username=String(value?.username||'').trim();return uid&&username?Object.freeze({uid,username}):null;}
  function same(a,b){return!!a&&!!b&&a.uid===b.uid&&a.username===b.username;}
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function sameOperation(a,b){return JSON.stringify(a)===JSON.stringify(b);}
  function createTrainerPreferenceSyncQueue({storage,identity:owner,domain,featureEnabled=false,writesEnabled=false,maxOperations,now=()=>Date.now()}={}){
    if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')throw new TypeError('Preference sync queue requires Storage-compatible access');
    if(!domain||typeof domain.normalizeOperation!=='function')throw new TypeError('Preference sync queue requires the sync domain');
    const requestedBound=Number(maxOperations),bound=Math.min(domain.MAX_QUEUE_OPERATIONS,Number.isSafeInteger(requestedBound)&&requestedBound>0?requestedBound:domain.MAX_QUEUE_OPERATIONS),partition=identity(owner);
    if(!partition)throw new TypeError('Preference sync queue requires UID and username');
    const key=`${PREFIX}${encodeURIComponent(partition.uid)}`;
    let active=true;
    function empty(){return{schemaVersion:1,owner:{...partition},operations:{}};}
    function read(){
      try{
        const value=JSON.parse(storage.getItem(key)||'null');
        if(value?.schemaVersion!==1||!same(identity(value.owner),partition)||!value.operations||Array.isArray(value.operations))return empty();
        const clean=empty();
        for(const [id,item] of Object.entries(value.operations)){
          const normalized=domain.normalizeOperation(item?.operation),attempts=Number(item?.attempts),nextAttemptAt=Number(item?.nextAttemptAt),status=String(item?.status||'');
          if(!normalized.ok||id!==normalized.value.operationId||normalized.value.viewerUid!==partition.uid||!sameOperation(item.operation,normalized.value))continue;
          if(!Number.isSafeInteger(attempts)||attempts<0||attempts>domain.MAX_RETRY_ATTEMPTS||!Number.isFinite(nextAttemptAt)||!['pending','conflict'].includes(status))continue;
          clean.operations[id]={operation:clone(normalized.value),attempts,status,nextAttemptAt,lastErrorCode:String(item.lastErrorCode||'').slice(0,80)};
        }
        return clean;
      }catch{return empty();}
    }
    function write(value){storage.setItem(key,JSON.stringify(value));}
    function enabled(){return featureEnabled===true&&writesEnabled===true;}
    function enqueue(rawOperation){
      if(!enabled())return error('trainer-preference-sync/disabled','Preference synchronization is disabled');
      if(!active)return error('trainer-preference-sync/session-inactive','Preference synchronization session is inactive');
      const normalized=domain.normalizeOperation(rawOperation);if(!normalized.ok)return normalized;
      const operation=normalized.value;
      if(operation.viewerUid!==partition.uid)return error('trainer-preference-sync/owner-mismatch','Operation belongs to another account');
      const state=read(),current=state.operations[operation.operationId];
      if(current){
        if(!sameOperation(current.operation,operation))return error('trainer-preference-sync/idempotency-conflict','Operation identifier was reused with different input');
        return Object.freeze({ok:true,status:'idempotent',pendingCount:Object.keys(state.operations).length});
      }
      if(Object.keys(state.operations).length>=bound)return error('trainer-preference-sync/queue-full','Preference sync queue is full');
      state.operations[operation.operationId]={operation,attempts:0,status:'pending',nextAttemptAt:Number(now()),lastErrorCode:''};
      write(state);
      return Object.freeze({ok:true,status:'queued',pendingCount:Object.keys(state.operations).length});
    }
    function next(activeIdentity){
      if(!enabled())return error('trainer-preference-sync/disabled','Preference synchronization is disabled');
      if(!active||!same(identity(activeIdentity),partition))return error('trainer-preference-sync/owner-mismatch','Active account does not own this queue');
      const state=read(),timestamp=Number(now());
      const item=Object.values(state.operations).filter(value=>value.status!=='acknowledged'&&value.attempts<domain.MAX_RETRY_ATTEMPTS&&Number(value.nextAttemptAt||0)<=timestamp).sort((a,b)=>a.operation.createdAt-b.operation.createdAt||a.operation.operationId.localeCompare(b.operation.operationId))[0];
      return Object.freeze({ok:true,status:item?'ready':'empty',operation:item?Object.freeze(clone(item.operation)):null});
    }
    function recordAttempt(operationId,{retryable=true,errorCode='sync-error'}={}){
      if(!enabled()||!active)return error('trainer-preference-sync/disabled','Preference synchronization is disabled');
      const state=read(),item=state.operations[operationId];if(!item)return error('trainer-preference-sync/operation-missing','Queued operation was not found');
      item.attempts+=1;item.lastErrorCode=String(errorCode||'sync-error');item.status=retryable&&item.attempts<domain.MAX_RETRY_ATTEMPTS?'pending':'conflict';
      item.nextAttemptAt=Number(now())+Math.min(60000,1000*(2**Math.min(item.attempts,6)));
      write(state);return Object.freeze({ok:true,status:item.status,attempts:item.attempts});
    }
    function acknowledge(operationId,operationFingerprint){
      if(!enabled()||!active)return error('trainer-preference-sync/disabled','Preference synchronization is disabled');
      const state=read(),item=state.operations[operationId];if(!item)return Object.freeze({ok:true,status:'already-acknowledged',pendingCount:Object.keys(state.operations).length});
      if(item.operation.fingerprint!==operationFingerprint)return error('trainer-preference-sync/ack-mismatch','Acknowledgement fingerprint does not match');
      delete state.operations[operationId];write(state);
      return Object.freeze({ok:true,status:'acknowledged',pendingCount:Object.keys(state.operations).length});
    }
    function suspend(){active=false;return Object.freeze({ok:true,status:'suspended'});}
    function resume(activeIdentity){if(!same(identity(activeIdentity),partition))return error('trainer-preference-sync/owner-mismatch','Another account cannot resume this queue');active=true;return Object.freeze({ok:true,status:'resumed'});}
    function snapshot(){const state=read(),items=Object.values(state.operations);return Object.freeze({ownerBound:true,enabled:enabled(),active,pendingCount:items.filter(item=>item.status==='pending').length,conflictCount:items.filter(item=>item.status==='conflict').length,operationCount:items.length,privateValuesExposed:false});}
    return Object.freeze({key,enabled:enabled(),enqueue,next,recordAttempt,acknowledge,suspend,resume,snapshot});
  }
  root.trainerPreferenceSyncQueue=Object.freeze({PREFIX,createTrainerPreferenceSyncQueue});
})(window);
