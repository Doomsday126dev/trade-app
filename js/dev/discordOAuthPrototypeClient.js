(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  const REQUEST_KEY='pogo.discord.prototype.request';

  function base64url(bytes){
    let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    return global.btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function randomToken(cryptoApi){const bytes=new Uint8Array(32);cryptoApi.getRandomValues(bytes);return base64url(bytes);}
  function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.slice().sort().join(',');}
  function createDiscordOAuthPrototypeClient({
    fetchImpl=global.fetch.bind(global),location=global.location,history=global.history,
    storage=global.sessionStorage,cryptoApi=global.crypto,
    getAuthorizationHeader=async()=>'',signInWithCustomToken=async()=>{},endpointRoot='/__local/discord/oauth'
  }={}){
    if(!fetchImpl||!location||!history||!storage||!cryptoApi?.getRandomValues)throw new TypeError('Discord prototype client dependencies are incomplete');
    const origin=new URL(location.href).origin;
    const endpoint=(route)=>new URL(`${endpointRoot}/${route}`,origin).href;
    async function headers(operation){
      const result={'content-type':'application/json'};
      if(operation==='link'){const authorization=await getAuthorizationHeader();if(!authorization)throw new Error('Discord link requires current Firebase authority');result.authorization=authorization;}
      return result;
    }
    async function request(route,operation,payload){
      const response=await fetchImpl(endpoint(route),{method:'POST',credentials:'same-origin',redirect:'error',headers:await headers(operation),body:JSON.stringify(payload)});
      const data=await response.json();if(!response.ok||data?.ok===false)throw Object.assign(new Error(data?.error?.reason||'Discord prototype request failed'),{code:data?.error?.code||'internal'});return data;
    }
    async function begin(operation){
      if(!['link','sign-in'].includes(operation))throw new TypeError('Invalid Discord operation');
      const requestId=`discord-${randomToken(cryptoApi)}`;
      storage.setItem(REQUEST_KEY,JSON.stringify({operation,requestId}));
      const result=await request('begin',operation,{operation,requestId});
      if(!exactKeys(result,['authorizeUrl','expiresInMs']))throw new Error('Invalid Discord authorization response');
      const authorize=new URL(result.authorizeUrl);
      if(authorize.protocol!=='https:'||authorize.hostname!=='discord.com'||authorize.pathname!=='/oauth2/authorize'||
        authorize.searchParams.get('response_type')!=='code'||authorize.searchParams.get('scope')!=='identify'||
        authorize.searchParams.get('code_challenge_method')!=='S256'||!authorize.searchParams.get('state')||
        authorize.searchParams.has('client_secret'))throw new Error('Unsafe Discord authorization URL');
      location.assign(authorize.href);return Object.freeze({status:'redirecting'});
    }
    function scrubCallback(){
      const clean=new URL(location.href);clean.searchParams.delete('code');clean.searchParams.delete('state');
      history.replaceState(history.state,'',`${clean.pathname}${clean.search}${clean.hash}`);
    }
    async function completeFromLocation(){
      const callback=new URL(location.href),code=callback.searchParams.get('code'),state=callback.searchParams.get('state');
      if(!code&&!state)return null;if(!code||!state)throw new Error('Incomplete Discord callback');
      let pending;try{pending=JSON.parse(storage.getItem(REQUEST_KEY)||'null');}catch{pending=null;}
      if(!pending||!['link','sign-in'].includes(pending.operation)||typeof pending.requestId!=='string')throw new Error('Discord continuation missing');
      try{
        const result=await request('complete',pending.operation,{code,state,requestId:pending.requestId});
        scrubCallback();storage.removeItem(REQUEST_KEY);
        if(result.operation==='sign-in'&&result.status==='existing-account'&&typeof result.customToken==='string'){
          await signInWithCustomToken(result.customToken);return Object.freeze({status:'existing-account'});
        }
        if(result.operation==='sign-in'&&result.status==='onboarding-required')return Object.freeze({status:'onboarding-required'});
        if(result.operation==='link'&&['linked','already-linked'].includes(result.status))return Object.freeze({status:result.status});
        throw new Error('Invalid Discord completion response');
      }catch(error){scrubCallback();throw error;}
    }
    return Object.freeze({begin,completeFromLocation});
  }
  root.discordOAuthPrototypeClient=Object.freeze({createDiscordOAuthPrototypeClient});
})(window);
