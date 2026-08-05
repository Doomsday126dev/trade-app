(function(global){
  const root=global.PogoData=global.PogoData||{};
  const VERSION=1;
  const PREFIX='pogoTrainerHistory_v1:';

  function ownerKey(identity){
    const uid=String(identity?.uid||'').trim(),username=String(identity?.username||'').trim();
    if(!uid||!username)throw new TypeError('trainer history requires UID and username');
    return`${PREFIX}${encodeURIComponent(uid)}`;
  }
  function empty(identity){return{version:VERSION,owner:{uid:String(identity.uid),username:String(identity.username)},favorites:[],recent:[],snapshots:{}};}
  function createTrainerHistoryStore({storage,identity,maxFavorites=20,maxRecent=6}={}){
    if(!storage)throw new TypeError('trainer history requires storage');
    const key=ownerKey(identity);
    function read(){
      try{
        const value=JSON.parse(storage.getItem(key)||'null');
        if(value?.version!==VERSION||value?.owner?.uid!==identity.uid||value?.owner?.username!==identity.username)return empty(identity);
        return{...empty(identity),...value,favorites:Array.isArray(value.favorites)?value.favorites:[],recent:Array.isArray(value.recent)?value.recent:[],snapshots:value.snapshots&&typeof value.snapshots==='object'?value.snapshots:{}};
      }catch{return empty(identity);}
    }
    function write(value){storage.setItem(key,JSON.stringify(value));return value;}
    function ref(username){const displayName=String(username||'').trim();return{key:displayName.normalize('NFKC').toLocaleLowerCase('en-US'),displayName};}
    return Object.freeze({
      read,
      isFavorite:username=>read().favorites.some(item=>item.key===ref(username).key),
      toggleFavorite(username){
        const state=read(),item=ref(username);
        const exists=state.favorites.some(value=>value.key===item.key);
        state.favorites=exists?state.favorites.filter(value=>value.key!==item.key):[item,...state.favorites].slice(0,maxFavorites);
        write(state);return{favorite:!exists,state};
      },
      rememberOpened(username,snapshot,openedAt=Date.now()){
        const state=read(),item={...ref(username),openedAt};
        state.recent=[item,...state.recent.filter(value=>value.key!==item.key)].slice(0,maxRecent);
        state.snapshots[item.key]={seenAt:openedAt,snapshot};
        write(state);return state;
      },
      snapshotFor:username=>read().snapshots[ref(username).key]||null,
      clear(){storage.removeItem(key);}
    });
  }
  root.trainerHistoryStore=Object.freeze({VERSION,PREFIX,createTrainerHistoryStore});
})(window);
