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
  function planLocalImport({activeIdentity,partitionIdentity,local={}}={}){
    const activeUid=String(activeIdentity?.uid||''),activeUsername=String(activeIdentity?.username||'');
    if(!activeUid||!activeUsername)return error('trainer-preferences/identity-required','Verified identity is required');
    if(activeUid!==String(partitionIdentity?.uid||'')||activeUsername!==String(partitionIdentity?.username||''))return error('trainer-preferences/partition-mismatch','Local preferences belong to another account');
    return Object.freeze({ok:true,status:'review_required',owner:Object.freeze({uid:activeUid,username:activeUsername}),counts:Object.freeze({favorites:Object.keys(local.favorites||{}).length,recents:Object.keys(local.recents||{}).length}),writesEnabled:false,deleteLocal:false});
  }

  root.trainerPreferences=Object.freeze({
    SYNCED_TRAINER_PREFERENCES_ENABLED:false,
    MAX_TAG_LABEL_LENGTH,MAX_NOTE_LENGTH,MAX_RECENT_TRAINERS,MAX_HISTORY_ENTRIES,
    normalizeTagLabel,mergeRecentTrainerSlots,advanceSeenState,planLocalImport
  });
})(window);
