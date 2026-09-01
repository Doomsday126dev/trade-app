const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');

const source=readFileSync(path.join(__dirname,'..','js/domain/providerOnboardingModel.js'),'utf8');
function load(){const window={crypto:webcrypto};window.window=window;vm.runInContext(source,vm.createContext({window,console,Uint8Array,unescape,encodeURIComponent}),{filename:'providerOnboardingModel.js'});return window.PogoDomain.providerOnboardingModel;}
function storage(){const values=new Map();return{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),values};}
function foundation(handle='TrainerNew'){return{status:'active',identityKind:'provider_only',legacyAccessConfigured:false,legacyUsername:null,canonicalTrainerName:handle};}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
function harness(options={}){
  const domain=load();let authority={uid:'uid-new',lifecycleId:'auth-1'},checks=[],createInputs=[];const store=options.storage||storage();
  const model=domain.createProviderOnboardingModel({
    authoritySnapshot:()=>authority,storage:store,
    checkHandle:async(handle,binding)=>{checks.push({handle,binding});if(options.checkError)throw options.checkError;return options.handleResult||{available:true};},
    createAccount:options.withCreate===false?undefined:async input=>{createInputs.push(input);return options.createResult||{status:'account-ready',foundation:foundation(input.handle)};},
    reconcileAccount:options.withReconcile===false?undefined:async input=>options.reconcileResult||{status:'account-ready',foundation:foundation(input.handle)}
  });
  return{domain,model,checks,createInputs,store,setAuthority:value=>{authority=value;}};
}
async function beginChoice(model){await model.begin({providerKey:'google'});model.resolveAccount({status:'missing'});model.startHandleChoice();}

test('required provider onboarding states are explicit and complete',()=>{
  const{STATES}=load();
  for(const state of ['checking-account','onboarding-required','choosing-handle','checking-availability','handle-unavailable',
    'ready-to-create','creating','verifying','account-ready','retryable-failure','ambiguous-result','blocked-conflict','canceled']){
    assert.equal(STATES.includes(state),true,state);
  }
});

test('new Google user chooses a handle explicitly and reaches account ready only after certification',async()=>{
  const h=harness();
  assert.equal((await h.model.begin({providerKey:'google'})).status,'checking-account');
  assert.equal(h.model.resolveAccount({status:'missing'}).status,'onboarding-required');
  assert.equal(h.model.startHandleChoice().status,'choosing-handle');
  assert.equal((await h.model.chooseHandle('  TrainerNew  ')).status,'ready-to-create');
  h.model.confirmProfile({friendCode:'000011112222'});
  const result=await h.model.create();
  assert.equal(result.status,'account-ready');assert.equal(result.initialProfile.friendCode,'0000 1111 2222');
  assert.equal(h.createInputs[0].profile.friendCode,'0000 1111 2222');
});

test('invalid optional profile data fails before identity dispatch',async()=>{
  const h=harness();await beginChoice(h.model);await h.model.chooseHandle('TrainerNew');
  assert.throws(()=>h.model.confirmProfile({friendCode:'1234 5678'}),error=>error.code==='provider-onboarding/profile-invalid');
  assert.equal(h.createInputs.length,0);
  await assert.rejects(h.model.create(),error=>error.code==='provider-onboarding/profile-invalid');
  assert.equal(h.createInputs.length,0);h.model.confirmProfile({});await h.model.create();
  assert.equal(h.createInputs.length,1);assert.equal(h.createInputs[0].profile.friendCode,'');
});

test('Google profile email and avatar cannot silently become the trainer identity or durable state',async()=>{
  const h=harness();await h.model.begin({providerKey:'google'});
  h.model.resolveAccount({status:'missing',displayName:'Google Name',email:'private@example.test',avatar:'private-url'});
  assert.equal(h.model.snapshot().handle,'');assert.equal(h.checks.length,0);
  assert.doesNotMatch([...h.store.values.values()].join('\n'),/Google Name|private@example|private-url/);
  assert.doesNotMatch(source,/result\.displayName|result\.email|result\.avatar/);
});

test('advisory unavailable result returns to a handle-specific state without creating',async()=>{
  const h=harness({handleResult:{available:false,code:'provider-onboarding/handle-unavailable'}});await beginChoice(h.model);
  const result=await h.model.chooseHandle('TakenName');assert.equal(result.status,'handle-unavailable');
  await assert.rejects(h.model.create(),error=>error.code==='provider-onboarding/creation-unavailable');
});

test('temporary availability failure is retryable and never claims a handle',async()=>{
  const h=harness({checkError:Object.assign(new Error('offline'),{code:'provider-onboarding/network-failed'})});await beginChoice(h.model);
  const result=await h.model.chooseHandle('TrainerNew');assert.equal(result.status,'retryable-failure');
  assert.equal(result.code,'provider-onboarding/network-failed');
});

test('account creation requires an injected server-authoritative dependency',async()=>{
  const h=harness({withCreate:false});await beginChoice(h.model);await h.model.chooseHandle('TrainerNew');
  await assert.rejects(h.model.create(),error=>error.code==='provider-onboarding/creation-unavailable');
});

