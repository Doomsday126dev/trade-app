'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {createDiscordCandidateGateway}=require('../functions/src/prototype/discordCandidateGateway');
const {createDiscordOAuthPrototype}=require('../functions/src/prototype/discordOAuthPrototype');
const {createInMemoryDiscordOAuthStore}=require('../functions/src/prototype/inMemoryDiscordOAuthStore');
const ORIGIN='https://doomsday126dev.github.io',CALLBACK=`${ORIGIN}/trade-app/auth/discord.html`,A=`v1_${'a'.repeat(64)}`,L=`v1_${'b'.repeat(64)}`;
function browser(binding){
  const values=new Map(),assigned=[],commits=[],listeners=new Map();let session=binding;
  const location={href:`${ORIGIN}/trade-app/`,assign:url=>assigned.push(url)},storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const window={crypto:webcrypto,btoa,location,sessionStorage:storage,history:{state:null,replaceState(){}},addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
  const context=vm.createContext({window,URL,Object,Error,TypeError,JSON,Uint8Array,Set,Date,Number});
  for(const file of['discordOAuthPrototypeClient','providerAuthCommitGate','discordCandidateRuntime','discordCallbackPage'])vm.runInContext(fs.readFileSync(path.join(__dirname,`../js/dev/${file}.js`),'utf8'),context);
  return{window,storage,values,assigned,commits,getSessionBinding:()=>session,setSession:value=>{session=value;},authGate:{commitCustomToken:async value=>{assert.equal(value.isCurrent(),true);commits.push(value);return{user:{uid:value.expectedUid}};}}};
}
function backend(){
  const store=createInMemoryDiscordOAuthStore({accounts:{'synthetic-owner':{uid:'synthetic-owner',status:'active',accountFingerprint:'c'.repeat(64),providers:{}}}}),calls=[];
  const authority={verify:async({lifecycleId})=>({uid:'synthetic-owner',lifecycleId,accountFingerprint:'c'.repeat(64),recentAuth:true}),unlink:async()=>{throw Error('not enabled');}};
  const oauth=createDiscordOAuthPrototype({store,config:{clientId:'157730590492196864',clientSecret:'synthetic-client-secret',statePepper:'synthetic-state-pepper',subjectPepper:'synthetic-subject-pepper',redirectUri:CALLBACK},discord:{exchangeCode:async()=>({accessToken:'synthetic-access-token',tokenType:'Bearer',scope:'identify'}),getCurrentUser:async()=>({subject:'80351110224678912',label:'SyntheticDiscord'}),revokeToken:async()=>{}},customTokenMinter:async uid=>`synthetic-custom-token-${uid}`});
  const gateway=createDiscordCandidateGateway({enabled:true,oauth,authority,allowedOrigin:ORIGIN,verifyAppCheck:async()=>true});
  const invoke=async(action,input,context)=>{calls.push(action);return gateway(action,input,{origin:ORIGIN,appCheckToken:'synthetic-app-check',idToken:context.authorization?'synthetic-id-token':null});};
  return{store,calls,invoke};
}
function runtime(h,server){return h.window.PogoDev.discordCandidateRuntime.createDiscordCandidateRuntime({enabled:true,invokeGateway:server.invoke,getSessionBinding:h.getSessionBinding,getAuthorizationHeader:async()=> 'Bearer synthetic-id-token',authGate:h.authGate,location:h.window.location,storage:h.storage,history:h.window.history,cryptoApi:webcrypto,fetchImpl:async()=>{throw Error('direct network forbidden');}});}
function callback(h){const url=new URL(h.assigned.at(-1));return{type:'pogo:discord-callback',code:'synthetic-provider-code',state:url.searchParams.get('state'),iss:'https://discord.com'};}
test('candidate runtime composes browser continuation, private gateway and explicit link confirmation without UID changes',async()=>{
  const h=browser({ownerBinding:A,lifecycleBinding:L}),server=backend(),api=runtime(h,server);
  await api.begin('link');assert.equal(new URL(h.assigned[0]).searchParams.get('redirect_uri'),CALLBACK);
  assert.equal((await api.completeCallback(callback(h))).status,'confirmation-required');assert.equal(Object.keys(server.store.inspect().providerSubjects).length,0);
  assert.equal((await api.confirmLink()).status,'linked');assert.equal(h.commits.length,0);assert.deepEqual(server.calls,['begin','complete','confirm']);
  assert.doesNotMatch(JSON.stringify([...h.values]),/synthetic-id-token|synthetic-access-token/);
});
test('linked Discord sign-in sends exact mapped UID and original lifecycle directly to the auth commit guard',async()=>{
  const server=backend(),linked=browser({ownerBinding:A,lifecycleBinding:L}),linkRuntime=runtime(linked,server);await linkRuntime.begin('link');await linkRuntime.completeCallback(callback(linked));await linkRuntime.confirmLink();
  const h=browser({ownerBinding:'',lifecycleBinding:L}),api=runtime(h,server);await api.begin('sign-in');assert.equal((await api.completeCallback(callback(h))).status,'existing-account');
  assert.equal(h.commits[0].expectedUid,'synthetic-owner');assert.equal(h.commits[0].expectedLifecycle,L);assert.doesNotMatch(JSON.stringify([...h.values]),/custom-token/);
});
test('candidate is default-off and blocked popup is a typed no-mutation failure',()=>{
  const h=browser({ownerBinding:A,lifecycleBinding:L});assert.equal(h.window.PogoDev.discordCandidateRuntime.createDiscordCandidateRuntime().available,false);
  assert.throws(()=>runtime(h,backend()).listenForPopup({popup:null}),{code:'discord/popup-blocked'});
});
test('standalone callback scrubs errors and codes before validating and never renders upstream text',()=>{
  const h=browser({ownerBinding:A,lifecycleBinding:L}),replaced=[],location={href:`${CALLBACK}?code=synthetic-provider-code&state=${'s'.repeat(43)}&iss=https%3A%2F%2Fdiscord.com`},history={replaceState:(...args)=>replaced.push(args)};
  const payload=h.window.PogoDev.discordCallbackPage.capture({location,history});assert.equal(payload.code,'synthetic-provider-code');assert.equal(replaced[0][2],'/trade-app/auth/discord.html');
  location.href=`${CALLBACK}?error=arbitrary-secret&error_description=never-render-this&state=${'s'.repeat(43)}&iss=https%3A%2F%2Fdiscord.com`;
  assert.equal(h.window.PogoDev.discordCallbackPage.capture({location,history}).error,'provider_error');
  location.href=`${CALLBACK}?code=synthetic-code&state=${'s'.repeat(43)}&iss=https%3A%2F%2Fevil.example`;
  assert.throws(()=>h.window.PogoDev.discordCallbackPage.capture({location,history}),/callback-invalid/);assert.equal(replaced.at(-1)[2],'/trade-app/auth/discord.html');
});
test('callback and candidate runtime remain outside release inventory',()=>{
  const root=path.join(__dirname,'..');for(const file of['index.html','sw.js','scripts/pages/frontend-files.json','functions/src/index.js'])assert.doesNotMatch(fs.readFileSync(path.join(root,file),'utf8'),/auth\/discord\.html|discordCandidateRuntime|discordCallbackPage/);
});

test('composed auth gate accepts its own UID/lifecycle transition without mistaking it for cancellation',async()=>{
  const server=backend(),linked=browser({ownerBinding:A,lifecycleBinding:L}),linkRuntime=runtime(linked,server);await linkRuntime.begin('link');await linkRuntime.completeCallback(callback(linked));await linkRuntime.confirmLink();
  const h=browser({ownerBinding:'',lifecycleBinding:L}),auth={currentUser:null};let hook;
  h.authGate=h.window.PogoDev.providerAuthCommitGate.createProviderAuthCommitGate({auth,locks:{request:async(name,options,work)=>work()},getLifecycle:()=>h.getSessionBinding().lifecycleBinding,
    beforeAuthStateChanged:(a,callback)=>{hook=callback;return()=>{hook=null;};},signInWithCustomToken:async()=>{
      const user={uid:'synthetic-owner'};await hook(user);auth.currentUser=user;h.setSession({ownerBinding:A,lifecycleBinding:`v1_${'e'.repeat(64)}`});return{user};
    }});
  const api=runtime(h,server);await api.begin('sign-in');assert.equal((await api.completeCallback(callback(h))).status,'existing-account');assert.equal(auth.currentUser.uid,'synthetic-owner');
});
