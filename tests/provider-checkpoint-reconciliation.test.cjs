'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{webcrypto}=require('node:crypto');
function setup(){
 const window={crypto:webcrypto};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/dev/providerAuthCommitGate.js'),'utf8'),{window,Object,Error,String,TypeError,WeakMap,JSON});
 let record={revision:0,uid:null,status:'settled'},failSettle=true,tail=Promise.resolve(),verified=true;
 const outcomes=new Map(),auth={currentUser:null,authStateReady:async()=>{}},hooks=new Set();
 const locks={request:(name,opts,work)=>{const next=tail.then(work);tail=next.catch(()=>{});return next;}};
 const coordination={read:async()=>structuredClone(record),write:async value=>{if(value.status==='settled'&&failSettle)throw Error('synthetic crash after receipt');record=structuredClone(value);},readOutcome:async id=>structuredClone(outcomes.get(id)||null),writeOutcome:async value=>outcomes.set(value.operationId,structuredClone(value))};
 const create=()=>window.PogoDev.providerAuthCommitGate.createProviderAuthCommitGate({auth,locks,coordination,getLifecycle:()=>auth.currentUser?.uid||'signed-out',verifyCurrentAuth:async({expectedUid})=>({uid:expectedUid,verified}),
 beforeAuthStateChanged:(a,hook)=>{hooks.add(hook);return()=>hooks.delete(hook);},signInWithCustomToken:async()=>{const user={uid:'synthetic-owner'};for(const hook of hooks)await hook(user);auth.currentUser=user;return{user};}});
 return{auth,create,outcomes,get record(){return record;},set record(value){record=value;},repairStorage(){failSettle=false;},rejectVerification(){verified=false;}};
}
async function interrupted(){const h=setup(),gate=h.create();const result=await gate.commitCustomToken({customToken:'synthetic-token',expectedUid:'synthetic-owner',expectedLifecycle:'signed-out'});assert.equal(result.authCoordinationBlocked,true);assert.equal(h.record.status,'pending');return h;}
test('reload can review a proven completed operation and explicitly reconcile, without changing auth',async()=>{
 const h=await interrupted();h.repairStorage();const gate=h.create(),ticket=await gate.prepareReconciliation();assert.equal(ticket.uid,h.auth.currentUser.uid);
 await assert.rejects(gate.confirmReconciliation(ticket),{code:'provider-auth/explicit-review-required'});assert.equal(h.record.status,'pending');
 const result=await gate.confirmReconciliation(ticket,{accepted:true});assert.equal(result.status,'reconciled');assert.equal(h.record.status,'settled');assert.equal(h.record.uid,'synthetic-owner');await gate.assertSession();
});
test('unknown outcome, wrong current UID, failed verification and changed review never clear pending',async()=>{
 for(const fault of['receipt','uid','verify','review']){
  const h=await interrupted();h.repairStorage();const gate=h.create();
  if(fault==='review'){const ticket=await gate.prepareReconciliation();h.record={...h.record,revision:h.record.revision+1};await assert.rejects(gate.confirmReconciliation(ticket,{accepted:true}));}
  else{if(fault==='receipt')h.outcomes.clear();if(fault==='uid')h.auth.currentUser={uid:'other-owner'};if(fault==='verify')h.rejectVerification();await assert.rejects(gate.prepareReconciliation());}
  assert.equal(h.record.status,'pending');
 }
});
test('two tabs reviewing one receipt cannot both reconcile, and a failed recovery write remains blocked',async()=>{
 const h=await interrupted(),one=h.create(),two=h.create();const tickets=await Promise.all([one.prepareReconciliation(),two.prepareReconciliation()]);
 await assert.rejects(one.confirmReconciliation(tickets[0],{accepted:true}),/synthetic crash/);assert.equal(h.record.status,'pending');
 h.repairStorage();const results=await Promise.allSettled([one.confirmReconciliation(tickets[0],{accepted:true}),two.confirmReconciliation(tickets[1],{accepted:true})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(h.record.status,'settled');
});

test('real checkpoint verifier forces fresh token and Firebase lookup, rejects revocation, substitution and session races',async()=>{
 const now=Date.now(),uid='verified-checkpoint-owner',projectId='demo-pogo-discord',claims={sub:uid,aud:projectId,iss:`https://securetoken.google.com/${projectId}`,exp:Math.floor(now/1000)+60,auth_time:Math.floor(now/1000)-10},calls=[];let reply={users:[{localId:uid,validSince:'0'}]};
 const user={uid,getIdTokenResult:async force=>{assert.equal(force,true);return{token:'synthetic-id-token',claims};}},auth={app:{options:{projectId}},currentUser:user,authStateReady:async()=>{}};
 const window={AbortController,setTimeout,clearTimeout},context=vm.createContext({window,Error,Object,TypeError,Number,Date,JSON,String});vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/dev/providerCheckpointRecovery.js'),'utf8'),context);
 const verify=window.PogoDev.providerCheckpointRecovery.createVerifier({enabled:true,auth,projectId,apiKey:'synthetic-api-key',clock:()=>now,fetchImpl:async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>reply};}});
 assert.equal((await verify({user,expectedUid:uid})).verified,true);assert.match(calls[0].url,/^https:\/\/identitytoolkit.googleapis.com\/v1\/accounts:lookup\?/);assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.credentials,'omit');
 reply={users:[{localId:uid,validSince:String(claims.auth_time+1)}]};await assert.rejects(verify({user,expectedUid:uid}),{code:'provider-auth/verification-failed'});reply={users:[{localId:'another-owner'}]};await assert.rejects(verify({user,expectedUid:uid}),{code:'provider-auth/verification-failed'});
 auth.currentUser={uid:'other'};await assert.rejects(verify({user,expectedUid:uid}),{code:'provider-auth/session-changed'});auth.currentUser=null;assert.equal((await verify({user:null,expectedUid:''})).uid,'');
 assert.throws(()=>window.PogoDev.providerCheckpointRecovery.createVerifier({enabled:true,auth:{...auth,emulatorConfig:{host:'example.test',protocol:'http',port:9898}},projectId,apiKey:'synthetic-key',fetchImpl:async()=>{}}),{code:'provider-auth/verification-target-invalid'});
});
