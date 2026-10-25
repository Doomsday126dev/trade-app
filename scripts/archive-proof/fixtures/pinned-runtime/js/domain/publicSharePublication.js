(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const REQUIRED_LIST_SURFACES=Object.freeze(['wishlist','dynamax','gmax','costumes']);
  const REQUIRED_SOURCE_SURFACES=Object.freeze(['profile',...REQUIRED_LIST_SURFACES]);
  const ALLOWED_TRIGGERS=Object.freeze(['explicit_share','owned_list_edit','share_profile_update']);
  const TRIGGER_PRIORITY=Object.freeze(['explicit_share','share_profile_update','owned_list_edit']);
  const LIST_ALIASES=Object.freeze({
    wishlist:Object.freeze(['wishlist','trades']),
    dynamax:Object.freeze(['dynamax']),
    gmax:Object.freeze(['gmax','gigantamax']),
    costumes:Object.freeze(['costumes','others'])
  });

  function errorResult(code,message,details={}){
    return{ok:false,error:Object.freeze({code,message,...details})};
  }
  function normalizeIdentity(value){
    const uid=String(value?.uid||'').trim();
    const username=String(value?.username||'').trim();
    return uid&&username?Object.freeze({uid,username}):null;
  }
  function sameIdentity(a,b){return!!a&&!!b&&a.uid===b.uid&&a.username===b.username;}
  function sameToken(active,token){
    return!!active&&!!token&&active.generation===token.generation&&sameIdentity(active,token);
  }
  function plainObject(value){return!!value&&typeof value==='object'&&!Array.isArray(value);}
  function normalizedPublicProfile(profile){
    return{
      friendCode:String(profile?.friendCode||'').slice(0,32),
      bio:String(profile?.bio||'').slice(0,120),
      discord:String(profile?.discord||'').slice(0,40),
      avatarPokemon:String(profile?.avatarPokemon||'').slice(0,80),
      lastUpdated:Number(profile?.lastUpdated||0)||null
    };
  }

  function normalizedPublishedTypes(value){
    if(!Array.isArray(value))return[];
    return REQUIRED_LIST_SURFACES.filter(type=>value.includes(type));
  }
  const DECLARATION_FIELDS=Object.freeze(['intent','category','name','p','mod','gender','backgroundId','note','lucky','shiny','xxl','xxs']);
  function publicDeclarations(entries,{strict=false}={}){
    if(!Array.isArray(entries)||entries.length>2000)throw new TypeError('Invalid public declarations');
    return entries.map(entry=>{
      if(!plainObject(entry)||strict&&(Object.keys(entry).length!==DECLARATION_FIELDS.length||Object.keys(entry).some(key=>!DECLARATION_FIELDS.includes(key))))throw new TypeError('Invalid public declaration fields');
      const item={};
      for(const key of DECLARATION_FIELDS){
        if(['lucky','shiny','xxl','xxs'].includes(key)){
          if(strict&&typeof entry[key]!=='boolean')throw new TypeError('Invalid public flag');
          item[key]=entry[key]===true;
        }else{
          const value=entry[key]??'';
          if(typeof value!=='string'||value.length>(key==='name'?200:160)||/[\u0000-\u001f\u007f]/u.test(value))throw new TypeError('Invalid public text');
          item[key]=value;
        }
      }
      if(!['lf','ft'].includes(item.intent)||!REQUIRED_LIST_SURFACES.includes(item.category)||!item.name.trim()||['__proto__','constructor','prototype'].includes(item.name)||!['','H','M','L'].includes(item.p)||!['','m','f'].includes(item.gender))throw new TypeError('Invalid public declaration');
      return item;
    });
  }
  function intentEntries(snapshot,intent='lf',category){
    if(snapshot?.version===2)return(snapshot.declarations||[]).filter(entry=>entry.intent===intent&&(!category||entry.category===category));
    if(intent!=='lf')return[];
    return REQUIRED_LIST_SURFACES.filter(type=>!category||type===category).flatMap(type=>Object.entries(snapshot?.lists?.[type]||{}).map(([name,value])=>({name,value,intent:'lf',category:type})));
  }
  function projectionLists(snapshot){
    if(plainObject(snapshot?.lists))return{container:snapshot.lists,shape:'current'};
    const hasLegacy=Object.values(LIST_ALIASES).flat().some(key=>plainObject(snapshot?.[key]));
    return hasLegacy?{container:snapshot,shape:'legacy'}:null;
  }
  function normalizeProjectionEntries(container,{strictCategories=false}={}){
    const lists={};
    const rejectionCounts={invalid_entry_name:0,invalid_entry_value:0,unsupported_category:0};
    if(strictCategories){
      const known=new Set(Object.values(LIST_ALIASES).flat());
      rejectionCounts.unsupported_category=Object.keys(container||{}).filter(key=>!known.has(key)).length;
    }
    for(const type of REQUIRED_LIST_SURFACES){
      const merged={};
      for(const alias of [...LIST_ALIASES[type]].reverse()){
        const entries=container?.[alias];
        if(entries===undefined)continue;
        if(!plainObject(entries)){rejectionCounts.invalid_entry_value++;continue;}
        for(const [name,value] of Object.entries(entries)){
          if(!String(name||'').trim()){rejectionCounts.invalid_entry_name++;continue;}
          if(typeof value!=='string'&&!plainObject(value)){rejectionCounts.invalid_entry_value++;continue;}
          merged[name]=value;
        }
      }
      lists[type]=merged;
    }
    return{lists,rejectionCounts};
  }
  function publicShareProjectionStatus(snapshot,{username}={}){
    if(snapshot===null||snapshot===undefined)return{ok:false,status:'not_published'};
    const expectedUsername=String(username||'').trim();
    const snapshotUsername=String(snapshot?.username||'').trim();
    if(!plainObject(snapshot)||!snapshotUsername||
      (expectedUsername&&snapshotUsername!==expectedUsername)||!plainObject(snapshot.profile)){
      return{ok:false,status:'projection_unsupported',rejectionCounts:{invalid_projection:1}};
    }
    const source=projectionLists(snapshot);
    const publishedTypes=normalizedPublishedTypes(snapshot.publishedListTypes);
    if(!source&&publishedTypes.length!==REQUIRED_LIST_SURFACES.length){
      return{ok:false,status:'projection_incomplete',rejectionCounts:{missing_list_projection:1}};
    }
    if(snapshot.version!==1&&snapshot.version!==2&&source?.shape!=='legacy'){
      return{ok:false,status:'projection_unsupported',rejectionCounts:{unsupported_version:1}};
    }
    const normalized=normalizeProjectionEntries(source?.container||{},{strictCategories:source?.shape==='current'});
    const rejected=Object.values(normalized.rejectionCounts).reduce((count,value)=>count+value,0);
    if(rejected)return{ok:false,status:'projection_unsupported',rejectionCounts:normalized.rejectionCounts};
    let declarations;
    if(snapshot.version===2){
      try{declarations=publicDeclarations(snapshot.declarations??[],{strict:true});}catch{return{ok:false,status:'projection_unsupported'};}
      if(snapshot.declarationCount!==declarations.length)return{ok:false,status:'projection_incomplete'};
    }
    const entryCount=declarations?declarations.length:REQUIRED_LIST_SURFACES.reduce((count,type)=>count+Object.keys(normalized.lists[type]).length,0);
    return{
      ok:true,status:entryCount?'published':'published_empty',entryCount,
      shape:source?.shape||'current',rejectionCounts:normalized.rejectionCounts,
      snapshot:{
        version:declarations?2:1,...(declarations?{declarations,declarationCount:declarations.length}:{}),username:snapshotUsername,profile:normalizedPublicProfile(snapshot.profile),
        lists:normalized.lists,publishedListTypes:[...REQUIRED_LIST_SURFACES],
        updatedAt:Number(snapshot.updatedAt||0)||null
      }
    };
  }

  function ownerProjectionReview(snapshot,{username}={}){
    if(snapshot===null||snapshot===undefined)return{ok:true,status:'missing_projection',republishRequired:true};
    if(!plainObject(snapshot))return{ok:true,status:'unsupported_projection',republishRequired:true};
    const hasProfile=plainObject(snapshot.profile);
    const source=projectionLists(snapshot);
    const publishedTypes=normalizedPublishedTypes(snapshot.publishedListTypes);
    if(hasProfile&&!source&&publishedTypes.length===0)return{ok:true,status:'profile_only',republishRequired:true};
    if(source&&publishedTypes.length!==REQUIRED_LIST_SURFACES.length){
      return{ok:true,status:'missing_published_list_types',republishRequired:true};
    }
    if(!source&&publishedTypes.length!==REQUIRED_LIST_SURFACES.length)return{ok:true,status:'incomplete_list_projection',republishRequired:true};
    const projection=publicShareProjectionStatus(snapshot,{username});
    if(!projection.ok){
      return{ok:true,status:projection.status==='projection_incomplete'?'incomplete_list_projection':'unsupported_projection',republishRequired:true};
    }
    return{ok:true,status:'valid_complete_projection',republishRequired:false,entryCount:projection.entryCount};
  }

  function createPublicSharePublicationGate(){
    let generation=0;
    let active=null;
    let surfaceState=new Map();
    const pendingTriggers=new Set();

    function token(){return active?Object.freeze({...active}):null;}
    function activate(value){
      const identity=normalizeIdentity(value);
      if(!identity)return errorResult('share-publication/identity-required','Public-share hydration requires UID and username');
      if(active&&sameIdentity(active,identity))return{ok:true,status:'existing',token:token()};
      generation++;
      active=Object.freeze({...identity,generation});
      surfaceState=new Map(REQUIRED_SOURCE_SURFACES.map(surface=>[surface,'pending']));
      pendingTriggers.clear();
      return{ok:true,status:'hydration_started',token:token()};
    }
    function validateToken(value){
      if(!active)return errorResult('share-publication/session-inactive','Public-share publication has no active session');
      if(!sameToken(active,value))return errorResult('share-publication/stale-generation','Public-share hydration belongs to a stale session');
      return{ok:true};
    }
    function validateSurface(surface){
      return REQUIRED_SOURCE_SURFACES.includes(surface)
        ?{ok:true}
        :errorResult('share-publication/surface-invalid','Public-share hydration surface is not registered');
    }
    function mark(value,surface,status){
      const session=validateToken(value);if(!session.ok)return session;
      const registered=validateSurface(surface);if(!registered.ok)return registered;
      surfaceState.set(surface,status);
      return{ok:true,status,ready:REQUIRED_SOURCE_SURFACES.every(name=>surfaceState.get(name)==='loaded')};
    }
    function markLoaded(value,surface){return mark(value,surface,'loaded');}
    function markFailed(value,surface){return mark(value,surface,'failed');}
    function readiness(value){
      const session=validateToken(value);if(!session.ok)return session;
      const failed=REQUIRED_SOURCE_SURFACES.filter(surface=>surfaceState.get(surface)==='failed');
      if(failed.length)return errorResult('share-publication/hydration-failed','A required public-share source failed to load',{surfaces:Object.freeze(failed)});
      const pending=REQUIRED_SOURCE_SURFACES.filter(surface=>surfaceState.get(surface)!=='loaded');
      if(pending.length)return errorResult('share-publication/not-ready','Public-share sources are still loading',{surfaces:Object.freeze(pending)});
      return{ok:true,status:'ready'};
    }
    function validateTrigger(trigger){
      return ALLOWED_TRIGGERS.includes(trigger)
        ?{ok:true}
        :errorResult('share-publication/trigger-denied','Public-share publication trigger is not allowed');
    }
    function request(value,trigger){
      const allowed=validateTrigger(trigger);if(!allowed.ok)return allowed;
      const state=readiness(value);
      if(state.ok)return{ok:true,status:'ready',trigger};
      if(state.error.code==='share-publication/not-ready'){
        pendingTriggers.add(trigger);
        return{ok:true,status:'pending',trigger,pendingSurfaces:state.error.surfaces};
      }
      return state;
    }
    function authorize(value,trigger){
      const allowed=validateTrigger(trigger);if(!allowed.ok)return allowed;
      return readiness(value);
    }
    function consumePending(value){
      const state=readiness(value);if(!state.ok)return state;
      const trigger=TRIGGER_PRIORITY.find(item=>pendingTriggers.has(item))||null;
      pendingTriggers.clear();
      return{ok:true,status:trigger?'pending_ready':'none',trigger};
    }
    function invalidate(reason='session_end'){
      generation++;
      active=null;
      surfaceState=new Map();
      pendingTriggers.clear();
      return{ok:true,status:'invalidated',reason,generation};
    }
    function snapshot(){
      return Object.freeze({
        active:!!active,
        generation,
        identity:active?Object.freeze({uid:active.uid,username:active.username}):null,
        surfaces:Object.freeze(Object.fromEntries(surfaceState)),
        pendingTriggers:Object.freeze([...pendingTriggers])
      });
    }
    return Object.freeze({activate,markLoaded,markFailed,request,authorize,consumePending,invalidate,snapshot});
  }

  function buildPublicShareSnapshot({gate,token,trigger,username,source,declarations,now=Date.now()}={}){
    if(!gate||typeof gate.authorize!=='function')throw new TypeError('Public-share snapshot requires a publication gate');
    const authorization=gate.authorize(token,trigger);if(!authorization.ok)return authorization;
    const cleanUsername=String(username||'').trim();
    if(!cleanUsername||token?.username!==cleanUsername){
      return errorResult('share-publication/username-mismatch','Public-share username does not match the hydrated session');
    }
    if(!plainObject(source))return errorResult('share-publication/source-invalid','Public-share source is invalid');
    const lists={};
    for(const type of REQUIRED_LIST_SURFACES){
      if(!plainObject(source[type]))return errorResult('share-publication/source-invalid','A public-share source collection is missing',{surface:type});
      const list=source[type][cleanUsername];
      if(list!==undefined&&!plainObject(list))return errorResult('share-publication/source-invalid','A public-share list has an invalid shape',{surface:type});
      lists[type]={...(list||{})};
    }
    const profile=plainObject(source.users?.[cleanUsername])?source.users[cleanUsername]:{};
    let unified;
    if(declarations!==undefined){
      try{unified=publicDeclarations(declarations);}catch{return errorResult('share-publication/declarations-invalid','Public declarations could not be represented');}
      // Compatibility LF fields are secondary. V2 readers use the lossless array.
      for(const type of REQUIRED_LIST_SURFACES)lists[type]=Object.create(null);
      for(const entry of unified)if(entry.intent==='lf'&&!Object.hasOwn(lists[entry.category],entry.name)){
        lists[entry.category][entry.name]={p:entry.p,mod:entry.mod,lucky:entry.lucky,shiny:entry.shiny,xxl:entry.xxl,xxs:entry.xxs,backgroundId:entry.backgroundId};
      }
    }
    return{ok:true,status:'ready',snapshot:{
      version:unified?2:1,...(unified?{declarations:unified,declarationCount:unified.length}:{}),
      username:cleanUsername,
      profile:normalizedPublicProfile(profile),
      lists,
      publishedListTypes:[...REQUIRED_LIST_SURFACES],
      updatedAt:Number(now)||Date.now()
    }};
  }

  root.publicSharePublication=Object.freeze({
    REQUIRED_LIST_SURFACES,REQUIRED_SOURCE_SURFACES,ALLOWED_TRIGGERS,LIST_ALIASES,
    DECLARATION_FIELDS,publicDeclarations,intentEntries,publicShareProjectionStatus,ownerProjectionReview,createPublicSharePublicationGate,buildPublicShareSnapshot
  });
})(window);
