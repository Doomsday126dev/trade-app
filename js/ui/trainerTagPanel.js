(function(global){
  const root=global.PogoUI=global.PogoUI||{};
  const BREAKPOINT=600;

  function tagsById(tags){return Object.fromEntries(tags.map(tag=>[tag.tagId,tag]));}
  function layoutForWidth(width,height=800){
    const viewport=Math.max(0,Number(width)||0),mobile=viewport<=BREAKPOINT;
    return Object.freeze({mode:mobile?'mobile_sheet':'desktop_dialog',width:viewport,touchTargetPx:48,chipsWrap:true,horizontalOverflow:false,internalScroll:true,maxHeightPx:Math.max(220,Math.floor((Number(height)||800)*0.82)),focusTrap:true,keyboardNavigation:true,pointer:true,touch:true,hoverRequired:false});
  }
  function accessibilityModel(){return Object.freeze({dialogRole:'dialog',listRole:'listbox',optionRole:'option',modal:true,focusTrap:true,escapeCloses:true,restoreFocus:true,visibleFocus:true,labelKeys:Object.freeze({dialog:'trainer.tagsDialogLabel',filters:'trainer.tagsFilterLabel',note:'trainer.privateNoteLabel',approvedViewers:'share.approvedViewersTitle'})});}
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

  root.trainerTagPanel=Object.freeze({viewModel,localOrganizerViewModel,shareControlsModel,layoutForWidth,accessibilityModel});
})(window);
