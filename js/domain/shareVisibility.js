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

  root.shareVisibility=Object.freeze({
    SHARE_VISIBILITY_MODEL_ENABLED:false,
    LEGACY_PUBLIC_SHARE_COMPAT_ENABLED:true,
    MODES,CLIENT_STATES,MIGRATION_CLASSES,validMode,accessState,readPlan,classifyMigrationRecord
  });
})(window);
