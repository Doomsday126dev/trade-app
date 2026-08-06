(function(global){
  const root=global.PogoData=global.PogoData||{};
  const VERSION=2;
  const PREFIX='pogoTrainerHistory_v1:';
  const MAX_TAGS=24;
  const MAX_TAGS_PER_FAVORITE=24;
  const MAX_TAG_LABEL_LENGTH=40;
  const MAX_NOTE_LENGTH=240;

  function ownerKey(identity){
    const uid=String(identity?.uid||'').trim(),username=String(identity?.username||'').trim();
    if(!uid||!username)throw new TypeError('trainer history requires UID and username');
    return`${PREFIX}${encodeURIComponent(uid)}`;
  }
  function trainerRef(username){
    const displayName=String(username||'').normalize('NFKC').trim();
    return{key:displayName.toLocaleLowerCase('en-US'),displayName};
  }
  function normalizeLabel(value){return String(value??'').normalize('NFKC').trim().replace(/\s+/gu,' ');}
  function labelIdentity(value){return normalizeLabel(value).toLocaleLowerCase('en-US');}
  function codePointLength(value){return Array.from(String(value||'')).length;}
  function empty(identity){return{version:VERSION,schemaVersion:VERSION,migrationVersion:VERSION,owner:{uid:String(identity.uid),username:String(identity.username)},favorites:[],recent:[],snapshots:{},tags:{},syncState:'local-only',migration:{skippedFavorites:0,skippedRecents:0}};}
  function createTrainerHistoryStore({storage,identity,maxFavorites=20,maxRecent=6,maxTags=MAX_TAGS,now=()=>Date.now()}={}){
    if(!storage)throw new TypeError('trainer history requires storage');
    const key=ownerKey(identity);
    function cleanFavorite(value,fallbackTime=0){
      const item=trainerRef(value?.displayName||value?.trainerName);
      if(!item.key)return null;
      const createdAt=Number(value?.createdAt||value?.addedAt||fallbackTime||0),updatedAt=Number(value?.updatedAt||createdAt||0);
      const clean={...item,tagIds:[...new Set((Array.isArray(value?.tagIds)?value.tagIds:[]).map(String).filter(Boolean))].sort(),createdAt:Number.isFinite(createdAt)?createdAt:0,updatedAt:Number.isFinite(updatedAt)?updatedAt:0};
      const note=String(value?.note||'').normalize('NFKC').trim();
      if(note&&codePointLength(note)<=MAX_NOTE_LENGTH)clean.note=note;
      return clean;
    }
    function cleanRecent(value){
      const item=trainerRef(value?.displayName||value?.trainerName);
      const openedAt=Number(value?.openedAt||value?.lastOpenedAt);
      return item.key&&Number.isFinite(openedAt)?{...item,openedAt}:null;
    }
    function cleanTag(id,value){
      const label=normalizeLabel(value?.label||value?.displayLabel),normalizedLabel=labelIdentity(label);
      if(!/^tag_[a-z0-9_-]{1,80}$/.test(String(id))||!label||codePointLength(label)>MAX_TAG_LABEL_LENGTH)return null;
      return{id:String(id),label,normalizedLabel,createdAt:Number(value?.createdAt||0),updatedAt:Number(value?.updatedAt||0)};
    }
    function normalize(value){
      const state=empty(identity),source=value&&typeof value==='object'?value:{};
      const sameOwner=source.owner?.uid===identity.uid&&source.owner?.username===identity.username;
      if(!sameOwner)return state;
      const seen=new Set();
      for(const raw of Array.isArray(source.favorites)?source.favorites:[]){
        const item=cleanFavorite(raw);if(!item||seen.has(item.key)){state.migration.skippedFavorites++;continue;}seen.add(item.key);state.favorites.push(item);
      }
      state.favorites=state.favorites
        .sort((a,b)=>a.displayName.localeCompare(b.displayName,'en',{sensitivity:'base'})||a.key.localeCompare(b.key))
        .slice(0,maxFavorites);
      const recentSeen=new Set();
      for(const raw of Array.isArray(source.recent)?source.recent:[]){
        const item=cleanRecent(raw);if(!item||recentSeen.has(item.key)){state.migration.skippedRecents++;continue;}recentSeen.add(item.key);state.recent.push(item);
      }
      state.recent=state.recent.sort((a,b)=>b.openedAt-a.openedAt||a.key.localeCompare(b.key)).slice(0,maxRecent);
      state.snapshots=source.snapshots&&typeof source.snapshots==='object'&&!Array.isArray(source.snapshots)?source.snapshots:{};
      for(const [id,raw] of Object.entries(source.tags||{})){const tag=cleanTag(id,raw);if(tag)state.tags[id]=tag;}
      const activeIds=new Set(Object.keys(state.tags));
      state.favorites=state.favorites.map(item=>({...item,tagIds:item.tagIds.filter(id=>activeIds.has(id))}));
      return state;
    }
    function write(value){const clean=normalize({...value,version:VERSION,owner:{uid:identity.uid,username:identity.username}});storage.setItem(key,JSON.stringify(clean));return clean;}
    function read(){
      try{
        const raw=JSON.parse(storage.getItem(key)||'null');
        const state=normalize(raw);
        const migrationNeeded=raw&&raw.owner?.uid===identity.uid&&raw.owner?.username===identity.username&&(raw.version!==VERSION||raw.schemaVersion!==VERSION||raw.migrationVersion!==VERSION);
        if(migrationNeeded){try{storage.setItem(key,JSON.stringify(state));}catch{} }
        return state;
      }catch{return empty(identity);}
    }
    function favoriteFor(username){const item=trainerRef(username);return read().favorites.find(value=>value.key===item.key)||null;}
    function uniqueTagId(state){let suffix=Number(now()).toString(36),id=`tag_${suffix}`,index=1;while(state.tags[id])id=`tag_${suffix}_${index++}`;return id;}
    return Object.freeze({
      key,read,favoriteFor,
      isFavorite:username=>!!favoriteFor(username),
      toggleFavorite(username){
        const state=read(),item=trainerRef(username),index=state.favorites.findIndex(value=>value.key===item.key),timestamp=Number(now());
        if(index>=0)state.favorites.splice(index,1);
        else state.favorites.push({...item,tagIds:[],createdAt:timestamp,updatedAt:timestamp});
        state.favorites.sort((a,b)=>a.displayName.localeCompare(b.displayName,'en',{sensitivity:'base'})||a.key.localeCompare(b.key));
        write(state);return{favorite:index<0,state:read()};
      },
      updateCanonicalName(username){
        const state=read(),item=trainerRef(username),current=state.favorites.find(value=>value.key===item.key);
        if(current&&current.displayName!==item.displayName){current.displayName=item.displayName;current.updatedAt=Number(now());write(state);return true;}return false;
      },
      rememberOpened(username,snapshot,openedAt=Number(now())){
        const state=read(),item={...trainerRef(username),openedAt};
        state.recent=[item,...state.recent.filter(value=>value.key!==item.key)].slice(0,maxRecent);
        state.snapshots[item.key]={seenAt:openedAt,snapshot};
        write(state);return read();
      },
      snapshotFor:username=>read().snapshots[trainerRef(username).key]||null,
      createTag(label){
        const state=read(),display=normalizeLabel(label),normalizedLabel=labelIdentity(display);
        if(!display)return{ok:false,code:'tag-empty'};
        if(codePointLength(display)>MAX_TAG_LABEL_LENGTH)return{ok:false,code:'tag-too-long'};
        if(Object.keys(state.tags).length>=maxTags)return{ok:false,code:'tag-limit'};
        if(Object.values(state.tags).some(tag=>tag.normalizedLabel===normalizedLabel))return{ok:false,code:'tag-duplicate'};
        const timestamp=Number(now()),id=uniqueTagId(state);state.tags[id]={id,label:display,normalizedLabel,createdAt:timestamp,updatedAt:timestamp};write(state);return{ok:true,id,state:read()};
      },
      renameTag(id,label){
        const state=read(),tag=state.tags[id],display=normalizeLabel(label),normalizedLabel=labelIdentity(display);
        if(!tag)return{ok:false,code:'tag-missing'};
        if(!display)return{ok:false,code:'tag-empty'};
        if(codePointLength(display)>MAX_TAG_LABEL_LENGTH)return{ok:false,code:'tag-too-long'};
        if(Object.values(state.tags).some(other=>other.id!==id&&other.normalizedLabel===normalizedLabel))return{ok:false,code:'tag-duplicate'};
        Object.assign(tag,{label:display,normalizedLabel,updatedAt:Number(now())});write(state);return{ok:true,state:read()};
      },
      deleteTag(id){
        const state=read();if(!state.tags[id])return{ok:false,code:'tag-missing'};
        delete state.tags[id];state.favorites.forEach(item=>{item.tagIds=item.tagIds.filter(value=>value!==id);});write(state);return{ok:true,state:read()};
      },
      setFavoriteTags(username,tagIds){
        const state=read(),item=state.favorites.find(value=>value.key===trainerRef(username).key),ids=[...new Set((tagIds||[]).map(String))].filter(id=>state.tags[id]).sort();
        if(!item)return{ok:false,code:'favorite-missing'};
        if(ids.length>MAX_TAGS_PER_FAVORITE)return{ok:false,code:'tag-limit'};
        item.tagIds=ids;item.updatedAt=Number(now());write(state);return{ok:true,state:read()};
      },
      setFavoriteNote(username,note){
        const state=read(),item=state.favorites.find(value=>value.key===trainerRef(username).key),value=String(note??'').normalize('NFKC').trim();
        if(!item)return{ok:false,code:'favorite-missing'};
        if(codePointLength(value)>MAX_NOTE_LENGTH)return{ok:false,code:'note-too-long'};
        if(value)item.note=value;else delete item.note;
        item.updatedAt=Number(now());write(state);return{ok:true,state:read()};
      },
      updateFavoriteOrganization(username,{tagIds=[],note=''}={}){
        const state=read(),item=state.favorites.find(value=>value.key===trainerRef(username).key),ids=[...new Set((tagIds||[]).map(String))].filter(id=>state.tags[id]).sort(),value=String(note??'').normalize('NFKC').trim();
        if(!item)return{ok:false,code:'favorite-missing'};
        if(ids.length>MAX_TAGS_PER_FAVORITE)return{ok:false,code:'tag-limit'};
        if(codePointLength(value)>MAX_NOTE_LENGTH)return{ok:false,code:'note-too-long'};
        item.tagIds=ids;if(value)item.note=value;else delete item.note;
        item.updatedAt=Number(now());write(state);return{ok:true,state:read()};
      },
      filterFavorites({query='',tagIds=[]}={}){
        const state=read(),needle=labelIdentity(query),selected=[...new Set(tagIds.map(String))];
        return state.favorites.filter(item=>{
          const tagLabels=item.tagIds.map(id=>state.tags[id]?.label||'');
          const text=labelIdentity([item.displayName,...tagLabels].join(' '));
          return(!needle||text.includes(needle))&&(!selected.length||selected.every(id=>item.tagIds.includes(id)));
        });
      },
      clear(){storage.removeItem(key);}
    });
  }
  root.trainerHistoryStore=Object.freeze({VERSION,PREFIX,MAX_TAGS,MAX_TAGS_PER_FAVORITE,MAX_TAG_LABEL_LENGTH,MAX_NOTE_LENGTH,createTrainerHistoryStore});
})(window);
