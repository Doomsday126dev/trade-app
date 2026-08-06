(function(global){
  const root=global.PogoData=global.PogoData||{};

  function key(value,label){
    const clean=String(value||'').trim();
    if(!clean||/[.#$\[\]\/]/.test(clean))throw new TypeError(`${label} must be a valid Firebase key`);
    return clean;
  }
  function disabled(){return Object.freeze({ok:false,error:Object.freeze({code:'trainer-preferences/disabled'})});}
  function favoritePayload(value={}){return{trainerName:String(value.trainerName||''),addedAt:Number(value.addedAt),revision:Number(value.revision),updatedAt:Number(value.updatedAt),operationId:key(value.operationId,'Operation ID'),deleted:value.deleted===true,...(value.deleted===true?{deletedAt:Number(value.deletedAt)}:{})};}
  function trainerMetadataPayload(value={}){
    const ids=Array.isArray(value.tagIds)?value.tagIds:Object.entries(value.tagIds||{}).filter(([,active])=>active===true).map(([id])=>id);
    return{note:String(value.note||''),tagIds:Object.fromEntries([...new Set(ids.map(id=>key(id,'Tag ID')))].sort().map(id=>[id,true])),revision:Number(value.revision),updatedAt:Number(value.updatedAt),operationId:key(value.operationId,'Operation ID'),deleted:value.deleted===true,...(value.deleted===true?{deletedAt:Number(value.deletedAt)}:{})};
  }
  function metadataPayload(value={}){return{schemaVersion:Number(value.schemaVersion),revision:Number(value.revision),updatedAt:Number(value.updatedAt),favoriteCount:Number(value.favoriteCount),tagCount:Number(value.tagCount),lastSuccessfulSyncAt:Number(value.lastSuccessfulSyncAt||0),migrationState:String(value.migrationState||'not-started'),migrationFingerprint:String(value.migrationFingerprint||'')};}
  function createTrainerPreferencesRepository({enabled=false,writesEnabled=false,readExact,listenExact,transactionExact}={}){
    if(enabled!==true)return Object.freeze({enabled:false,writesEnabled:false,readMetadata:async()=>disabled(),readFavorites:async()=>disabled(),readTrainerMetadata:async()=>disabled(),readTags:async()=>disabled(),readTagLabels:async()=>disabled(),readRecents:async()=>disabled(),readHistory:async()=>disabled(),subscribeMetadata:disabled,subscribeFavorites:disabled,subscribeTrainerMetadata:disabled,subscribeTags:disabled,subscribeTagLabels:disabled,subscribeRecents:disabled,subscribeHistory:disabled});
    if(typeof readExact!=='function'||typeof listenExact!=='function')throw new TypeError('Enabled trainer preferences require exact read adapters');
    const base=viewerUid=>`userPreferences/${key(viewerUid,'Viewer UID')}`;
    const repository={
      enabled:true,writesEnabled:writesEnabled===true,
      readMetadata:viewerUid=>readExact(`${base(viewerUid)}/metadata`),
      readFavorites:viewerUid=>readExact(`${base(viewerUid)}/favoriteTrainers`),
      readTrainerMetadata:viewerUid=>readExact(`${base(viewerUid)}/trainerMetadata`),
      readTags:viewerUid=>readExact(`${base(viewerUid)}/trainerTags`),
      readTagLabels:viewerUid=>readExact(`${base(viewerUid)}/trainerTagLabels`),
      readRecents:viewerUid=>readExact(`${base(viewerUid)}/recentTrainerSlots`),
      readHistory:viewerUid=>readExact(`${base(viewerUid)}/trainerHistory`),
      subscribeMetadata:(viewerUid,callbacks)=>listenExact(`${base(viewerUid)}/metadata`,callbacks),
      subscribeFavorites:(viewerUid,callbacks)=>listenExact(`${base(viewerUid)}/favoriteTrainers`,callbacks),
      subscribeTrainerMetadata:(viewerUid,callbacks)=>listenExact(`${base(viewerUid)}/trainerMetadata`,callbacks),
      subscribeTags:(viewerUid,callbacks)=>listenExact(`${base(viewerUid)}/trainerTags`,callbacks),
      subscribeTagLabels:(viewerUid,callbacks)=>listenExact(`${base(viewerUid)}/trainerTagLabels`,callbacks),
      subscribeRecents:(viewerUid,callbacks)=>listenExact(`${base(viewerUid)}/recentTrainerSlots`,callbacks),
      subscribeHistory:(viewerUid,callbacks)=>listenExact(`${base(viewerUid)}/trainerHistory`,callbacks)
    };
    if(writesEnabled===true){
      if(typeof transactionExact!=='function')throw new TypeError('Enabled preference writes require an exact transaction adapter');
      Object.assign(repository,{
        mutateFavorite:(viewerUid,ownerUid,updater)=>transactionExact(`${base(viewerUid)}/favoriteTrainers/${key(ownerUid,'Owner UID')}`,updater),
        mutateTrainerMetadata:(viewerUid,ownerUid,updater)=>transactionExact(`${base(viewerUid)}/trainerMetadata/${key(ownerUid,'Owner UID')}`,updater),
        mergeRecents:(viewerUid,updater)=>transactionExact(`${base(viewerUid)}/recentTrainerSlots`,updater),
        mutateMetadata:(viewerUid,updater)=>transactionExact(`${base(viewerUid)}/metadata`,updater)
      });
    }
    return Object.freeze(repository);
  }

  root.trainerPreferencesRepository=Object.freeze({createTrainerPreferencesRepository,favoritePayload,trainerMetadataPayload,metadataPayload});
})(window);
