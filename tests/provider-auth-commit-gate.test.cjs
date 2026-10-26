'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(){
  const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/dev/providerAuthCommitGate.js'),'utf8'),{window,Object,Error,String,TypeError});
  let tail=Promise.resolve(),lifecycle='out-1',hooks=new Set();const auth={currentUser:null},calls=[];
  const locks={request(name,options,work){const next=tail.then(work);tail=next.catch(()=>{});return next;}};
  async function transition(user){for(const hook of hooks)await hook(user);auth.currentUser=user;lifecycle=`life-${lifecycle}`;}
  const create=()=>window.PogoDev.providerAuthCommitGate.createProviderAuthCommitGate({auth,locks,getLifecycle:()=>lifecycle,
    beforeAuthStateChanged:(a,hook)=>{hooks.add(hook);return()=>hooks.delete(hook);},signInWithCustomToken:async(a,token)=>{calls.push(token);await transition({uid:'synthetic-owner'});return{user:auth.currentUser};}});
  return{auth,create,transition,calls,hooks,get lifecycle(){return lifecycle;}};
}
test('exact mapped UID commits once under a shared cross-tab lock',async()=>{
  const h=setup(),one=h.create(),two=h.create(),input={customToken:'synthetic-custom-token',expectedUid:'synthetic-owner',expectedLifecycle:h.lifecycle};
  const results=await Promise.allSettled([one.commitCustomToken(input),two.commitCustomToken(input)]);
  assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);assert.deepEqual(h.calls,['synthetic-custom-token']);assert.equal(h.hooks.size,0);
});
test('stale signed-out continuation cannot replace an existing login',async()=>{
  const h=setup(),gate=h.create(),old=h.lifecycle;await h.transition({uid:'other-owner'});
  await assert.rejects(gate.commitCustomToken({customToken:'synthetic-token',expectedUid:'synthetic-owner',expectedLifecycle:old}),{code:'provider-auth/session-changed'});
  assert.equal(h.auth.currentUser.uid,'other-owner');assert.deepEqual(h.calls,[]);
});
test('Firebase before-auth guard rejects a wrong-account transition during a pending commit',async()=>{
  const h=setup(),gate=h.create();let release,entered;const ready=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});
  const running=gate.run({kind:'sign-in',expectedUid:'synthetic-owner',expectedLifecycle:h.lifecycle},async()=>{entered();await held;await h.transition({uid:'synthetic-owner'});return{user:h.auth.currentUser};});
  await ready;await assert.rejects(h.transition({uid:'wrong-owner'}),{code:'provider-auth/unexpected-account'});assert.equal(h.auth.currentUser,null);release();await running;assert.equal(h.auth.currentUser.uid,'synthetic-owner');
});
test('link/unlink preserve exact UID and release guard after cancellation',async()=>{
  const h=setup();await h.transition({uid:'synthetic-owner'});const gate=h.create();
  await assert.rejects(gate.run({expectedUid:'synthetic-owner',expectedLifecycle:h.lifecycle},async()=>{throw Error('canceled');}),/canceled/);
  assert.equal(h.hooks.size,0);assert.equal(h.auth.currentUser.uid,'synthetic-owner');
});
test('no Web Locks support fails closed rather than using an unsafe localStorage lease',()=>{
  const h=setup();const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/dev/providerAuthCommitGate.js'),'utf8'),{window,Object,Error,String,TypeError});
  assert.throws(()=>window.PogoDev.providerAuthCommitGate.createProviderAuthCommitGate({auth:h.auth}),/Serialized auth/);
});
