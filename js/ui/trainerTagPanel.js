(function(global){
  const root=global.PogoUI=global.PogoUI||{};

  function viewModel({preferences,query='',tagIds=[],matchAllTags=false,compact=false,domain}={}){
    if(!domain)throw new TypeError('Trainer tag panel requires the preference domain');
    const activeTags=Object.values(preferences?.tags||{}).filter(tag=>!tag.deletedAt);
    const favorites=domain.filterFavorites(preferences,{query,tagIds,matchAllTags}).map(favorite=>Object.freeze({
      ownerUid:favorite.ownerUid,
      trainerName:String(favorite.trainerName||''),
      chips:Object.freeze((favorite.tagIds||[]).map(id=>tagsById(activeTags)[id]).filter(Boolean).map(tag=>Object.freeze({id:tag.tagId,label:tag.displayLabel}))),
      presentation:compact?'compact_chip_row':'rich_tagged_card'
    }));
    return Object.freeze({
      status:'disabled_candidate',
      presentation:compact?'compact_mobile':'rich_desktop',
      tags:Object.freeze(activeTags.map(tag=>Object.freeze({id:tag.tagId,label:tag.displayLabel}))),
      favorites:Object.freeze(favorites),
      actions:Object.freeze(['trainer.tagsCreate','trainer.tagsRename','trainer.tagsDelete','trainer.tagsFilter','trainer.tagsSearch']),
      controls:Object.freeze({keyboard:true,pointer:true,touch:true,multipleTags:true})
    });
  }
  function tagsById(tags){return Object.fromEntries(tags.map(tag=>[tag.tagId,tag]));}

  root.trainerTagPanel=Object.freeze({viewModel});
})(window);
