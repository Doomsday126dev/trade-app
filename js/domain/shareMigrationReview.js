(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  const SCHEMA_VERSION=1;
  const TOOL_VERSION='share-migration-manual-review-v1';
  const DECISIONS=Object.freeze([
    'unreviewed',
    'confirmed_valid_identity',
    'confirmed_inactive_legacy',
    'confirmed_duplicate',
    'confirmed_conflict',
    'requires_owner_confirmation',
    'requires_auth_repair_design',
    'requires_projection_republish',
    'insufficient_evidence',
    'protected_no_action'
  ]);
  const CONFIDENCE_LEVELS=Object.freeze(['high','medium','low','unknown']);
  const QUEUES=Object.freeze([
    'protected_accounts',
    'duplicate_conflicts',
    'invalid_uid_authindex_linkage',
    'individually_reviewable',
    'unresolved_records',
    'missing_incomplete_projections',
    'other_diagnostic'
  ]);
  const EXCLUDED_AUTHORITY_SIGNALS=Object.freeze([
    'public_share_contents',
    'public_share_entry_count',
    'community_membership',
    'pokemon_lists',
    'profile_privilege_flags',
    'similar_display_names'
  ]);

  function plain(value){return!!value&&typeof value==='object'&&!Array.isArray(value);}
  function stable(a,b){const left=String(a??''),right=String(b??'');return left<right?-1:left>right?1:0;}
  function unique(values){return[...new Set(values)].sort(stable);}
  function has(record,reason){return Array.isArray(record.reasonCodes)&&record.reasonCodes.includes(reason);}

  function authIndexStatus(record){
    if(record.facts?.authIndexConsistent===true)return'consistent';
    if(has(record,'auth_index_linkage_invalid'))return'invalid_linkage';
    if(!record.uid)return'missing_or_unbound';
    return'unknown';
  }
  function authIdentityStatus(record){
    if(has(record,'auth_identity_disabled'))return'disabled';
    if(has(record,'auth_identity_missing')||record.facts?.authIdentityPresent===false)return'missing';
    if(has(record,'auth_identity_not_corroborated'))return'not_corroborated';
    if(record.facts?.authIdentityPresent===true&&record.facts?.authIdentityEnabled===true)return'present_enabled';
    return'unknown';
  }
  function directoryStatus(record){
    if(record.facts?.directoryReady===true)return'ready';
    if(record.facts?.directoryPresent===false)return'missing';
    if(record.facts?.directoryPresent===true)return'not_ready';
    return'unknown';
  }
  function projectionStatus(record){
    const raw=record.facts?.projectionStatus;
    if(raw==='published'||raw==='published_empty')return'valid_complete';
    if(has(record,'projection_missing_list_projection'))return'projection_incomplete';
    if(has(record,'projection_completeness_markers_missing'))return'projection_markers_missing';
    if(raw==='not_published'||record.facts?.projectionPresent===false)return'no_projection';
    if(raw==='projection_incomplete')return'projection_incomplete';
    return'unsupported_projection';
  }
  function linkageStatus(record){
    if(record.classification==='identity_mapping_conflict'||record.classification==='normalized_name_collision')return'conflicting';
    if(record.facts?.userPresent!==true||!record.uid)return'missing_user_binding';
    if(record.facts?.authIndexConsistent!==true)return'incomplete_or_invalid';
    if(authIdentityStatus(record)!=='present_enabled')return'auth_not_corroborated';
    if(directoryStatus(record)!=='ready')return'directory_not_ready';
    return'consistent';
  }
  function queueFor(record){
    if(record.facts?.protectedAccount===true||record.classification==='protected_account')return'protected_accounts';
    if(record.classification==='identity_mapping_conflict'||record.classification==='normalized_name_collision')return'duplicate_conflicts';
    if(has(record,'auth_index_linkage_invalid'))return'invalid_uid_authindex_linkage';
    if(record.reviewClassification==='individually_reviewable')return'individually_reviewable';
    if(record.classification==='unresolved')return'unresolved_records';
    if(['missing_projection','incomplete_profile_only','unsupported_malformed'].includes(record.classification))return'missing_incomplete_projections';
    return'other_diagnostic';
  }
  function confidenceFor(record){
    const linkage=linkageStatus(record);
    if(linkage==='consistent'&&!['identity_mapping_conflict','normalized_name_collision'].includes(record.classification))return'high';
    if(linkage==='conflicting'||has(record,'auth_index_linkage_invalid')||authIdentityStatus(record)==='disabled')return'low';
    const positive=[record.facts?.directoryReady===true,record.facts?.userPresent===true,record.facts?.authIndexConsistent===true,authIdentityStatus(record)==='present_enabled'].filter(Boolean).length;
    if(record.uid&&positive>=2)return'medium';
    return'unknown';
  }
  function evidenceSummary(record){
    const authoritative=[];
    if(record.facts?.directoryReady===true)authoritative.push('directory_ready');
    if(record.facts?.userPresent===true&&record.uid)authoritative.push('user_uid_bound');
    if(record.facts?.authIndexConsistent===true)authoritative.push('auth_index_bidirectional_match');
    if(authIdentityStatus(record)==='present_enabled')authoritative.push('sanitized_auth_identity_enabled');
    if(record.facts?.protectedAccount===true)authoritative.push('protected_admin_registry_match');
    const contextual=[];
    if(record.facts?.projectionPresent===true)contextual.push('public_projection_present');
    if(Number.isFinite(record.facts?.projectionEntryCount))contextual.push('public_projection_entry_count_available');
    return{authoritative:unique(authoritative),contextual:unique(contextual),excludedAsAuthority:[...EXCLUDED_AUTHORITY_SIGNALS]};
  }
  function allowedDecision(record,decision){
    if(!DECISIONS.includes(decision)||decision==='unreviewed')return false;
    if(record.protectedAccountStatus==='protected')return['protected_no_action','requires_owner_confirmation','insufficient_evidence'].includes(decision);
    if(record.classification==='identity_mapping_conflict'||record.classification==='normalized_name_collision')return[
      'confirmed_duplicate','confirmed_conflict','requires_owner_confirmation','requires_auth_repair_design','insufficient_evidence'
    ].includes(decision);
    return decision!=='protected_no_action';
  }

  function deriveManualReview(sourceReport){
    if(!plain(sourceReport)||!Array.isArray(sourceReport.records)||!plain(sourceReport.source?.snapshotHashes))return{ok:false,error:{code:'review/invalid_source_audit'}};
    const byUid=new Map(),byNormalized=new Map();
    for(const record of sourceReport.records){
      if(record.uid){const rows=byUid.get(record.uid)||[];rows.push(record.recordId);byUid.set(record.uid,rows);}
      if(record.normalizedTrainerName){const rows=byNormalized.get(record.normalizedTrainerName)||[];rows.push(record.recordId);byNormalized.set(record.normalizedTrainerName,rows);}
    }
    const records=sourceReport.records.map(record=>{
      const duplicateCandidates=unique([
        ...(record.uid?(byUid.get(record.uid)||[]):[]),
        ...(record.normalizedTrainerName?(byNormalized.get(record.normalizedTrainerName)||[]):[])
      ].filter(id=>id!==record.recordId));
      const projection=projectionStatus(record);
      return{
        recordId:record.recordId,
        canonicalTrainerName:record.trainerName,
        normalizedTrainerName:record.normalizedTrainerName,
        privateIdentity:{uid:record.uid||null},
        classification:record.classification,
        reviewClassification:record.reviewClassification||null,
        reasonCodes:unique(record.reasonCodes||[]),
        queue:queueFor(record),
        sourcePresence:{
          loginDirectory:record.facts?.directoryPresent===true,
          users:record.facts?.userPresent===true,
          authIndex:record.facts?.authIndexConsistent===true||has(record,'auth_index_linkage_invalid'),
          sanitizedAuth:record.facts?.authIdentityPresent===true,
          publicShare:record.facts?.projectionPresent===true
        },
        uidLinkageStatus:linkageStatus(record),
        authIndexStatus:authIndexStatus(record),
        authIdentityStatus:authIdentityStatus(record),
        loginDirectoryStatus:directoryStatus(record),
        publicProjectionStatus:projection,
        protectedAccountStatus:record.facts?.protectedAccount===true?'protected':'ordinary_or_unknown',
        duplicateCandidates,
        evidenceSummary:evidenceSummary(record),
        confidence:confidenceFor(record),
        reviewerDecision:'unreviewed',
        reviewerNote:'',
        reviewedAt:null,
        seedEligible:false
      };
    }).sort((a,b)=>QUEUES.indexOf(a.queue)-QUEUES.indexOf(b.queue)||stable(a.recordId,b.recordId));
    return{ok:true,value:{schemaVersion:SCHEMA_VERSION,toolVersion:TOOL_VERSION,records}};
  }

  root.shareMigrationReview=Object.freeze({
    SCHEMA_VERSION,TOOL_VERSION,DECISIONS,CONFIDENCE_LEVELS,QUEUES,EXCLUDED_AUTHORITY_SIGNALS,
    deriveManualReview,allowedDecision
  });
})(window);
