const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {createHash,webcrypto}=require('node:crypto');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const domainFiles=[
  'js/domain/authProviderRegistry.js',
  'js/domain/providerContinuationState.js',
  'js/domain/accountLinkingModel.js',
  'js/domain/accountLinkingController.js'
];

class MemoryStorage{
  constructor(entries=[]){this.values=new Map(entries);}
  getItem(key){return this.values.has(key)?this.values.get(key):null;}
  setItem(key,value){this.values.set(String(key),String(value));}
  removeItem(key){this.values.delete(String(key));}
  entries(){return[...this.values.entries()];}
}

function loadDomains(){
  const window={crypto:webcrypto};window.window=window;
  const context=vm.createContext({window,TextEncoder,Uint8Array,console});
  for(const file of domainFiles)vm.runInContext(readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  return window.PogoDomain;
}

function clone(value){return JSON.parse(JSON.stringify(value));}
function digest(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function codedError(code){const error=new Error(code);error.code=code;return error;}
async function waitFor(check){for(let attempt=0;attempt<20;attempt++){if(check())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail('Timed out waiting for deterministic test state');}

function accountFixture(uid,handle){
  return{
    uid,
    myList:{wishlist:{Pikachu:{priority:'H',lucky:true}},dynamax:{Wooloo:{priority:'M'}},gmax:{},costumes:{'Pikachu (World Cap)':{priority:'L'}}},
    favorites:{Mazer:{displayName:'Mazer',tagIds:{nyc:true}}},
    tags:{nyc:{label:'NYC'},friends:{label:'Friends'}},
    specialTradeBoard:{lf:[{name:'Armored Mewtwo',background:'nyc'}],ft:[{name:'Clone Pikachu',gender:'female'}]},
    journal:{ownerUid:uid,generation:7,pending:[],blocked:[]},
    migration:{generation:'migration-84',recoveryEvidence:Array.from({length:66},(_,index)=>({candidateId:`reviewed-${index+1}`,resolved:true})),reviewedEvidenceCount:66,activeEvidenceCount:0,completed:true},
    listener:{ownerUid:uid,generation:11,healthy:true},
    publicShare:{shareId:handle,username:handle,friendCode:'0000 1111 2222'},
    trainer:{handle,displayName:handle,avatar:'Mewtwo'}
  };
}

function boundaryFor(account){
  return{
    accountDataFingerprint:digest({myList:account.myList,favorites:account.favorites,tags:account.tags,board:account.specialTradeBoard}),
    journalOwner:account.journal.ownerUid,
    journalGeneration:account.journal.generation,
    migrationGeneration:account.migration.generation,
    recoveryEvidenceFingerprint:digest(account.migration.recoveryEvidence),
    reviewedEvidenceCount:account.migration.reviewedEvidenceCount,
    activeEvidenceCount:account.migration.activeEvidenceCount,
    listenerAuthority:`${account.listener.ownerUid}:${account.listener.generation}:${account.listener.healthy}`,
    publicIdentityFingerprint:digest(account.publicShare),
    trainerIdentityFingerprint:digest(account.trainer)
  };
}

function createAuth(session){
  return{
    value:session,
    snapshot(){return this.value;},
    replace(value){this.value=value;},
    update(patch){this.value={...this.value,...patch};}
  };
}

function createHarness(options={}){
  const domains=loadDomains();
  let now=1_800_000_000_000;
  const storage=options.storage||new MemoryStorage();
  const continuation=domains.providerContinuationState.createProviderContinuationState({storage,crypto:webcrypto,clock:()=>now,ttlMs:60_000});
  const registry=domains.authProviderRegistry.createAuthProviderRegistry({developmentEnabled:true,configuredProviders:['google','discord']});
  const auth=createAuth(options.signedOut?null:{uid:'uid-a',lifecycleId:'life-a',authTime:now-1_000,providerData:[{providerId:'password'}]});
  const accounts=new Map([
    ['uid-a',accountFixture('uid-a','TrainerA')],
    ['uid-b',accountFixture('uid-b','TrainerB')]
  ]);
  const providerOwners=new Map(options.providerOwners||[]);
  const behavior={};
  const calls=[];
  const providerId=providerKey=>providerKey==='google'?'google.com':'discord.com';
  async function link(providerKey){
    calls.push(`link:${providerKey}`);
    if(behavior.linkDeferred)await behavior.linkDeferred.promise;
    if(behavior.linkError)throw codedError(behavior.linkError);
    const session=auth.snapshot();if(!session?.uid)throw codedError('provider-link/auth-required');
    const owner=providerOwners.get(providerKey);
    if(owner&&owner!==session.uid)throw codedError('auth/credential-already-in-use');
    if(behavior.switchSession)auth.replace(clone(behavior.switchSession));
    else if(!session.providerData.some(item=>item.providerId===providerId(providerKey))){
      session.providerData=[...session.providerData,{providerId:providerId(providerKey),displayName:'Provider Name',email:'provider@example.test'}];
      providerOwners.set(providerKey,session.uid);
    }
    return{uid:behavior.resultUid||auth.snapshot()?.uid||session.uid,status:owner===session.uid?'already-linked':'linked'};
  }
  function signInResult(){
    const result=behavior.signInResult||{status:'existing',uid:'uid-a'};
    if(result.status==='existing'&&behavior.settleSignInAuth!==false){
      const uid=behavior.signInAuthUid||result.uid;
      auth.replace({uid,lifecycleId:`provider-sign-in-${uid}`,authTime:now,providerData:[{providerId:providerId('google')}]});
    }
    return result;
  }
  const adapter={
    linkCurrentUser:({providerKey})=>link(providerKey),
    beginRedirectLink:async({providerKey,nonce})=>{calls.push(`begin-link:${providerKey}:${nonce}`);if(behavior.beginError)throw codedError(behavior.beginError);},
    completeRedirectLink:({providerKey})=>link(providerKey),
    reauthenticateCurrentUser:async({methodKey})=>{calls.push(`reauth:${methodKey}`);if(behavior.reauthError)throw codedError(behavior.reauthError);auth.update({authTime:now});return{uid:auth.snapshot().uid};},
    unlinkCurrentUser:async({providerKey})=>{calls.push(`unlink:${providerKey}`);if(behavior.unlinkError)throw codedError(behavior.unlinkError);const session=auth.snapshot();session.providerData=session.providerData.filter(item=>item.providerId!==providerId(providerKey));providerOwners.delete(providerKey);return{uid:session.uid};},
    beginRedirectSignIn:async({providerKey,nonce})=>{calls.push(`begin-sign-in:${providerKey}:${nonce}`);},
    completeRedirectSignIn:async({providerKey})=>{calls.push(`complete-sign-in:${providerKey}`);return signInResult();},
    signInProvider:async({providerKey})=>{calls.push(`sign-in:${providerKey}`);return signInResult();}
  };
  const accountBoundary={snapshot:async uid=>boundaryFor(accounts.get(uid))};
  const lease=options.lease||domains.accountLinkingController.createSharedOperationLease();
  const controller=domains.accountLinkingController.createAccountLinkingController({registry,continuation,authSession:auth,providerAdapter:adapter,accountBoundary,lease,clock:()=>now});
  return{domains,storage,continuation,registry,auth,accounts,providerOwners,behavior,calls,adapter,accountBoundary,lease,controller,get now(){return now;},advance(ms){now+=ms;}};
}

async function expectCode(promise,expected){
  await assert.rejects(promise,error=>{assert.equal(error.code,expected);return true;});
}

async function prepareAndComplete(controller,providerKey='google'){
  await controller.prepareLinkPopup(providerKey);
  return controller.completeLinkPopup(providerKey);
}

test('production registry exposes only the connected username and PIN method',()=>{
  const {authProviderRegistry}=loadDomains();
  const registry=authProviderRegistry.createAuthProviderRegistry();
  const methods=registry.methods({providerData:[{providerId:'password'}]});
  assert.deepEqual(clone(methods.map(item=>[item.key,item.visible,item.state,item.actionable])),[
    ['username-pin',true,'connected',false],['google',false,'unavailable',false],['discord',false,'unavailable',false]
  ]);
});

test('configured development providers are actionable while production remains inert',()=>{
  const {authProviderRegistry}=loadDomains();
  const registry=authProviderRegistry.createAuthProviderRegistry({developmentEnabled:true,configuredProviders:['google','discord']});
  assert.deepEqual(clone(registry.methods().slice(1).map(item=>[item.visible,item.available,item.actionable,item.state])),[[true,true,true,'not-connected'],[true,true,true,'not-connected']]);
});

test('username and PIN user links a provider without changing Firebase UID',async()=>{
  const h=createHarness();const uid=h.auth.snapshot().uid;
  const result=await prepareAndComplete(h.controller);
  assert.equal(result.status,'connected');assert.equal(h.auth.snapshot().uid,uid);
});

test('linked provider appears through Firebase providerData',async()=>{
  const h=createHarness();await prepareAndComplete(h.controller);
  const google=h.registry.methods({providerData:h.auth.snapshot().providerData}).find(item=>item.key==='google');
  assert.equal(google.linked,true);assert.equal(google.state,'connected');
});

for(const [label,selector]of[
  ['My List',account=>account.myList],
  ['Favorites and tags',account=>({favorites:account.favorites,tags:account.tags})],
  ['Special Trade Board',account=>account.specialTradeBoard],
  ['public share identity',account=>account.publicShare],
  ['trainer identity',account=>account.trainer]
])test(`${label} remains byte-for-byte unchanged after same-UID linking`,async()=>{
  const h=createHarness(),before=clone(selector(h.accounts.get('uid-a')));
  await prepareAndComplete(h.controller);
  assert.deepEqual(selector(h.accounts.get('uid-a')),before);
});

test('linking an already-linked provider is idempotent',async()=>{
  const h=createHarness({providerOwners:[['google','uid-a']]});
  h.auth.snapshot().providerData.push({providerId:'google.com'});
  const before=h.auth.snapshot().providerData.length,result=await prepareAndComplete(h.controller);
  assert.equal(result.status,'connected');assert.equal(h.auth.snapshot().providerData.length,before);
});

test('provider credential collision preserves UID A, UID B, and both datasets',async()=>{
  const h=createHarness({providerOwners:[['google','uid-b']]}),a=clone(h.accounts.get('uid-a')),b=clone(h.accounts.get('uid-b'));
  await h.controller.prepareLinkPopup('google');
  await expectCode(h.controller.completeLinkPopup('google'),'provider-link/collision');
  assert.equal(h.auth.snapshot().uid,'uid-a');assert.deepEqual(h.accounts.get('uid-a'),a);assert.deepEqual(h.accounts.get('uid-b'),b);assert.equal(h.providerOwners.get('google'),'uid-b');
});

test('popup cancellation is explicit and retryable',async()=>{
  const h=createHarness();h.behavior.linkError='auth/popup-closed-by-user';
  await h.controller.prepareLinkPopup('google');
  await expectCode(h.controller.completeLinkPopup('google'),'provider-link/canceled');
  assert.equal(h.controller.snapshot().status,'canceled');assert.equal(h.controller.snapshot().retryable,true);
});

test('popup blocking is explicit and retryable',async()=>{
  const h=createHarness();h.behavior.linkError='auth/popup-blocked';
  await h.controller.prepareLinkPopup('google');
  await expectCode(h.controller.completeLinkPopup('google'),'provider-link/popup-blocked');
  assert.equal(h.controller.snapshot().status,'blocked');assert.equal(h.controller.snapshot().retryable,true);
});

test('prepared linking invokes the popup adapter synchronously on the second click',async()=>{
  const h=createHarness();h.behavior.linkDeferred=deferred();
  await h.controller.prepareLinkPopup('google');
  assert.equal(h.calls.includes('link:google'),false);
  const pending=h.controller.completeLinkPopup('google');
  assert.equal(h.calls.includes('link:google'),true);
  h.behavior.linkDeferred.resolve();await pending;
});

test('popup retry reuses a still-current prepared context',async()=>{
  const h=createHarness();h.behavior.linkError='auth/popup-blocked';
  await h.controller.prepareLinkPopup('google');
  await expectCode(h.controller.completeLinkPopup('google'),'provider-link/popup-blocked');
  h.behavior.linkError='';
  assert.equal((await h.controller.retry()).status,'connected');
  assert.equal(h.calls.filter(item=>item==='link:google').length,2);
});

test('expired preparation fails before the popup adapter is invoked',async()=>{
  const h=createHarness();await h.controller.prepareLinkPopup('google');h.advance(2*60_000+1);
  await expectCode(h.controller.completeLinkPopup('google'),'provider-link/preparation-expired');
  assert.equal(h.calls.includes('link:google'),false);
});

test('changed Auth lifecycle invalidates preparation before the popup opens',async()=>{
  const h=createHarness();await h.controller.prepareLinkPopup('google');h.auth.update({lifecycleId:'life-a-replaced'});
  await expectCode(h.controller.completeLinkPopup('google'),'provider-link/auth-lifecycle-changed');
  assert.equal(h.calls.includes('link:google'),false);
});

test('redirect continuation links successfully in the same storage owner',async()=>{
  const h=createHarness(),waiting=await h.controller.beginRedirect('google');
  const result=await h.controller.resumeRedirect({providerKey:'google',nonce:waiting.nonce});
  assert.equal(result.status,'connected');assert.equal(h.auth.snapshot().uid,'uid-a');
});

test('redirect continuation rejects a different Firebase UID',async()=>{
  const h=createHarness(),waiting=await h.controller.beginRedirect('google');
  h.auth.replace({uid:'uid-b',lifecycleId:'life-b',authTime:h.now,providerData:[{providerId:'password'}]});
  await expectCode(h.controller.resumeRedirect({providerKey:'google',nonce:waiting.nonce}),'provider-continuation/owner-mismatch');
});

test('expired redirect continuation fails closed',async()=>{
  const h=createHarness(),waiting=await h.controller.beginRedirect('google');h.advance(60_000);
  await expectCode(h.controller.resumeRedirect({providerKey:'google',nonce:waiting.nonce}),'provider-continuation/expired');
});

test('consumed redirect continuation cannot be replayed',async()=>{
  const h=createHarness(),waiting=await h.controller.beginRedirect('google');await h.controller.resumeRedirect({providerKey:'google',nonce:waiting.nonce});
  await expectCode(h.controller.resumeRedirect({providerKey:'google',nonce:waiting.nonce}),'provider-continuation/replayed');
});

test('sign-out while a link is in flight invalidates the operation',async()=>{
  const h=createHarness();h.behavior.linkDeferred=deferred();await h.controller.prepareLinkPopup('google');const pending=h.controller.completeLinkPopup('google');await waitFor(()=>h.calls.includes('link:google'));
  h.auth.replace(null);h.behavior.linkDeferred.resolve();
  await expectCode(pending,'provider-link/auth-lifecycle-changed');
});

test('same UID with a replaced Auth lifecycle invalidates the operation',async()=>{
  const h=createHarness();h.behavior.linkDeferred=deferred();await h.controller.prepareLinkPopup('google');const pending=h.controller.completeLinkPopup('google');await waitFor(()=>h.calls.includes('link:google'));
  h.auth.update({lifecycleId:'life-a-replaced'});h.behavior.linkDeferred.resolve();
  await expectCode(pending,'provider-link/auth-lifecycle-changed');
});

test('two contexts share a lease and only one link operation reaches the adapter',async()=>{
  const h=createHarness();h.behavior.linkDeferred=deferred();
  const second=h.domains.accountLinkingController.createAccountLinkingController({registry:h.registry,continuation:h.continuation,authSession:h.auth,providerAdapter:h.adapter,accountBoundary:h.accountBoundary,lease:h.lease,clock:()=>h.now});
  await h.controller.prepareLinkPopup('google');await second.prepareLinkPopup('google');
  const firstPending=h.controller.completeLinkPopup('google');await waitFor(()=>h.calls.includes('link:google'));
  await expectCode(second.completeLinkPopup('google'),'provider-link/operation-in-progress');
  h.behavior.linkDeferred.resolve();await firstPending;
  assert.equal(h.calls.filter(item=>item==='link:google').length,1);
});

test('unlink succeeds when username and PIN remains usable',async()=>{
  const h=createHarness({providerOwners:[['google','uid-a']]});h.auth.snapshot().providerData.push({providerId:'google.com'});
  const result=await h.controller.unlink('google',{usernamePinAvailable:true});
  assert.equal(result.status,'disconnected');assert.equal(h.auth.snapshot().providerData.some(item=>item.providerId==='google.com'),false);assert.equal(h.auth.snapshot().uid,'uid-a');
});

test('unlink rejects removal of the final usable method',async()=>{
  const h=createHarness({providerOwners:[['google','uid-a']]});h.auth.snapshot().providerData=[{providerId:'google.com'}];
  await expectCode(h.controller.unlink('google',{usernamePinAvailable:false}),'provider-link/last-usable-method');
  assert.equal(h.auth.snapshot().providerData[0].providerId,'google.com');
});

test('unlink requires recent authentication',async()=>{
  const h=createHarness({providerOwners:[['google','uid-a']]});h.auth.snapshot().providerData.push({providerId:'google.com'});h.auth.update({authTime:h.now-11*60_000});
  await expectCode(h.controller.unlink('google',{usernamePinAvailable:true}),'provider-link/recent-auth-required');
  assert.equal(h.controller.snapshot().status,'reauthenticate');
});

test('username and PIN can satisfy provider-neutral reauthentication',async()=>{
  const h=createHarness();h.auth.update({authTime:h.now-11*60_000});
  const result=await h.controller.reauthenticate('username-pin');
  assert.equal(result.status,'connected');assert.equal(h.auth.snapshot().authTime,h.now);assert.deepEqual(h.calls,['reauth:username-pin']);
});

test('installed macOS web-app redirect resumes from same session storage only',async()=>{
  const h=createHarness(),ownerBefore=h.continuation.storageOwner(),waiting=await h.controller.beginRedirect('google',{returnRoute:'#settings/security'});
  assert.equal(h.continuation.storageOwner(),ownerBefore);assert.equal(h.continuation.inspect().returnRoute,'#settings/security');
  assert.equal((await h.controller.resumeRedirect({providerKey:'google',nonce:waiting.nonce})).status,'connected');
});

test('separate storage context cannot consume another context continuation',async()=>{
  const h=createHarness(),waiting=await h.controller.beginRedirect('google');
  const copied=new MemoryStorage(h.storage.entries().filter(([key])=>key===h.domains.providerContinuationState.ACTIVE_KEY));
  const foreign=h.domains.providerContinuationState.createProviderContinuationState({storage:copied,crypto:webcrypto,clock:()=>h.now});
  const owner=await foreign.ownerBinding('uid-a'),life=await foreign.lifecycleBinding('uid-a\0life-a');
  assert.throws(()=>foreign.consume({nonce:waiting.nonce,operation:'link',providerKey:'google',ownerBinding:owner,lifecycleBinding:life}),error=>error.code==='provider-continuation/storage-owner-mismatch');
});

test('same-UID link preserves healthy listener authority',async()=>{
  const h=createHarness(),before=clone(h.accounts.get('uid-a').listener);await prepareAndComplete(h.controller);
  assert.deepEqual(h.accounts.get('uid-a').listener,before);
});

test('same-UID link does not rerun migration or change journal ownership and generation',async()=>{
  const h=createHarness(),before=clone({migration:h.accounts.get('uid-a').migration,journal:h.accounts.get('uid-a').journal});await prepareAndComplete(h.controller);
  assert.deepEqual({migration:h.accounts.get('uid-a').migration,journal:h.accounts.get('uid-a').journal},before);
});

test('.84 reviewed stale evidence remains reviewed and inactive',async()=>{
  const h=createHarness();await prepareAndComplete(h.controller);
  assert.equal(h.accounts.get('uid-a').migration.reviewedEvidenceCount,66);assert.equal(h.accounts.get('uid-a').migration.activeEvidenceCount,0);
});

test('continuation persistence contains no UID, PIN, OAuth token, or provider profile',async()=>{
  const h=createHarness(),uid='uid-a',pin='731942',token='oauth-secret-token';
  const owner=await h.continuation.ownerBinding(uid),life=await h.continuation.lifecycleBinding(`${uid}\0life-a`);
  h.continuation.issue({operation:'link',providerKey:'google',ownerBinding:owner,lifecycleBinding:life});
  const persisted=JSON.stringify(h.storage.entries());
  for(const secret of[uid,pin,token,'provider@example.test','Provider Name'])assert.equal(persisted.includes(secret),false,secret);
});

test('signed-out provider sign-in resolves only an explicitly existing account',async()=>{
  const h=createHarness({signedOut:true});h.behavior.signInResult={status:'existing',uid:'uid-a'};
  assert.equal((await h.controller.signIn('google')).status,'connected');
  assert.equal(h.auth.snapshot().uid,'uid-a');
});

test('signed-out provider sign-in rejects an unsettled or mismatched Firebase authority',async()=>{
  const unsettled=createHarness({signedOut:true});unsettled.behavior.signInResult={status:'existing',uid:'uid-a'};unsettled.behavior.settleSignInAuth=false;
  await expectCode(unsettled.controller.signIn('google'),'provider-link/auth-not-settled');
  const mismatched=createHarness({signedOut:true});mismatched.behavior.signInResult={status:'existing',uid:'uid-a'};mismatched.behavior.signInAuthUid='uid-b';
  await expectCode(mismatched.controller.signIn('google'),'provider-link/uid-changed');
});

test('provider sign-in cannot route the application username and PIN method through OAuth adapters',async()=>{
  const h=createHarness({signedOut:true});
  await expectCode(h.controller.signIn('username-pin'),'provider-link/provider-unavailable');
  assert.equal(h.calls.some(call=>call==='sign-in:username-pin'),false);
});

test('signed-out provider sign-in sends an unlinked identity to onboarding without merging email',async()=>{
  const h=createHarness({signedOut:true});h.behavior.signInResult={status:'new-user',email:'same-as-existing@example.test',displayName:'TrainerA'};
  const result=await h.controller.signIn('google');
  assert.equal(result.code,'provider-link/onboarding-required');assert.equal(result.status,'blocked');assert.equal(h.accounts.size,2);
});

test('signed-out redirect sign-in has a distinct one-time continuation path',async()=>{
  const h=createHarness({signedOut:true});h.behavior.signInResult={status:'existing',uid:'uid-a'};
  const waiting=await h.controller.signIn('google',{flow:'redirect'}),result=await h.controller.resumeSignInRedirect({providerKey:'google',nonce:waiting.nonce});
  assert.equal(result.status,'connected');h.auth.replace(null);
  await expectCode(h.controller.resumeSignInRedirect({providerKey:'google',nonce:waiting.nonce}),'provider-continuation/replayed');
});

test('malformed, wrong-provider, and wrong-operation continuations are rejected',async()=>{
  const h=createHarness(),owner=await h.continuation.ownerBinding('uid-a'),life=await h.continuation.lifecycleBinding('uid-a\0life-a');
  const record=h.continuation.issue({operation:'link',providerKey:'google',ownerBinding:owner,lifecycleBinding:life});
  assert.throws(()=>h.continuation.consume({nonce:record.nonce,operation:'link',providerKey:'discord',ownerBinding:owner,lifecycleBinding:life}),error=>error.code==='provider-continuation/provider-mismatch');
  assert.throws(()=>h.continuation.consume({nonce:record.nonce,operation:'unlink',providerKey:'google',ownerBinding:owner,lifecycleBinding:life}),error=>error.code==='provider-continuation/operation-mismatch');
  h.storage.setItem(h.domains.providerContinuationState.ACTIVE_KEY,'{"schemaVersion":1,"token":"secret"}');
  assert.throws(()=>h.continuation.inspect(),error=>error.code==='provider-continuation/malformed');
});

test('account-boundary mutation during linking fails closed',async()=>{
  const h=createHarness();h.behavior.linkDeferred=deferred();await h.controller.prepareLinkPopup('google');const pending=h.controller.completeLinkPopup('google');await waitFor(()=>h.calls.includes('link:google'));
  h.accounts.get('uid-a').trainer.handle='Provider Name';h.behavior.linkDeferred.resolve();
  await expectCode(pending,'provider-link/account-boundary-changed-trainer-identity-fingerprint');
});

test('exact reviewed recovery evidence cannot change during linking even when counts stay equal',async()=>{
  const h=createHarness();h.behavior.linkDeferred=deferred();await h.controller.prepareLinkPopup('google');const pending=h.controller.completeLinkPopup('google');await waitFor(()=>h.calls.includes('link:google'));
  h.accounts.get('uid-a').migration.recoveryEvidence[0].candidateId='rewritten-with-same-count';h.behavior.linkDeferred.resolve();
  await expectCode(pending,'provider-link/account-boundary-changed-recovery-evidence-fingerprint');
});
