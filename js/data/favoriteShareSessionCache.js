(function(global){
  const root=global.PogoData=global.PogoData||{};
  const DEFAULT_CONCURRENCY=4;
  const DEFAULT_READ_DEADLINE_MS=5000;
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
  function createFavoriteShareSessionCache({repository,validateProjection,projectSnapshot,concurrency=DEFAULT_CONCURRENCY,maxFavorites=DEFAULT_MAX_FAVORITES,readDeadlineMs=DEFAULT_READ_DEADLINE_MS,now=()=>Date.now(),setTimer=(handler,delay)=>setTimeout(handler,delay),clearTimer=handle=>clearTimeout(handle)}={}){
    if(!repository||typeof repository.read!=='function')throw new TypeError('Favorite-share cache requires an exact public-share repository');
    if(typeof validateProjection!=='function'||typeof projectSnapshot!=='function')throw new TypeError('Favorite-share cache requires projection helpers');
    concurrency=Math.max(1,Math.min(DEFAULT_CONCURRENCY,Number(concurrency)||DEFAULT_CONCURRENCY));
    maxFavorites=Math.max(0,Number(maxFavorites)||DEFAULT_MAX_FAVORITES);
    readDeadlineMs=Math.max(1,Number(readDeadlineMs)||DEFAULT_READ_DEADLINE_MS);
    let activeIdentity='',generation=0,activeReads=0;
    let records=new Map(),inflight=new Map(),physicalReads=new Map(),readEpochs=new Map(),candidateKeys=new Set(),queue=[],activeEntries=new Set();
    const queueBlocked=Object.freeze({ok:false,error:Object.freeze({code:'favorite-cache/queue-blocked'})});

    function pump(){
      while(activeReads<concurrency&&queue.length){
        const task=queue.shift();
        if(task.state!=='queued')continue;
        task.state='started';activeReads++;activeEntries.add(task);task.startHandlers.splice(0).forEach(handler=>handler());
        Promise.resolve().then(task.run).then(task.resolve,task.reject).finally(()=>{task.state='settled';activeEntries.delete(task);activeReads--;pump();});
      }
    }
    function schedule(run){
      const task={run,state:'queued',deadlineExceeded:false,startHandlers:[]};
      task.promise=new Promise((resolve,reject)=>{task.resolve=resolve;task.reject=reject;queue.push(task);pump();});
      releaseBlockedQueue();
      return task;
    }
    function cancelQueuedTask(task,value){
      if(task?.state!=='queued')return false;
      const index=queue.indexOf(task);if(index>=0)queue.splice(index,1);
      task.state='cancelled';task.resolve(value);return true;
    }
    function releaseBlockedQueue(){
      if(!queue.length||activeReads<concurrency||[...activeEntries].some(entry=>!entry.deadlineExceeded))return;
      queue.slice().forEach(task=>cancelQueuedTask(task,queueBlocked));
    }
    function cancelQueued(){
      const pending=queue.splice(0);
      pending.forEach(task=>{task.state='cancelled';task.reject(Object.assign(new Error('Favorite-share cache session changed'),{code:'favorite-cache/session-changed'}));});
    }
    function activate(identity){
      const next=identityKey(identity);
      if(next===activeIdentity)return false;
      cancelQueued();activeIdentity=next;generation++;records=new Map();inflight=new Map();physicalReads=new Map();readEpochs=new Map();candidateKeys=new Set();
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
    function projectFavorite(favorite,result){
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
    function physicalRead(favorite,{replacement=false}={}){
      let state=physicalReads.get(favorite.key);
      if(!state){state={primary:null,replacement:null};physicalReads.set(favorite.key,state);}
      const slot=replacement?'replacement':'primary';
      const task=schedule(()=>Promise.resolve().then(()=>repository.read(favorite.displayName)).catch(error=>({ok:false,error:{code:String(error?.code||'firebase/read-failed')}})));
      const entry={task,replacement};state[slot]=entry;
      const clear=()=>{
        if(state[slot]===entry)state[slot]=null;
        if(!state.primary&&!state.replacement&&physicalReads.get(favorite.key)===state)physicalReads.delete(favorite.key);
      };
      task.promise.then(clear,clear);return entry;
    }
    function boundedPhysicalResult(favorite,entry){
      const task=entry.task;
      return new Promise((resolve,reject)=>{
        let settled=false,timer=null;
        const finish=(handler,value)=>{if(settled)return;settled=true;if(timer!==null)clearTimer(timer);handler(value);};
        const deadline=()=>{
          // RTDB get() is not cancellable; settle the UI while the physical task keeps its concurrency slot.
          timer=setTimer(()=>{
            task.deadlineExceeded=true;
            finish(resolve,{ok:false,error:{code:'favorite-cache/deadline-exceeded'}});
            releaseBlockedQueue();
          },readDeadlineMs);
        };
        task.deadlineExceeded=false;
        if(task.state==='started')deadline();
        else if(task.state==='queued')task.startHandlers.push(deadline);
        task.promise.then(result=>{
          if(result===queueBlocked)return finish(resolve,{ok:false,error:{code:'favorite-cache/deadline-exceeded'}});
          finish(resolve,result);
        },error=>finish(reject,error));
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
      const token=generation,retrying=force&&records.get(normalized.key)?.retryable;
      let physicalState=physicalReads.get(normalized.key),physical=physicalState?.replacement||physicalState?.primary;
      if(force&&!retrying){
        readEpochs.set(normalized.key,(readEpochs.get(normalized.key)||0)+1);
        if(physicalState?.primary&&!physicalState.replacement)physical=physicalRead(normalized,{replacement:true});
      }
      if(!physical)physical=physicalRead(normalized,{replacement:force&&!retrying});
      const epoch=readEpochs.get(normalized.key)||0;
      const pending=boundedPhysicalResult(normalized,physical).then(result=>projectFavorite(normalized,result)).then(record=>{
        if(token!==generation)throw Object.assign(new Error('Favorite-share cache session changed'),{code:'favorite-cache/session-changed'});
        if(epoch===(readEpochs.get(normalized.key)||0)&&candidateKeys.has(normalized.key))records.set(normalized.key,record);
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
    function reset(){cancelQueued();activeIdentity='';generation++;records=new Map();inflight=new Map();physicalReads=new Map();readEpochs=new Map();candidateKeys=new Set();}
    function peek(favorite){return records.get(trainerKey(favorite?.key||favorite?.displayName))||null;}
    function snapshot(){
      const physicalReferences=[...physicalReads.values()].reduce((count,state)=>count+Number(!!state.primary)+Number(!!state.replacement),0);
      const physicalReferencesByKey=new Map([...physicalReads].map(([key,state])=>[key,Number(!!state.primary)+Number(!!state.replacement)]));
      return Object.freeze({active:!!activeIdentity,size:records.size,activeReads,queuedReads:queue.length,physicalReferences,physicalReferencesByKey,unresolvedPhysicalReads:activeEntries.size,readEpochs:new Map(readEpochs),records:new Map(records)});
    }

    return Object.freeze({activate,syncFavorites,readFavorite,hydrate,retryUnavailable,summary,invalidate,reset,peek,snapshot});
  }

  root.favoriteShareSessionCache=Object.freeze({DEFAULT_CONCURRENCY,DEFAULT_READ_DEADLINE_MS,DEFAULT_MAX_FAVORITES,retryableReadError,createFavoriteShareSessionCache});
})(window);
