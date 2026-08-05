(function(global){
  const root=global.PogoData=global.PogoData||{};

  function key(value,label){
    const clean=String(value||'').trim();
    if(!clean||/[.#$\[\]\/]/.test(clean))throw new TypeError(`${label} must be a valid Firebase key`);
    return clean;
  }
  function disabled(){return Object.freeze({ok:false,error:Object.freeze({code:'trainer-preferences/disabled'})});}
  function favoritePayload(value={}){
    const payload={trainerName:String(value.trainerName||''),addedAt:Number(value.addedAt),note:String(value.note||'')};
    const ids=Array.isArray(value.tagIds)?value.tagIds:Object.entries(value.tagIds||{}).filter(([,active])=>active===true).map(([id])=>id);
    if(ids.length)payload.tagIds=Object.fromEntries([...new Set(ids.map(id=>key(id,'Tag ID')))].sort().map(id=>[id,true]));
    return payload;
  }
  function tagPayload(value={}){return{label:String(value.label??value.displayLabel??''),normalizedLabel:String(value.normalizedLabel||''),labelKey:key(value.labelKey,'Tag label key'),active:value.active!==false,createdAt:Number(value.createdAt),updatedAt:Number(value.updatedAt)};}
  function historyPayload(value={}){return{lastSeenShareVersion:Number(value.lastSeenShareVersion),lastSeenUpdatedAt:Number(value.lastSeenUpdatedAt),lastSeenFingerprint:String(value.lastSeenFingerprint||''),entryCount:Number(value.entryCount),lastSeenSnapshot:Object.fromEntries(Object.entries(value.lastSeenSnapshot||{}).map(([id,item])=>[key(id,'History entry ID'),{category:String(item.category||''),fingerprint:String(item.fingerprint||'')}]))};}
  function createTrainerPreferencesRepository({enabled=false,writesEnabled=false,readExact,listenExact,writeExact,removeExact,transactionExact}={}){
    if(enabled!==true)return Object.freeze({enabled:false,writesEnabled:false,readFavorites:async()=>disabled(),readTags:async()=>disabled(),readTagLabels:async()=>disabled(),subscribeFavorites:disabled,subscribeTags:disabled,subscribeTagLabels:disabled,subscribeRecents:disabled,subscribeHistory:disabled});
    if(typeof readExact!=='function'||typeof listenExact!=='function')throw new TypeError('Enabled trainer preferences require exact read adapters');
    const base=viewerUid=>`userPreferences/${key(viewerUid,'Viewer UID')}`;
    const repository={
      enabled:true,writesEnabled:writesEnabled===true,
      readFavorites:viewerUid=>readExact(`${base(viewerUid)}/favoriteTrainers`),
      readTags:viewerUid=>readExact(`${base(viewerUid)}/trainerTags`),
      readTagLabels:viewerUid=>readExact(`${base(viewerUid)}/trainerTagLabels`),
      readRecents:viewerUid=>readExact(`${base(viewerUid)}/recentTrainerSlots`),
      readHistory:viewerUid=>readExact(`${base(viewerUid)}/trainerHistory`),
      subscribeFavorites:(viewerUid,callbacks)=>listenExact(`${base(viewerUid)}/favoriteTrainers`,callbacks),
      subscribeTags:(viewerUid,callbacks)=>listenExact(`${base(viewerUid)}/trainerTags`,callbacks),
      subscribeTagLabels:(viewerUid,callbacks)=>listenExact(`${base(viewerUid)}/trainerTagLabels`,callbacks),
      subscribeRecents:(viewerUid,callbacks)=>listenExact(`${base(viewerUid)}/recentTrainerSlots`,callbacks),
      subscribeHistory:(viewerUid,callbacks)=>listenExact(`${base(viewerUid)}/trainerHistory`,callbacks)
    };
    if(writesEnabled===true){
      if(typeof writeExact!=='function'||typeof removeExact!=='function'||typeof transactionExact!=='function')throw new TypeError('Enabled preference writes require exact write, remove, and transaction adapters');
      Object.assign(repository,{
        saveFavorite:(viewerUid,ownerUid,value)=>writeExact(`${base(viewerUid)}/favoriteTrainers/${key(ownerUid,'Owner UID')}`,favoritePayload(value)),
        removeFavorite:(viewerUid,ownerUid)=>removeExact(`${base(viewerUid)}/favoriteTrainers/${key(ownerUid,'Owner UID')}`),
        saveTag:(viewerUid,tagId,value)=>writeExact(`${base(viewerUid)}/trainerTags/${key(tagId,'Tag ID')}`,tagPayload(value)),
        claimTagLabel:(viewerUid,labelKey,tagId)=>writeExact(`${base(viewerUid)}/trainerTagLabels/${key(labelKey,'Tag label key')}`,key(tagId,'Tag ID')),
        saveHistory:(viewerUid,ownerUid,value)=>writeExact(`${base(viewerUid)}/trainerHistory/${key(ownerUid,'Owner UID')}`,historyPayload(value)),
        mergeRecents:(viewerUid,updater)=>transactionExact(`${base(viewerUid)}/recentTrainerSlots`,updater)
      });
    }
    return Object.freeze(repository);
  }

  root.trainerPreferencesRepository=Object.freeze({createTrainerPreferencesRepository,favoritePayload,tagPayload,historyPayload});
})(window);
