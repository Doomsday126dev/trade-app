(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  function fail(code){throw Object.assign(new Error(code),{code});}
  const clone=value=>JSON.parse(JSON.stringify(value));
  function create({bundleModel,model=global.PogoDomain?.accountSyncModel,merge=global.PogoDomain?.accountSyncMerge,migration=global.PogoDomain?.accountSyncMigration,parseListValue,catalogIdentity,resolveFavoriteUid,genderForVariant=()=>''}={}){
    if(!bundleModel?.verify||!migration?.buildMigrationPlan||!model||!merge||typeof parseListValue!=='function'||typeof catalogIdentity!=='function')throw new TypeError('Explicit verified catalog and legacy parser required');
    async function convert(bundle){
      const source=await bundleModel.verify(bundle),sections=clone(source.sections);
      const get=(section,id)=>source.sections[section].records.find(row=>row.id===id)?.value;
      const profile=get('profile','legacy-profile')||{},history=get('preferences','history')||{};
      if(history.owner&&(history.owner.uid!==source.source.ownerUid||history.owner.username!==source.source.trainerHandle))fail('recovery/history-owner-or-version-invalid');
      const dependencies={parseListValue,genderForVariant,resolveFavoriteUid,
        catalogIdentity:(...args)=>{const identity=catalogIdentity(...args);return identity?.catalogId&&!identity.catalogId.startsWith('legacy:')?identity:null;}};
      const plan=await migration.buildMigrationPlan({ownerUid:source.source.ownerUid,username:source.source.trainerHandle,deviceInstallId:`recovery_${source.integrity.digest}`,
        legacyRemoteLists:get('legacyLists','remote')||{},legacyLocalLists:get('legacyLists','local')||{},legacyRemoteBoard:profile.specialTradeBoard||{lf:[],ft:[]},legacyLocalBoard:{lf:[],ft:[]},
        legacyQueue:{},orders:get('legacyLists','orders')||{},favorites:history.favorites||[],tags:history.tags||{},remoteCanonical:source.sections.canonicalEntities.records.map(row=>row.value),canonicalInitialized:false},dependencies);
      if(!plan.ok)fail('recovery/catalog-conversion-invalid');
      const existing=new Map(sections.canonicalEntities.records.map(row=>[row.id,row.value])),added=[];
      for(const seed of [...plan.tagSeeds,...plan.favoriteSeeds,...plan.tradeSeeds]){
        const id=`${seed.entityType}:${seed.entityId}`;if(existing.has(id))continue;
        const patch=seed.entityType==='favorite'?{displayName:seed.values.displayName,...Object.fromEntries(Object.entries(seed.values.tagIds||{}).map(([id,value])=>[`tagIds/${id}`,value]))}:seed.values;
        const operationId=`op_${await model.sha256Hex(model.canonicalJson(['legacy-recovery-v1',source.integrity.digest,id]))}`;
        const built=await model.createOperation({ownerUid:source.source.ownerUid,entityType:seed.entityType,entityId:seed.entityId,identity:seed.identity,kind:'add',operationId,
          baseGeneration:0,generation:1,baseFieldRevisions:Object.fromEntries(Object.keys(patch).map(key=>[key,0])),patch,clientAt:source.source.capturedAt});
        if(!built.ok)fail('recovery/catalog-operation-invalid');const merged=merge.mergeOperation(null,built.value,{acceptedAt:source.source.capturedAt});
        if(!merged.ok)fail('recovery/catalog-operation-invalid');existing.set(id,merged.value);added.push(id);
      }
      sections.canonicalEntities.records=[...existing].map(([id,value])=>({id,value}));
      for(const candidate of plan.recoveryCandidates){const id=`legacy-conversion:${candidate.candidateId}`;if(!sections.recovery.records.some(row=>row.id===id))sections.recovery.records.push({id,value:clone(candidate)});}
      return{bundle:await bundleModel.create({source:source.source,sections}),added,manualReview:clone(plan.recoveryCandidates),ignoredQueueRequiresReview:!!get('journal','legacy-pending-queue')&&Object.keys(get('journal','legacy-pending-queue')).length>0};
    }
    return Object.freeze({convert});
  }
  root.accountRecoveryLegacyConversion=Object.freeze({create});
})(window);
