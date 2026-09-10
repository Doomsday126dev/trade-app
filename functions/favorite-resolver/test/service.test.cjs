'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {requestHandles}=require('../contract');
const {createIdentityResolver,createIdentityReader}=require('../identity');
const {createQuota,createGcsQuotaStore}=require('../quota');
const {createHandler}=require('../handler');
function memory(){const values=new Map();return{values,async read(id){const entry=values.get(id);return entry?structuredClone(entry):{generation:0,value:null};},async compareAndSwap(id,generation,value){const old=values.get(id);if((old?.generation||0)!==generation)throw Object.assign(new Error('CAS'),{code:412});values.set(id,{generation:generation+1,value:structuredClone(value)});}};}
function identityFixture(){
  const forward=new Map([['Caller','caller'],...Array.from({length:100},(_,i)=>[`Target${i}`,`target${i}`])]),reverse=new Map([...forward].map(([name,uid])=>[uid,name])),fences=new Set(),reads=[];
  return{forward,reverse,fences,reads,reader:{async callerHandle(uid){reads.push(['caller',uid]);return reverse.get(uid)||null;},async targetUid(name){reads.push(['forward',name]);return forward.get(name)||null;},async reverseHandle(uid){reads.push(['reverse',uid]);return reverse.get(uid)||null;},async isFenced(uid){reads.push(['fence',uid]);return fences.has(uid);}}};
}
function response(){return{headers:{},set(k,v){this.headers[k]=v;return this;},status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;},send(value){this.body=value;return this;}};}
function fixture(overrides={}){
 const identity=identityFixture(),store=memory();const consumed=new Set();
 const handler=createHandler({enabled:()=>true,origins:['https://allowed.example'],verifyAuth:async token=>{if(token!=='current-token')throw new Error('invalid');return{uid:'caller'};},verifyAppCheck:async token=>{if(token!=='app-token'||consumed.has(token))return false;consumed.add(token);return true;},quota:createQuota(store),resolve:createIdentityResolver(identity.reader),...overrides});
 return{identity,store,handler,async call(body={handles:['Target0']},options={}){const res=response();await handler({method:'POST',headers:{origin:'https://allowed.example','content-type':'application/json',authorization:'Bearer current-token','x-firebase-appcheck':'app-token'},body,...options},res);return res;}};
}
for(const body of [{handle:'Target0'},{handles:[]},{handles:['Target0','Target0']},{handles:[' target']},{handles:['x/y']},{handles:Array(51).fill('x')},{handles:['x'],uid:'caller'},{handles:['e\u0301']}])test('strict exact batch request rejects '+JSON.stringify(body).slice(0,75),()=>assert.throws(()=>requestHandles(body)));
test('one and fifty exact handles use the same minimal response',async()=>{
 const f=fixture(),r=await f.call({handles:Array.from({length:50},(_,i)=>`Target${i}`)});assert.equal(r.statusCode,200);assert.equal(r.body.results.length,50);
 assert.deepEqual(r.body.results[0],{handle:'Target0',status:'resolved',targetUid:'target0',canonicalHandle:'Target0'});assert.deepEqual(Object.keys(r.body).sort(),['results','version']);assert.equal([...f.store.values.values()][0].value.work,50);
});
test('missing conflicting retired and self identities use one unavailable result',async()=>{
 const f=fixture();f.identity.reverse.set('target1','Different');f.identity.fences.add('target2');const r=await f.call({handles:['Missing','Target1','Target2','Caller']});assert.equal(r.statusCode,200);
 for(const row of r.body.results)assert.deepEqual(Object.keys(row).sort(),['handle','status']);assert.ok(r.body.results.every(row=>row.status==='unavailable'));
});
test('transport errors remain transport errors instead of account-existence results',async()=>{
 const f=fixture();f.identity.reader.targetUid=async()=>{throw new Error('SDK secret detail');};const r=await f.call();assert.equal(r.statusCode,503);assert.deepEqual(r.body,{code:'favorite/unavailable'});
});
test('App Check is consumed once per batch and replay is rejected before quota or identity work',async()=>{
 const f=fixture();assert.equal((await f.call()).statusCode,200);const count=f.identity.reads.length;const r=await f.call();assert.equal(r.statusCode,401);assert.equal(f.identity.reads.length,count);assert.equal([...f.store.values.values()][0].value.requests,1);
});
for(const [name,options,status]of[['missing Auth',{headers:{origin:'https://allowed.example','content-type':'application/json','x-firebase-appcheck':'app-token'}},401],['wrong origin',{headers:{origin:'https://wrong.example'}},403],['oversize',{rawBody:Buffer.alloc(16385)},413],['GET',{method:'GET'},405]])test(name+' is denied',async()=>assert.equal((await fixture().call(undefined,options)).statusCode,status));
test('disabled capability and caller maintenance hold fail closed',async()=>{
 assert.equal((await fixture({enabled:()=>false}).call()).statusCode,503);const f=fixture();f.identity.fences.add('caller');assert.equal((await f.call()).statusCode,403);
});
test('100 legitimate targets fit into two batches and every target is charged',async()=>{
 const store=memory(),q=createQuota(store,()=>1000);let a=await q.acquire('caller',50);await q.release(a);a=await q.acquire('caller',50);await q.release(a);const v=[...store.values.values()][0].value;assert.equal(v.work,100);assert.equal(v.requests,2);
});
test('work budget and caller concurrency are enforced across service instances',async()=>{
 const store=memory(),a=createQuota(store,()=>1000),b=createQuota(store,()=>1000);const leases=await Promise.all([a.acquire('caller',50),b.acquire('caller',50)]);
 await assert.rejects(a.acquire('caller',1),{code:'favorite/busy'});await Promise.all(leases.map(lease=>a.release(lease)));for(const work of[50,50,40]){const lease=await b.acquire('caller',work);await b.release(lease);}await assert.rejects(a.acquire('caller',1),{code:'favorite/rate-limited'});assert.equal([...store.values.values()][0].value.work,240);
});
test('request budget is independent of target budget',async()=>{
 const store=memory(),q=createQuota(store,()=>1000);for(let i=0;i<24;i++){const l=await q.acquire('caller',1);await q.release(l);}await assert.rejects(q.acquire('caller',1),{code:'favorite/rate-limited'});
});
test('unreleased leases outlive platform timeout without refunding work',async()=>{
 let time=1000;const store=memory(),q=createQuota(store,()=>time);await q.acquire('caller',10);await q.acquire('caller',10);time+=30001;await assert.rejects(q.acquire('caller',1),{code:'favorite/busy'});time+=30000;await q.acquire('caller',1);assert.equal([...store.values.values()][0].value.work,21);
});
test('quota failures and generation download races cannot reset quota',async()=>{
 const q=createQuota({read:async()=>{throw new Error('storage outage');}});await assert.rejects(q.acquire('caller',1));
 const gcs=createGcsQuotaStore({file:(_name,options)=>({getMetadata:async()=>[{generation:'2',size:'30'}],download:async()=>{assert.equal(options.generation,'2');throw Object.assign(new Error('gone'),{code:404});}})});await assert.rejects(gcs.read('a'.repeat(64)),{code:404});
});
test('production identity adapter reads exact scalars and fence existence only',async()=>{
 const paths=[],reader=createIdentityReader({ref:path=>({get:async()=>{paths.push(path);return{val:()=>null,exists:()=>false};}})});await reader.callerHandle('caller');await reader.targetUid('Exact');await reader.reverseHandle('target');await reader.isFenced('target');assert.deepEqual(paths,['authIndex/caller/username','users/Exact/authUid','authIndex/target/username','legacyIdentityFences/target']);
});
test('deadline stops scheduling target reads',async()=>{
 const f=identityFixture();let open=true,count=0;const original=f.reader.targetUid;f.reader.targetUid=async name=>{count++;if(name==='Target0')open=false;return original(name);};await assert.rejects(createIdentityResolver(f.reader)('caller',Array.from({length:50},(_,i)=>`Target${i}`),()=>open),{code:'favorite/unavailable'});assert.ok(count<50);
});
