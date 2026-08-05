(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const MODES=Object.freeze(['public','approved_viewers','private']);
  const CLIENT_STATES=Object.freeze([
    'published_public','published_authorized','restricted','approved_viewers_restricted','private','private_owner',
    'not_published','projection_incomplete','projection_unsupported','transport_error'
  ]);
  const MIGRATION_CLASSES=Object.freeze([
    'valid_complete_public','incomplete_profile_only','missing_projection',
    'unsupported_malformed','inactive_legacy','duplicate_conflict','unresolved'
  ]);

  function result(ok,status,extra={}){return Object.freeze({ok,status,...extra});}
  function validMode(mode){return MODES.includes(mode);}
  function accessState({mode,authenticated=false,isOwner=false,isAdmin=false,approved=false,projectionStatus='published'}={}){
    if(projectionStatus==='transport_error')return result(false,'transport_error');
    if(projectionStatus==='not_published')return result(false,'not_published');
    if(projectionStatus==='projection_incomplete')return result(false,'projection_incomplete');
    if(projectionStatus==='projection_unsupported')return result(false,'projection_unsupported');
    if(!validMode(mode))return result(false,'projection_unsupported',{code:'share-visibility/mode-invalid'});
    if(isOwner||isAdmin)return result(true,mode==='private'?'private_owner':'published_authorized');
    if(mode==='public')return result(true,'published_public');
    if(mode==='approved_viewers'&&authenticated&&approved)return result(true,'published_authorized');
    if(authenticated&&mode==='approved_viewers')return result(false,'approved_viewers_restricted');
    if(authenticated&&mode==='private')return result(false,'private');
    return result(false,'restricted');
  }

  function visibilityPresentation(input={}){
    const state=accessState(input);
    const statusKeys={
      published_public:'share.visibilityPublic',published_authorized:'share.visibilityApproved',private_owner:'share.visibilityPrivateOwner',
      approved_viewers_restricted:'share.visibilityRestricted',private:'share.visibilityPrivate',restricted:'share.visibilityRestricted',
      not_published:'share.visibilityUnpublished',projection_incomplete:'share.visibilityIncomplete',projection_unsupported:'share.visibilityUnsupported',transport_error:'share.visibilityReadError'
    };
    const metadataVisible=state.ok===true;
    return Object.freeze({ok:state.ok,status:state.status,statusKey:statusKeys[state.status]||'share.visibilityUnavailable',metadataVisible,showEntryCount:metadataVisible,showUpdatedAt:metadataVisible,showFingerprint:metadataVisible});
  }

  function readPlan({enabled=false,legacyCompat=true,ownerUid='',username='',authenticated=false}={}){
    if(!enabled){
      return legacyCompat&&username
        ?result(true,'legacy',{reads:Object.freeze([`publicShares/${username}`])})
        :result(false,'not_published',{reads:Object.freeze([])});
    }
    if(!ownerUid)return result(false,'identity_unresolved',{reads:Object.freeze([])});
    const reads=[`trainerShares/${ownerUid}`];
    if(authenticated)reads.unshift(`shareVisibility/${ownerUid}/mode`);
    return result(true,'uid_visibility',{reads:Object.freeze(reads)});
  }

  function classifyMigrationRecord({active=true,conflict=false,resolvedOwner=false,projectionStatus='not_published'}={}){
    if(conflict)return result(false,'duplicate_conflict',{seedEligible:false});
    if(!active)return result(false,'inactive_legacy',{seedEligible:false});
    if(!resolvedOwner)return result(false,'unresolved',{seedEligible:false});
    const statusMap={
      published:'valid_complete_public',published_empty:'valid_complete_public',
      projection_incomplete:'incomplete_profile_only',not_published:'missing_projection',
      projection_unsupported:'unsupported_malformed'
    };
    return result(projectionStatus==='published'||projectionStatus==='published_empty',statusMap[projectionStatus]||'unresolved',{seedEligible:false});
  }

  function approvedViewerPlan({enabled=false,writesEnabled=false,activeOwnerUid='',targetViewerUid='',currentGrant=false,action='grant'}={}){
    const ownerUid=String(activeOwnerUid||'').trim(),viewerUid=String(targetViewerUid||'').trim();
    if(!ownerUid||!viewerUid)return result(false,'identity_unresolved',{code:'share-visibility/identity-required',executable:false});
    if(ownerUid===viewerUid)return result(false,'self_grant_denied',{code:'share-visibility/self-grant-denied',executable:false});
    if(!['grant','revoke'].includes(action))return result(false,'action_invalid',{code:'share-visibility/action-invalid',executable:false});
    const alreadyApplied=(action==='grant'&&currentGrant===true)||(action==='revoke'&&currentGrant!==true);
    return Object.freeze({ok:true,status:alreadyApplied?'no_change':(enabled&&writesEnabled?'ready':'disabled_candidate'),action,ownerUid,viewerUid,executable:enabled===true&&writesEnabled===true&&!alreadyApplied,preferencePaths:Object.freeze([]),favoriteMutation:false});
  }

  function visibilitySettingsModel({enabled=false,currentMode='public'}={}){
    const mode=validMode(currentMode)?currentMode:'public';
    return Object.freeze({status:enabled?'ready':'disabled_candidate',interactive:enabled===true,currentMode:mode,options:Object.freeze(MODES.map(value=>Object.freeze({value,labelKey:`share.mode.${value}`}))),approvedViewerLabelKey:'share.approvedViewersTitle',anonymousHelpKey:`share.anonymous.${mode}`});
  }

  root.shareVisibility=Object.freeze({
    SHARE_VISIBILITY_MODEL_ENABLED:false,
    LEGACY_PUBLIC_SHARE_COMPAT_ENABLED:true,
    MODES,CLIENT_STATES,MIGRATION_CLASSES,validMode,accessState,visibilityPresentation,readPlan,classifyMigrationRecord,approvedViewerPlan,visibilitySettingsModel
  });
})(window);
