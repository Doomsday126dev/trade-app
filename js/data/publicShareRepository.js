(function(global){
  const root=global.PogoData=global.PogoData||{};
  const FORBIDDEN_KEY=/[.#$\[\]\/]/;

  function shareUsername(value){
    const clean=String(value||'').trim();
    if(!clean||FORBIDDEN_KEY.test(clean))throw new TypeError('username is not a valid Firebase key');
    return clean;
  }
  function createPublicShareRepository(client){
    if(!client||typeof client.read!=='function'||typeof client.listen!=='function')throw new TypeError('Public-share repository requires a Firebase client');
    return Object.freeze({
      read:username=>client.read(`publicShares/${shareUsername(username)}`),
      listen:(username,handlers)=>client.listen(`publicShares/${shareUsername(username)}`,handlers)
    });
  }

  root.publicShareRepository=Object.freeze({createPublicShareRepository});
})(window);
