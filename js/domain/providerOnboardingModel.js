(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const STATES=Object.freeze([
    'idle','checking-account','onboarding-required','choosing-handle','checking-availability','handle-unavailable',
    'ready-to-create','creating','verifying','account-ready','retryable-failure','ambiguous-result',
    'blocked-conflict','canceled'
  ]);
  const HANDLE_PATTERN=/^[^.#$\/\[\]\u0000-\u001f\u007f]{2,64}$/;
  const STORAGE_KEY='pogoProviderOnboarding:v2';
  const PERSISTED_FIELDS=Object.freeze(['schemaVersion','uid','lifecycleId','providerKey','status','handle','code']);

  function failure(code,state='blocked'){const error=new Error(code);error.code=code;error.state=state;return error;}
  function cleanHandle(value){
    const handle=String(value||'').normalize('NFKC').trim();
    if(!HANDLE_PATTERN.test(handle))throw failure('provider-onboarding/handle-invalid','handle-unavailable');
    return handle;
  }
  function authority(value){
    const uid=String(value?.uid||''),lifecycleId=String(value?.lifecycleId||'');
    if(!uid||!/^auth-[1-9][0-9]{0,9}$/.test(lifecycleId))throw failure('provider-onboarding/authority-invalid','canceled');
    return Object.freeze({uid,lifecycleId});
  }
  function authorityCurrent(expected,current){return!!expected&&!!current&&expected.uid===current.uid&&expected.lifecycleId===current.lifecycleId;}
  function exactFields(value,fields){
    const keys=value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).sort():[];
    const expected=[...fields].sort();return keys.length===expected.length&&keys.every((key,index)=>key===expected[index]);
  }
  function createProviderOnboardingModel({authoritySnapshot,checkHandle,createAccount,reconcileAccount,
    storage=global.localStorage,storageKey=STORAGE_KEY}={}){
    if(typeof authoritySnapshot!=='function'||typeof checkHandle!=='function'||!storage||
      typeof storage.getItem!=='function'||typeof storage.setItem!=='function'){
      throw new TypeError('Provider onboarding dependencies are incomplete');
    }
    let binding=null,profile=null,state=Object.freeze({status:'idle',providerKey:'',handle:'',code:''});
    function persisted(){
      let value=null;try{value=JSON.parse(storage.getItem(storageKey)||'null');}catch{}
      return exactFields(value,PERSISTED_FIELDS)&&value.schemaVersion===1&&STATES.includes(value.status)&&
        typeof value.uid==='string'&&value.uid&&/^auth-[1-9][0-9]{0,9}$/.test(value.lifecycleId||'')&&
        typeof value.providerKey==='string'&&typeof value.handle==='string'&&typeof value.code==='string'?value:null;
    }
    function save(next){
      state=Object.freeze({...next});
      if(binding&&state.status!=='idle'){
        try{storage.setItem(storageKey,JSON.stringify({schemaVersion:1,uid:binding.uid,lifecycleId:binding.lifecycleId,
          providerKey:state.providerKey,status:state.status,handle:state.handle,code:state.code}));}catch{}
      }
      return state;
    }
    function clear(){try{storage.removeItem(storageKey);}catch{}}
    function requireCurrent(){
      const current=authority(authoritySnapshot());
      if(!authorityCurrent(binding,current))throw failure('provider-onboarding/auth-lifecycle-changed','canceled');
      return current;
    }
    function begin({providerKey='google'}={}){
      binding=authority(authoritySnapshot());profile=null;
      const key=String(providerKey||''),prior=persisted();
      if(prior&&prior.uid===binding.uid&&prior.lifecycleId===binding.lifecycleId&&prior.providerKey===key){
        const status=['creating','verifying','ambiguous-result'].includes(prior.status)?'ambiguous-result':
          prior.status==='account-ready'?'checking-account':prior.status;
        return save({status,providerKey:key,handle:prior.handle,code:status==='ambiguous-result'?'provider-onboarding/ambiguous-result':prior.code});
      }
      clear();return save({status:'checking-account',providerKey:key,handle:'',code:''});
    }
    function resolveAccount(result={}){
      requireCurrent();
      if(result.status==='existing'&&(result.foundation?.canonicalTrainerName||result.username)){
        clear();return save({status:'account-ready',providerKey:state.providerKey,
          handle:String(result.foundation?.canonicalTrainerName||result.username),code:'',foundation:result.foundation||null});
      }
      if(['missing','unlinked'].includes(result.status))return save({status:'onboarding-required',providerKey:state.providerKey,handle:state.handle,code:''});
      throw failure('provider-onboarding/account-resolution-invalid','blocked-conflict');
    }
    function startHandleChoice(){
      requireCurrent();
      if(!['onboarding-required','handle-unavailable','retryable-failure','choosing-handle'].includes(state.status))throw failure('provider-onboarding/state-invalid');
      return save({status:'choosing-handle',providerKey:state.providerKey,handle:state.handle,code:''});
    }
    async function chooseHandle(rawHandle){
      requireCurrent();
      if(!['choosing-handle','handle-unavailable','retryable-failure'].includes(state.status))throw failure('provider-onboarding/state-invalid');
      const handle=cleanHandle(rawHandle);save({status:'checking-availability',providerKey:state.providerKey,handle,code:''});
      let result;
      try{result=await checkHandle(handle,binding);}catch(error){
        requireCurrent();return save({status:'retryable-failure',providerKey:state.providerKey,handle,
          code:String(error?.code||'provider-onboarding/availability-failed')});
      }
      requireCurrent();
      if(result?.available!==true)return save({status:'handle-unavailable',providerKey:state.providerKey,handle,
        code:String(result?.code||'provider-onboarding/handle-unavailable')});
      return save({status:'ready-to-create',providerKey:state.providerKey,handle,code:''});
    }
    function confirmProfile({friendCode='',avatarPokemon='',bio=''}={}){
      requireCurrent();if(state.status!=='ready-to-create')throw failure('provider-onboarding/state-invalid');
      profile=Object.freeze({friendCode:String(friendCode||'').trim(),avatarPokemon:String(avatarPokemon||'').trim(),bio:String(bio||'').trim()});
      return state;
    }
    function classifyCreationFailure(error){
      const code=String(error?.code||'provider-onboarding/creation-failed'),kind=String(error?.state||'');
      if(kind==='ambiguous'||/ambiguous|pending-reconciliation/.test(code))return['ambiguous-result','provider-onboarding/ambiguous-result'];
      if(kind==='handle-unavailable'||/handle-(?:conflict|unavailable)/.test(code))return['handle-unavailable',code];
      if(kind==='retryable'||/timeout|network|unavailable|app-check/.test(code))return['retryable-failure',code];
      return['blocked-conflict',code];
    }
    function exactCreatedFoundation(result){
      const foundation=result?.foundation;
      return result?.status==='account-ready'&&foundation?.status==='active'&&foundation.identityKind==='provider_only'&&
        foundation.legacyAccessConfigured===false&&foundation.legacyUsername===null&&
        foundation.canonicalTrainerName===state.handle;
    }
    async function finishCreation(work){
      requireCurrent();save({...state,status:'creating',code:''});
      let result;
      try{result=await work();requireCurrent();}
      catch(error){
        requireCurrent();const[status,code]=classifyCreationFailure(error);save({...state,status,code});throw error;
      }
      save({...state,status:'verifying',code:''});
      if(!exactCreatedFoundation(result)){
        const error=failure('provider-onboarding/creation-result-invalid','blocked-conflict');
        save({...state,status:'blocked-conflict',code:error.code});throw error;
      }
      clear();return save({...state,status:'account-ready',code:'',foundation:result.foundation});
    }
    async function create(){
      requireCurrent();
      if(state.status!=='ready-to-create'||typeof createAccount!=='function')throw failure('provider-onboarding/creation-unavailable');
      const input=Object.freeze({uid:binding.uid,lifecycleId:binding.lifecycleId,providerKey:state.providerKey,
        handle:state.handle,profile});
      return finishCreation(()=>createAccount(input));
    }
    async function reconcile(){
      requireCurrent();
      if(!['ambiguous-result','retryable-failure'].includes(state.status)||typeof reconcileAccount!=='function')throw failure('provider-onboarding/reconciliation-unavailable');
      return finishCreation(()=>reconcileAccount(Object.freeze({uid:binding.uid,lifecycleId:binding.lifecycleId,
        providerKey:state.providerKey,handle:state.handle})));
    }
    function cancel(){
      const providerKey=state.providerKey;binding=null;profile=null;clear();
      state=Object.freeze({status:'canceled',providerKey,handle:'',code:'provider-onboarding/canceled'});return state;
    }
    return Object.freeze({snapshot:()=>state,begin,resolveAccount,startHandleChoice,chooseHandle,confirmProfile,create,reconcile,cancel});
  }

  root.providerOnboardingModel=Object.freeze({
    STATES,HANDLE_PATTERN,STORAGE_KEY,cleanHandle,authority,authorityCurrent,createProviderOnboardingModel
  });
})(window);
