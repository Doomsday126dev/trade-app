(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const MAX_TAG_LABEL_LENGTH=40;
  const MAX_NOTE_LENGTH=240;
  const MAX_RECENT_TRAINERS=30;
  const MAX_HISTORY_ENTRIES=1500;

  function error(code,message){return Object.freeze({ok:false,error:Object.freeze({code,message})});}
  function normalizeTagLabel(value){
    const display=String(value??'').normalize('NFKC').trim().replace(/\s+/gu,' ');
    if(!display)return error('trainer-preferences/tag-empty','Tag label is empty');
    if(Array.from(display).length>MAX_TAG_LABEL_LENGTH)return error('trainer-preferences/tag-too-long','Tag label is too long');
    const normalizedLabel=display.toLowerCase();
    const labelKey=`tag_${Array.from(normalizedLabel,value=>value.codePointAt(0).toString(16).padStart(6,'0')).join('-')}`;
    return Object.freeze({ok:true,displayLabel:display,normalizedLabel,labelKey});
  }
  function recentRecords(slots={}){
    return Object.values(slots||{}).filter(value=>value&&typeof value==='object'&&String(value.ownerUid||'')&&Number.isFinite(Number(value.lastOpenedAt)));
  }
  function mergeRecentTrainerSlots(slots,entry,max=MAX_RECENT_TRAINERS){
    const ownerUid=String(entry?.ownerUid||'').trim();
    const lastOpenedAt=Number(entry?.lastOpenedAt);
    if(!ownerUid||!Number.isFinite(lastOpenedAt))return error('trainer-preferences/recent-invalid','Recent trainer entry is invalid');
    const byOwner=new Map(recentRecords(slots).map(value=>[String(value.ownerUid),{ownerUid:String(value.ownerUid),trainerName:String(value.trainerName||''),lastOpenedAt:Number(value.lastOpenedAt)}]));
    const previous=byOwner.get(ownerUid);
    byOwner.set(ownerUid,{ownerUid,trainerName:String(entry.trainerName||previous?.trainerName||''),lastOpenedAt:Math.max(lastOpenedAt,previous?.lastOpenedAt||0)});
    const retained=[...byOwner.values()].sort((a,b)=>b.lastOpenedAt-a.lastOpenedAt||a.ownerUid.localeCompare(b.ownerUid)).slice(0,max);
    return Object.freeze({ok:true,slots:Object.freeze(Object.fromEntries(retained.map((value,index)=>[String(index).padStart(2,'0'),Object.freeze(value)])))});
  }
  function advanceSeenState(previous={},candidate={}){
    const status=String(candidate.shareStatus||'');
    if(!['published_public','published_authorized','private_owner'].includes(status))return error('trainer-preferences/share-unavailable','Unavailable or restricted shares cannot update history');
    const nextVersion=Number(candidate.lastSeenShareVersion);
    const priorVersion=Number(previous.lastSeenShareVersion||0);
    if(!Number.isSafeInteger(nextVersion)||nextVersion<1)return error('trainer-preferences/version-invalid','Share version is invalid');
    if(nextVersion<priorVersion)return error('trainer-preferences/stale-seen-write','Seen state cannot move backward');
    const nextFingerprint=String(candidate.lastSeenFingerprint||'');
    const priorFingerprint=String(previous.lastSeenFingerprint||'');
    if(nextVersion===priorVersion&&priorFingerprint&&nextFingerprint!==priorFingerprint)return error('trainer-preferences/seen-conflict','The same share version cannot replace an established seen fingerprint');
    const entries=candidate.lastSeenSnapshot&&typeof candidate.lastSeenSnapshot==='object'?candidate.lastSeenSnapshot:{};
    if(Object.keys(entries).length>MAX_HISTORY_ENTRIES)return error('trainer-preferences/history-too-large','History snapshot exceeds the bounded entry limit');
    return Object.freeze({ok:true,value:Object.freeze({
      lastSeenShareVersion:nextVersion,
      lastSeenUpdatedAt:Math.max(Number(candidate.lastSeenUpdatedAt||0),Number(previous.lastSeenUpdatedAt||0)),
      lastSeenFingerprint:nextFingerprint,
      entryCount:Object.keys(entries).length,
      lastSeenSnapshot:Object.freeze({...entries})
    })});
  }
  function preferenceMergePreview(local={},server={}){
    const favorites={...(server.favorites||{})};
    for(const [ownerUid,value] of Object.entries(local.favorites||{}))if(!favorites[ownerUid])favorites[ownerUid]={...value,ownerUid};
    const history={...(server.history||{})};
    for(const [ownerUid,value] of Object.entries(local.history||{})){
      const remote=history[ownerUid];
      if(!remote||Number(value?.lastSeenUpdatedAt||0)>Number(remote?.lastSeenUpdatedAt||0))history[ownerUid]={...value};
    }
    return Object.freeze({favorites:Object.freeze(favorites),history:Object.freeze(history)});
  }
  function planLocalImport({activeIdentity,partitionIdentity,local={},server={}}={}){
    const activeUid=String(activeIdentity?.uid||''),activeUsername=String(activeIdentity?.username||'');
    if(!activeUid||!activeUsername)return error('trainer-preferences/identity-required','Verified identity is required');
    if(activeUid!==String(partitionIdentity?.uid||'')||activeUsername!==String(partitionIdentity?.username||''))return error('trainer-preferences/partition-mismatch','Local preferences belong to another account');
    const preview=preferenceMergePreview(local,server);
    return Object.freeze({ok:true,status:'review_required',owner:Object.freeze({uid:activeUid,username:activeUsername}),counts:Object.freeze({favorites:Object.keys(preview.favorites).length,recents:Object.keys(local.recents||{}).length,history:Object.keys(preview.history).length}),strategy:Object.freeze({dedupeFavoritesBy:'ownerUid',preserveNewerHistoryBy:'lastSeenUpdatedAt',requireServerVerification:true}),writesEnabled:false,deleteLocal:false});
  }

  function normalizeTagRecord(tagId,value={}){
    const id=String(tagId||'').trim();
    if(!/^tag_[a-z0-9_-]{1,80}$/.test(id))return error('trainer-preferences/tag-id-invalid','Tag identifier is invalid');
    const label=normalizeTagLabel(value.displayLabel);
    if(!label.ok)return label;
    return Object.freeze({ok:true,value:Object.freeze({tagId:id,displayLabel:label.displayLabel,normalizedLabel:label.normalizedLabel,labelKey:label.labelKey,deletedAt:Number(value.deletedAt||0)||null})});
  }
  function createTag(state,label,{tagId,now=Date.now()}={}){
    const normalized=normalizeTagLabel(label);if(!normalized.ok)return normalized;
    const tags={...(state?.tags||{})};
    const duplicate=Object.values(tags).some(tag=>!tag?.deletedAt&&tag?.normalizedLabel===normalized.normalizedLabel);
    if(duplicate)return error('trainer-preferences/tag-duplicate','A tag with this normalized label already exists');
    const id=String(tagId||`tag_${Number(now).toString(36)}`);
    const record=normalizeTagRecord(id,{displayLabel:normalized.displayLabel});if(!record.ok)return record;
    tags[id]={...record.value,createdAt:Number(now),updatedAt:Number(now)};
    return Object.freeze({ok:true,tags:Object.freeze(tags)});
  }
  function renameTag(state,tagId,label,{now=Date.now()}={}){
    const tags={...(state?.tags||{})},current=tags[tagId];
    if(!current||current.deletedAt)return error('trainer-preferences/tag-missing','Tag does not exist');
    const normalized=normalizeTagLabel(label);if(!normalized.ok)return normalized;
    if(Object.entries(tags).some(([id,tag])=>id!==tagId&&!tag?.deletedAt&&tag?.normalizedLabel===normalized.normalizedLabel))return error('trainer-preferences/tag-duplicate','A tag with this normalized label already exists');
    tags[tagId]={...current,displayLabel:normalized.displayLabel,normalizedLabel:normalized.normalizedLabel,labelKey:normalized.labelKey,updatedAt:Number(now)};
    return Object.freeze({ok:true,tags:Object.freeze(tags)});
  }
  function softDeleteTag(state,tagId,{now=Date.now()}={}){
    const tags={...(state?.tags||{})},current=tags[tagId];
    if(!current)return error('trainer-preferences/tag-missing','Tag does not exist');
    tags[tagId]={...current,deletedAt:Number(now),updatedAt:Number(now)};
    const favorites=Object.fromEntries(Object.entries(state?.favorites||{}).map(([ownerUid,favorite])=>[ownerUid,{...favorite,tagIds:(favorite.tagIds||[]).filter(id=>id!==tagId)}]));
    return Object.freeze({ok:true,tags:Object.freeze(tags),favorites:Object.freeze(favorites)});
  }
  function setFavoriteTags(state,ownerUid,tagIds=[]){
    const uid=String(ownerUid||'').trim();if(!uid)return error('trainer-preferences/favorite-invalid','Favorite trainer is invalid');
    const tags=state?.tags||{},ids=[...new Set(tagIds.map(String))];
    if(ids.some(id=>!tags[id]||tags[id].deletedAt))return error('trainer-preferences/tag-assignment-invalid','Tag assignment references an unavailable tag');
    const favorites={...(state?.favorites||{})},current=favorites[uid]||{ownerUid:uid};
    favorites[uid]={...current,tagIds:ids};
    return Object.freeze({ok:true,favorites:Object.freeze(favorites)});
  }
  function filterFavorites(state,{query='',tagIds=[],matchAllTags=false}={}){
    const needle=String(query||'').normalize('NFKC').trim().toLowerCase();
    const selected=[...new Set(tagIds.map(String))];
    const tags=state?.tags||{};
    return Object.values(state?.favorites||{}).filter(favorite=>{
      const assigned=favorite.tagIds||[];
      const tagsMatch=!selected.length||(matchAllTags?selected.every(id=>assigned.includes(id)):selected.some(id=>assigned.includes(id)));
      const text=[favorite.trainerName,...assigned.map(id=>tags[id]?.displayLabel||'')].join(' ').normalize('NFKC').toLowerCase();
      return tagsMatch&&(!needle||text.includes(needle));
    });
  }

  root.trainerPreferences=Object.freeze({
    SYNCED_TRAINER_PREFERENCES_ENABLED:false,
    MAX_TAG_LABEL_LENGTH,MAX_NOTE_LENGTH,MAX_RECENT_TRAINERS,MAX_HISTORY_ENTRIES,
    normalizeTagLabel,normalizeTagRecord,createTag,renameTag,softDeleteTag,setFavoriteTags,filterFavorites,
    mergeRecentTrainerSlots,advanceSeenState,preferenceMergePreview,planLocalImport
  });
})(window);
