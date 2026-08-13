(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const RELEASE_ID='2026-08-05.42';
  const TRAINER_DISCOVERY_API=Object.freeze(['fold','trainerSuggestions','bestTrainerSuggestion']);

  function trainerSearchControlState(domain){
    const missing=TRAINER_DISCOVERY_API.filter(name=>typeof domain?.[name]!=='function');
    return Object.freeze({
      compatible:missing.length===0,
      searchDisabled:missing.length>0,
      reloadRequired:missing.length>0,
      statusKey:missing.length?'app.updateRequired':'',
      code:missing.length?'client/reload-required':'ok',
      missing:Object.freeze(missing)
    });
  }

  root.clientRelease=Object.freeze({RELEASE_ID,TRAINER_DISCOVERY_API,trainerSearchControlState});
})(window);
