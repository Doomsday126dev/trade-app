(function(global){
  const root=global.PogoData=global.PogoData||{};
  const DEFAULT_CONCURRENCY=4;
  const DEFAULT_MAX_FAVORITES=global.PogoDomain?.productLimits?.MAX_FAVORITES;
  if(!Number.isInteger(DEFAULT_MAX_FAVORITES)||DEFAULT_MAX_FAVORITES<1)throw new Error('Product Favorite limit is unavailable');

  function normalizedText(value){return String(value||'').normalize('NFKC').trim();}
  function trainerKey(value){return normalizedText(value).toLocaleLowerCase('en-US');}
  function retryableReadError(error){
    const code=normalizedText(error?.code).toLocaleLowerCase('en-US');
    if(!code||/(?:permission|denied|unauth|forbidden|invalid|malformed)/.test(code))return false;
    return/(?:offline|network|unavailable|timeout|deadline|disconnect|read-failed)/.test(code);
  }
  function identityKey(identity){
    const uid=normalizedText(identity?.uid),username=normalizedText(identity?.username);
    if(!uid||!username)throw new TypeError('Favorite-share cache requires UID and username');
    return`${uid}\u0000${username}`;
  }
  function createFavoriteShareSessionCache({repository,validateProjection,projectSnapshot,concurrency=DEFAULT_CONCURRENCY,maxFavorites=DEFAULT_MAX_FAVORITES,now=()=>Date.now()}={}){
    if(!repository||typeof repository.read!=='function')throw new TypeError('Favorite-share cache requires an exact public-share repository');
    if(typeof validateProjection!=='function'||typeof projectSnapshot!=='function')throw new TypeError('Favorite-share cache requires projection helpers');
    concurrency=Math.max(1,Math.min(DEFAULT_CONCURRENCY,Number(concurrency)||DEFAULT_CONCURRENCY));
    maxFavorites=Math.max(0,Number(maxFavorites)||DEFAULT_MAX_FAVORITES);
    let activeIdentity='',generation=0,activeReads=0;
    let records=new Map(),inflight=new Map(),candidateKeys=new Set(),queue=[];

    function pump(){
      while(activeReads<concurrency&&queue.length){
        const task=queue.shift();activeReads++;
        Promise.resolve().then(task.run).then(task.resolve,task.reject).finally(()=>{activeReads--;pump();});
      }
    }
    function schedule(run){return new Promise((resolve,reject)=>{queue.push({run,resolve,reject});pump();});}
    function cancelQueued(){
      const pending=queue.splice(0);
      pending.forEach(task=>task.reject(Object.assign(new Error('Favorite-share cache session changed'),{code:'favorite-cache/session-changed'})));
    }
    function activate(identity){
      const next=identityKey(identity);
      if(next===activeIdentity)return false;
      cancelQueued();activeIdentity=next;generation++;records=new Map();inflight=new Map();candidateKeys=new Set();
      return true;
    }
    function requireActive(){if(!activeIdentity)throw new Error('Favorite-share cache session is inactive');}
    function syncFavorites(favorites=[]){
      requireActive();
      const unique=new Map();
      for(const favorite of favorites||[]){
        const displayName=normalizedText(favorite?.displayName),key=trainerKey(favorite?.key||displayName);
        if(displayName&&key&&!unique.has(key))unique.set(key,{key,displayName});
      }
      if(unique.size>maxFavorites)throw new RangeError(`Favorite-share cache supports at most ${maxFavorites} candidates`);
      candidateKeys=new Set(unique.keys());
      for(const key of records.keys())if(!candidateKeys.has(key))records.delete(key);
      return[...unique.values()];
    }
    function unavailableRecord(favorite,status,retryable,error=null){
      return Object.freeze({trainerKey:favorite.key,displayName:favorite.displayName,status,fetchedAt:Number(now()),updatedAt:null,entries:Object.freeze([]),listSnapshot:null,retryable,error:error?Object.freeze({code:String(error.code||'read-failed')}):null});
    }
    async function fetchFavorite(favorite,token){
      const result=await repository.read(favorite.displayName);
      if(!result?.ok)return unavailableRecord(favorite,'transport_error',retryableReadError(result?.error),result?.error);
      const projection=validateProjection(result.value,{username:favorite.displayName});
      if(!projection?.ok)return unavailableRecord(favorite,String(projection?.status||'projection_unsupported'),false);
      const snapshot=projection.snapshot;
      return Object.freeze({
        trainerKey:favorite.key,displayName:favorite.displayName,status:projection.status,
        fetchedAt:Number(now()),updatedAt:Number(snapshot.updatedAt||0)||null,
        entries:Object.freeze(projectSnapshot(snapshot)),
        listSnapshot:Object.freeze({lists:snapshot.lists,updatedAt:Number(snapshot.updatedAt||0)||null}),
        retryable:false
      });
    }
    function readFavorite(favorite,{force=false}={}){
      requireActive();
      const normalized={key:trainerKey(favorite?.key||favorite?.displayName),displayName:normalizedText(favorite?.displayName)};
      if(!normalized.key||!normalized.displayName)return Promise.reject(new TypeError('Favorite candidate requires a trainer name'));
      if(!candidateKeys.has(normalized.key)&&candidateKeys.size>=maxFavorites)return Promise.reject(new RangeError(`Favorite-share cache supports at most ${maxFavorites} candidates`));
      candidateKeys.add(normalized.key);
      if(!force&&records.has(normalized.key))return Promise.resolve(records.get(normalized.key));
      if(inflight.has(normalized.key))return inflight.get(normalized.key);
      const token=generation;
      const pending=schedule(()=>fetchFavorite(normalized,token)).then(record=>{
        if(token!==generation)throw Object.assign(new Error('Favorite-share cache session changed'),{code:'favorite-cache/session-changed'});
        if(candidateKeys.has(normalized.key))records.set(normalized.key,record);
        return record;
      }).finally(()=>{if(inflight.get(normalized.key)===pending)inflight.delete(normalized.key);});
      inflight.set(normalized.key,pending);return pending;
    }
    async function hydrate(favorites=[],{force=false,onProgress}={}){
      const candidates=syncFavorites(favorites),total=candidates.length;
      let completed=0;
      const hydrated=await Promise.all(candidates.map(favorite=>readFavorite(favorite,{force}).then(record=>{
        completed++;onProgress?.({completed,total,record});return record;
      })));
      return Object.freeze({records:Object.freeze(hydrated),summary:summary(candidates)});
    }
    async function retryUnavailable(favorites=[],options={}){
      const candidates=syncFavorites(favorites).filter(item=>records.get(item.key)?.retryable);
      let completed=0;const total=candidates.length;
      const hydrated=await Promise.all(candidates.map(favorite=>readFavorite(favorite,{force:true}).then(record=>{
        completed++;options.onProgress?.({completed,total,record});return record;
      })));
      return Object.freeze({records:Object.freeze(hydrated),summary:summary(syncFavorites(favorites))});
    }
    function summary(favorites=[]){
      const candidates=(favorites||[]).map(item=>({key:trainerKey(item.key||item.displayName),displayName:item.displayName}));
      const values=candidates.map(item=>records.get(item.key)).filter(Boolean);
      return Object.freeze({
        total:candidates.length,checked:values.length,
        published:values.filter(item=>item.status==='published').length,
        publishedEmpty:values.filter(item=>item.status==='published_empty').length,
        failed:values.filter(item=>item.retryable).length,
        notPublished:values.filter(item=>item.status==='not_published').length,
        invalid:values.filter(item=>!item.retryable&&!['published','published_empty','not_published'].includes(item.status)).length,
        fetchedAt:values.reduce((latest,item)=>Math.max(latest,item.fetchedAt||0),0)
      });
    }
    function invalidate(favorites=null){
      requireActive();
      if(!favorites){records.clear();return;}
      for(const favorite of favorites)records.delete(trainerKey(favorite?.key||favorite?.displayName));
    }
    function reset(){cancelQueued();activeIdentity='';generation++;records=new Map();inflight=new Map();candidateKeys=new Set();}
    function peek(favorite){return records.get(trainerKey(favorite?.key||favorite?.displayName))||null;}
    function snapshot(){return Object.freeze({active:!!activeIdentity,size:records.size,activeReads,queuedReads:queue.length,records:new Map(records)});}

    return Object.freeze({activate,syncFavorites,readFavorite,hydrate,retryUnavailable,summary,invalidate,reset,peek,snapshot});
  }

  root.favoriteShareSessionCache=Object.freeze({DEFAULT_CONCURRENCY,DEFAULT_MAX_FAVORITES,retryableReadError,createFavoriteShareSessionCache});
})(window);