test('UID or lifecycle replacement fails closed during availability and creation',async()=>{
  const pending=deferred(),domain=load();let authority={uid:'uid-new',lifecycleId:'auth-1'};const store=storage();
  const model=domain.createProviderOnboardingModel({authoritySnapshot:()=>authority,storage:store,checkHandle:()=>pending.promise});
  await beginChoice(model);const choosing=model.chooseHandle('TrainerNew');authority={uid:'uid-new',lifecycleId:'auth-2'};pending.resolve({available:true});
  await assert.rejects(choosing,error=>error.code==='provider-onboarding/auth-lifecycle-changed');
});

test('malformed create result becomes a blocked conflict and cannot attach account sync',async()=>{
  const h=harness({createResult:{status:'account-ready',foundation:foundation('OtherTrainer')}});await beginChoice(h.model);await h.model.chooseHandle('TrainerNew');
  await assert.rejects(h.model.create(),error=>error.code==='provider-onboarding/creation-result-invalid');
  assert.equal(h.model.snapshot().status,'blocked-conflict');
});

test('ambiguous creation persists for exact reconciliation and never becomes account ready early',async()=>{
  const store=storage(),ambiguous=Object.assign(new Error('lost'),{code:'provider-account/ambiguous-result',state:'ambiguous'});
  const domain=load();let authority={uid:'uid-new',lifecycleId:'auth-1'};
  const model=domain.createProviderOnboardingModel({authoritySnapshot:()=>authority,storage:store,checkHandle:async()=>({available:true}),
    createAccount:async()=>{throw ambiguous;},reconcileAccount:async input=>({status:'account-ready',foundation:foundation(input.handle)})});
  await beginChoice(model);await model.chooseHandle('TrainerNew');await assert.rejects(model.create(),error=>error===ambiguous);
  assert.equal(model.snapshot().status,'ambiguous-result');
  const reopened=domain.createProviderOnboardingModel({authoritySnapshot:()=>authority,storage:store,checkHandle:async()=>({available:true}),
    createAccount:async()=>{throw new Error('must not create');},reconcileAccount:async input=>({status:'account-ready',foundation:foundation(input.handle)})});
  assert.equal((await reopened.begin({providerKey:'google'})).status,'ambiguous-result');
  assert.equal((await reopened.reconcile()).status,'account-ready');
});

test('close and reopen before dispatch restores the chosen ready handle without profile fields',async()=>{
  const store=storage(),first=harness({storage:store});await beginChoice(first.model);await first.model.chooseHandle('TrainerNew');
  first.model.confirmProfile({friendCode:'0000 1111 2222',bio:'private draft'});
  const second=harness({storage:store});const restored=await second.model.begin({providerKey:'google'});
  assert.equal(restored.status,'ready-to-create');assert.equal(restored.handle,'TrainerNew');
  assert.doesNotMatch([...store.values.values()].join('\n'),/0000 1111 2222|private draft/);
  assert.equal(first.createInputs.length,0);assert.equal(second.createInputs.length,0);
});

test('continuation persists only a versioned UID digest and clears cross-account or legacy raw-UID state',async()=>{
  const first=harness();await beginChoice(first.model);await first.model.chooseHandle('TrainerNew');
  const serialized=[...first.store.values.values()][0],record=JSON.parse(serialized);
  assert.deepEqual(Object.keys(record).sort(),['code','handle','lifecycleId','providerKey','schemaVersion','status','uidDigest','uidDigestVersion']);
  assert.equal(record.schemaVersion,2);assert.equal(record.uidDigestVersion,'sha256-v1');assert.match(record.uidDigest,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(serialized,/uid-new|email|subject|token|credential|friendCode|profile|avatar/i);

  first.setAuthority({uid:'uid-other',lifecycleId:'auth-1'});
  assert.equal((await first.model.begin({providerKey:'google'})).status,'checking-account');
  assert.notEqual(JSON.parse([...first.store.values.values()][0]).uidDigest,record.uidDigest);

  const legacyStore=storage();legacyStore.setItem('pogoProviderOnboarding:v2',JSON.stringify({schemaVersion:1,uid:'uid-new',lifecycleId:'auth-1',providerKey:'google',status:'ready-to-create',handle:'TrainerNew',code:''}));
  const legacy=harness({storage:legacyStore});assert.equal((await legacy.model.begin({providerKey:'google'})).status,'checking-account');
  assert.doesNotMatch([...legacyStore.values.values()].join('\n'),/uid-new/);
});

test('existing canonical account bypasses account creation',async()=>{
  const h=harness();await h.model.begin({providerKey:'google'});
  const result=h.model.resolveAccount({status:'existing',foundation:{canonicalTrainerName:'ExistingTrainer'}});
  assert.equal(result.status,'account-ready');assert.equal(result.handle,'ExistingTrainer');
});

test('cancel clears durable onboarding state without deleting the Firebase Auth user',async()=>{
  const h=harness();await beginChoice(h.model);assert.equal(h.model.cancel().status,'canceled');assert.equal(h.store.values.size,0);
  assert.doesNotMatch(source,/deleteUser|deleteAccount/);
});

test('invalid handles are deterministic',async()=>{
  const h=harness();await beginChoice(h.model);
  await assert.rejects(h.model.chooseHandle('bad/name'),error=>error.code==='provider-onboarding/handle-invalid');
});
