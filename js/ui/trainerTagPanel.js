(function(global){
  const root=global.PogoUI=global.PogoUI||{};
  const BREAKPOINT=600;
  const SYNC_STATUS=Object.freeze({
    'local-only':Object.freeze({icon:'device',statusKey:'trainer.syncState.local-only',detailKey:'trainer.syncStatus.localOnlyDetail'}),
    'pending-sync':Object.freeze({icon:'sync',statusKey:'trainer.syncState.pending-sync',detailKey:'trainer.syncStatus.pendingDetail'}),
    synced:Object.freeze({icon:'check',statusKey:'trainer.syncState.synced',detailKey:'trainer.syncStatus.syncedDetail'}),
    conflict:Object.freeze({icon:'attention',statusKey:'trainer.syncState.conflict',detailKey:'trainer.syncStatus.conflictDetail'}),
    'sync-error':Object.freeze({icon:'retry',statusKey:'trainer.syncState.sync-error',detailKey:'trainer.syncStatus.errorDetail'})
  });
  const CONFLICTS=Object.freeze({
    'note-edit':Object.freeze({titleKey:'trainer.syncConflict.note.title',localKey:'trainer.syncConflict.note.local',remoteKey:'trainer.syncConflict.note.remote',preserveKey:'trainer.syncConflict.note.preserve',discardKey:'trainer.syncConflict.note.discard',choices:Object.freeze(['keep-both','use-device','use-cloud'])}),
    'tag-rename':Object.freeze({titleKey:'trainer.syncConflict.tagRename.title',localKey:'trainer.syncConflict.tagRename.local',remoteKey:'trainer.syncConflict.tagRename.remote',preserveKey:'trainer.syncConflict.tagRename.preserve',discardKey:'trainer.syncConflict.tagRename.discard',choices:Object.freeze(['keep-both','use-device','use-cloud'])}),
    'favorite-stale':Object.freeze({titleKey:'trainer.syncConflict.favorite.title',localKey:'trainer.syncConflict.favorite.local',remoteKey:'trainer.syncConflict.favorite.remote',preserveKey:'trainer.syncConflict.favorite.preserve',discardKey:'trainer.syncConflict.favorite.discard',choices:Object.freeze(['keep-current','try-again'])}),
    'offline-newer-remote':Object.freeze({titleKey:'trainer.syncConflict.offline.title',localKey:'trainer.syncConflict.offline.local',remoteKey:'trainer.syncConflict.offline.remote',preserveKey:'trainer.syncConflict.offline.preserve',discardKey:'trainer.syncConflict.offline.discard',choices:Object.freeze(['keep-both','use-device','use-cloud'])}),
    'stale-schema':Object.freeze({titleKey:'trainer.syncConflict.version.title',localKey:'trainer.syncConflict.version.local',remoteKey:'trainer.syncConflict.version.remote',preserveKey:'trainer.syncConflict.version.preserve',discardKey:'trainer.syncConflict.version.discard',choices:Object.freeze(['refresh'])})
  });
  const COUNT_KEYS=Object.freeze(['favorites','tags','notes','recents','history']);

  function tagsById(tags){return Object.fromEntries(tags.map(tag=>[tag.tagId,tag]));}
  function layoutForWidth(width,height=800){
    const viewport=Math.max(0,Number(width)||0),mobile=viewport<=BREAKPOINT;
    return Object.freeze({mode:mobile?'mobile_sheet':'desktop_dialog',width:viewport,touchTargetPx:48,chipsWrap:true,horizontalOverflow:false,internalScroll:true,maxHeightPx:Math.max(220,Math.floor((Number(height)||800)*0.82)),focusTrap:true,keyboardNavigation:true,pointer:true,touch:true,hoverRequired:false});
  }
  function accessibilityModel(){return Object.freeze({dialogRole:'dialog',listRole:'listbox',optionRole:'option',modal:true,focusTrap:true,escapeCloses:true,restoreFocus:true,visibleFocus:true,labelKeys:Object.freeze({dialog:'trainer.tagsDialogLabel',filters:'trainer.tagsFilterLabel',note:'trainer.privateNoteLabel',approvedViewers:'share.approvedViewersTitle'})});}
  function boundedCount(value){const number=Number(value);return Number.isSafeInteger(number)&&number>=0?number:0;}
  function countModel(value={}){return Object.freeze(Object.fromEntries(COUNT_KEYS.map(key=>[key,boundedCount(value[key])])));}
  function syncStatusViewModel({featureEnabled=false,writesEnabled=false,state='local-only',pendingCount=0,conflictCount=0,lastSuccessfulSyncAt=0,reducedMotion=false,previewSource='',syncDomain}={}){
    if(!syncDomain)throw new TypeError('Trainer preference status requires the sync domain');
    const previewAllowed=previewSource==='deterministic-mock';
    const presentation=syncDomain.preferenceSyncPresentation({featureEnabled:featureEnabled===true&&previewAllowed,writesEnabled:writesEnabled===true&&previewAllowed,state,pendingCount,conflictCount,lastSuccessfulSyncAt});
    const status=SYNC_STATUS[presentation.state]||SYNC_STATUS['local-only'];
    return Object.freeze({
      state:presentation.state,icon:status.icon,statusKey:status.statusKey,detailKey:status.detailKey,
      iconAndText:true,colorOnly:false,ariaLive:'polite',ariaAtomic:true,
      animated:presentation.state==='pending-sync'&&reducedMotion!==true,
      lastSuccessfulSyncAt:presentation.lastSuccessfulSyncAt,
      lastSuccessKey:presentation.lastSuccessfulSyncAt?'trainer.syncLastSuccess':'trainer.syncLastSuccessNever'
    });
  }
  function conflictViewModel({kind,fixture,featureEnabled=false,writesEnabled=false,width=1024,height=800}={}){
    const definition=CONFLICTS[kind],fixtureOnly=fixture?.source==='deterministic-mock'&&fixture.kind===kind;
    const available=!!definition&&fixtureOnly&&featureEnabled===true&&writesEnabled===true;
    return Object.freeze({
      kind:definition?kind:'unknown',fixtureOnly:true,fixtureAccepted:fixtureOnly,hidden:!available,interactive:available,
      titleKey:definition?.titleKey||'trainer.syncConflict.unavailable',localChangeKey:definition?.localKey||'trainer.syncConflict.unavailable',remoteChangeKey:definition?.remoteKey||'trainer.syncConflict.unavailable',
      preserveKey:definition?.preserveKey||'trainer.syncConflict.unavailable',discardKey:definition?.discardKey||'trainer.syncConflict.unavailable',
      localValue:fixtureOnly?fixture.localValue:null,remoteValue:fixtureOnly?fixture.remoteValue:null,
      choices:Object.freeze((definition?.choices||[]).map(id=>Object.freeze({id,labelKey:`trainer.syncChoice.${id}`,disabled:!available,preservesBoth:id==='keep-both'}))),
      layout:layoutForWidth(width,height),accessibility:Object.freeze({...accessibilityModel(),choiceRole:'radiogroup',announcement:'polite',focusFirstChoice:true})
    });
  }
  function migrationPreviewViewModel({featureEnabled=false,writesEnabled=false,previewSource='',localCounts={},cloudCounts={},conflictCount=0,width=1024,height=800}={}){
    const available=featureEnabled===true&&writesEnabled===true&&previewSource==='deterministic-mock';
    return Object.freeze({
      hidden:!available,interactive:available,previewOnly:true,executionAvailable:false,
      titleKey:'trainer.syncMigration.title',steps:Object.freeze([
        'trainer.syncMigration.reviewDevice','trainer.syncMigration.deviceCounts','trainer.syncMigration.cloudCounts',
        'trainer.syncMigration.summary','trainer.syncMigration.nothingDeleted','trainer.syncMigration.confirmTitle'
      ]),
      localCounts:countModel(localCounts),cloudCounts:countModel(cloudCounts),conflictCount:boundedCount(conflictCount),
      countKeys:COUNT_KEYS,controls:Object.freeze({nextDisabled:!available,backDisabled:!available,confirmDisabled:true,executeAbsent:true}),
      layout:layoutForWidth(width,height),accessibility:Object.freeze({...accessibilityModel(),stepAnnouncement:'polite',confirmRole:'dialog'})
    });
  }
  function cloudDeletionViewModel({featureEnabled=false,writesEnabled=false,previewSource='',width=1024,height=800}={}){
    const available=featureEnabled===true&&writesEnabled===true&&previewSource==='deterministic-mock';
    const choices=['cloud-only','cloud-and-device','device-only'].map(id=>Object.freeze({id,labelKey:`trainer.syncDelete.${id}.title`,consequenceKey:`trainer.syncDelete.${id}.consequence`,disabled:true}));
    return Object.freeze({
      hidden:!available,interactive:false,previewOnly:true,operationAvailable:false,titleKey:'trainer.syncDelete.title',
      choices:Object.freeze(choices),controls:Object.freeze({confirmDisabled:true,cancelEnabled:available}),
      layout:layoutForWidth(width,height),accessibility:Object.freeze({...accessibilityModel(),confirmationRequired:true,consequencesAnnounced:true})
    });
  }
  function viewModel({preferences,query='',tagIds=[],matchAllTags=false,compact=false,width=1024,height=800,domain}={}){
    if(!domain)throw new TypeError('Trainer tag panel requires the preference domain');
    const activeTags=Object.values(preferences?.tags||{}).filter(tag=>tag.active!==false);
    const byId=tagsById(activeTags);
    const favorites=domain.filterFavorites(preferences,{query,tagIds,matchAllTags}).map(favorite=>Object.freeze({
      ownerUid:favorite.ownerUid,trainerName:String(favorite.trainerName||''),note:String(favorite.note||''),unread:favorite.unread===true,
      chips:Object.freeze((favorite.tagIds||[]).map(id=>byId[id]).filter(Boolean).map(tag=>Object.freeze({id:tag.tagId,label:tag.label||tag.displayLabel}))),
      presentation:compact?'compact_chip_row':'rich_tagged_card',wrapLongText:true
    }));
    return Object.freeze({
      status:'disabled_candidate',hidden:true,interactive:false,syncState:'disabled',syncStateKey:'trainer.syncUnavailable',
      presentation:compact?'compact_mobile':'rich_desktop',layout:layoutForWidth(width,height),accessibility:accessibilityModel(),
      tags:Object.freeze(activeTags.map(tag=>Object.freeze({id:tag.tagId,label:tag.label||tag.displayLabel,active:true}))),favorites:Object.freeze(favorites),
      actions:Object.freeze(['trainer.tagsCreate','trainer.tagsRename','trainer.tagsDelete','trainer.tagsAssign','trainer.tagsRemove','trainer.tagsFilter','trainer.tagsSearch','trainer.privateNoteAction']),
      controls:Object.freeze({keyboard:true,pointer:true,touch:true,multipleTags:true,saveDisabled:true})
    });
  }
  function shareControlsModel({shareDomain,currentMode='public',width=1024,height=800}={}){
    if(!shareDomain)throw new TypeError('Share controls require the visibility domain');
    return Object.freeze({...shareDomain.visibilitySettingsModel({enabled:false,currentMode}),hidden:true,interactive:false,layout:layoutForWidth(width,height),accessibility:accessibilityModel(),grantActionEnabled:false,revokeActionEnabled:false,statusKey:'share.visibilityComingLater'});
  }

  function localOrganizerViewModel({preferences,query='',tagIds=[],width=1024,height=800,domain}={}){
    if(!domain)throw new TypeError('Local trainer organizer requires the preference domain');
    const model=viewModel({preferences,query,tagIds,matchAllTags:true,compact:Number(width)<=BREAKPOINT,width,height,domain});
    return Object.freeze({...model,status:'local_only',hidden:false,interactive:true,syncState:'local-only',syncStateKey:'organizer.localOnly',controls:Object.freeze({...model.controls,saveDisabled:false})});
  }

  function syncReadinessViewModel({featureEnabled=false,writesEnabled=false,previewSource='',state='local-only',localCounts={},cloudCounts={},pendingCount=0,conflictCount=0,lastSuccessfulSyncAt=0,width=1024,height=800,syncDomain}={}){
    if(!syncDomain)throw new TypeError('Trainer preference sync UI requires the sync domain');
    const active=featureEnabled===true&&writesEnabled===true&&previewSource==='deterministic-mock';
    const presentation=syncDomain.preferenceSyncPresentation({featureEnabled:active,writesEnabled:active,state,pendingCount,conflictCount,lastSuccessfulSyncAt});
    return Object.freeze({
      status:active?'future-enabled-model':'disabled-candidate',hidden:!active,interactive:active,state:presentation.state,statusKey:presentation.statusKey,
      statusPresentation:syncStatusViewModel({featureEnabled,writesEnabled,previewSource,state,pendingCount,conflictCount,lastSuccessfulSyncAt,syncDomain}),
      layout:layoutForWidth(width,height),accessibility:accessibilityModel(),
      counts:Object.freeze({local:Object.freeze({...localCounts}),cloud:Object.freeze({...cloudCounts})}),
      migration:Object.freeze({...migrationPreviewViewModel({featureEnabled,writesEnabled,previewSource,localCounts,cloudCounts,conflictCount,width,height}),previewable:true,requiresExplicitApproval:true,automaticOnLogin:false,hydrationRequired:true,rereadVerificationRequired:true}),
      cloudDeletion:cloudDeletionViewModel({featureEnabled,writesEnabled,previewSource,width,height}),
      controls:Object.freeze({startSyncDisabled:!active,retryDisabled:!active,resolveConflictDisabled:!active,removeCloudCopyDisabled:!active}),
      removalChoices:Object.freeze(['trainer.syncDelete.cloud-only.title','trainer.syncDelete.cloud-and-device.title','trainer.syncDelete.device-only.title']),
      labelKeys:Object.freeze(['trainer.syncTitle','trainer.syncPreview','trainer.syncDeviceCount','trainer.syncCloudCount','trainer.syncPending','trainer.syncSuccess','trainer.syncError','trainer.syncConflict','trainer.syncLastSuccess'])
    });
  }

  root.trainerTagPanel=Object.freeze({SYNC_STATUS,CONFLICTS,viewModel,localOrganizerViewModel,syncStatusViewModel,conflictViewModel,migrationPreviewViewModel,cloudDeletionViewModel,syncReadinessViewModel,shareControlsModel,layoutForWidth,accessibilityModel});
})(window);
