const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),acorn=require('acorn');
const source=fs.readFileSync('js/app/application.js','utf8');
const ast=acorn.parse(source,{ecmaVersion:'latest'});
function extract(name){const node=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(node,name);return source.slice(node.start,node.end);}
function fixture({canonical={status:'missing'},records={},onRead=()=>{}}={}){
  const reads=[],user={uid:'same-uid'},lifecycle={uid:user.uid,lifecycleId:'auth-1'};
  const data={'authIndex/same-uid':{username:'Trainer',accountSyncRecoveryReviews:{reviewed:true}},'users/Trainer':{authUid:user.uid,pin:'stale-verifier',intentDeclarations:[{kind:'want'}]},...records};
  const context=vm.createContext({auth:{currentUser:user},providerAuthSnapshot:()=>({...lifecycle}),
    accountLinkingModelDomain:{failure:code=>Object.assign(new Error(code),{code})},
    ensureFirebaseDataProtection:async()=>{},ensureProviderAccountFoundationClient:()=>({read:async()=>{if(canonical instanceof Error)throw canonical;return canonical;}}),
    providerOnboardingModelDomain:{HANDLE_PATTERN:/^[^.#$\/[\]\x00-\x1f]{2,64}$/},
    db:{},ref:(_db,path)=>path,withTimeout:p=>p,get:async path=>{reads.push(path);await onRead(path,lifecycle);return{exists:()=>data[path]!=null,val:()=>data[path]};}});
  for(const name of ['validCanonicalFoundation','resolveGoogleAccountBinding'])vm.runInContext(extract(name),context);
  return{context,reads,lifecycle};
}
test('exact reciprocal legacy Google login works without migrating or fabricating a foundation',async()=>{
  const f=fixture(),result=await f.context.resolveGoogleAccountBinding('same-uid');
  assert.equal(result.status,'existing');assert.equal(result.uid,'same-uid');assert.equal(result.username,'Trainer');
  assert.equal(result.foundation,null);assert.equal(result.indexRecord.accountSyncRecoveryReviews.reviewed,true);
});
test('canonical failure and reciprocal conflicts never fall through to onboarding',async()=>{
  for(const options of [{canonical:new Error('authority unavailable')},{records:{'users/Trainer':{authUid:'other'}}},{records:{'authIndex/same-uid':{username:'../bad'}}},{records:{'users/Trainer':{authUid:'same-uid',identityFrozen:true}}}]){
    const f=fixture(options);await assert.rejects(f.context.resolveGoogleAccountBinding('same-uid'));
  }
});
test('sign-out and same-UID return while resolving cannot reuse an earlier lifecycle',async()=>{
  const f=fixture({onRead:(path,state)=>{if(path.startsWith('users/'))state.lifecycleId='auth-3';}});
  await assert.rejects(f.context.resolveGoogleAccountBinding('same-uid'),{code:'provider-link/auth-lifecycle-changed'});
});
test('genuinely unmapped Google identity remains distinct from existing login',async()=>{
  const f=fixture({records:{'authIndex/same-uid':null}});
  assert.equal((await f.context.resolveGoogleAccountBinding('same-uid')).status,'unlinked');
});
test('reset PIN reconnect validates Firebase instead of rejecting the new PIN against an old verifier',async()=>{
  let calls=0;
  const context=vm.createContext({cur:'Trainer',allData:{users:{Trainer:{authUid:'same-uid',pin:'old-hash'}}},
    prompt:()=> '654321',isSixDigitPin:()=>true,verifyPin:async()=>false,
    ensureFirebaseIdentity:async()=>{calls++;return{uid:'same-uid'};},toast:()=>{},i18nCore:{t:k=>k},console});
  vm.runInContext(extract('reconnectAuth'),context);await context.reconnectAuth();assert.equal(calls,1);
});
test('stale legacy verifier alone does not advertise a usable PIN after password unlink',()=>{
  const context=vm.createContext({cur:'Trainer',allData:{users:{Trainer:{authUid:'same-uid',pin:'old-hash'}}},auth:{currentUser:{uid:'same-uid',providerData:[{providerId:'google.com'}]}}});
  vm.runInContext(extract('usernamePinAccessUsable'),context);assert.equal(context.usernamePinAccessUsable(),false);
  context.auth.currentUser.providerData.push({providerId:'password'});assert.equal(context.usernamePinAccessUsable(),true);
});
function foundation(kind='legacy_migrated'){
  return {schemaVersion:1,canonicalTrainerName:'Trainer',normalizedTrainerName:'trainer',handleKey:'v1_747261696e6572',
    identityKind:kind,legacyAccessConfigured:kind==='legacy_migrated',legacyUsername:kind==='legacy_migrated'?'Trainer':null,status:'active',revision:1};
}
test('migrated and provider-only returning accounts retain their distinct identity and read paths',async()=>{
  for(const kind of ['legacy_migrated','provider_only']){
    const f=fixture({canonical:{status:'ready',foundation:foundation(kind)}}),result=await f.context.resolveGoogleAccountBinding('same-uid');
    assert.equal(result.foundation.identityKind,kind);assert.equal(result.status,'existing');
    assert.equal(f.reads.length,kind==='provider_only'?0:2);
  }
});
test('existing legacy activation preserves profile and recovery mapping without creating canonical identity',async()=>{
  const f=fixture(),resolution=await f.context.resolveGoogleAccountBinding('same-uid');
  const local={users:{Trainer:{wants:'preserved'}},authIndex:{}},calls=[];
  Object.assign(f.context,{activateOwnedSession:(uid,name)=>calls.push(['session',uid,name]),stampSession:()=>{},getLocal:()=>local,
    normalizedUserRecord:(_name,old,value)=>({...old,...value}),saveLocal:()=>{},runtimeDataWithSelectedTrainer:value=>value,
    ensureProtectedSubscriptions:()=>{},ensureAccountSyncRuntime:async()=>({ok:true}),showApp:()=>calls.push(['opened'])});
  vm.runInContext(extract('activateGoogleResolvedAccount'),f.context);
  const opened=await f.context.activateGoogleResolvedAccount(resolution);
  assert.equal(opened.uid,'same-uid');assert.equal(f.context.activeCanonicalIdentity,null);
  assert.equal(local.users.Trainer.wants,'preserved');assert.equal(local.authIndex['same-uid'].accountSyncRecoveryReviews.reviewed,true);
  assert.deepEqual(calls,[['session','same-uid','Trainer'],['opened']]);
});
test('provider boundary includes current wants declarations, Groups, recovery and exact trainer ownership',async()=>{
  const profile={intentDeclarations:[{id:'special',requirements:{lucky:true}}],specialTradeBoard:{lf:[{name:'Mewtwo'}]},friendCode:'0000 1111 2222'};
  const context=vm.createContext({cur:'Trainer',auth:{currentUser:{uid:'same-uid'}},allData:{users:{Trainer:profile},wishlist:{Trainer:{Pikachu:{priority:'H'}}}},
    managedSessionCache:{snapshot:()=>({activeOwner:{uid:'same-uid',username:'Trainer'}})},
    managedAccountSyncRuntime:{ownerUid:'same-uid',listRecoveryCandidates:async()=>[{resolved:true,id:'reviewed'}]},
    trainerHistoryStore:{read:()=>({favorites:[{name:'Friend',tagIds:['g1']}],tags:{g1:{label:'Group'}}})},
    managedListenerLifecycle:{snapshot:()=>({session:'same-session'})},OWNED_MY_LIST_TYPES:['wishlist'],accountSyncCanonicalEntities:[{id:'canonical'}],
    accountSyncRuntimeGeneration:7,accountSyncMigrationState:'complete',accountSyncUiState:{listenerHealthy:true,controllerHealthy:true},
    accountSyncModel:{canonicalJson:JSON.stringify},activePublicShareHydrationToken:{username:'Trainer'},providerBoundaryFingerprint:async value=>JSON.stringify(value)});
  vm.runInContext(extract('providerAccountBoundarySnapshot'),context);
  const before=await context.providerAccountBoundarySnapshot('same-uid');
  assert.match(before.accountDataFingerprint,/Group/);assert.equal(before.reviewedEvidenceCount,1);assert.equal(before.activeEvidenceCount,0);
  profile.intentDeclarations[0].requirements.lucky=false;
  const after=await context.providerAccountBoundarySnapshot('same-uid');assert.notEqual(after.accountDataFingerprint,before.accountDataFingerprint);
});
test('restoring a persisted Auth user does not fabricate recent authentication',()=>{
  const context=vm.createContext({providerAuthLifecycleUid:'',providerAuthLifecycleGeneration:0,providerAuthRecentAt:0});
  vm.runInContext(extract('noteProviderAuthState'),context);context.noteProviderAuthState({uid:'same-uid'});
  assert.equal(context.providerAuthRecentAt,0);
});
test('failed signed-out account resolution releases only the Google session owned by that attempt',async()=>{
  for(const changed of [false,true]){
    let signouts=0;
    const context=vm.createContext({auth:{currentUser:{uid:'same-uid'}},GoogleAuthProvider:null,linkWithPopup:null,signInWithPopup:null,
      reauthenticateWithPopup:null,unlink:null,getAdditionalUserInfo:null,noteProviderReauthentication:()=>{},
      googleAuthAdapterService:{createGoogleAuthAdapter:()=>({signInProvider:async()=>({uid:'same-uid'})})},
      providerAuthSnapshot:()=>({uid:'same-uid',lifecycleId:context.life}),life:'auth-1',
      resolveGoogleAccountBinding:async()=>{if(changed)context.life='auth-3';throw new Error('resolution unavailable');},firebaseSignOut:async()=>{signouts++;}});
    vm.runInContext(extract('createGoogleProviderAdapter'),context);
    await assert.rejects(context.createGoogleProviderAdapter().signInProvider({providerKey:'google'}));
    assert.equal(signouts,changed?0:1);
  }
});
