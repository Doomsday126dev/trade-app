(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const REQUIRED_LIST_SURFACES=Object.freeze(['wishlist','dynamax','gmax','costumes']);
  const REQUIRED_SOURCE_SURFACES=Object.freeze(['profile',...REQUIRED_LIST_SURFACES]);
  const ALLOWED_TRIGGERS=Object.freeze(['explicit_share','owned_list_edit','share_profile_update']);
  const TRIGGER_PRIORITY=Object.freeze(['explicit_share','share_profile_update','owned_list_edit']);

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

  function buildPublicShareSnapshot({gate,token,trigger,username,source,now=Date.now()}={}){
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
    return{ok:true,status:'ready',snapshot:{
      version:1,
      username:cleanUsername,
      profile:{
        friendCode:String(profile.friendCode||'').slice(0,32),
        bio:String(profile.bio||'').slice(0,120),
        discord:String(profile.discord||'').slice(0,40),
        avatarPokemon:String(profile.avatarPokemon||'').slice(0,80),
        lastUpdated:Number(profile.lastUpdated||0)||null
      },
      lists,
      updatedAt:Number(now)||Date.now()
    }};
  }

  root.publicSharePublication=Object.freeze({
    REQUIRED_LIST_SURFACES,REQUIRED_SOURCE_SURFACES,ALLOWED_TRIGGERS,createPublicSharePublicationGate,buildPublicShareSnapshot
  });
})(window);
