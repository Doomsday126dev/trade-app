const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=readFileSync(path.join(__dirname,'..','js/domain/providerOnboardingModel.js'),'utf8');
function load(){const window={};window.window=window;vm.runInContext(source,vm.createContext({window,console}),{filename:'providerOnboardingModel.js'});return window.PogoDomain.providerOnboardingModel;}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
function harness(options={}){
  const domain=load();let authority={uid:'uid-new',lifecycleId:'life-1'},checks=[];
  const model=domain.createProviderOnboardingModel({
    authoritySnapshot:()=>authority,
    checkHandle:async(handle,binding)=>{checks.push({handle,binding});return options.handleResult||{available:true};},
    createAccount:options.withCreate?async input=>options.createResult||{uid:input.uid,handle:input.handle}:undefined
  });
  return{domain,model,checks,setAuthority:value=>{authority=value;}};
}

test('new Google user must explicitly choose a trainer handle and confirm profile',async()=>{
  const h=harness({withCreate:true});h.model.begin({providerKey:'google'});h.model.resolveAccount({status:'unlinked'});
  assert.equal(h.model.snapshot().status,'choose-handle');
  assert.equal((await h.model.chooseHandle('  TrainerNew  ')).status,'confirm-profile');
  assert.equal(h.checks[0].handle,'TrainerNew');assert.equal(h.model.confirmProfile({friendCode:'0000 1111 2222'}).status,'ready-to-create');
  assert.equal((await h.model.create()).status,'complete');
});

test('Google profile and email cannot silently become the trainer identity',async()=>{
  const h=harness();h.model.begin({providerKey:'google'});h.model.resolveAccount({status:'unlinked',displayName:'Google Name',email:'private@example.test'});
  assert.equal(h.model.snapshot().handle,'');assert.equal(h.checks.length,0);
  assert.doesNotMatch(source,/displayName|\.email|profile\.email/);
});

test('unavailable handle blocks creation without mutating authority',async()=>{
  const h=harness({handleResult:{available:false,code:'provider-onboarding/handle-unavailable'}});h.model.begin();h.model.resolveAccount({status:'unlinked'});
  const result=await h.model.chooseHandle('TakenName');assert.equal(result.status,'blocked');assert.equal(result.code,'provider-onboarding/handle-unavailable');
  await assert.rejects(h.model.create(),error=>error.code==='provider-onboarding/state-invalid'||error.code==='provider-onboarding/creation-unavailable');
});

test('account creation is unavailable until an exact secure create dependency is injected',async()=>{
  const h=harness();h.model.begin();h.model.resolveAccount({status:'unlinked'});await h.model.chooseHandle('TrainerNew');h.model.confirmProfile({});
  await assert.rejects(h.model.create(),error=>error.code==='provider-onboarding/creation-unavailable');
});

test('UID or lifecycle replacement fails closed during onboarding',async()=>{
  const pending=deferred(),domain=load();let authority={uid:'uid-new',lifecycleId:'life-1'};
  const model=domain.createProviderOnboardingModel({authoritySnapshot:()=>authority,checkHandle:()=>pending.promise});
  model.begin();model.resolveAccount({status:'unlinked'});const choosing=model.chooseHandle('TrainerNew');authority={uid:'uid-new',lifecycleId:'life-2'};pending.resolve({available:true});
  await assert.rejects(choosing,error=>error.code==='provider-onboarding/auth-lifecycle-changed');
});

test('create result must exactly match the bound UID and chosen handle',async()=>{
  const h=harness({withCreate:true,createResult:{uid:'uid-other',handle:'TrainerNew'}});h.model.begin();h.model.resolveAccount({status:'unlinked'});await h.model.chooseHandle('TrainerNew');h.model.confirmProfile({});
  await assert.rejects(h.model.create(),error=>error.code==='provider-onboarding/creation-result-invalid');
});

test('invalid handles and cancel are deterministic',()=>{
  const h=harness();h.model.begin();h.model.resolveAccount({status:'unlinked'});
  assert.rejects(h.model.chooseHandle('bad/name'),error=>error.code==='provider-onboarding/handle-invalid');
  assert.equal(h.model.cancel().status,'canceled');
});
