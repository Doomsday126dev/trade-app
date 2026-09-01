const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=readFileSync(path.join(__dirname,'..','js/domain/providerOnboardingModel.js'),'utf8');
function load(){const window={};window.window=window;vm.runInContext(source,vm.createContext({window,console}),{filename:'providerOnboardingModel.js'});return window.PogoDomain.providerOnboardingModel;}
function storage(){const values=new Map();return{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),values};}
function foundation(handle='TrainerNew'){return{status:'active',identityKind:'provider_only',legacyAccessConfigured:false,legacyUsername:null,canonicalTrainerName:handle};}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
function harness(options={}){
  const domain=load();let authority={uid:'uid-new',lifecycleId:'auth-1'},checks=[];const store=options.storage||storage();
  const model=domain.createProviderOnboardingModel({
    authoritySnapshot:()=>authority,storage:store,
    checkHandle:async(handle,binding)=>{checks.push({handle,binding});if(options.checkError)throw options.checkError;return options.handleResult||{available:true};},
    createAccount:options.withCreate===false?undefined:async input=>options.createResult||{status:'account-ready',foundation:foundation(input.handle)},
    reconcileAccount:options.withReconcile===false?undefined:async input=>options.reconcileResult||{status:'account-ready',foundation:foundation(input.handle)}
  });
  return{domain,model,checks,store,setAuthority:value=>{authority=value;}};
}
function beginChoice(model){model.begin({providerKey:'google'});model.resolveAccount({status:'missing'});model.startHandleChoice();}

test('required provider onboarding states are explicit and complete',()=>{
  const{STATES}=load();
  for(const state of ['checking-account','onboarding-required','choosing-handle','checking-availability','handle-unavailable',
    'ready-to-create','creating','verifying','account-ready','retryable-failure','ambiguous-result','blocked-conflict','canceled']){
    assert.equal(STATES.includes(state),true,state);
  }
});

test('new Google user chooses a handle explicitly and reaches account ready only after certification',async()=>{
  const h=harness();
  assert.equal(h.model.begin({providerKey:'google'}).status,'checking-account');
  assert.equal(h.model.resolveAccount({status:'missing'}).status,'onboarding-required');
  assert.equal(h.model.startHandleChoice().status,'choosing-handle');
  assert.equal((await h.model.chooseHandle('  TrainerNew  ')).status,'ready-to-create');
  h.model.confirmProfile({friendCode:'0000 1111 2222'});
  assert.equal((await h.model.create()).status,'account-ready');
});

test('Google profile email and avatar cannot silently become the trainer identity or durable state',()=>{
  const h=harness();h.model.begin({providerKey:'google'});
  h.model.resolveAccount({status:'missing',displayName:'Google Name',email:'private@example.test',avatar:'private-url'});
  assert.equal(h.model.snapshot().handle,'');assert.equal(h.checks.length,0);
  assert.doesNotMatch([...h.store.values.values()].join('\n'),/Google Name|private@example|private-url/);
  assert.doesNotMatch(source,/result\.displayName|result\.email|result\.avatar/);
});

test('advisory unavailable result returns to a handle-specific state without creating',async()=>{
  const h=harness({handleResult:{available:false,code:'provider-onboarding/handle-unavailable'}});beginChoice(h.model);
  const result=await h.model.chooseHandle('TakenName');assert.equal(result.status,'handle-unavailable');
  await assert.rejects(h.model.create(),error=>error.code==='provider-onboarding/creation-unavailable');
});

test('temporary availability failure is retryable and never claims a handle',async()=>{
  const h=harness({checkError:Object.assign(new Error('offline'),{code:'provider-onboarding/network-failed'})});beginChoice(h.model);
  const result=await h.model.chooseHandle('TrainerNew');assert.equal(result.status,'retryable-failure');
  assert.equal(result.code,'provider-onboarding/network-failed');
});

