(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const UID_SEED_TARGETS=Object.freeze(['accounts/{uid}','shareVisibility/{uid}','shareDirectory/{normalizedTrainerName}','trainerShares/{uid}','legacyShareOwners/{username}']);
  const PREFERENCE_SECTIONS=Object.freeze(['favoriteTrainers','recentTrainerSlots','trainerTags','trainerTagLabels','trainerHistory']);

  function result(ok,status,extra={}){return Object.freeze({ok,status,...extra});}
  function exactOne(records){return Array.isArray(records)&&records.length===1?records[0]:null;}
  function oneRecordEligibility({records=[],sourceAuditHash='',expectedSourceAuditHash='',reviewReportHash='',expectedReviewReportHash='',freshProductionAudit=false,ownerApproval=false,recordDryRunReviewed=false,rollbackReviewed=false}={}){
    const record=exactOne(records);
    if(!record)return result(false,'blocked',{code:'share-activation/exactly-one-record-required',seedEligible:false});
    const gates=Object.freeze({
      freshProductionAudit:freshProductionAudit===true,
      sourceAuditMatch:!!sourceAuditHash&&sourceAuditHash===expectedSourceAuditHash,
      reviewReportMatch:!!reviewReportHash&&reviewReportHash===expectedReviewReportHash,
      diagnosticIdentityConfirmed:record.reviewerDecision==='confirmed_valid_identity',
      seedStateUnchanged:record.seedEligible===false,
      noConflict:record.conflict!==true&&!['duplicate_conflicts','protected_accounts'].includes(record.queue),
      completeProjection:record.publicProjectionStatus==='valid_complete',
      uidOwnershipVerified:record.linkageStatus==='consistent',
      explicitOwnerApproval:ownerApproval===true,
      recordDryRunReviewed:recordDryRunReviewed===true,
      rollbackReviewed:rollbackReviewed===true
    });
    const blockers=Object.keys(gates).filter(key=>gates[key]!==true);
    return result(blockers.length===0,blockers.length?'blocked':'eligible_for_separate_seed_approval',{gates,blockers:Object.freeze(blockers),recordCount:1,seedEligible:false,requiresExplicitSeedEligibilityApproval:true});
  }
  function uidSeedDryRun({records=[],eligibility,baselineFingerprints={},proposedVisibility='private',fingerprint}={}){
    const record=exactOne(records);
    if(!record)return result(false,'blocked',{code:'share-activation/exactly-one-record-required',writes:0,seedEligible:false});
    if(!eligibility?.ok)return result(false,'blocked',{code:'share-activation/eligibility-required',writes:0,seedEligible:false});
    if(record.publicProjectionStatus!=='valid_complete')return result(false,'blocked',{code:'share-activation/complete-projection-required',writes:0,seedEligible:false});
    if(!['public','approved_viewers','private'].includes(proposedVisibility))return result(false,'blocked',{code:'share-activation/visibility-invalid',writes:0,seedEligible:false});
    if(typeof fingerprint!=='function')return result(false,'blocked',{code:'share-activation/fingerprint-required',writes:0,seedEligible:false});
    const before=Object.fromEntries(UID_SEED_TARGETS.map(target=>[target,String(baselineFingerprints[target]||'missing')]));
    const after=Object.fromEntries(UID_SEED_TARGETS.map(target=>[target,String(fingerprint({target,sourceEvidenceDigest:record.evidenceHash||'',proposedVisibility}))]));
    return result(true,'dry_run_ready',{mode:'dry-run',recordCount:1,targets:UID_SEED_TARGETS,beforeFingerprints:Object.freeze(before),afterFingerprints:Object.freeze(after),proposedVisibility,writes:0,seedEligible:false,bulkSupported:false,applySupported:false,identityRepair:false,ownedListProjectionGeneration:false,requiresIndependentPayloadReview:true,staleWarning:'Re-read and revalidate production baselines before any separately approved write.'});
  }
  function preferenceMigrationDryRun({activeIdentity,partitionIdentity,local={},server={},serverReadsComplete=false,userApproved=false}={}){
    const planner=root.trainerPreferences?.planLocalImport;
    if(typeof planner!=='function')return result(false,'blocked',{code:'share-activation/preference-domain-required',writes:0});
    const plan=planner({activeIdentity,partitionIdentity,local,server,serverReadsComplete,userApproved,featureEnabled:false,writesEnabled:false});
    if(!plan.ok)return result(false,'blocked',{code:plan.error.code,writes:0,deleteLocal:false});
    const tagsById=new Map();let invalidTags=0;
    for(const source of [server.tags||{},local.tags||{}])for(const [tagId,tag] of Object.entries(source)){
      const normalized=root.trainerPreferences.normalizeTagRecord(tagId,tag);
      if(!normalized.ok){invalidTags++;continue;}
      const current=tagsById.get(tagId),candidate=normalized.value;
      if(!current||candidate.updatedAt>current.updatedAt)tagsById.set(tagId,{...candidate,createdAt:current?Math.min(current.createdAt,candidate.createdAt):candidate.createdAt});
    }
    const normalizedTags=[...tagsById.values()].sort((a,b)=>a.tagId.localeCompare(b.tagId));
    const claims=new Map(),conflicts=[];
    for(const tag of normalizedTags){
      const prior=claims.get(tag.normalizedLabel);
      if(prior&&prior!==tag.tagId)conflicts.push(tag.normalizedLabel);else claims.set(tag.normalizedLabel,tag.tagId);
    }
    const tagConflicts=new Set(conflicts).size;
    const historyValues=Object.values(plan.preview?.history||{}),historyInvalidCount=historyValues.filter(item=>{
      const snapshot=root.trainerPreferences.normalizeHistorySnapshot(item?.lastSeenSnapshot||{});
      return !snapshot.ok||(item.entryCount!=null&&Number(item.entryCount)!==snapshot.entryCount);
    }).length;
    const trainerTags=Object.fromEntries(normalizedTags.map(tag=>[tag.tagId,Object.freeze(tag)]));
    const trainerTagLabels=Object.fromEntries(normalizedTags.filter(tag=>tag.active!==false).map(tag=>[tag.labelKey,tag.tagId]));
    const privatePlan=Object.freeze({favoriteTrainers:plan.preview.favorites,recentTrainerSlots:plan.preview.recents,trainerTags:Object.freeze(trainerTags),trainerTagLabels:Object.freeze(trainerTagLabels),trainerHistory:plan.preview.history});
    const counts=Object.freeze({...plan.counts,tags:normalizedTags.length});
    const fingerprint=root.trainerPreferences.importFingerprint(privatePlan);
    const blocked=tagConflicts>0||invalidTags>0||historyInvalidCount>0;
    return result(!blocked,blocked?'conflict_or_invalid':'dry_run_ready',{mode:'dry-run',ownerVerified:true,sections:PREFERENCE_SECTIONS,counts,fingerprint,tagConflictCount:tagConflicts,invalidTagCount:invalidTags,historyInvalidCount,recentsBounded:(plan.counts.recents||0)<=30,historyBounded:historyInvalidCount===0,mergeRules:Object.freeze({favorites:'dedupe_owner_uid_earliest_added_at',recents:'newest_activity_fixed_slots',tags:'newest_tag_timestamp_normalized_conflicts_require_review',history:'highest_version_then_newest_timestamp'}),privatePlan,writes:0,applySupported:false,deleteLocal:false,requiresRereadVerification:true});
  }

  root.shareActivationPlanning=Object.freeze({UID_SEED_TARGETS,PREFERENCE_SECTIONS,oneRecordEligibility,uidSeedDryRun,preferenceMigrationDryRun});
})(window);
