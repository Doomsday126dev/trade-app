(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  function fail(code){throw Object.assign(new Error(code),{code});}
  const clone=value=>JSON.parse(JSON.stringify(value));
  // Deliberately owns only an in-memory snapshot. No injected writer or database.
  function create({initialBundle,bundleModel,dryRun,getSession,clock=()=>Date.now()}={}){
    const model=global.PogoDomain?.accountSyncModel,merge=global.PogoDomain?.accountSyncMerge;
    if(!model||!merge||!bundleModel?.verify||!dryRun?.revalidate||typeof getSession!=='function')throw new TypeError('Synthetic recovery dependencies required');
    let current=clone(initialBundle),tail=Promise.resolve();const reviews=new WeakMap();
    function session(){const value=getSession();if(!value?.uid||!value.lifecycleId||value.accountReady!==true)fail('recovery/session-not-ready');return{uid:value.uid,lifecycleId:value.lifecycleId};}
    function unchanged(expected){const value=session();if(value.uid!==expected.uid||value.lifecycleId!==expected.lifecycleId)fail('recovery/session-changed');}
    async function review({sourceBundle,plan,accepted=false}={}){
      if(accepted!==true)fail('recovery/explicit-review-required');
      const captured=session(),source=clone(sourceBundle),reviewed=clone(plan);
      if(!reviewed.sameOwner||reviewed.targetUid!==captured.uid)fail('recovery/identity-recovery-required');
      await dryRun.revalidate({plan:reviewed,sourceBundle:source,currentBundle:current,targetUid:captured.uid});unchanged(captured);
      const ticket=Object.freeze({status:'reviewed',operationCount:reviewed.operations.length});
      reviews.set(ticket,{source,plan:reviewed,session:captured,receipt:null});return ticket;
    }
    function apply(ticket){
      const work=tail.then(async()=>{
        const record=reviews.get(ticket);if(!record)fail('recovery/review-required');unchanged(record.session);
        if(record.receipt)return clone({...record.receipt,replay:true});
        await dryRun.revalidate({plan:record.plan,sourceBundle:record.source,currentBundle:current,targetUid:record.session.uid});unchanged(record.session);
        const next=clone(current),entities=new Map(next.sections.canonicalEntities.records.map(row=>[row.id,row.value]));
        for(const operation of record.plan.operations){
          if(operation.ownerUid!==record.session.uid||operation.kind!=='add'||!['tradeEntry','favorite','tag'].includes(operation.entityType))fail('recovery/operation-invalid');
          const key=`${operation.entityType}:${operation.entityId}`,prior=entities.get(key)||null;
          const result=merge.mergeOperation(prior,operation,{acceptedAt:clock()});
          if(!result.ok||!['applied','idempotent'].includes(result.status))fail('recovery/conflict-review-required');
          entities.set(key,result.value);
        }
        next.sections.canonicalEntities.records=[...entities].map(([id,value])=>({id,value}));
        next.source.revision=await model.sha256Hex(model.canonicalJson(next.sections));
        const prepared=await bundleModel.create({source:next.source,sections:next.sections});
        await bundleModel.verify(prepared);unchanged(record.session);
        for(const operation of record.plan.operations){
          const entity=prepared.sections.canonicalEntities.records.find(row=>row.id===`${operation.entityType}:${operation.entityId}`)?.value;
          const proof=merge.mergeOperation(entity,operation,{acceptedAt:clock()});
          if(!proof.ok||proof.status!=='idempotent')fail('recovery/readback-unverified');
        }
        // One atomic in-memory publish after every check; noncanonical data is untouched.
        current=prepared;record.receipt={status:'verified',replay:false,operationIds:record.plan.operations.map(row=>row.operationId),revision:current.source.revision};
        return clone(record.receipt);
      });tail=work.catch(()=>{});return work;
    }
    return Object.freeze({environment:'synthetic-memory-only',review,apply,read:()=>clone(current)});
  }
  root.accountRecoverySyntheticApply=Object.freeze({create});
})(window);
