(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  function fail(code){throw Object.assign(new Error(code),{code});}
  function createAccountRecoveryDryRun({bundleModel,model=global.PogoDomain?.accountSyncModel,merge=global.PogoDomain?.accountSyncMerge,resolveFavoriteTarget}={}){
    if(!bundleModel?.verify||!model||!merge)throw new TypeError('Recovery dry-run dependencies required');
    async function prepare({sourceBundle,currentBundle,targetUid}={}){
      const source=await bundleModel.verify(sourceBundle),target=await bundleModel.verify(currentBundle);
      if(target.source.ownerUid!==targetUid)fail('recovery/target-owner-mismatch');
      const sameOwner=source.source.ownerUid===targetUid,rows=[],operations=[];
      const existing=new Map(target.sections.canonicalEntities.records.map(row=>[row.id,row.value]));
      const sourceTags=new Set(source.sections.canonicalEntities.records.filter(row=>row.value.entityType==='tag'&&!row.value.deleted&&row.value.generation===1&&!existing.has(row.id)).map(row=>row.value.entityId));
      const currentTags=new Set(target.sections.canonicalEntities.records.filter(row=>row.value.entityType==='tag'&&!row.value.deleted).map(row=>row.value.entityId));
      for(const record of source.sections.canonicalEntities.records){
        const entity=record.value;
        if(!merge.validateEntity(entity,{ownerUid:source.source.ownerUid,entityType:entity.entityType,entityId:entity.entityId}).ok||record.id!==`${entity.entityType}:${entity.entityId}`)fail('recovery/canonical-invalid');
        const present=existing.get(record.id);
        if(present&&!merge.validateEntity(present,{ownerUid:targetUid,entityType:entity.entityType,entityId:entity.entityId}).ok)fail('recovery/canonical-invalid');
        let status;
        if(!sameOwner)status='identity-recovery-required';
        else if(present)status=model.canonicalJson(present)===model.canonicalJson(entity)?'unchanged':'conflict-review';
        else if(entity.deleted||entity.generation!==1)status='lifecycle-review';
        else if(entity.entityType==='favorite'&&(typeof resolveFavoriteTarget!=='function'||(await resolveFavoriteTarget({expectedUid:entity.identity.targetUid}))?.uid!==entity.identity.targetUid))status='favorite-identity-review';
        else if(entity.entityType==='favorite'&&Object.entries(entity.values.tagIds||{}).some(([id,included])=>included===true&&!sourceTags.has(id)&&!currentTags.has(id)))status='tag-reference-review';
        else status='proposed-add';
        const row={section:'canonicalEntities',id:record.id,status};rows.push(row);
        if(status==='proposed-add'){
          const patch=entity.entityType==='favorite'?{displayName:entity.values.displayName,...Object.fromEntries(Object.entries(entity.values.tagIds||{}).map(([key,value])=>[`tagIds/${key}`,value]))}:entity.values;
          const operationId=`op_${await model.sha256Hex(model.canonicalJson(['recovery-v1',source.integrity.digest,targetUid,record.id]))}`;
          const built=await model.createOperation({ownerUid:targetUid,entityType:entity.entityType,entityId:entity.entityId,identity:entity.identity,kind:'add',operationId,
            baseGeneration:0,generation:1,baseFieldRevisions:Object.fromEntries(Object.keys(patch).map(key=>[key,0])),patch,clientAt:source.source.capturedAt});
          if(!built.ok)fail('recovery/operation-invalid');operations.push(built.value);
        }
      }
      // Noncanonical sections are inventoried for review, never turned into arbitrary database paths.
      for(const section of global.PogoDev.accountRecoveryBundle.SECTIONS.filter(name=>name!=='canonicalEntities'))for(const record of source.sections[section].records){
        const current=target.sections[section].records.find(value=>value.id===record.id);
        rows.push({section,id:record.id,status:current&&model.canonicalJson(current.value)===model.canonicalJson(record.value)?'unchanged':'reference-or-content-review'});
      }
      const order={tag:0,favorite:1,tradeEntry:2};operations.sort((a,b)=>order[a.entityType]-order[b.entityType]||a.entityId.localeCompare(b.entityId));
      return{schemaVersion:1,targetUid,sourceDigest:source.integrity.digest,expectedTargetRevision:target.source.revision,sameOwner,
        automaticApply:false,rows,operations};
    }
    async function revalidate({plan,sourceBundle,currentBundle,targetUid}={}){
      const current=await bundleModel.verify(currentBundle);
      if(current.source.revision!==plan.expectedTargetRevision||targetUid!==plan.targetUid)fail('recovery/stale-plan');
      const rebuilt=await prepare({sourceBundle,currentBundle,targetUid});
      if(model.canonicalJson(rebuilt)!==model.canonicalJson(plan))fail('recovery/plan-changed');
      return{ok:true,automaticApply:false,operations:rebuilt.operations};
    }
    return Object.freeze({prepare,revalidate});
  }
  root.accountRecoveryDryRun=Object.freeze({createAccountRecoveryDryRun});
})(window);
