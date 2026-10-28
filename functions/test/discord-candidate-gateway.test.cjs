'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDiscordCandidateGateway}=require('../src/prototype/discordCandidateGateway');
const ORIGIN='https://doomsday126dev.github.io',input={operation:'link',requestId:'synthetic-request',browserBinding:'b'.repeat(43),lifecycleId:'synthetic-life'};
function harness(enabled=true){const calls=[],oauth={redirectUri:`${ORIGIN}/trade-app/auth/discord.html`,begin:async value=>{calls.push(['begin',await value.currentAuthority()]);return{status:'begun'};},complete:async value=>{calls.push(['complete',value.observedRedirectUri]);return{status:'review'};},confirmLink:async()=>({status:'linked'})},authority={verify:async value=>{calls.push(['verify',value.lifecycleId]);return{uid:'synthetic-owner'};},unlink:async value=>{calls.push(['unlink',Object.keys(value).sort()]);return{status:'unlinked'};}};return{calls,invoke:createDiscordCandidateGateway({enabled,oauth,authority,allowedOrigin:ORIGIN,verifyAppCheck:async token=>token==='synthetic-app-check'})};}
const context={origin:ORIGIN,idToken:'synthetic-id-token',appCheckToken:'synthetic-app-check'};
test('candidate gateway is disabled unless explicitly enabled and verifies App Check/origin before authority',async()=>{
  const off=harness(false);assert.equal((await off.invoke('begin',input,context)).error.reason,'discord/gate_disabled');assert.deepEqual(off.calls,[]);
  for(const altered of[{...context,origin:'https://evil.example'},{...context,appCheckToken:'wrong'}]){const h=harness();assert.equal((await h.invoke('begin',input,altered)).ok,false);assert.deepEqual(h.calls,[]);}
});
test('exact request schemas prevent alternate-access injection and arbitrary backend routing',async()=>{
  const h=harness();assert.equal((await h.invoke('begin',{...input,alternateAccess:true},context)).error.reason,'discord/request_invalid');assert.deepEqual(h.calls,[]);
  assert.equal((await h.invoke('begin',input,context)).status,'begun');assert.deepEqual(h.calls[1],['begin',{uid:'synthetic-owner'}]);
});
test('unlink forwards only auth and optimistic method version to verified server authority',async()=>{
  const h=harness(),request={requestId:input.requestId,browserBinding:input.browserBinding,lifecycleId:input.lifecycleId,expectedProviderRevision:1};
  assert.equal((await h.invoke('unlink',request,context)).status,'unlinked');
  assert.deepEqual(h.calls[0],['unlink',['expectedProviderRevision','idToken','lifecycleId','requestId']]);
  assert.equal((await h.invoke('unlink',request,{...context,idToken:null})).error.reason,'discord/auth_required');
});

test('registration routes require exact allowlisted fields and retain verified request context',async()=>{
  const calls=[],oauth={begin(){},complete(){},confirmLink(){},confirmRegistration:async value=>{calls.push(value);return{ok:true,status:'account-created'};},cancelRegistration:async value=>{calls.push(value);return{ok:true,status:'canceled'};}};
  const invoke=createDiscordCandidateGateway({enabled:true,oauth,authority:{verify:async()=>({uid:'existing-owner'}),unlink(){}},verifyAppCheck:async()=>true,allowedOrigin:ORIGIN});
  const request={registrationToken:'r'.repeat(43),requestId:'registration-request',browserBinding:'b'.repeat(43),lifecycleId:'registration-lifecycle',requestedHandle:'TrainerNew',reviewAccepted:true};
  assert.equal((await invoke('register',{...request,uid:'injected-owner'},context)).error.reason,'discord/request_invalid');assert.equal(calls.length,0);
  assert.equal((await invoke('register',request,{...context,idToken:null})).status,'account-created');assert.equal(await calls[0].currentAuthority(),null);
  const {requestedHandle,reviewAccepted,...cancel}=request;
  assert.equal((await invoke('cancelRegistration',cancel,context)).status,'canceled');assert.equal((await calls[1].currentAuthority()).uid,'existing-owner');
});