test('account creation requires an injected server-authoritative dependency',async()=>{
  const h=harness({withCreate:false});beginChoice(h.model);await h.model.chooseHandle('TrainerNew');
  await assert.rejects(h.model.create(),error=>error.code==='provider-onboarding/creation-unavailable');
});

test('UID or lifecycle replacement fails closed during availability and creation',async()=>{
  const pending=deferred(),domain=load();let authority={uid:'uid-new',lifecycleId:'auth-1'};const store=storage();
  const model=domain.createProviderOnboardingModel({authoritySnapshot:()=>authority,storage:store,checkHandle:()=>pending.promise});
  beginChoice(model);const choosing=model.chooseHandle('TrainerNew');authority={uid:'uid-new',lifecycleId:'auth-2'};pending.resolve({available:true});
  await assert.rejects(choosing,error=>error.code==='provider-onboarding/auth-lifecycle-changed');
});

test('malformed create result becomes a blocked conflict and cannot attach account sync',async()=>{
  const h=harness({createResult:{status:'account-ready',foundation:foundation('OtherTrainer')}});beginChoice(h.model);await h.model.chooseHandle('TrainerNew');
  await assert.rejects(h.model.create(),error=>error.code==='provider-onboarding/creation-result-invalid');
  assert.equal(h.model.snapshot().status,'blocked-conflict');
});

test('ambiguous creation persists for exact reconciliation and never becomes account ready early',async()=>{
  const store=storage(),ambiguous=Object.assign(new Error('lost'),{code:'provider-account/ambiguous-result',state:'ambiguous'});
  const domain=load();let authority={uid:'uid-new',lifecycleId:'auth-1'};
  const model=domain.createProviderOnboardingModel({authoritySnapshot:()=>authority,storage:store,checkHandle:async()=>({available:true}),
    createAccount:async()=>{throw ambiguous;},reconcileAccount:async input=>({status:'account-ready',foundation:foundation(input.handle)})});
  beginChoice(model);await model.chooseHandle('TrainerNew');await assert.rejects(model.create(),error=>error===ambiguous);
  assert.equal(model.snapshot().status,'ambiguous-result');
  const reopened=domain.createProviderOnboardingModel({authoritySnapshot:()=>authority,storage:store,checkHandle:async()=>({available:true}),
    createAccount:async()=>{throw new Error('must not create');},reconcileAccount:async input=>({status:'account-ready',foundation:foundation(input.handle)})});
  assert.equal(reopened.begin({providerKey:'google'}).status,'ambiguous-result');
  assert.equal((await reopened.reconcile()).status,'account-ready');
});

test('close and reopen before dispatch restores the chosen ready handle without profile fields',async()=>{
  const store=storage(),first=harness({storage:store});beginChoice(first.model);await first.model.chooseHandle('TrainerNew');
  first.model.confirmProfile({friendCode:'0000 1111 2222',bio:'private draft'});
  const second=harness({storage:store});const restored=second.model.begin({providerKey:'google'});
  assert.equal(restored.status,'ready-to-create');assert.equal(restored.handle,'TrainerNew');
  assert.doesNotMatch([...store.values.values()].join('\n'),/0000 1111 2222|private draft/);
});

test('existing canonical account bypasses account creation',()=>{
  const h=harness();h.model.begin({providerKey:'google'});
  const result=h.model.resolveAccount({status:'existing',foundation:{canonicalTrainerName:'ExistingTrainer'}});
  assert.equal(result.status,'account-ready');assert.equal(result.handle,'ExistingTrainer');
});

test('cancel clears durable onboarding state without deleting the Firebase Auth user',()=>{
  const h=harness();beginChoice(h.model);assert.equal(h.model.cancel().status,'canceled');assert.equal(h.store.values.size,0);
  assert.doesNotMatch(source,/deleteUser|deleteAccount/);
});

test('invalid handles are deterministic',async()=>{
  const h=harness();beginChoice(h.model);
  await assert.rejects(h.model.chooseHandle('bad/name'),error=>error.code==='provider-onboarding/handle-invalid');
});
