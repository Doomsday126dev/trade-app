(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{},clone=value=>JSON.parse(JSON.stringify(value));
  function fail(code){throw Object.assign(new Error(code),{code});}
  function create({enabled=false,repository,journal,bundleModel,batchPlanner,model=global.PogoDomain?.accountSyncModel,merge=global.PogoDomain?.accountSyncMerge,getSession,verifyFavoriteTarget,verifyTradeIdentity,onBatch=async()=>{}}={}){
    if(!enabled)return Object.freeze({available:false});
    if(!repository?.readAccount||!repository?.applyOperation||!journal?.getMeta||!journal?.setMeta||!bundleModel?.verify||!batchPlanner?.prepare||typeof getSession!=='function')throw new TypeError('Owner-bound production consumers required');
    let generation=0,active=false;const tickets=new WeakMap();
    function session(){const value=getSession();if(!value?.uid||!value.lifecycleId||value.accountReady!==true||repository.ownerUid!==value.uid)fail('recovery/session-not-ready');return{uid:value.uid,lifecycleId:value.lifecycleId};}
    function current(expected,epoch){const value=session();if(value.uid!==expected.uid||value.lifecycleId!==expected.lifecycleId||epoch!==generation)fail('recovery/session-changed');}
    const key=digest=>`recovery-batch-${digest}`;
    async function review({sourceBundle,operations,accepted=false,resumeDigest}={}){
      if(accepted!==true||active)fail('recovery/explicit-review-required');
      const captured=session(),epoch=generation,source=await bundleModel.verify(sourceBundle);current(captured,epoch);
      if(source.source.ownerUid!==captured.uid)fail('recovery/identity-recovery-required');
      let plan;
      if(resumeDigest){if(!/^[a-f0-9]{64}$/.test(resumeDigest))fail('recovery/batch-invalid');const record=await journal.getMeta(key(resumeDigest));current(captured,epoch);
        if(record?.ownerUid!==captured.uid||record?.plan?.sourceDigest!==source.integrity.digest)fail('recovery/batch-review-changed');plan=record.plan;
      }else plan=await batchPlanner.prepare({operations,ownerUid:captured.uid,sourceDigest:source.integrity.digest});
      const rebuilt=await batchPlanner.prepare({operations:plan.batches.flatMap(batch=>batch.operations),ownerUid:captured.uid,sourceDigest:source.integrity.digest});current(captured,epoch);
      if(model.canonicalJson(rebuilt)!==model.canonicalJson(plan))fail('recovery/batch-review-changed');
      const sourceRows=new Map(source.sections.canonicalEntities.records.map(row=>[row.id,row]));
      for(const op of plan.batches.flatMap(batch=>batch.operations)){
        const row=sourceRows.get(`${op.entityType}:${op.entityId}`),expected=merge.mergeOperation(null,op,{acceptedAt:op.clientAt});
        if(!row||!merge.validateEntity(row.value,{ownerUid:captured.uid,entityType:op.entityType,entityId:op.entityId}).ok||row.value.deleted||row.value.generation!==1||!expected.ok||model.canonicalJson(row.value.values)!==model.canonicalJson(expected.value.values))fail('recovery/source-operation-mismatch');
      }
      const prior=await journal.getMeta(key(plan.digest));current(captured,epoch);
      if(prior&&model.canonicalJson(prior.plan)!==model.canonicalJson(plan))fail('recovery/batch-review-changed');
      if(!prior)await journal.setMeta(key(plan.digest),{ownerUid:captured.uid,plan:clone(plan)});current(captured,epoch);
      const ticket=Object.freeze({digest:plan.digest,batchCount:plan.batches.length,operationCount:plan.operationCount});tickets.set(ticket,{plan:clone(plan),captured,epoch});return ticket;
    }
    async function run(ticket){
      if(active)fail('recovery/batch-pending');const record=tickets.get(ticket);if(!record)fail('recovery/explicit-review-required');active=true;
      const {plan,captured,epoch}=record;let verified=0;
      const collection={tradeEntry:'tradeEntries',favorite:'favorites',tag:'tags'};
      async function read(op){const account=await repository.readAccount();current(captured,epoch);if(account?.meta?.ownerUid!==captured.uid||account.meta.initialized!==true)fail('recovery/owner-mismatch');return account[collection[op.entityType]]?.[op.entityId]||null;}
      try{
        for(const batch of plan.batches){
          current(captured,epoch);
          for(const op of batch.operations){
            current(captured,epoch);
            if(op.entityType==='tradeEntry'&&(typeof verifyTradeIdentity!=='function'||(await verifyTradeIdentity(op.identity))?.catalogId!==op.identity.catalogId))fail('recovery/catalog-identity-review');
            if(op.entityType==='favorite'&&(op.identity.targetUid===captured.uid||typeof verifyFavoriteTarget!=='function'||(await verifyFavoriteTarget(op.identity.targetUid,op))?.uid!==op.identity.targetUid))fail('recovery/favorite-identity-review');
            current(captured,epoch);
            const receiptKey=`recovery-item-${op.operationId.slice(3)}`,prior=await journal.getMeta(receiptKey);current(captured,epoch);
            let entity=await read(op);
            if(entity){const proof=merge.mergeOperation(entity,op,{acceptedAt:op.clientAt}),expected=merge.mergeOperation(null,op,{acceptedAt:op.clientAt});
              if(!proof.ok||proof.status!=='idempotent')fail('recovery/conflict-review-required');
              if(!expected.ok||model.canonicalJson(entity.values)!==model.canonicalJson(expected.value.values))fail('recovery/committed-content-changed');
            }else{
              if(prior?.status==='verified')fail('recovery/committed-content-changed');
              if(prior?.status==='pending')fail('recovery/outcome-unproven');
              await journal.setMeta(receiptKey,{ownerUid:captured.uid,planDigest:plan.digest,status:'pending',operation:op});current(captured,epoch);
              const result=await repository.applyOperation(op);current(captured,epoch);if(!result?.ok)fail(result?.error?.code||'recovery/write-unverified');
              entity=await read(op);
            }
            if(!entity||!merge.validateEntity(entity,{ownerUid:captured.uid,entityType:op.entityType,entityId:op.entityId}).ok)fail('recovery/readback-unverified');
            const expectedContent=merge.mergeOperation(null,op,{acceptedAt:op.clientAt});
            if(!expectedContent.ok||model.canonicalJson(entity.values)!==model.canonicalJson(expectedContent.value.values))fail('recovery/committed-content-changed');
            const digest=await model.sha256Hex(model.canonicalJson(entity));current(captured,epoch);
            if(prior?.status==='verified'&&prior.entityDigest!==digest)fail('recovery/committed-content-changed');
            await journal.setMeta(receiptKey,{ownerUid:captured.uid,planDigest:plan.digest,status:'verified',operationId:op.operationId,entityDigest:digest});current(captured,epoch);verified++;
          }
          await onBatch({index:batch.index,verified,total:plan.operationCount});current(captured,epoch);
        }
        return{status:'verified',digest:plan.digest,verified};
      }finally{active=false;}
    }
    return Object.freeze({available:true,review,run,cancel(){generation++;return{status:active?'stopping-after-current-write':'canceled'};}});
  }
  root.accountRecoveryOwnerConsumer=Object.freeze({create});
})(window);
