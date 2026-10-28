(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  function fail(code){throw Object.assign(new Error(code),{code});}
  function create({model=global.PogoDomain?.accountSyncModel,maxItems=25,maxBytes=65536}={}){
    if(!model?.verifyOperation||!Number.isSafeInteger(maxItems)||maxItems<1||maxItems>50||!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>131072)throw new TypeError('Bounded batch dependencies required');
    async function prepare({operations,ownerUid,sourceDigest}={}){
      if(!Array.isArray(operations)||operations.length>20000||!/^[a-f0-9]{64}$/.test(sourceDigest||''))fail('recovery/batch-invalid');
      const seen=new Set(),ordered=[...operations],order={tag:0,favorite:1,tradeEntry:2};
      for(const op of ordered){if(op.ownerUid!==ownerUid||op.kind!=='add'||!(op.entityType in order)||(await model.verifyOperation(op)).ok!==true||seen.has(op.operationId))fail('recovery/batch-operation-invalid');seen.add(op.operationId);}
      ordered.sort((a,b)=>order[a.entityType]-order[b.entityType]||a.entityId.localeCompare(b.entityId));
      const batches=[];let current=[],bytes=2;
      for(const op of ordered){const size=new TextEncoder().encode(model.canonicalJson(op)).length+1;if(size+2>maxBytes)fail('recovery/batch-item-too-large');
        if(current.length&&(current.length===maxItems||bytes+size>maxBytes)){batches.push(current);current=[];bytes=2;}current.push(op);bytes+=size;}
      if(current.length)batches.push(current);
      const digest=await model.sha256Hex(model.canonicalJson(['recovery-batches-v1',ownerUid,sourceDigest,ordered]));
      return{schemaVersion:1,digest,ownerUid,sourceDigest,operationCount:ordered.length,batches:await Promise.all(batches.map(async(items,index)=>({index,digest:await model.sha256Hex(model.canonicalJson([digest,index,items])),operations:items})))};
    }
    return Object.freeze({prepare});
  }
  root.accountRecoveryBatchPlan=Object.freeze({create});
})(window);
