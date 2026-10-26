'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const SOURCE=fs.readFileSync(path.join(__dirname,'../js/dev/discordOAuthPrototypeClient.js'),'utf8');
const ORIGIN='http://127.0.0.1:8878',REQUEST_KEY='pogo.discord.prototype.request';
const STATE='s'.repeat(43),CONFIRM='r'.repeat(43),NOW=1_800_000_000_000;
const A={ownerBinding:`v1_${'a'.repeat(64)}`,lifecycleBinding:`v1_${'b'.repeat(64)}`};
const OUT={ownerBinding:'',lifecycleBinding:`v1_${'c'.repeat(64)}`};
function env(options={}){
  const values=new Map(),writes=[],assigned=[],replaced=[],calls=[],signIns=[];
  let href=options.href||`${ORIGIN}/trade-app/`,binding=options.signedOut?OUT:A,now=NOW;
  const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>{values.set(key,String(value));writes.push(String(value));},removeItem:key=>values.delete(key)};
  const location={get href(){return href;},assign(value){assigned.push(value);}};
  const history={state:null,replaceState(...args){replaced.push(args);href=new URL(args[2],ORIGIN).href;}};
  const fetchImpl=async(url,init)=>{
    calls.push({url,init});if(options.fetchImpl)return options.fetchImpl(url,init);
    if(url.endsWith('/begin')){
      const authorize=new URL('https://discord.com/oauth2/authorize');
      authorize.search=new URLSearchParams({response_type:'code',client_id:'157730590492196864',redirect_uri:`${ORIGIN}/trade-app/`,scope:'identify',prompt:'consent',state:STATE,code_challenge:'c'.repeat(43),code_challenge_method:'S256'});
      return new Response(JSON.stringify({authorizeUrl:authorize.href,expiresInMs:300000}));
    }
    if(url.endsWith('/confirm'))return new Response(JSON.stringify({ok:true,operation:'link',status:'linked',replay:false}));
    return new Response(JSON.stringify(options.completeResult||{ok:true,operation:'link',status:'confirmation-required',confirmationToken:CONFIRM,discordLabel:'SyntheticDiscordUser',expiresInMs:300000}));
  };
  const window={btoa,location,history,sessionStorage:storage,fetch:fetchImpl,crypto:{getRandomValues:array=>{array.fill(1);return array;}}};
  vm.runInNewContext(SOURCE,{window,URL,Uint8Array,JSON,Object,Error,TypeError,Date,Number});
  const client=window.PogoDev.discordOAuthPrototypeClient.createDiscordOAuthPrototypeClient({fetchImpl,location,history,storage,cryptoApi:window.crypto,
    callbackUri:`${ORIGIN}/trade-app/`,getSessionBinding:()=>binding,clock:()=>now,getAuthorizationHeader:async()=>{options.onHeaders?.();return'Bearer synthetic-id-token';},
    signInWithCustomToken:async(token,guard)=>{assert.equal(guard.isCurrent(),true);signIns.push(token);}});
  function continuation(operation='link',extra={}){values.set(REQUEST_KEY,JSON.stringify({operation,requestId:`discord-${'a'.repeat(43)}`,...(operation==='link'?A:OUT),state:STATE,issuedAt:NOW,expiresAt:NOW+300000,...extra}));}
  return{client,values,writes,assigned,replaced,calls,signIns,continuation,storage,location,setBinding:value=>{binding=value;},setHref:value=>{href=value;},advance:ms=>{now+=ms;}};
}
const callback=`${ORIGIN}/trade-app/?code=synthetic-code&state=${STATE}&iss=https%3A%2F%2Fdiscord.com`;
test('begin stores only bounded opaque continuation metadata and exact identify redirect',async()=>{
  const h=env();await h.client.begin('link');assert.equal(h.calls.length,1);assert.equal(h.calls[0].init.credentials,'same-origin');
  const saved=JSON.parse(h.values.get(REQUEST_KEY));assert.equal(saved.ownerBinding,A.ownerBinding);assert.equal(saved.state,STATE);
  assert.equal(new URL(h.assigned[0]).searchParams.get('scope'),'identify');
  assert.doesNotMatch(JSON.stringify(h.writes),/synthetic-id-token|uid|secret|accessToken|refreshToken/);
});
test('link callback displays identity and requires explicit confirmation before mapping',async()=>{
  const h=env({href:callback});h.continuation();const result=await h.client.completeFromLocation();
  assert.equal(result.status,'confirmation-required');assert.equal(result.discordLabel,'SyntheticDiscordUser');assert.equal(h.calls.length,1);assert.equal(h.signIns.length,0);
  assert.equal(h.values.has(REQUEST_KEY),false);assert.doesNotMatch(JSON.stringify(h.writes),new RegExp(CONFIRM));
  assert.equal((await h.client.confirmLink()).status,'linked');assert.equal(h.calls.length,2);assert.ok(h.calls[1].url.endsWith('/confirm'));
  await assert.rejects(h.client.confirmLink(),{code:'discord/confirmation-expired'});
});
test('canceling wrong Discord account never sends confirmation',async()=>{
  const h=env({href:callback});h.continuation();await h.client.completeFromLocation();h.client.cancel();
  await assert.rejects(h.client.confirmLink(),{code:'discord/confirmation-expired'});assert.equal(h.calls.length,1);
});
test('signed-out login passes token directly to serialized auth commit without persistence',async()=>{
  const token='synthetic-custom-token';
  const h=env({href:callback,signedOut:true,completeResult:{ok:true,operation:'sign-in',status:'existing-account',customToken:token}});h.continuation('sign-in');
  assert.equal((await h.client.completeFromLocation()).status,'existing-account');assert.deepEqual(h.signIns,[token]);assert.equal(h.writes.join('').includes(token),false);
});
test('unlinked Discord enters onboarding without provider account creation',async()=>{
  const h=env({href:callback,signedOut:true,completeResult:{ok:true,operation:'sign-in',status:'onboarding-required'}});h.continuation('sign-in');
  assert.equal((await h.client.completeFromLocation()).status,'onboarding-required');assert.deepEqual(h.signIns,[]);
});
test('denied consent is scrubbed and canceled without network calls',async()=>{
  const h=env({href:`${ORIGIN}/trade-app/?error=access_denied&error_description=never-render-this&state=${STATE}&iss=https%3A%2F%2Fdiscord.com`});h.continuation();
  assert.equal((await h.client.completeFromLocation()).status,'canceled');assert.equal(h.calls.length,0);assert.doesNotMatch(h.location.href,/error|state=/);
});
test('malformed, expired, copied, duplicate and wrong-route callbacks scrub and fail before network',async()=>{
  for(const options of[
    {href:callback,missing:true},{href:callback,extra:{expiresAt:NOW}},{href:callback,extra:{issuedAt:NOW+1}},
    {href:callback.replace(STATE,'x'.repeat(43))},{href:callback.replace('iss=https%3A%2F%2Fdiscord.com','iss=https%3A%2F%2Fevil.example')},{href:`${callback}&iss=https%3A%2F%2Fdiscord.com`},{href:`${callback}&code=other-code`},
    {href:callback.replace('/trade-app/','/wrong/')},{href:callback,change:true}
  ]){
    const h=env(options);if(!options.missing)h.continuation('link',options.extra);if(options.change)h.setBinding({...A,lifecycleBinding:`v1_${'d'.repeat(64)}`});
    await assert.rejects(h.client.completeFromLocation());assert.equal(h.calls.length,0);assert.doesNotMatch(h.location.href,/code=|state=/);assert.equal(h.values.has(REQUEST_KEY),false);
  }
});
test('provider operation substitution cannot sign in while linking',async()=>{
  const h=env({href:callback,completeResult:{ok:true,operation:'sign-in',status:'existing-account',customToken:'synthetic-custom-token'}});h.continuation();
  await assert.rejects(h.client.completeFromLocation(),{code:'discord/response-invalid'});assert.deepEqual(h.signIns,[]);
});
test('session switch during request or before confirmation fails without sign-in or confirmation',async()=>{
  let h;h=env({href:callback,signedOut:true,fetchImpl:async()=>{h.setBinding(A);return new Response(JSON.stringify({ok:true,operation:'sign-in',status:'existing-account',customToken:'synthetic-token'}));}});h.continuation('sign-in');
  await assert.rejects(h.client.completeFromLocation(),{code:'discord/session-changed'});assert.deepEqual(h.signIns,[]);
  const link=env({href:callback});link.continuation();await link.client.completeFromLocation();link.setBinding({...A,lifecycleBinding:`v1_${'e'.repeat(64)}`});
  await assert.rejects(link.client.confirmLink(),{code:'discord/session-changed'});assert.equal(link.calls.length,1);
});
test('authorization result rejects credentials, duplicates, wrong redirect and extra parameters',async()=>{
  for(const mutate of[url=>url.username='attacker',url=>url.searchParams.append('state',STATE),url=>url.searchParams.set('redirect_uri','https://evil.example/'),url=>url.searchParams.set('scope','identify email'),url=>url.hash='hidden']){
    const h=env({fetchImpl:async()=>{
      const url=new URL('https://discord.com/oauth2/authorize');url.search=new URLSearchParams({response_type:'code',client_id:'157730590492196864',redirect_uri:`${ORIGIN}/trade-app/`,scope:'identify',prompt:'consent',state:STATE,code_challenge:'c'.repeat(43),code_challenge_method:'S256'});mutate(url);
      return new Response(JSON.stringify({authorizeUrl:url.href,expiresInMs:300000}));
    }});await assert.rejects(h.client.begin('link'),{code:'discord/authorization-url-invalid'});assert.deepEqual(h.assigned,[]);assert.equal(h.values.size,0);
  }
});
test('expired review and reload never silently link a provider',async()=>{
  const h=env({href:callback});h.continuation();await h.client.completeFromLocation();h.advance(300000);
  await assert.rejects(h.client.confirmLink(),{code:'discord/confirmation-expired'});assert.equal(h.calls.length,1);
  const reloaded=env();await assert.rejects(reloaded.client.confirmLink(),{code:'discord/confirmation-expired'});assert.equal(reloaded.calls.length,0);
});
test('duplicate clicks cannot start two browser operations',async()=>{
  let release;const held=new Promise(resolve=>{release=resolve;});const h=env({fetchImpl:async()=>{await held;throw Error('offline');}});
  const first=h.client.begin('link');await assert.rejects(h.client.begin('link'),{code:'discord/operation-pending'});release();await assert.rejects(first);assert.equal(h.calls.length,1);
});
test('candidate stays outside production loaders and caches',()=>{
  for(const file of['index.html','sw.js','scripts/pages/frontend-files.json','js/app/application.js'])assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),/discordOAuthPrototypeClient|providerMigrationOnboarding/);
  assert.doesNotMatch(SOURCE,/localStorage|indexedDB|accountSync|journal|DISCORD_CLIENT_SECRET/);
});
