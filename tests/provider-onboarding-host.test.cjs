'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),acorn=require('acorn');
const source=fs.readFileSync('js/app/application.js','utf8'),ast=acorn.parse(source,{ecmaVersion:'latest'});
const names=['googleOnboardingSessionCurrent','requireGoogleOnboardingSession','beginGoogleOnboarding','checkGoogleOnboarding','cancelGoogleOnboarding'];
const code=names.map(name=>{const node=ast.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name===name);assert.ok(node,name);return source.slice(node.start,node.end);}).join('\n');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function fixture(){
 const calls=[],elements=new Map(),user={uid:'new-google-uid'},session={uid:user.uid,lifecycleId:'auth-1',closing:false};
 const ctx={window:{},auth:{currentUser:user},providerGoogleOnboardingSession:session,providerGoogleAccountResolution:null,
  PROVIDER_CAPABILITIES:{providerAccountCreation:true},providerAuthSnapshot:()=>ctx.auth.currentUser?{uid:ctx.auth.currentUser.uid,lifecycleId:ctx.lifecycle}:null,lifecycle:'auth-1',
  document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{value:id.includes('handle')?'TrainerNew':'',textContent:''});return elements.get(id);}},
  providerFailure:(code,state)=>Object.assign(new Error(code),{code,state}),providerUiMessage:code=>code,
  ensureProviderAccountFoundationClient:()=>({pending:()=>false,pendingForCurrentOwner:async()=>null}),syncGoogleOnboardingUi:()=>calls.push('sync'),hideGoogleOnboarding:()=>calls.push('hide'),showGoogleOnboarding:()=>calls.push('show'),showLogin:()=>calls.push('login'),
  activateGoogleResolvedAccount:async result=>{calls.push(['activate',result]);return{status:'opened'};},
  firebaseSignOut:async()=>{calls.push('signOut');ctx.auth.currentUser=null;},
  providerOnboardingController:{snapshot:()=>({status:'ready-to-create'}),confirmProfile:()=>calls.push('profile'),cancel:()=>calls.push('cancel'),begin:async()=>({status:'checking-account'}),resolveAccount:()=>calls.push('resolve')}
 };
 ctx.window.__pogoProviderHostAuthGate={available:true,prepareSignOut:async()=>calls.push('prepare')};
 vm.createContext(ctx);vm.runInContext(code,ctx);return{ctx,calls,elements,session,user};
}
test('host cancellation cannot sign out a switched account',async()=>{
 const h=fixture(),wait=deferred();h.ctx.window.__pogoProviderHostAuthGate.prepareSignOut=()=>wait.promise;
 const cancel=h.ctx.cancelGoogleOnboarding();h.ctx.auth.currentUser={uid:'another-owner'};h.ctx.lifecycle='auth-2';wait.resolve();
 assert.equal((await cancel).status,'stale');assert.equal(h.ctx.auth.currentUser.uid,'another-owner');assert.deepEqual(h.calls,[]);
});
test('blocked preparation preserves onboarding and signed-in identity',async()=>{
 const h=fixture();h.ctx.window.__pogoProviderHostAuthGate.prepareSignOut=async()=>{throw Object.assign(new Error(),{code:'provider-auth/coordination-blocked'});};
 assert.equal((await h.ctx.cancelGoogleOnboarding()).status,'blocked');assert.equal(h.ctx.auth.currentUser,h.user);assert.deepEqual(h.calls,[]);
 assert.equal(h.elements.get('google-onboarding-status').textContent,'provider-auth/coordination-blocked');
});
test('missing gate cannot pretend cancel safely signed out',async()=>{
 const h=fixture();h.ctx.window.__pogoProviderHostAuthGate=null;
 assert.equal((await h.ctx.cancelGoogleOnboarding()).code,'provider-auth/gate-required');assert.equal(h.ctx.auth.currentUser,h.user);assert.deepEqual(h.calls,[]);
});
test('successful cancellation waits for actual sign-out before UI cleanup',async()=>{
 const h=fixture(),wait=deferred();h.ctx.firebaseSignOut=async()=>{h.calls.push('signOut');await wait.promise;h.ctx.auth.currentUser=null;};
 const cancel=h.ctx.cancelGoogleOnboarding();await new Promise(setImmediate);assert.deepEqual(h.calls,['prepare','signOut']);wait.resolve();
 assert.equal((await cancel).status,'canceled');assert.deepEqual(h.calls,['prepare','signOut','cancel','hide','login']);
});
test('failed sign-out leaves the UI and current identity intact',async()=>{
 const h=fixture();h.ctx.firebaseSignOut=async()=>{throw Error('offline');};
 assert.equal((await h.ctx.cancelGoogleOnboarding()).status,'blocked');assert.equal(h.ctx.auth.currentUser,h.user);assert.deepEqual(h.calls,['prepare']);
});
test('late creation cannot activate a switched UID or alter its status',async()=>{
 const h=fixture(),wait=deferred();h.ctx.providerOnboardingController.create=()=>wait.promise;
 const pending=h.ctx.checkGoogleOnboarding();h.ctx.auth.currentUser={uid:'another-owner'};h.ctx.lifecycle='auth-2';
 wait.resolve({status:'account-ready',foundation:{canonicalTrainerName:'TrainerNew'}});await pending;
 assert.deepEqual(h.calls,['profile']);assert.equal(h.ctx.providerGoogleAccountResolution,null);
});
test('late startup cannot reopen a canceled/replaced onboarding screen',async()=>{
 const h=fixture(),wait=deferred();h.ctx.providerOnboardingController.begin=()=>wait.promise;
 const start=h.ctx.beginGoogleOnboarding();h.ctx.providerGoogleOnboardingSession=null;wait.resolve({status:'checking-account'});
 await assert.rejects(start,{code:'provider-onboarding/auth-lifecycle-changed'});assert.deepEqual(h.calls,[]);
});
test('verified completion binds the original UID and lifecycle before activation',async()=>{
 const h=fixture();h.ctx.providerOnboardingController.create=async()=>({status:'account-ready',foundation:{canonicalTrainerName:'TrainerNew'}});
 assert.equal((await h.ctx.checkGoogleOnboarding()).status,'opened');const result=h.calls.find(v=>Array.isArray(v))[1];
 assert.equal(result.uid,h.user.uid);assert.equal(result.lifecycleId,'auth-1');assert.equal(h.ctx.providerGoogleOnboardingSession,null);
});
