(function(global){
  'use strict';
  const TITLE='PoGo Trades';
  function collectorEndpoint(value){
    try{
      const url=new URL(value);
      if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/count'||url.search||url.hash)return null;
      if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.goatcounter\.com$/.test(url.hostname)||url.hostname==='doomsday126dev.goatcounter.com')return null;
      return url;
    }catch{return null;}
  }
  function category(location){
    if(location.protocol!=='https:'||location.hostname!=='doomsday126dev.github.io'||location.port||!['/trade-app/','/trade-app/index.html'].includes(location.pathname))return null;
    return new URLSearchParams(location.search).has('view')?'/trade-share':'/trade';
  }
  function exactCollectorPolicy(document,origin){
    let found=false;
    for(const meta of document.querySelectorAll('meta[http-equiv]')){
      if(meta.httpEquiv.toLowerCase()!=='content-security-policy')continue;
      const directives=meta.content.split(';').map(value=>value.trim().split(/\s+/));
      const connect=directives.find(parts=>parts[0].toLowerCase()==='connect-src');
      if(!connect)continue;
      const sources=connect.slice(1);
      if(!sources.includes(origin)||sources.some(source=>(source.includes('*')&&!/^https?:\/\/\*\.firebaseio\.com$|^wss:\/\/\*\.firebaseio\.com$/.test(source))||/^(https?|wss?):$/.test(source)))return false;
      found=true;
    }
    return found;
  }
  function install({window,document,navigator,fetch}){
    let consumed=false;
    function send(){
      if(consumed||document.visibilityState!=='visible'||document.prerendering)return;
      if(window.top!==window.self||navigator.webdriver||navigator.onLine===false||navigator.globalPrivacyControl===true||[navigator.doNotTrack,window.doNotTrack,navigator.msDoNotTrack].some(value=>['1','yes'].includes(String(value||'').toLowerCase())))return;
      const page=category(window.location),endpoint=collectorEndpoint(document.querySelector('meta[name="pogo-traffic-endpoint"]')?.content||'');
      if(!page||!endpoint||!exactCollectorPolicy(document,endpoint.origin))return;
      consumed=true;
      document.removeEventListener('visibilitychange',send);document.removeEventListener('prerenderingchange',send);
      endpoint.searchParams.set('p',page);endpoint.searchParams.set('t',TITLE);endpoint.searchParams.set('r','');
      try{Promise.resolve(fetch(endpoint.href,{method:'GET',mode:'no-cors',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',keepalive:true})).catch(()=>{});}catch{}
    }
    document.addEventListener('visibilitychange',send);document.addEventListener('prerenderingchange',send);send();
    return()=>{consumed=true;document.removeEventListener('visibilitychange',send);document.removeEventListener('prerenderingchange',send);};
  }
  if(typeof module==='object'&&module.exports)module.exports={collectorEndpoint,category,exactCollectorPolicy,install};
  else if(typeof global.fetch==='function')install({window:global,document:global.document,navigator:global.navigator,fetch:global.fetch.bind(global)});
})(typeof window==='undefined'?globalThis:window);
