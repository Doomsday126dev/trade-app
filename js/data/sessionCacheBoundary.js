(function(global){
  const root=global.PogoData=global.PogoData||{};
  const CACHE_SCHEMA_VERSION=2;
  const QUEUE_SCHEMA_VERSION=2;
  const DEFAULT_CACHE_KEY='pogoSessionCache_v2';
  const LEGACY_CACHE_KEY='pogo3';
  const DEFAULT_QUEUE_KEY='pogoSyncQueue_v2';
  const LEGACY_QUEUE_KEY='pogoSyncQueue_v1';
  const OWNED_LIST_ROOTS=Object.freeze(['wishlist','dynamax','gmax','costumes']);

  function resultError(code,message){return{ok:false,error:Object.freeze({code,message})};}
  function objectValue(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function ownerIdentity(value){
    const uid=String(value?.uid||'').trim();
    const username=String(value?.username||'').trim();
    return uid&&username?Object.freeze({uid,username}):null;
  }
  function sameOwner(a,b){return!!a&&!!b&&a.uid===b.uid&&a.username===b.username;}
  function partialOwnerMismatch(a,b){
    if(!a||!b)return false;
    return(a.uid===b.uid&&a.username!==b.username)||(a.username===b.username&&a.uid!==b.uid);
  }
  function emptyCache(publicData={}){
    return{schemaVersion:CACHE_SCHEMA_VERSION,public:{loginDirectory:clone(objectValue(publicData.loginDirectory))},protected:null};
  }
  function emptyQueue(owner=null){
    return{schemaVersion:QUEUE_SCHEMA_VERSION,owner:owner?{...owner}:null,entries:{},quarantined:{}};
  }
  function isWholeListReplacementPath(path){
    const parts=String(path||'').split('/').filter(Boolean);
    return parts.length===2&&OWNED_LIST_ROOTS.includes(parts[0])&&!!parts[1];
  }
  function isWholeListReplacementEntry(key,item){
    return isWholeListReplacementPath(key)||isWholeListReplacementPath(item?.path);
  }
  function parseStored(storage,key){
    const raw=storage.getItem(key);
    if(raw==null)return{exists:false,value:null};
    try{return{exists:true,value:JSON.parse(raw)}}catch{return{exists:true,value:null,corrupt:true}};
  }
  function protectedDataFrom(source){
    const next=clone(objectValue(source));
    delete next.loginDirectory;
    return next;
  }

  function createSessionCacheBoundary({
    storage,
    cacheKey=DEFAULT_CACHE_KEY,
    legacyCacheKey=LEGACY_CACHE_KEY,
    queueKey=DEFAULT_QUEUE_KEY,
    legacyQueueKey=LEGACY_QUEUE_KEY
  }={}){
    if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function'||typeof storage.removeItem!=='function'){
      throw new TypeError('Session cache boundary requires Storage-compatible access');
    }
    let activeOwner=null;
    const notices=[];

    function write(key,value){storage.setItem(key,JSON.stringify(value));}
    function loadCache(){
      const parsed=parseStored(storage,cacheKey);
      if(!parsed.exists){
        const legacy=parseStored(storage,legacyCacheKey);
        if(legacy.exists){
          const migrated=emptyCache({loginDirectory:objectValue(legacy.value).loginDirectory});
          write(cacheKey,migrated);
          storage.removeItem(legacyCacheKey);
          notices.push('storage/cache-migrated');
          return migrated;
        }
      }
      const value=parsed.value;
      if(parsed.corrupt){
        const reset=emptyCache();
        write(cacheKey,reset);
        notices.push('storage/cache-reset');
        return reset;
      }
      if(value?.schemaVersion===CACHE_SCHEMA_VERSION&&value.public&&Object.prototype.hasOwnProperty.call(value,'protected')){
        const owner=ownerIdentity(value.protected?.owner);
        const normalized={
          schemaVersion:CACHE_SCHEMA_VERSION,
          public:{loginDirectory:clone(objectValue(value.public.loginDirectory))},
          protected:owner?{owner:{...owner},data:protectedDataFrom(value.protected.data)}:null
        };
        if(value.protected&&!owner){
          write(cacheKey,normalized);
          notices.push('storage/cache-reset');
        }
        return normalized;
      }
      if(parsed.exists){
        const migrated=emptyCache({loginDirectory:objectValue(value).loginDirectory});
        write(cacheKey,migrated);
        notices.push('storage/cache-migrated');
        return migrated;
      }
      const initial=emptyCache();
      write(cacheKey,initial);
      return initial;
    }
    function loadQueue(){
      const parsed=parseStored(storage,queueKey);
      const value=parsed.value;
      if(parsed.corrupt||!value||value.schemaVersion!==QUEUE_SCHEMA_VERSION){
        const reset=emptyQueue();
        write(queueKey,reset);
        if(parsed.exists)notices.push('storage/queue-reset');
        return reset;
      }
      const owner=ownerIdentity(value.owner);
      if(value.owner&&!owner){
        const reset=emptyQueue();
        write(queueKey,reset);
        notices.push('storage/queue-reset');
        return reset;
      }
      return{
        schemaVersion:QUEUE_SCHEMA_VERSION,
        owner:owner?{...owner}:null,
        entries:clone(objectValue(value.entries)),
        quarantined:clone(objectValue(value.quarantined))
      };
    }
    function discardLegacyQueue(){
      const legacy=parseStored(storage,legacyQueueKey);
      if(legacy.exists){
        if(Object.keys(objectValue(legacy.value)).length)notices.push('storage/legacy-queue-discarded');
        storage.removeItem(legacyQueueKey);
      }
    }

    let cache=loadCache();
    let queue=loadQueue();
    discardLegacyQueue();

    function quarantineWholeListReplacements(){
      const moved=[];
      const entries=objectValue(queue.entries);
      const quarantined=clone(objectValue(queue.quarantined));
      for(const[key,item]of Object.entries(entries)){
        if(!isWholeListReplacementEntry(key,item))continue;
        quarantined[key]=clone(item);
        delete entries[key];
        moved.push(key);
      }
      if(!moved.length)return moved;
      queue={...queue,entries:clone(entries),quarantined};
      write(queueKey,queue);
      notices.push('storage/whole-list-queue-quarantined');
      return moved;
    }

    function activate(value){
      const next=ownerIdentity(value);
      if(!next)return resultError('storage/owner-required','Cache activation requires UID and username');
      const cacheOwner=ownerIdentity(cache.protected?.owner);
      const queueOwner=ownerIdentity(queue.owner);
      if(partialOwnerMismatch(cacheOwner,next)||partialOwnerMismatch(queueOwner,next)){
        activeOwner=null;
        return resultError('storage/owner-mismatch','Stored UID and username ownership do not match the authenticated session');
      }
      const priorOwners=[cacheOwner,queueOwner].filter(Boolean);
      if(priorOwners.some(owner=>!sameOwner(owner,next))){
        cache={...cache,protected:null};
        queue=emptyQueue();
        notices.push('storage/cache-owner-reset');
      }
      activeOwner=next;
      if(!sameOwner(ownerIdentity(cache.protected?.owner),next)){
        cache={...cache,protected:{owner:{...next},data:{}}};
      }
      if(!sameOwner(ownerIdentity(queue.owner),next))queue=emptyQueue(next);
      quarantineWholeListReplacements();
      write(cacheKey,cache);
      write(queueKey,queue);
      return{ok:true,status:priorOwners.length?'restored':'initialized',owner:activeOwner};
    }
    function suspend(reason='auth_loss'){
      activeOwner=null;
      return{ok:true,status:'suspended',reason};
    }
    function clearForLogout(){
      activeOwner=null;
      cache={...cache,protected:null};
      queue=emptyQueue();
      write(cacheKey,cache);
      write(queueKey,queue);
      return{ok:true,status:'cleared'};
    }
    function readData(){
      const data={loginDirectory:clone(objectValue(cache.public.loginDirectory))};
      const owner=ownerIdentity(cache.protected?.owner);
      if(activeOwner&&sameOwner(owner,activeOwner))Object.assign(data,clone(objectValue(cache.protected.data)));
      return data;
    }
    function writeData(value){
      const source=objectValue(value);
      cache={...cache,public:{loginDirectory:clone(objectValue(source.loginDirectory))}};
      if(activeOwner){
        const owner=ownerIdentity(cache.protected?.owner);
        if(!sameOwner(owner,activeOwner))return resultError('storage/owner-mismatch','Protected cache owner changed during the active session');
        cache.protected={owner:{...activeOwner},data:protectedDataFrom(source)};
      }
      write(cacheKey,cache);
      return{ok:true,status:activeOwner?'protected_saved':'public_saved'};
    }
    function readQueue(){
      const owner=ownerIdentity(queue.owner);
      return activeOwner&&sameOwner(owner,activeOwner)?clone(queue.entries):{};
    }
    function readQuarantinedQueue(){
      const owner=ownerIdentity(queue.owner);
      return activeOwner&&sameOwner(owner,activeOwner)?clone(queue.quarantined):{};
    }
    function writeQueue(entries){
      if(!activeOwner)return resultError('storage/session-inactive','Pending changes require an authenticated cache owner');
      const owner=ownerIdentity(queue.owner);
      if(!sameOwner(owner,activeOwner))return resultError('storage/owner-mismatch','Pending-change owner changed during the active session');
      queue={
        schemaVersion:QUEUE_SCHEMA_VERSION,
        owner:{...activeOwner},
        entries:clone(objectValue(entries)),
        quarantined:clone(objectValue(queue.quarantined))
      };
      quarantineWholeListReplacements();
      write(queueKey,queue);
      return{ok:true,status:'queue_saved'};
    }
    function quarantineQueueEntry(key,item){
      if(!activeOwner)return resultError('storage/session-inactive','Queue quarantine requires an authenticated cache owner');
      const owner=ownerIdentity(queue.owner);
      if(!sameOwner(owner,activeOwner))return resultError('storage/owner-mismatch','Pending-change owner changed during queue quarantine');
      if(!isWholeListReplacementEntry(key,item))return resultError('storage/quarantine-path-invalid','Only whole-list replacement writes may enter this quarantine');
      const entries=clone(objectValue(queue.entries));
      const quarantined=clone(objectValue(queue.quarantined));
      quarantined[key]=clone(item);
      delete entries[key];
      queue={schemaVersion:QUEUE_SCHEMA_VERSION,owner:{...activeOwner},entries,quarantined};
      write(queueKey,queue);
      notices.push('storage/whole-list-queue-quarantined');
      return{ok:true,status:'queue_entry_quarantined'};
    }
    function drainNotices(){return notices.splice(0);}
    function snapshot(){
      return Object.freeze({
        activeOwner:activeOwner?Object.freeze({...activeOwner}):null,
        cacheOwner:ownerIdentity(cache.protected?.owner),
        queueOwner:ownerIdentity(queue.owner),
        protectedAccessible:!!activeOwner&&sameOwner(ownerIdentity(cache.protected?.owner),activeOwner),
        queueAccessible:!!activeOwner&&sameOwner(ownerIdentity(queue.owner),activeOwner),
        quarantinedQueueCount:activeOwner&&sameOwner(ownerIdentity(queue.owner),activeOwner)
          ?Object.keys(objectValue(queue.quarantined)).length:0
      });
    }
    return Object.freeze({
      activate,suspend,clearForLogout,readData,writeData,readQueue,readQuarantinedQueue,
      writeQueue,quarantineQueueEntry,drainNotices,snapshot
    });
  }

  root.sessionCacheBoundary=Object.freeze({
    CACHE_SCHEMA_VERSION,QUEUE_SCHEMA_VERSION,DEFAULT_CACHE_KEY,LEGACY_CACHE_KEY,DEFAULT_QUEUE_KEY,LEGACY_QUEUE_KEY,
    OWNED_LIST_ROOTS,isWholeListReplacementPath,
    createSessionCacheBoundary
  });
})(window);
