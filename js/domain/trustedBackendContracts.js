(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const HANDLE_MAX_CODE_POINTS=64;
  const TAG_MAX_CODE_POINTS=40;
  const HISTORY_MAX_ENTRIES=1500;
  const PUBLIC_CATEGORIES=Object.freeze(['wishlist','dynamax','gmax','costumes']);
  const FIREBASE_KEY_FORBIDDEN=/[.#$\[\]/\u0000-\u001f\u007f]/u;

  function result(ok,status,extra={}){return Object.freeze({ok,status,...extra});}
  function codePoints(value){return Array.from(value).length;}
  function text(value){return String(value??'').normalize('NFKC').trim();}
  function requestGate({authUid='',appCheckValid=false,appCheckRequired=true,requestId=''}={}){
    const uid=text(authUid),id=text(requestId);
    if(!uid)return result(false,'unauthenticated',{code:'trusted-backend/auth-required'});
    if(appCheckRequired&&appCheckValid!==true)return result(false,'app_check_required',{code:'trusted-backend/app-check-required'});
    if(!id||id.length>128)return result(false,'request_invalid',{code:'trusted-backend/request-id-invalid'});
    return result(true,'authorized',{authUid:uid,requestId:id});
  }
  function canonicalHandle(value){
    const parts=root.trainerNames?.trainerNameParts?.(value);
    if(!parts?.valid)return result(false,'invalid_handle',{code:'trusted-backend/handle-empty'});
    if(codePoints(parts.nfkcTrainerName)>HANDLE_MAX_CODE_POINTS)return result(false,'invalid_handle',{code:'trusted-backend/handle-too-long'});
    if(FIREBASE_KEY_FORBIDDEN.test(parts.normalizedTrainerName))return result(false,'invalid_handle',{code:'trusted-backend/handle-key-invalid'});
    return result(true,'normalized',{displayHandle:parts.nfkcTrainerName,normalizedHandle:parts.normalizedTrainerName});
  }
  function reserveHandle(input={}){
    const gate=requestGate(input);if(!gate.ok)return gate;
    const handle=canonicalHandle(input.requestedHandle);if(!handle.ok)return handle;
    if(input.accountUid&&text(input.accountUid)!==gate.authUid)return result(false,'owner_mismatch',{code:'trusted-backend/uid-ownership-mismatch'});
    const claimedUid=text(input.existingClaimUid);
    if(claimedUid&&claimedUid!==gate.authUid)return result(false,'collision',{code:'trusted-backend/handle-collision'});
    return result(true,claimedUid?'idempotent':'reservation_validated',{operation:'handle_reservation',ownerUid:gate.authUid,displayHandle:handle.displayHandle,normalizedHandle:handle.normalizedHandle,requestId:gate.requestId,allowedTargets:Object.freeze(['accounts/{authUid}','shareDirectory/{normalizedHandle}']),identityReassignment:false});
  }
  function tagLabel(value){
    const normalized=root.trainerPreferences?.normalizeTagLabel?.(value);
    if(!normalized?.ok)return result(false,'invalid_tag',{code:normalized?.error?.code||'trusted-backend/tag-invalid'});
    if(codePoints(normalized.displayLabel)>TAG_MAX_CODE_POINTS)return result(false,'invalid_tag',{code:'trusted-backend/tag-too-long'});
    return result(true,'normalized',{displayLabel:normalized.displayLabel,normalizedLabel:normalized.normalizedLabel,labelKey:normalized.labelKey});
  }
  function claimTagLabel(input={}){
    const gate=requestGate(input);if(!gate.ok)return gate;
    const viewerUid=text(input.viewerUid),tagId=text(input.tagId),action=text(input.action||'claim');
    if(viewerUid!==gate.authUid)return result(false,'owner_mismatch',{code:'trusted-backend/tag-namespace-denied'});
    if(!/^tag_[a-z0-9_-]{1,80}$/.test(tagId))return result(false,'invalid_tag',{code:'trainer-preferences/tag-id-invalid'});
    if(!['claim','rename','soft_delete'].includes(action))return result(false,'action_invalid',{code:'trusted-backend/action-invalid'});
    if(action==='soft_delete')return result(true,'soft_delete_validated',{operation:'tag_soft_delete',viewerUid,tagId,requestId:gate.requestId,allowedTargets:Object.freeze(['userPreferences/{viewerUid}/trainerTags/{tagId}'])});
    const label=tagLabel(input.label);if(!label.ok)return label;
    const existingTagId=text(input.existingClaimTagId);
    if(existingTagId&&existingTagId!==tagId)return result(false,'collision',{code:'trusted-backend/tag-label-collision'});
    return result(true,existingTagId?'idempotent':`${action}_validated`,{operation:action==='rename'?'tag_rename':'tag_claim',viewerUid,tagId,displayLabel:label.displayLabel,normalizedLabel:label.normalizedLabel,labelKey:label.labelKey,requestId:gate.requestId,allowedTargets:Object.freeze(['userPreferences/{viewerUid}/trainerTags/{tagId}','userPreferences/{viewerUid}/trainerTagLabels/{labelKey}'])});
  }
  function stable(value){
    if(Array.isArray(value))return`[${value.map(stable).join(',')}]`;
    if(value&&typeof value==='object')return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }
  function verifyHistory(input={}){
    const gate=requestGate(input);if(!gate.ok)return gate;
    const viewerUid=text(input.viewerUid),ownerUid=text(input.ownerUid);
    if(viewerUid!==gate.authUid)return result(false,'owner_mismatch',{code:'trusted-backend/history-namespace-denied'});
    if(!ownerUid)return result(false,'history_invalid',{code:'trusted-backend/history-owner-required'});
    const entries=input.entries;
    if(!entries||typeof entries!=='object'||Array.isArray(entries))return result(false,'history_invalid',{code:'trainer-preferences/history-invalid'});
    const keys=Object.keys(entries);
    if(keys.length>HISTORY_MAX_ENTRIES)return result(false,'history_invalid',{code:'trainer-preferences/history-too-large'});
    for(const key of keys){
      const item=entries[key],fields=item&&typeof item==='object'?Object.keys(item):[];
      if(!item||fields.some(field=>!['category','fingerprint'].includes(field))||!PUBLIC_CATEGORIES.includes(item.category)||!text(item.fingerprint))return result(false,'history_invalid',{code:'trainer-preferences/history-entry-invalid'});
    }
    if(Number(input.entryCount)!==keys.length)return result(false,'history_invalid',{code:'trusted-backend/history-count-mismatch'});
    if(typeof input.sha256!=='function')return result(false,'history_invalid',{code:'trusted-backend/fingerprint-service-required'});
    const fingerprint=String(input.sha256(stable(entries))||'');
    if(!fingerprint||fingerprint!==String(input.declaredFingerprint||''))return result(false,'history_invalid',{code:'trusted-backend/history-fingerprint-mismatch'});
    const priorVersion=Number(input.previous?.lastSeenShareVersion||0),nextVersion=Number(input.lastSeenShareVersion);
    const priorTime=Number(input.previous?.lastSeenUpdatedAt||0),nextTime=Number(input.lastSeenUpdatedAt);
    if(!Number.isSafeInteger(nextVersion)||nextVersion<1||nextVersion<priorVersion)return result(false,'history_invalid',{code:'trusted-backend/history-version-stale'});
    if(!Number.isFinite(nextTime)||nextTime<priorTime)return result(false,'history_invalid',{code:'trusted-backend/history-time-stale'});
    if(nextVersion===priorVersion&&input.previous?.lastSeenFingerprint&&input.previous.lastSeenFingerprint!==fingerprint)return result(false,'history_invalid',{code:'trainer-preferences/seen-conflict'});
    return result(true,'history_verified',{operation:'history_verify',viewerUid,ownerUid,entryCount:keys.length,fingerprint,lastSeenShareVersion:nextVersion,lastSeenUpdatedAt:nextTime,requestId:gate.requestId,allowedTargets:Object.freeze(['userPreferences/{viewerUid}/trainerHistory/{ownerUid}']),acceptedFields:Object.freeze(['category','fingerprint'])});
  }
  function approvedViewerGrant(input={}){
    const gate=requestGate(input);if(!gate.ok)return gate;
    const ownerUid=text(input.ownerUid),viewerUid=text(input.viewerUid),action=text(input.action);
    const adminAuthorized=input.adminRegistryValue===true;
    if(gate.authUid!==ownerUid&&!adminAuthorized)return result(false,'owner_mismatch',{code:'trusted-backend/grant-owner-denied'});
    if(ownerUid===viewerUid)return result(false,'self_grant_denied',{code:'share-visibility/self-grant-denied'});
    if(!viewerUid||!['grant','revoke'].includes(action))return result(false,'action_invalid',{code:'trusted-backend/action-invalid'});
    if(input.targetDirectoryVerified!==true)return result(false,'target_unverified',{code:'trusted-backend/viewer-directory-unverified'});
    const alreadyApplied=(action==='grant'&&input.currentGrant===true)||(action==='revoke'&&input.currentGrant!==true);
    return result(true,alreadyApplied?'idempotent':`${action}_validated`,{operation:`approved_viewer_${action}`,ownerUid,viewerUid,requestId:gate.requestId,allowedTargets:Object.freeze(['shareAccess/{ownerUid}/{viewerUid}']),preferenceTargets:Object.freeze([])});
  }
  function renameHandle(input={}){
    const gate=requestGate(input);if(!gate.ok)return gate;
    if(text(input.accountUid)!==gate.authUid||text(input.currentClaimUid)!==gate.authUid)return result(false,'owner_mismatch',{code:'trusted-backend/uid-ownership-mismatch'});
    const current=canonicalHandle(input.currentHandle),next=canonicalHandle(input.requestedHandle);if(!current.ok)return current;if(!next.ok)return next;
    const nextClaim=text(input.nextClaimUid);if(nextClaim&&nextClaim!==gate.authUid)return result(false,'collision',{code:'trusted-backend/handle-collision'});
    return result(true,current.normalizedHandle===next.normalizedHandle?'display_update_validated':'rename_validated',{operation:'handle_rename',ownerUid:gate.authUid,currentNormalizedHandle:current.normalizedHandle,nextDisplayHandle:next.displayHandle,nextNormalizedHandle:next.normalizedHandle,requestId:gate.requestId,atomic:true,allowedTargets:Object.freeze(['accounts/{authUid}','shareDirectory/{currentNormalizedHandle}','shareDirectory/{nextNormalizedHandle}','legacyShareOwners/{currentUsername}']),identityReassignment:false});
  }
  function redactedAuditEvent({operation='',status='',code='',durationMs=0}={}){
    const operationCode=text(operation),statusCode=text(status),errorCode=text(code),duration=Math.max(0,Math.round(Number(durationMs)||0));
    if(!operationCode||!statusCode)return result(false,'log_invalid',{code:'trusted-backend/log-invalid'});
    return Object.freeze({schemaVersion:1,operation:operationCode,status:statusCode,errorCode:errorCode||null,durationMs:duration,identityRedacted:true,payloadRedacted:true});
  }

  root.trustedBackendContracts=Object.freeze({
    HANDLE_MAX_CODE_POINTS,TAG_MAX_CODE_POINTS,HISTORY_MAX_ENTRIES,PUBLIC_CATEGORIES,
    requestGate,canonicalHandle,reserveHandle,tagLabel,claimTagLabel,verifyHistory,approvedViewerGrant,renameHandle,redactedAuditEvent,stable
  });
})(window);
