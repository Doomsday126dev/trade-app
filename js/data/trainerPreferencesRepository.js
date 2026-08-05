(function(global){
  const root=global.PogoData=global.PogoData||{};

  function createTrainerPreferencesRepository({enabled=false,readExact,listenExact}={}){
    const disabled=()=>({ok:false,error:{code:'trainer-preferences/disabled'}});
    if(enabled!==true){
      return Object.freeze({
        enabled:false,
        readFavorites:async()=>disabled(),readTags:async()=>disabled(),readTagLabels:async()=>disabled(),
        subscribeFavorites:disabled,subscribeTags:disabled,subscribeTagLabels:disabled,
        subscribeRecents:disabled,subscribeHistory:disabled
      });
    }
    if(typeof readExact!=='function'||typeof listenExact!=='function')throw new TypeError('Enabled trainer preferences require exact read adapters');
    return Object.freeze({
      enabled:true,
      readFavorites:viewerUid=>readExact(`userPreferences/${viewerUid}/favoriteTrainers`),
      readTags:viewerUid=>readExact(`userPreferences/${viewerUid}/trainerTags`),
      readTagLabels:viewerUid=>readExact(`userPreferences/${viewerUid}/trainerTagLabels`),
      subscribeFavorites:(viewerUid,callbacks)=>listenExact(`userPreferences/${viewerUid}/favoriteTrainers`,callbacks),
      subscribeTags:(viewerUid,callbacks)=>listenExact(`userPreferences/${viewerUid}/trainerTags`,callbacks),
      subscribeTagLabels:(viewerUid,callbacks)=>listenExact(`userPreferences/${viewerUid}/trainerTagLabels`,callbacks),
      subscribeRecents:(viewerUid,callbacks)=>listenExact(`userPreferences/${viewerUid}/recentTrainerSlots`,callbacks),
      subscribeHistory:(viewerUid,callbacks)=>listenExact(`userPreferences/${viewerUid}/trainerHistory`,callbacks)
    });
  }

  root.trainerPreferencesRepository=Object.freeze({createTrainerPreferencesRepository});
})(window);
