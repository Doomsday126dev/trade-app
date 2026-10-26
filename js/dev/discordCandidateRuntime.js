(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  const CALLBACK_URI='https://doomsday126dev.github.io/trade-app/auth/discord.html';
  function createDiscordCandidateRuntime({enabled=false,invokeGateway,getSessionBinding,getAuthorizationHeader,authGate,...browser}={}){
    if(!enabled)return Object.freeze({available:false});
    if(typeof invokeGateway!=='function'||!authGate?.commitCustomToken)throw new TypeError('Discord candidate runtime dependencies required');
    const client=root.discordOAuthPrototypeClient.createDiscordOAuthPrototypeClient({...browser,candidateMode:true,callbackUri:CALLBACK_URI,getSessionBinding,getAuthorizationHeader,
      requestTransport:(action,input,context)=>invokeGateway(action,input,context),
      signInWithCustomToken:(customToken,context)=>authGate.commitCustomToken({customToken,...context})});
    async function completeCallback(payload){
      if(!payload||payload.type!=='pogo:discord-callback')throw new TypeError('Exact callback payload required');
      const url=new URL(CALLBACK_URI);
      for(const key of['code','state','iss','error'])if(typeof payload[key]==='string')url.searchParams.set(key,payload[key]);
      return client.completeFromLocation(url.href);
    }
    return Object.freeze({available:true,begin:client.begin,confirmLink:client.confirmLink,cancel:client.cancel,completeCallback,
      listenForPopup({popup,onResult,onError}={}){
        if(!popup)throw Object.assign(new Error('discord/popup-blocked'),{code:'discord/popup-blocked'});
        const handler=async event=>{
          if(event.origin!==new URL(CALLBACK_URI).origin||event.source!==popup||event.data?.type!=='pogo:discord-callback')return;
          global.removeEventListener('message',handler);
          try{const result=await completeCallback(event.data);popup.postMessage({type:'pogo:discord-callback-accepted',state:event.data.state},event.origin);onResult?.(result);}catch{onError?.({code:'discord/callback-failed'});}
        };
        global.addEventListener('message',handler);return()=>global.removeEventListener('message',handler);
      }});
  }
  root.discordCandidateRuntime=Object.freeze({CALLBACK_URI,createDiscordCandidateRuntime});
})(window);
