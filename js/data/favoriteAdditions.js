(function(global){
  'use strict';
  const root=global.PogoData=global.PogoData||{},model=global.PogoDomain?.accountSyncModel;
  const PREFIX='favorite-add-intent-v1:',CAPACITY=global.PogoDomain?.productLimits?.MAX_FAVORITES;
  const STATES=new Set(['selected','resolving','ready','pending','confirmed','already-present','unsuccessful','cancelled']);
  const validHandle=value=>typeof value==='string'&&value.length<=64&&model.firebaseKey(value,64)===value&&value===value.normalize('NFC');
  const failure=code=>Object.assign(new Error(code),{code});
  function createFavoriteAdditions({ownerUid,journal,controller,resolver,sessionCurrent,onChange=()=>{},now=()=>Date.now()}={}){
    const owner=model.firebaseKey(ownerUid,128);
    if(!owner||CAPACITY!==100||!journal?.listMeta||!controller?.ensureFavorite||!resolver?.resolve||typeof sessionCurrent!=='function')throw new TypeError('Favorite addition runtime is incomplete');
    let closed=false,work=Promise.resolve(),refreshing=null;const cancelled=new Set();
    const current=()=>{if(closed||!sessionCurrent())throw failure('favorite/session-changed');};
    function valid(row){
      return row&&row.version===1&&row.ownerUid===owner&&validHandle(row.handle)&&/^op_[A-Za-z0-9_-]{16,96}$/.test(row.operationId||'')&&Number.isSafeInteger(row.createdAt)&&row.createdAt>=0&&Number.isSafeInteger(row.expectedGeneration)&&row.expectedGeneration>=0&&STATES.has(row.state)&&
        (!row.expectedUid||model.firebaseKey(row.expectedUid,128)===row.expectedUid)&&(!row.targetUid||model.firebaseKey(row.targetUid,128)===row.targetUid);
    }
    async function read(){current();const entries=await journal.listMeta(PREFIX);current();if(entries.some(entry=>!valid(entry.value)||entry.name!==PREFIX+entry.value.operationId))throw failure('favorite/intent-invalid');return entries.map(entry=>({...entry.value})).sort((a,b)=>a.createdAt-b.createdAt||a.operationId.localeCompare(b.operationId));}
    async function save(row){current();if(!valid(row))throw failure('favorite/intent-invalid');await journal.setMeta(PREFIX+row.operationId,row);current();}
    async function snapshot(){
      const rows=await read(),operations=await journal.listOperations({statuses:['pending','sending','blocked','conflict','acknowledged']});current();
      const byId=new Map(operations.map(record=>[record.operationId,record]));
      const values=rows.map(row=>{
        const operation=byId.get(row.operationId),uid=row.targetUid||row.expectedUid,entity=uid?controller.getEntity('favorite',uid):null;
        if(operation){
          if(['pending','sending'].includes(operation.status))return{...row,state:'pending',code:operation.lastErrorCode||''};
          if(operation.status==='acknowledged')return{...row,state:entity&&!entity.deleted?'confirmed':'unsuccessful',code:entity&&!entity.deleted?'':'favorite/removed'};
          return{...row,state:'unsuccessful',code:operation.lastErrorCode||'account-sync/conflict'};
        }
        if(row.state==='already-present'){
          const unsettled=operations.find(record=>record.operation.entityType==='favorite'&&record.operation.entityId===uid&&['pending','sending','blocked','conflict'].includes(record.status));
          const state=unsettled?(['pending','sending'].includes(unsettled.status)?'pending':'unsuccessful'):entity&&!entity.deleted?'already-present':'unsuccessful';
          return{...row,state,code:unsettled?.lastErrorCode||(entity&&!entity.deleted?'':'favorite/removed')};
        }
        return row;
      });
      const active=controller.activeEntities('favorite'),reserved=new Set(values.filter(row=>['selected','resolving','ready'].includes(row.state)&&!active.some(entity=>entity.entityId===row.targetUid)).map(row=>row.targetUid||row.handle));
      return Object.freeze({ownerUid:owner,rows:Object.freeze(values.map(Object.freeze)),activeCount:active.length,reservedCount:reserved.size,remaining:Math.max(0,CAPACITY-active.length-reserved.size),capacity:CAPACITY});
    }
    function refresh(){
      if(refreshing)return refreshing;
      refreshing=snapshot().then(value=>{current();onChange(value);return value;}).finally(()=>{refreshing=null;});return refreshing;
    }
    function serialize(task){const result=work.then(task);work=result.catch(()=>{});return result;}
    async function processRows(rows){
      const operations=await journal.listOperations({statuses:['pending','sending','blocked','conflict','acknowledged']});current();
      const retained=new Set(operations.map(record=>record.operationId));
      const candidates=await journal.listRecoveryCandidates();current();
      const todo=[];
      for(const row of rows){
        if(retained.has(row.operationId)){const operation=operations.find(record=>record.operationId===row.operationId);if(operation?.status==='blocked'&&model.blockedRetryEligible(operation)){await controller.retry(row.operationId);current();}continue;}
        if(row.state==='already-present'||row.state==='confirmed'||row.state==='cancelled')continue;
        if(row.retryAt&&row.retryAt>now())continue;
        if(cancelled.has(row.handle)){row.state='cancelled';await save(row);continue;}
        const fold=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('en-US');
        if(candidates.some(candidate=>candidate.entityType==='favorite'&&fold(candidate.values?.displayName)===fold(row.handle))){row.state='unsuccessful';row.code='account-sync/entity-review-required';await save(row);continue;}
        row.state='resolving';row.code='';await save(row);todo.push(row);
      }
      await refresh();
      for(let offset=0;offset<todo.length;offset+=50){
        current();const batch=todo.slice(offset,offset+50).filter(row=>!cancelled.has(row.handle));if(!batch.length)continue;
        let resolved;
        try{resolved=await resolver.resolve(batch.map(row=>row.handle));current();}
        catch(error){
          current();for(const row of batch){row.state=cancelled.has(row.handle)?'cancelled':'unsuccessful';row.code=String(error?.code||'favorite/network-failed');row.retryAt=now()+Math.max(0,Number(error?.retryAfter)||0)*1000;await save(row);}await refresh();continue;
        }
        for(let index=0;index<batch.length;index++){
          const row=batch[index],identity=resolved[index];current();
          if(cancelled.has(row.handle)){row.state='cancelled';await save(row);continue;}
          if(identity?.status!=='resolved'||identity.handle!==row.handle||row.expectedUid&&row.expectedUid!==identity.targetUid){row.state='unsuccessful';row.code='favorite/identity-unavailable';await save(row);continue;}
          row.targetUid=identity.targetUid;row.state='ready';await save(row);
          const result=await controller.ensureFavorite({targetUid:identity.targetUid,displayName:identity.canonicalHandle,expectedGeneration:row.expectedGeneration,operationId:row.operationId,clientAt:row.createdAt});current();
          row.state=result.ok?(result.status==='already-present'?'already-present':'pending'):'unsuccessful';row.code=result.error?.code||'';await save(row);
        }
        await refresh();
      }
      for(const row of todo)if(cancelled.has(row.handle)&&row.state==='resolving'){row.state='cancelled';await save(row);}
      return refresh();
    }
    async function prune(){
      const value=await snapshot();
      // Only our terminal intent presentation is bounded. Original histories,
      // migration evidence and all durable mutation records remain untouched.
      const terminal=value.rows.filter(row=>['confirmed','already-present','cancelled'].includes(row.state));
      for(const row of terminal.slice(0,Math.max(0,value.rows.length-200)))await journal.removeMeta(PREFIX+row.operationId);
    }
    function ensure(handles){return serialize(async()=>{
      current();if(!Array.isArray(handles)||!handles.length||handles.length>CAPACITY||handles.some(handle=>!validHandle(handle))||new Set(handles).size!==handles.length)throw failure('favorite/request-invalid');
      const previous=await snapshot(),byHandle=new Map(previous.rows.map(row=>[row.handle,{...row}])),rows=[];
      const newHandles=handles.filter(handle=>!byHandle.has(handle)&&!controller.activeEntities('favorite').some(entity=>entity.values.displayName===handle));
      if(newHandles.length>previous.remaining)throw failure('favorite/capacity-exceeded');
      for(const handle of handles){
        cancelled.delete(handle);let row=byHandle.get(handle);
        if(row&&['cancelled','confirmed','already-present'].includes(row.state)){
          const existing=row.targetUid?controller.getEntity('favorite',row.targetUid):null;
          if(row.state==='cancelled'||existing?.deleted)row=null;
        }
        if(!row){
          // Capture the generation before awaiting identity resolution. A later
          // removal cannot turn this intent into an implicit resurrection.
          const stored=(await journal.listEntities()).find(entity=>entity.entityType==='favorite'&&entity.values.displayName===handle);current();
          row={version:1,ownerUid:owner,handle,operationId:model.operationId(),createdAt:now(),expectedUid:stored?.entityId||'',expectedGeneration:stored?.generation||0,state:'selected',code:''};await save(row);
        }
        rows.push(row);
      }
      const result=await processRows(rows);await prune();return result;
    });}
    function retry(handles){return serialize(async()=>{const rows=await read();return processRows(rows.filter(row=>!handles||handles.includes(row.handle)));});}
    function cancel(handles){for(const handle of handles||[])cancelled.add(handle);return serialize(async()=>{const value=await snapshot();for(const row of value.rows)if(cancelled.has(row.handle)&&!['pending','confirmed','already-present'].includes(row.state)){await save({...row,state:'cancelled'});}return refresh();});}
    function resume(){return serialize(async()=>{const rows=await read();return processRows(rows.filter(row=>['selected','resolving','ready'].includes(row.state)));});}
    return Object.freeze({ownerUid:owner,ensure,retry,cancel,resume,snapshot,refresh,close(){closed=true;cancelled.clear();}});
  }
  root.favoriteAdditions=Object.freeze({PREFIX,createFavoriteAdditions});
})(window);
