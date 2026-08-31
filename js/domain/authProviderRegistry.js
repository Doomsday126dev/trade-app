(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const METHOD_KEYS=Object.freeze(['username-pin','google','discord']);
  const DEFINITIONS=Object.freeze({
    'username-pin':Object.freeze({key:'username-pin',providerId:'password',labelKey:'security.usernamePin',detailKey:'security.usernamePinHelp',source:'application'}),
    google:Object.freeze({key:'google',providerId:'google.com',labelKey:'security.google',detailKey:'security.providerDevelopmentOnly',source:'firebase-provider-data'}),
    discord:Object.freeze({key:'discord',providerId:'discord.com',labelKey:'security.discord',detailKey:'security.providerDevelopmentOnly',source:'private-provider-link'})
  });
  const METHOD_STATES=Object.freeze(['connected','not-connected','connecting','prepared','waiting-browser','needs-attention','reauthenticate','disconnecting','unavailable']);

  function providerIds(providerData){
    return new Set((Array.isArray(providerData)?providerData:[]).map(item=>String(item?.providerId||'')).filter(Boolean));
  }
  function externalLinks(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return new Set();
    return new Set(Object.entries(value).filter(([,linked])=>linked===true).map(([key])=>key));
  }
  function descriptor(key){return DEFINITIONS[key]||null;}
  function createAuthProviderRegistry({developmentEnabled=false,configuredProviders=[]}={}){
    const configured=new Set((configuredProviders||[]).filter(key=>METHOD_KEYS.includes(key)&&key!=='username-pin'));
    function availability(key){
      if(key==='username-pin')return Object.freeze({visible:true,available:true,actionable:false,reason:'production-access-method'});
      if(!developmentEnabled)return Object.freeze({visible:false,available:false,actionable:false,reason:'production-hidden'});
      const available=configured.has(key);
      return Object.freeze({visible:true,available,actionable:available,reason:available?'development-configured':'provider-unconfigured'});
    }
    function methods({providerData=[],usernamePinAvailable=true,linkedExternalProviders={},operationStates={}}={}){
      const ids=providerIds(providerData),external=externalLinks(linkedExternalProviders);
      return Object.freeze(METHOD_KEYS.map(key=>{
        const definition=DEFINITIONS[key],access=availability(key);
        const linked=key==='username-pin'?usernamePinAvailable===true:
          definition.source==='firebase-provider-data'?ids.has(definition.providerId):external.has(key);
        const requestedState=String(operationStates?.[key]||'');
        const state=METHOD_STATES.includes(requestedState)?requestedState:
          linked?'connected':access.available?'not-connected':'unavailable';
        return Object.freeze({...definition,...access,linked,usable:linked,state});
      }));
    }
    return Object.freeze({developmentEnabled:developmentEnabled===true,descriptor,availability,methods});
  }

  root.authProviderRegistry=Object.freeze({METHOD_KEYS,METHOD_STATES,DEFINITIONS,descriptor,createAuthProviderRegistry});
})(window);
