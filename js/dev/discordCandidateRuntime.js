(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  const CALLBACK_URI='https://doomsday126dev.github.io/trade-app/auth/discord.html';
  function createDiscordCandidateRuntime({enabled=false,invokeGateway,getSessionBinding,getAuthorizationHeader,authGate,...browser}={}){
    if(!enabled)return Object.freeze({available:false});
    if(typeof invokeGateway!=='function'||!authGate?.commitCustomToken)throw new TypeError('Discord candidate runtime dependencies required');
    let popup=null,removePopupListener=null;
    const hostLocation=browser.location||global.location;
    const client=root.discordOAuthPrototypeClient.createDiscordOAuthPrototypeClient({...browser,
      location:{get href(){return hostLocation.href;},assign(url){if(popup){if(popup.closed)throw Error('discord/popup-closed');popup.location.replace(url);}else hostLocation.assign(url);}},
      candidateMode:true,callbackUri:CALLBACK_URI,getSessionBinding,getAuthorizationHeader,
      requestTransport:(action,input,context)=>invokeGateway(action,input,context),
      signInWithCustomToken:(customToken,context)=>authGate.commitCustomToken({customToken,...context})});
    async function completeCallback(payload){
      if(!payload||payload.type!=='pogo:discord-callback')throw new TypeError('Exact callback payload required');
      const url=new URL(CALLBACK_URI);
      for(const key of['code','state','iss','error'])if(typeof payload[key]==='string')url.searchParams.set(key,payload[key]);
      return client.completeFromLocation(url.href);
    }
    function cleanup(){removePopupListener?.();removePopupListener=null;try{popup?.close();}catch{}popup=null;}
    const api={available:true,begin:client.begin,confirmLink:client.confirmLink,getState:client.getState,completeCallback,
      cancel(){const result=client.cancel();if(result.canCancel)cleanup();return result;},
      async startPopup(operation,{open=global.open?.bind(global),onResult,onError}={}){
        if(popup||client.getState().status==='pending'||client.getState().status==='committing')throw Object.assign(new Error('discord/operation-pending'),{code:'discord/operation-pending'});
        popup=open?.('about:blank','_blank','popup,width=520,height=720');
        if(!popup)throw Object.assign(new Error('discord/popup-blocked'),{code:'discord/popup-blocked'});
        removePopupListener=api.listenForPopup({popup,onResult:result=>{cleanup();onResult?.(result);},onError:error=>{cleanup();onError?.(error);}});
        try{return await client.begin(operation);}catch(error){cleanup();throw error;}
      },
      listenForPopup({popup,onResult,onError}={}){
        if(!popup)throw Object.assign(new Error('discord/popup-blocked'),{code:'discord/popup-blocked'});
        const handler=async event=>{
          if(event.origin!==new URL(CALLBACK_URI).origin||event.source!==popup||event.data?.type!=='pogo:discord-callback')return;
          global.removeEventListener('message',handler);
          try{const result=await completeCallback(event.data);popup.postMessage({type:'pogo:discord-callback-accepted',state:event.data.state},event.origin);onResult?.(result);}catch{onError?.({code:'discord/callback-failed'});}
        };
        global.addEventListener('message',handler);return()=>global.removeEventListener('message',handler);
      }};
    return Object.freeze(api);
  }
  root.discordCandidateRuntime=Object.freeze({CALLBACK_URI,createDiscordCandidateRuntime});
})(window);
