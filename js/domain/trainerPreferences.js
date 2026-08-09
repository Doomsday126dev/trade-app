(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const MAX_TAG_LABEL_LENGTH=40;
  const MAX_RECENT_TRAINERS=30;
  const MAX_HISTORY_ENTRIES=1500;
  const PREFERENCE_SYNC_STATES=Object.freeze(['local-only','pending-sync','synced','conflict','sync-error']);
  const PUBLIC_CATEGORIES=Object.freeze(['wishlist','dynamax','gmax','costumes']);

  function error(code,message){return Object.freeze({ok:false,error:Object.freeze({code,message})});}
  function freezeMap(value){return Object.freeze(Object.fromEntries(Object.entries(value).map(([key,item])=>[key,Object.freeze({...item})])));}
  function normalizeText(value){return String(value??'').normalize('NFKC').trim();}
  function preferenceSyncState(){
    return Object.freeze({state:'local-only',interactive:false,remoteWritesAllowed:false});
  }
  function normalizeTagLabel(value){
    const display=normalizeText(value).replace(/\s+/gu,' ');
    if(!display)return error('trainer-preferences/tag-empty','Tag label is empty');
    if(Array.from(display).length>MAX_TAG_LABEL_LENGTH)return error('trainer-preferences/tag-too-long','Tag label is too long');
    const normalizedLabel=display.toLowerCase();
    const labelKey=`tag_${Array.from(normalizedLabel,value=>value.codePointAt(0).toString(16).padStart(6,'0')).join('-')}`;
    return Object.freeze({ok:true,displayLabel:display,normalizedLabel,labelKey});
  }
  function tagIdList(value){
    const source=Array.isArray(value)?value:Object.entries(value||{}).filter(([,active])=>active===true).map(([id])=>id);
    return [...new Set(source.map(String).filter(Boolean))].sort();
  }
  function normalizeFavorite(ownerUid,value={}){
    const uid=normalizeText(ownerUid||value.ownerUid);
    const trainerName=normalizeText(value.trainerName);
    const addedAt=Number(value.addedAt);
    if(!uid||!trainerName||!Number.isFinite(addedAt)||addedAt<0)return error('trainer-preferences/favorite-invalid','Favorite trainer record is invalid');
    return Object.freeze({ok:true,value:Object.freeze({ownerUid:uid,trainerName,addedAt,tagIds:Object.freeze(tagIdList(value.tagIds))})});
  }
  function favoriteTrainer(state,ownerUid,{trainerName,addedAt=Date.now(),tagIds=[]}={}){
    const favorites={...(state?.favorites||{})};
    const existing=favorites[ownerUid];
    const normalized=normalizeFavorite(ownerUid,{trainerName:trainerName||existing?.trainerName,addedAt:existing?.addedAt??addedAt,tagIds:existing?.tagIds??tagIds});
    if(!normalized.ok)return normalized;
    favorites[normalized.value.ownerUid]=normalized.value;
    return Object.freeze({ok:true,changed:!existing,favorites:freezeMap(favorites)});
  }
  function unfavoriteTrainer(state,ownerUid){
    const favorites={...(state?.favorites||{})};
    const changed=Object.prototype.hasOwnProperty.call(favorites,ownerUid);
    delete favorites[ownerUid];
    return Object.freeze({ok:true,changed,favorites:freezeMap(favorites)});
  }
  function mergeFavorites(left={},right={}){
    const merged={};
    for(const source of [left,right])for(const [ownerUid,value] of Object.entries(source||{})){
      const normalized=normalizeFavorite(ownerUid,value);if(!normalized.ok)continue;
      const current=merged[ownerUid];
      if(!current){merged[ownerUid]={...normalized.value};continue;}
      const newest=normalized.value;
      merged[ownerUid]={...newest,addedAt:Math.min(current.addedAt,normalized.value.addedAt),tagIds:[...new Set([...tagIdList(current.tagIds),...tagIdList(normalized.value.tagIds)])].sort()};
    }
    return Object.freeze({ok:true,favorites:freezeMap(merged)});
  }

  function normalizeTagRecord(tagId,value={}){
    const id=normalizeText(tagId);
    if(!/^tag_[a-z0-9_-]{1,80}$/.test(id))return error('trainer-preferences/tag-id-invalid','Tag identifier is invalid');
    const label=normalizeTagLabel(value.label??value.displayLabel);if(!label.ok)return label;
    return Object.freeze({ok:true,value:Object.freeze({tagId:id,label:label.displayLabel,displayLabel:label.displayLabel,normalizedLabel:label.normalizedLabel,labelKey:label.labelKey,active:value.active!==false,createdAt:Number(value.createdAt||0),updatedAt:Number(value.updatedAt||0)})});
  }
  function activeTag(tag){return !!tag&&tag.active!==false;}
  function createTag(state,label,{tagId,now=Date.now()}={}){
    const normalized=normalizeTagLabel(label);if(!normalized.ok)return normalized;
    const tags={...(state?.tags||{})};
    if(Object.values(tags).some(tag=>activeTag(tag)&&tag.normalizedLabel===normalized.normalizedLabel))return error('trainer-preferences/tag-duplicate','A tag with this normalized label already exists');
    const id=String(tagId||`tag_${Number(now).toString(36)}`);
    const record=normalizeTagRecord(id,{label:normalized.displayLabel,active:true,createdAt:Number(now),updatedAt:Number(now)});if(!record.ok)return record;
    tags[id]=record.value;
    return Object.freeze({ok:true,tags:freezeMap(tags),labelClaim:Object.freeze({labelKey:record.value.labelKey,tagId:id})});
  }
  function renameTag(state,tagId,label,{now=Date.now()}={}){
    const tags={...(state?.tags||{})},current=tags[tagId];
    if(!activeTag(current))return error('trainer-preferences/tag-missing','Tag does not exist');
    const normalized=normalizeTagLabel(label);if(!normalized.ok)return normalized;
    if(Object.entries(tags).some(([id,tag])=>id!==tagId&&activeTag(tag)&&tag.normalizedLabel===normalized.normalizedLabel))return error('trainer-preferences/tag-duplicate','A tag with this normalized label already exists');
    tags[tagId]={...current,label:normalized.displayLabel,displayLabel:normalized.displayLabel,normalizedLabel:normalized.normalizedLabel,labelKey:normalized.labelKey,updatedAt:Number(now)};
    return Object.freeze({ok:true,tags:freezeMap(tags),labelClaim:Object.freeze({labelKey:normalized.labelKey,tagId})});
  }
  function softDeleteTag(state,tagId,{now=Date.now()}={}){
    const tags={...(state?.tags||{})},current=tags[tagId];
    if(!current)return error('trainer-preferences/tag-missing','Tag does not exist');
    tags[tagId]={...current,active:false,updatedAt:Number(now)};
    return Object.freeze({ok:true,tags:freezeMap(tags),favorites:freezeMap(state?.favorites||{})});
  }
  function setFavoriteTags(state,ownerUid,tagIds=[]){
    const uid=normalizeText(ownerUid);if(!uid)return error('trainer-preferences/favorite-invalid','Favorite trainer is invalid');
    const tags=state?.tags||{},ids=tagIdList(tagIds);
    if(ids.some(id=>!activeTag(tags[id])))return error('trainer-preferences/tag-assignment-invalid','Tag assignment references an unavailable tag');
    const favorites={...(state?.favorites||{})},current=favorites[uid];
    if(!current)return error('trainer-preferences/favorite-missing','Favorite trainer does not exist');
    favorites[uid]={...current,tagIds:ids};
    return Object.freeze({ok:true,favorites:freezeMap(favorites)});
  }
  function filterFavorites(state,{query='',tagIds=[],matchAllTags=false}={}){
    const needle=normalizeText(query).toLowerCase(),selected=tagIdList(tagIds),tags=state?.tags||{};
    return Object.values(state?.favorites||{}).filter(favorite=>{
      const assigned=tagIdList(favorite.tagIds).filter(id=>activeTag(tags[id]));
      const tagsMatch=!selected.length||(matchAllTags?selected.every(id=>assigned.includes(id)):selected.some(id=>assigned.includes(id)));
      const text=[favorite.trainerName,...assigned.map(id=>tags[id]?.label||tags[id]?.displayLabel||'')].join(' ').normalize('NFKC').toLowerCase();
      return tagsMatch&&(!needle||text.includes(needle));
    });
  }

  function recentRecords(slots={}){
    return Object.values(slots||{}).filter(value=>value&&typeof value==='object'&&normalizeText(value.ownerUid)&&Number.isFinite(Number(value.lastOpenedAt)));
  }
  function mergeRecentSlotSets(...sources){
    let max=MAX_RECENT_TRAINERS;
    if(typeof sources.at(-1)==='number')max=sources.pop();
    const byOwner=new Map();
    for(const slots of sources)for(const value of recentRecords(slots)){
      const ownerUid=normalizeText(value.ownerUid),candidate={ownerUid,trainerName:normalizeText(value.trainerName),lastOpenedAt:Number(value.lastOpenedAt)},current=byOwner.get(ownerUid);
      if(!current||candidate.lastOpenedAt>current.lastOpenedAt||(candidate.lastOpenedAt===current.lastOpenedAt&&candidate.trainerName>current.trainerName))byOwner.set(ownerUid,candidate);
    }
    const retained=[...byOwner.values()].sort((a,b)=>b.lastOpenedAt-a.lastOpenedAt||a.ownerUid.localeCompare(b.ownerUid)).slice(0,max);
    return Object.freeze({ok:true,slots:freezeMap(Object.fromEntries(retained.map((value,index)=>[String(index).padStart(2,'0'),value]))) });
  }
  function mergeRecentTrainerSlots(slots,entry,max=MAX_RECENT_TRAINERS){return mergeRecentSlotSets(slots,{'00':entry},max);}

  function normalizeHistorySnapshot(entries={}){
    if(!entries||typeof entries!=='object'||Array.isArray(entries))return error('trainer-preferences/history-invalid','History snapshot is invalid');
    const keys=Object.keys(entries);
    if(keys.length>MAX_HISTORY_ENTRIES)return error('trainer-preferences/history-too-large','History snapshot exceeds the bounded entry limit');
    const clean={};
    for(const stableEntryId of keys){
      const item=entries[stableEntryId];
      if(!item||!PUBLIC_CATEGORIES.includes(item.category)||!normalizeText(item.fingerprint))return error('trainer-preferences/history-entry-invalid','History contains a malformed public entry');
      clean[stableEntryId]={category:item.category,fingerprint:normalizeText(item.fingerprint)};
    }
    return Object.freeze({ok:true,value:freezeMap(clean),entryCount:keys.length});
  }
  function advanceSeenState(previous={},candidate={}){
    const status=String(candidate.shareStatus||'');
    if(!['published_public','published_authorized','private_owner'].includes(status))return error('trainer-preferences/share-unavailable','Unavailable or restricted shares cannot update history');
    const nextVersion=Number(candidate.lastSeenShareVersion),priorVersion=Number(previous.lastSeenShareVersion||0);
    if(!Number.isSafeInteger(nextVersion)||nextVersion<1)return error('trainer-preferences/version-invalid','Share version is invalid');
    if(nextVersion<priorVersion)return error('trainer-preferences/stale-seen-write','Seen state cannot move backward');
    const nextFingerprint=normalizeText(candidate.lastSeenFingerprint),priorFingerprint=normalizeText(previous.lastSeenFingerprint);
    if(!nextFingerprint)return error('trainer-preferences/fingerprint-required','Public share fingerprint is required');
    if(nextVersion===priorVersion&&priorFingerprint&&nextFingerprint!==priorFingerprint)return error('trainer-preferences/seen-conflict','The same share version cannot replace an established seen fingerprint');
    const snapshot=normalizeHistorySnapshot(candidate.lastSeenSnapshot||{});if(!snapshot.ok)return snapshot;
    return Object.freeze({ok:true,value:Object.freeze({lastSeenShareVersion:nextVersion,lastSeenUpdatedAt:Math.max(Number(candidate.lastSeenUpdatedAt||0),Number(previous.lastSeenUpdatedAt||0)),lastSeenFingerprint:nextFingerprint,entryCount:snapshot.entryCount,lastSeenSnapshot:snapshot.value})});
  }
  function mergeHistoryState(left={},right={}){
    const lv=Number(left.lastSeenShareVersion||0),rv=Number(right.lastSeenShareVersion||0);
    if(lv!==rv)return Object.freeze({ok:true,value:lv>rv?left:right});
    const lf=normalizeText(left.lastSeenFingerprint),rf=normalizeText(right.lastSeenFingerprint);
    if(lf&&rf&&lf!==rf)return error('trainer-preferences/seen-conflict','Same-version history fingerprints conflict');
    return Object.freeze({ok:true,value:Number(left.lastSeenUpdatedAt||0)>=Number(right.lastSeenUpdatedAt||0)?left:right});
  }
  function historyStatus(currentShare={},seen={}){
    if(!['published_public','published_authorized','private_owner'].includes(String(currentShare.status||'')))return Object.freeze({ok:true,status:'unavailable',unread:false,diffAllowed:false});
    const currentVersion=Number(currentShare.shareVersion||0),seenVersion=Number(seen.lastSeenShareVersion||0);
    if(currentVersion===seenVersion&&seen.lastSeenFingerprint&&currentShare.fingerprint&&seen.lastSeenFingerprint!==currentShare.fingerprint)return error('trainer-preferences/seen-conflict','Current share conflicts with the seen fingerprint');
    return Object.freeze({ok:true,status:currentVersion>seenVersion?'unread':'seen',unread:currentVersion>seenVersion,diffAllowed:currentVersion>=seenVersion});
  }
  function diffPublicSnapshots(previous={},current={}){
    const before=normalizeHistorySnapshot(previous),after=normalizeHistorySnapshot(current);if(!before.ok)return before;if(!after.ok)return after;
    const added=[],removed=[],modified=[],moved=[];
    for(const id of Object.keys(after.value)){
      if(!before.value[id])added.push(id);
      else if(before.value[id].category!==after.value[id].category)moved.push(id);
      else if(before.value[id].fingerprint!==after.value[id].fingerprint)modified.push(id);
    }
    for(const id of Object.keys(before.value))if(!after.value[id])removed.push(id);
    return Object.freeze({ok:true,counts:Object.freeze({added:added.length,removed:removed.length,modified:modified.length,moved:moved.length}),ids:Object.freeze({added:Object.freeze(added),removed:Object.freeze(removed),modified:Object.freeze(modified),moved:Object.freeze(moved)})});
  }

  function preferenceMergePreview(local={},server={}){
    const favorites=mergeFavorites(server.favorites||{},local.favorites||{}).favorites;
    const recents=mergeRecentSlotSets(server.recents||{},local.recents||{}).slots;
    const history={...(server.history||{})};
    for(const [ownerUid,value] of Object.entries(local.history||{})){const merged=mergeHistoryState(history[ownerUid]||{},value);if(merged.ok)history[ownerUid]=merged.value;}
    return Object.freeze({favorites,recents,history:freezeMap(history)});
  }
  function importFingerprint(preview){
    const stable=JSON.stringify(preview,(key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(name=>[name,value[name]])):value);
    let hash=2166136261;for(let i=0;i<stable.length;i++){hash^=stable.charCodeAt(i);hash=Math.imul(hash,16777619);}return `pref_${(hash>>>0).toString(16).padStart(8,'0')}`;
  }
  function planLocalImport({activeIdentity,partitionIdentity,local={},server={},serverReadsComplete=false,userApproved=false,featureEnabled=false,writesEnabled=false}={}){
    const activeUid=normalizeText(activeIdentity?.uid),activeUsername=normalizeText(activeIdentity?.username);
    if(!activeUid||!activeUsername)return error('trainer-preferences/identity-required','Verified identity is required');
    if(activeUid!==normalizeText(partitionIdentity?.uid)||activeUsername!==normalizeText(partitionIdentity?.username))return error('trainer-preferences/partition-mismatch','Local preferences belong to another account');
    if(serverReadsComplete!==true)return error('trainer-preferences/server-read-required','Server preferences must be read before migration planning');
    const preview=preferenceMergePreview(local,server),fingerprint=importFingerprint(preview);
    const executable=featureEnabled===true&&writesEnabled===true&&userApproved===true;
    return Object.freeze({ok:true,status:executable?'approved_for_later_adapter':'review_required',owner:Object.freeze({uid:activeUid,username:activeUsername}),counts:Object.freeze({favorites:Object.keys(preview.favorites).length,recents:Object.keys(preview.recents).length,history:Object.keys(preview.history).length}),fingerprint,strategy:Object.freeze({dedupeFavoritesBy:'ownerUid',favoriteAddedAt:'earliest',historyMergeBy:'shareVersion_then_timestamp',requireServerVerification:true}),writesEnabled:executable,deleteLocal:false,preview});
  }
  function verifyLocalImport(plan,serverAfter){
    if(!plan?.ok||!plan.fingerprint)return error('trainer-preferences/import-plan-invalid','Migration plan is invalid');
    const verified=importFingerprint(serverAfter)===plan.fingerprint;
    return Object.freeze({ok:verified,status:verified?'verified':'verification_failed',deleteLocal:verified,retainLocal:!verified});
  }

  root.trainerPreferences=Object.freeze({
    SYNCED_TRAINER_PREFERENCES_ENABLED:false,
    MAX_TAG_LABEL_LENGTH,MAX_RECENT_TRAINERS,MAX_HISTORY_ENTRIES,PUBLIC_CATEGORIES,PREFERENCE_SYNC_STATES,preferenceSyncState,
    normalizeTagLabel,normalizeFavorite,favoriteTrainer,unfavoriteTrainer,mergeFavorites,
    normalizeTagRecord,createTag,renameTag,softDeleteTag,setFavoriteTags,filterFavorites,
    mergeRecentTrainerSlots,mergeRecentSlotSets,normalizeHistorySnapshot,advanceSeenState,mergeHistoryState,historyStatus,diffPublicSnapshots,
    preferenceMergePreview,planLocalImport,verifyLocalImport,importFingerprint
  });
})(window);
