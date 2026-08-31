(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const STATES=Object.freeze(['idle','resolving-account','existing-account','choose-handle','confirm-profile','ready-to-create','creating','complete','blocked','canceled']);
  const HANDLE_PATTERN=/^[^.#$\/\[\]\u0000-\u001f\u007f]{2,32}$/;

  function failure(code){const error=new Error(code);error.code=code;return error;}
  function cleanHandle(value){
    const handle=String(value||'').trim();
    if(!HANDLE_PATTERN.test(handle))throw failure('provider-onboarding/handle-invalid');
    return handle;
  }
  function authority(value){
    const uid=String(value?.uid||''),lifecycleId=String(value?.lifecycleId||'');
    if(!uid||!lifecycleId)throw failure('provider-onboarding/authority-invalid');
    return Object.freeze({uid,lifecycleId});
  }
  function authorityCurrent(expected,current){return!!expected&&!!current&&expected.uid===current.uid&&expected.lifecycleId===current.lifecycleId;}
  function createProviderOnboardingModel({authoritySnapshot,checkHandle,createAccount}={}){
    if(typeof authoritySnapshot!=='function'||typeof checkHandle!=='function')throw new TypeError('Provider onboarding dependencies are incomplete');
    let binding=null,state=Object.freeze({status:'idle',providerKey:'',handle:'',code:''});
    const set=next=>(state=Object.freeze({...next}));
    const requireCurrent=()=>{const current=authority(authoritySnapshot());if(!authorityCurrent(binding,current))throw failure('provider-onboarding/auth-lifecycle-changed');return current;};
    function begin({providerKey='google'}={}){
      binding=authority(authoritySnapshot());
      return set({status:'resolving-account',providerKey:String(providerKey||''),handle:'',code:''});
    }
    function resolveAccount(result={}){
      requireCurrent();
      if(result.status==='existing'&&result.username)return set({status:'existing-account',providerKey:state.providerKey,handle:String(result.username),code:''});
      if(result.status==='unlinked')return set({status:'choose-handle',providerKey:state.providerKey,handle:'',code:''});
      throw failure('provider-onboarding/account-resolution-invalid');
    }
    async function chooseHandle(rawHandle){
      requireCurrent();const handle=cleanHandle(rawHandle),result=await checkHandle(handle,binding);
      requireCurrent();
      if(result?.available!==true)return set({status:'blocked',providerKey:state.providerKey,handle,code:String(result?.code||'provider-onboarding/handle-unavailable')});
      return set({status:'confirm-profile',providerKey:state.providerKey,handle,code:''});
    }
    function confirmProfile({friendCode='',avatarPokemon='',bio=''}={}){
      requireCurrent();
      if(state.status!=='confirm-profile')throw failure('provider-onboarding/state-invalid');
      const profile=Object.freeze({friendCode:String(friendCode||'').trim(),avatarPokemon:String(avatarPokemon||'').trim(),bio:String(bio||'').trim()});
      state=Object.freeze({...state,status:'ready-to-create',profile});return state;
    }
    async function create(){
      requireCurrent();
      if(state.status!=='ready-to-create'||typeof createAccount!=='function')throw failure('provider-onboarding/creation-unavailable');
      set({...state,status:'creating'});
      const result=await createAccount(Object.freeze({uid:binding.uid,lifecycleId:binding.lifecycleId,providerKey:state.providerKey,handle:state.handle,profile:state.profile}));
      requireCurrent();
      if(result?.uid!==binding.uid||result?.handle!==state.handle)throw failure('provider-onboarding/creation-result-invalid');
      return set({...state,status:'complete',code:''});
    }
    function cancel(){binding=null;return set({status:'canceled',providerKey:state.providerKey,handle:'',code:'provider-onboarding/canceled'});}
    return Object.freeze({snapshot:()=>state,begin,resolveAccount,chooseHandle,confirmProfile,create,cancel});
  }

  root.providerOnboardingModel=Object.freeze({STATES,HANDLE_PATTERN,cleanHandle,authority,authorityCurrent,createProviderOnboardingModel});
})(window);
