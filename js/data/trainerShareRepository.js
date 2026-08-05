(function(global){
  const root=global.PogoData=global.PogoData||{};
  const key=value=>{
    const clean=String(value||'').trim();
    if(!clean||/[.#$\[\]\/]/.test(clean))throw new TypeError('Trainer share identifier must be a valid Firebase key');
    return clean;
  };
  function createTrainerShareRepository(client,domain){
    if(!client||typeof client.read!=='function'||typeof client.listen!=='function')throw new TypeError('Trainer share repository requires a read-only Firebase client');
    if(!domain||typeof domain.readPlan!=='function')throw new TypeError('Trainer share repository requires share visibility domain helpers');
    const plan=options=>domain.readPlan(options);
    return Object.freeze({
      plan,
      readShare:ownerUid=>client.read(`trainerShares/${key(ownerUid)}`),
      listenShare:(ownerUid,handlers)=>client.listen(`trainerShares/${key(ownerUid)}`,handlers),
      readMode:ownerUid=>client.read(`shareVisibility/${key(ownerUid)}/mode`),
      readDirectoryEntry:normalizedName=>client.read(`shareDirectory/${key(normalizedName)}`),
      readLegacy:username=>client.read(`publicShares/${key(username)}`)
    });
  }
  root.trainerShareRepository=Object.freeze({createTrainerShareRepository});
})(window);
