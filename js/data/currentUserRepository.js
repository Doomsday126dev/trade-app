(function(global){
  const root=global.PogoData=global.PogoData||{};
  const OWNED_LIST_TYPES=Object.freeze(['wishlist','dynamax','gmax','costumes']);
  const FORBIDDEN_KEY=/[.#$\[\]\/]/;

  function segment(value,label){
    const clean=String(value||'').trim();
    if(!clean||FORBIDDEN_KEY.test(clean))throw new TypeError(`${label} is not a valid Firebase key`);
    return clean;
  }
  function listType(value){
    if(!OWNED_LIST_TYPES.includes(value))throw new TypeError('List type is not registered');
    return value;
  }
  function createCurrentUserRepository(client){
    if(!client||typeof client.read!=='function'||typeof client.listen!=='function')throw new TypeError('Current-user repository requires a Firebase client');
    const readPath=path=>client.read(path);
    const listenPath=(path,handlers)=>client.listen(path,handlers);
    return Object.freeze({
      readProfile:username=>readPath(`users/${segment(username,'username')}`),
      listenProfile:(username,handlers)=>listenPath(`users/${segment(username,'username')}`,handlers),
      readList:(type,username)=>readPath(`${listType(type)}/${segment(username,'username')}`),
      listenList:(type,username,handlers)=>listenPath(`${listType(type)}/${segment(username,'username')}`,handlers),
      readInventory:username=>readPath(`have/${segment(username,'username')}`),
      listenInventory:(username,handlers)=>listenPath(`have/${segment(username,'username')}`,handlers),
      readAuthIndex:uid=>readPath(`authIndex/${segment(uid,'uid')}`),
      listenAuthIndex:(uid,handlers)=>listenPath(`authIndex/${segment(uid,'uid')}`,handlers),
      listenMemberships:(uid,handlers)=>listenPath(`userCommunities/${segment(uid,'uid')}`,handlers),
      listenPendingDecrements:(username,handlers)=>listenPath(`pendingDecrements/${segment(username,'username')}`,handlers)
    });
  }

  root.currentUserRepository=Object.freeze({OWNED_LIST_TYPES,createCurrentUserRepository});
})(window);
