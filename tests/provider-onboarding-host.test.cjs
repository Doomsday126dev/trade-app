'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),acorn=require('acorn');
const source=fs.readFileSync('js/app/application.js','utf8'),ast=acorn.parse(source,{ecmaVersion:'latest'});
const names=['googleOnboardingSessionCurrent','requireGoogleOnboardingSession','beginGoogleOnboarding','checkGoogleOnboarding','cancelGoogleOnboarding','activateDiscordAccountCandidate','bindDiscordHostCandidate','createOwnerRecoveryConsumerCandidate','createOwnerRecoveryReviewCandidate','createOwnerRecoveryCollectorCandidate','restoreOwnerRecoveryProfileCandidate','restoreOwnerRecoveryHistoryCandidate','refreshOwnerRecoveryPreferencesCandidate'];
const code=names.map(name=>{const node=ast.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name===name);assert.ok(node,name);return source.slice(node.start,node.end);}).join('\n');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function fixture(){
 const calls=[],elements=new Map(),user={uid:'new-google-uid'},session={uid:user.uid,lifecycleId:'auth-1',closing:false};
 const ctx={window:{},auth:{currentUser:user},providerGoogleOnboardingSession:session,providerGoogleAccountResolution:null,providerDiscordResolutionPromise:null,
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

test('Discord host activation uses the verified account reader and original UID',async()=>{
 const h=fixture();h.ctx.window.__POGO_DISCORD_HOST_CANARY__=true;h.ctx.window.__POGO_DISCORD_HOST_CANARY_UID__=h.user.uid;h.ctx.window.__pogoProviderHostAuthGate.snapshot=()=>({authCoordinationBlocked:false});
 h.ctx.resolveGoogleAccountBinding=async(uid,{readFoundation})=>{const result=await readFoundation();return{status:'existing',uid,username:'TrainerNew',foundation:result.foundation,lifecycleId:'auth-1'};};
 const runtime={available:true,readAccount:async()=>{h.calls.push('verified-discord-read');return{foundation:{canonicalTrainerName:'TrainerNew',identityKind:'provider_only'}};}};
 const host=h.ctx.bindDiscordHostCandidate(runtime);assert.equal((await host.onRegistered()).status,'opened');assert.equal(h.calls[0],'verified-discord-read');assert.equal(h.calls[1][1].uid,h.user.uid);
});
test('Discord activation rejects a switched UID before opening any account',async()=>{
 const h=fixture(),wait=deferred();h.ctx.window.__POGO_DISCORD_HOST_CANARY__=true;h.ctx.window.__POGO_DISCORD_HOST_CANARY_UID__=h.user.uid;h.ctx.window.__pogoProviderHostAuthGate.snapshot=()=>({authCoordinationBlocked:false});
 h.ctx.resolveGoogleAccountBinding=async(uid,{readFoundation})=>{await readFoundation();return{status:'existing',uid};};
 const pending=h.ctx.activateDiscordAccountCandidate({available:true,readAccount:()=>wait.promise});h.ctx.auth.currentUser={uid:'other-owner'};wait.resolve({foundation:{canonicalTrainerName:'TrainerNew'}});
 await assert.rejects(pending,{code:'discord/session-changed'});assert.equal(h.calls.length,0);
});
test('host recovery and Discord factories are disabled without explicit candidate flags',async()=>{
 const h=fixture();assert.equal(h.ctx.createOwnerRecoveryConsumerCandidate().available,false);assert.equal(h.ctx.createOwnerRecoveryReviewCandidate().available,false);assert.equal(h.ctx.createOwnerRecoveryCollectorCandidate().available,false);assert.equal(h.ctx.bindDiscordHostCandidate({available:true}).available,false);
 await assert.rejects(h.ctx.activateDiscordAccountCandidate({available:true}),{code:'discord/host-disabled'});
});

function recoveryHostFixture(){
 const h=fixture(),uid=h.user.uid;h.ctx.window.__POGO_RECOVERY_OWNER_CANARY__=true;h.ctx.window.__POGO_RECOVERY_OWNER_CANARY_UID__=uid;h.ctx.cur='TrainerNew';h.ctx.accountSyncProjectionReady=()=>true;h.ctx.providerOnlyIdentityActive=()=>true;
 h.ctx.accountSyncModel={validateProfileRecord:()=>({ok:true}),profileValues:value=>value.values||value,normalizeProfileValues:value=>({ok:true,value})};
 h.ctx.managedAccountSyncRuntime={ownerUid:uid,providerProfile:{bio:'',friendCode:'',discord:'',avatarPokemon:'',revision:4},updateProviderProfile:async(patch,options)=>{h.calls.push(['profile-write',patch,options]);return{ok:true};}};
 h.ctx.window.PogoDev={accountRecoveryBundle:{createAccountRecoveryBundle:()=>({verify:async value=>value})}};return h;
}
test('host profile restore fills blank owned fields with the captured revision and preserves conflicting fields',async()=>{
 const h=recoveryHostFixture(),source={source:{ownerUid:h.user.uid},sections:{profile:{records:[{id:'canonical-profile',value:{values:{bio:'Recovered'}}}]}}};
 assert.equal((await h.ctx.restoreOwnerRecoveryProfileCandidate(source)).ok,true);assert.equal(h.calls[0][1].bio,'Recovered');assert.equal(h.calls[0][2].expectedRevision,4);
 h.calls.length=0;h.ctx.managedAccountSyncRuntime.providerProfile.bio='Owner changed this';assert.equal((await h.ctx.restoreOwnerRecoveryProfileCandidate(source)).status,'conflict-review');assert.equal(h.calls.length,0);
});
test('host profile and history restores reject a lifecycle switch during verification before writes',async()=>{
 const h=recoveryHostFixture(),wait=deferred();h.ctx.window.PogoDev.accountRecoveryBundle.createAccountRecoveryBundle=()=>({verify:()=>wait.promise});
 h.ctx.ensureTrainerHistoryStore=()=>({restoreOwnedHistoryArchive:()=>{throw Error('must not write');}});
 const profile=h.ctx.restoreOwnerRecoveryProfileCandidate({}),history=h.ctx.restoreOwnerRecoveryHistoryCandidate({});h.ctx.lifecycle='replacement';wait.resolve({source:{ownerUid:h.user.uid,trainerHandle:'TrainerNew'}});
 await assert.rejects(profile,{code:'recovery/session-changed'});await assert.rejects(history,{code:'recovery/session-changed'});assert.equal(h.calls.length,0);
});
test('delayed preference rendering cannot apply to a switched account or replace a newer language choice',async()=>{
 const h=recoveryHostFixture();let locale='ja';const wait=deferred();h.ctx.window.__pogoEnsureLocale=()=>wait.promise;h.ctx.i18nCore={readStoredLocale:()=>locale,detectBrowserLocale:()=> 'en',setLocale:value=>h.calls.push(['locale',value])};h.ctx.recoveredDisplayPreference=(_field,fallback)=>fallback;h.ctx.applyTheme=value=>h.calls.push(['theme',value]);h.ctx.lsGet=()=> 'light';h.ctx.renderInterimProductLabels=()=>{};
 const first=h.ctx.refreshOwnerRecoveryPreferencesCandidate();h.ctx.auth.currentUser={uid:'different-owner'};wait.resolve();await first;assert.equal(h.calls.length,0);
 h.ctx.auth.currentUser=h.user;const next=deferred();h.ctx.window.__pogoEnsureLocale=()=>next.promise;const second=h.ctx.refreshOwnerRecoveryPreferencesCandidate();locale='es';next.resolve();await second;assert.equal(h.calls.length,0);
});

test('host collector captures actual owner-local sources without credentials or another owner partition',async()=>{
 const h=recoveryHostFixture(),uid=h.user.uid,name='TrainerNew',history={version:3,owner:{uid,username:name},recent:[],snapshots:{},favorites:[],tags:{}},key=`pogoTrainerHistory_v1:${uid}`,map=new Map([[key,JSON.stringify(history)],[key+':before-canonical-v1',JSON.stringify(history)],[key+':recovery-v1:abc',JSON.stringify(history)],['pogoTrainerHistory_v1:other-owner:recovery-v1:def','must-not-read']]);
 Object.assign(h.ctx,{db:{},ref:()=>{},get:()=>{},onValue:()=>{},runTransaction:()=>{},serverTimestamp:()=>{},localStorage:{get length(){return map.size;},key:i=>[...map.keys()][i],getItem:key=>map.get(key)??null},POGO_SEARCH_LANGUAGE_KEY:'search-language',POGO_SEARCH_LANGUAGE_OVERRIDE_KEY:'search-override',OWNED_MY_LIST_TYPES:['wishlist','dynamax','gmax','costumes'],syncQueue:{},accountSyncClone:value=>JSON.parse(JSON.stringify(value)),accountSyncOrdersSnapshot:()=>({wishlist:{priorities:{}}}),lsGet:()=> 'dark',i18nCore:{readStoredLocale:()=> 'ja'},getLocal:()=>({users:{TrainerNew:{bio:'Local unsent bio',pin:'NEVER-EXPORT'},OtherOwner:{bio:'MUST-NOT-EXPORT'}},wishlist:{TrainerNew:{Pikachu:'H'},OtherOwner:{Secret:'L'}}}),ensureTrainerHistoryStore:()=>({key,retainedKey:key+':before-canonical-v1',read:()=>history}),accountSyncRepositoryData:{createAccountSyncRepository:input=>({ownerUid:input.ownerUid})},validCanonicalFoundation:()=>true});
 h.ctx.window.PogoDomain={accountSyncMerge:{validateEntity:()=>({ok:true})}};h.ctx.window.PogoDev.accountRecoveryCollector={createOwnerRecoveryReader:input=>input,createAccountRecoveryCollector:input=>input};h.ctx.window.PogoDev.accountRecoveryJournalSnapshot={createAccountRecoveryJournalSnapshot:input=>({ownerUid:input.ownerUid,readOnly:true})};
 const collector=h.ctx.createOwnerRecoveryCollectorCandidate({features:{providerPublicShares:false,syncedPreferences:false,shareVisibility:false},readProviderFoundation:async()=>({foundation:{canonicalTrainerName:name,identityKind:'provider_only',legacyAccessConfigured:false}})}),local=await collector.ownerReader.readLocal(),serialized=JSON.stringify(local);
 assert.equal(collector.repository.ownerUid,uid);assert.equal(collector.journal.readOnly,true);assert.equal(local.preferences.localProfileDraft.bio,'Local unsent bio');assert.equal(local.preferences.recoveredHistoryArchives.length,1);assert.equal(serialized.includes('NEVER-EXPORT'),false);assert.equal(serialized.includes('MUST-NOT-EXPORT'),false);assert.equal(serialized.includes('Secret'),false);assert.equal((await collector.ownerReader.readProviderFoundation()).uid,uid);
 h.ctx.lifecycle='changed';assert.equal(collector.getSession(),null);await assert.rejects(collector.ownerReader.readLocal(),{code:'recovery/session-changed'});
});
