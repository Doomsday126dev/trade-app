(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  function capture({location=global.location,history=global.history}={}){
    const url=new URL(location.href),payload={type:'pogo:discord-callback'};
    const clean=new URL(url.href);
    for(const key of['code','state','iss','error','error_description','error_uri'])clean.searchParams.delete(key);
    clean.hash='';history.replaceState(null,'',`${clean.pathname}${clean.search}`);
    const keys=[...url.searchParams.keys()],allowed=url.searchParams.has('error')?['state','iss','error','error_description','error_uri']:['code','state','iss'];
    if(url.hash||keys.some(key=>!allowed.includes(key))||new Set(keys).size!==keys.length||url.searchParams.get('iss')!=='https://discord.com'||!/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('state')||''))throw Error('discord/callback-invalid');
    payload.state=url.searchParams.get('state');payload.iss=url.searchParams.get('iss');
    if(url.searchParams.has('error'))payload.error=url.searchParams.get('error')==='access_denied'?'access_denied':'provider_error';
    else{const code=url.searchParams.get('code');if(typeof code!=='string'||code.length<8||code.length>2048||/[\u0000-\u001f\u007f]/.test(code))throw Error('discord/callback-invalid');payload.code=code;}
    return Object.freeze(payload);
  }
  let pending=null;
  function take(){const value=pending;pending=null;return value;}
  root.discordCallbackPage=Object.freeze({capture,take});
  if(global.document?.documentElement?.dataset?.discordCallback==='candidate'){
    let message='This sign-in could not be resumed. Return to PoGo Trades and try again.';
    try{
      pending=capture();
      if(global.opener&&!global.opener.closed){
        global.opener.postMessage(pending,global.location.origin);message='Return to the open PoGo Trades window to review your sign-in.';
        const state=pending.state;
        const accepted=event=>{if(event.origin===global.location.origin&&event.source===global.opener&&event.data?.type==='pogo:discord-callback-accepted'&&event.data.state===state){pending=null;global.removeEventListener('message',accepted);global.close();}};
        global.addEventListener('message',accepted);
      }else message='The callback is held only in this window. Return to PoGo Trades to restart if the canary runtime is unavailable.';
    }catch{}
    global.document.addEventListener('DOMContentLoaded',()=>{global.document.getElementById('discord-callback-status').textContent=message;});
  }
})(window);
