const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const files=['js/data/subscriptionManager.js','js/data/listenerLifecycle.js'];

function createHarness(){
  const window={};
  const context=vm.createContext({window});
  for(const file of files)vm.runInContext(readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  const subscriptions=window.PogoData.subscriptionManager.createSubscriptionManager();
  const lifecycle=window.PogoData.listenerLifecycle.createListenerLifecycle({subscriptions});
  const starts=[];
  function source(path){
    return({next,error})=>{
      const record={path,next,error,stopped:false};
      starts.push(record);
      return()=>{record.stopped=true;};
    };
  }
  function options(path,onValue=()=>{}){
    return{path,start:source(path),onValue,onError:()=>{}};
  }
  return{lifecycle,subscriptions,starts,options};
}

test('public login-directory subscription is idempotent and survives session cleanup',()=>{
  const h=createHarness();
  const first=h.lifecycle.subscribePublic({...h.options('loginDirectory'),key:'public:loginDirectory'});
  const duplicate=h.lifecycle.subscribePublic({...h.options('loginDirectory'),key:'public:loginDirectory'});
  h.lifecycle.activateSession({uid:'uid-a',username:'TrainerA'});
  h.lifecycle.subscribeSession({...h.options('users'),key:'session:users'});
  const cleanup=h.lifecycle.deactivateSession('logout');
  assert.equal(first.status,'subscribed');
  assert.equal(duplicate.status,'existing');
  assert.equal(cleanup.session,1);
  assert.deepEqual(Array.from(h.subscriptions.snapshot(),item=>item.key),['public:loginDirectory']);
});

test('user switch replaces UID-fingerprinted listeners and suppresses the old callback',()=>{
  const h=createHarness();
  const values=[];
  h.lifecycle.activateSession({uid:'uid-a',username:'TrainerA'});
  h.lifecycle.subscribeSession({...h.options('users',value=>values.push(`a:${value}`)),key:'session:users'});
  const old=h.starts[0];
  const transition=h.lifecycle.activateSession({uid:'uid-b',username:'TrainerB'});
  h.lifecycle.subscribeSession({...h.options('users',value=>values.push(`b:${value}`)),key:'session:users'});
  old.next('stale');
  h.starts[1].next('current');
  assert.equal(transition.status,'active');
  assert.equal(old.stopped,true);
  assert.deepEqual(values,['b:current']);
});

test('repeated login and logout cycles do not duplicate protected listeners',()=>{
  const h=createHarness();
  for(let cycle=0;cycle<3;cycle++){
    h.lifecycle.activateSession({uid:'uid-a',username:'TrainerA'});
    const first=h.lifecycle.subscribeSession({...h.options('wishlist'),key:'session:wishlist'});
    const duplicate=h.lifecycle.subscribeSession({...h.options('wishlist'),key:'session:wishlist'});
    assert.equal(first.status,'subscribed');
    assert.equal(duplicate.status,'existing');
    assert.equal(h.lifecycle.deactivateSession('logout').session,1);
  }
  assert.equal(h.starts.length,3);
  assert.equal(h.subscriptions.size(),0);
});

test('auth loss invalidates a callback that was scheduled before cleanup',()=>{
  const h=createHarness();
  const values=[];
  h.lifecycle.activateSession({uid:'uid-a',username:'TrainerA'});
  h.lifecycle.subscribeSession({...h.options('offers',value=>values.push(value)),key:'session:offers'});
  const pending=h.starts[0].next;
  h.lifecycle.deactivateSession('auth_loss');
  pending('late');
  assert.deepEqual(values,[]);
  assert.equal(h.starts[0].stopped,true);
});

test('selected-trainer switch removes every previous trainer listener',()=>{
  const h=createHarness();
  const oldValues=[];
  h.lifecycle.subscribeSelectedTrainer({username:'TrainerA',...h.options('publicShares/TrainerA',value=>oldValues.push(value))});
  h.lifecycle.subscribeSelectedTrainer({username:'TrainerA',authenticated:true,...h.options('users/TrainerA',value=>oldValues.push(value))});
  const old=[...h.starts];
  h.lifecycle.subscribeSelectedTrainer({username:'TrainerB',...h.options('publicShares/TrainerB')});
  old.forEach(record=>record.next('stale'));
  assert.ok(old.every(record=>record.stopped));
  assert.deepEqual(oldValues,[]);
  assert.equal(h.lifecycle.snapshot().selectedTrainer,'TrainerB');
  assert.equal(h.subscriptions.size(),1);
});

test('auth loss removes legacy share fallback but retains anonymous public share',()=>{
  const h=createHarness();
  h.lifecycle.activateSession({uid:'uid-a',username:'TrainerA'});
  h.lifecycle.subscribeSelectedTrainer({username:'Shared',...h.options('publicShares/Shared')});
  h.lifecycle.subscribeSelectedTrainer({username:'Shared',authenticated:true,...h.options('users/Shared')});
  h.lifecycle.subscribeSelectedTrainer({username:'Shared',authenticated:true,...h.options('wishlist/Shared')});
  const result=h.lifecycle.deactivateSession('auth_loss');
  assert.equal(result.authenticatedShares,2);
  assert.deepEqual(Array.from(h.subscriptions.snapshot(),item=>item.key),['selectedTrainer:public:publicShares/Shared']);
});

test('share close explicitly removes the public and authenticated listeners',()=>{
  const h=createHarness();
  h.lifecycle.subscribeSelectedTrainer({username:'Shared',...h.options('publicShares/Shared')});
  h.lifecycle.subscribeSelectedTrainer({username:'Shared',authenticated:true,...h.options('users/Shared')});
  const result=h.lifecycle.clearSelectedTrainer('share_closed');
  assert.equal(result.count,2);
  assert.equal(h.subscriptions.size(),0);
  assert.equal(h.lifecycle.snapshot().selectedTrainer,null);
});

test('session and trainer subscriptions fail closed without required identity',()=>{
  const h=createHarness();
  assert.equal(h.lifecycle.activateSession({uid:'uid-only'}).error.code,'listener/session-identity-required');
  assert.equal(h.lifecycle.subscribeSession(h.options('users')).error.code,'listener/session-inactive');
  assert.equal(h.lifecycle.subscribeSelectedTrainer({username:'',...h.options('publicShares/x')}).error.code,'listener/trainer-required');
});

test('legacy admin listeners are session-bound, idempotent, and cleared on admin close',()=>{
  const h=createHarness();
  assert.equal(h.lifecycle.subscribeLegacyAdmin(h.options('users')).error.code,'listener/session-inactive');
  h.lifecycle.activateSession({uid:'uid-owner',username:'Owner'});
  const first=h.lifecycle.subscribeLegacyAdmin({...h.options('users'),key:'legacyAdmin:users'});
  const duplicate=h.lifecycle.subscribeLegacyAdmin({...h.options('users'),key:'legacyAdmin:users'});
  const cleared=h.lifecycle.clearLegacyAdmin('admin_closed');
  assert.equal(first.status,'subscribed');
  assert.equal(duplicate.status,'existing');
  assert.equal(cleared.count,1);
  assert.equal(h.starts[0].stopped,true);
  assert.equal(h.subscriptions.size(),0);
});
