'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const enabled=process.env.POGO_FAVORITES_EMULATORS==='1';
const {PROJECT,createServer}=enabled?require('./support/favoriteResolverEmulator.cjs'):{PROJECT:'demo-pogo-saving-incident'};
const namespace=PROJECT+'-default-rtdb';
async function req(p,method='GET',body,token){const r=await fetch(`http://127.0.0.1:9500/${p}.json?ns=${namespace}${token?'&auth='+token:''}`,{method,headers:{'content-type':'application/json',...(!token?{authorization:'Bearer owner'}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,value:await r.json()};}
async function authUser(name){const r=await fetch('http://127.0.0.1:9599/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:name.toLowerCase()+'@pogotrades.nyc',password:'834761',returnSecureToken:true})});assert.equal(r.status,200);return r.json();}
async function fixture(count=2){
 assert.equal((await req('.settings/rules','PUT',JSON.parse(readFileSync(path.join(__dirname,'firebase/database.rules.favorite-resolver.json'))))).status,200);
 const suffix=Date.now().toString(36)+Math.random().toString(36).slice(2,6),name='Owner'+suffix,account=await authUser(name),targets=[];
 await req('users/'+name,'PUT',{authUid:account.localId,authVersion:1});await req('authIndex/'+account.localId,'PUT',{username:name});
 for(let i=0;i<count;i++){const handle='Target'+suffix+'x'+i,record=await authUser(handle);targets.push({handle,uid:record.localId,token:record.idToken});await req('users/'+handle,'PUT',{authUid:record.localId,privateNote:'Never returned'});await req('authIndex/'+record.localId,'PUT',{username:handle});}
 return{name,uid:account.localId,token:account.idToken,targets};
}
async function call(server,f,handles,{token=f.token,appToken=server.token()}={}){const r=await fetch(server.url,{method:'POST',headers:{origin:'http://localhost:4188','content-type':'application/json',authorization:'Bearer '+token,'x-firebase-appcheck':appToken},body:JSON.stringify({handles})});return{status:r.status,value:await r.json()};}
function domains(){const window={crypto:webcrypto,btoa:v=>Buffer.from(v,'binary').toString('base64')};const context=vm.createContext({window,Uint8Array,unescape,encodeURIComponent,decodeURIComponent,console,setTimeout,clearTimeout});for(const name of ['js/domain/productLimits.js','js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/data/favoriteAdditionRepository.js'])vm.runInContext(readFileSync(path.join(__dirname,'..',name),'utf8'),context);return window;}
async function operation(w,owner,t,index=0){const result=await w.PogoDomain.accountSyncModel.createOperation({ownerUid:owner,entityType:'favorite',entityId:t.uid,identity:{targetUid:t.uid},kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{displayName:0},patch:{displayName:t.handle},clientAt:Date.now(),operationId:'op_'+String(index).padStart(20,'0')},{crypto:webcrypto});assert.equal(result.ok,true);return result.value;}
function repository(w,f,{beforeWrite,afterWrite}={}){
 return w.PogoData.favoriteAdditionRepository.createFavoriteAdditionRepository({repository:{},database:{},ownerUid:f.uid,enabled:true,ref:(_db,p='')=>p,serverTimestamp:()=>({'.sv':'timestamp'}),
 get:async p=>{const r=await req(p,'GET',undefined,f.token);assert.equal(r.status,200);return{exists:()=>r.value!==null,val:()=>r.value};},
 update:async(_p,value)=>{await beforeWrite?.(value);const r=await req('','PATCH',value,f.token);if(r.status!==200)throw Object.assign(new Error('permission denied'),{code:'PERMISSION_DENIED'});await afterWrite?.();}});
}
test('candidate handler verifies real ordinary Auth and exact bindings without private browser reads',{skip:!enabled},async()=>{
 const s=await createServer();try{const f=await fixture();for(const p of['users','authIndex','users/'+f.targets[0].handle,'authIndex/'+f.targets[0].uid])assert.equal((await req(p,'GET',undefined,f.token)).status,401);
 const r=await call(s,f,f.targets.map(t=>t.handle));assert.equal(r.status,200);assert.deepEqual(r.value.results.map(x=>x.targetUid),f.targets.map(x=>x.uid));assert.ok(!JSON.stringify(r.value).includes('privateNote'));
 const replay=s.token();assert.equal((await call(s,f,[f.targets[0].handle],{appToken:replay})).status,200);assert.equal((await call(s,f,[f.targets[0].handle],{appToken:replay})).status,401);
 assert.equal((await call(s,f,[f.targets[0].handle],{token:'invalid'})).status,401);assert.equal((await call(s,f,[f.targets[0].handle],{appToken:'invalid'})).status,401);
 await s.auth.updateUser(f.uid,{disabled:true});assert.equal((await call(s,f,[f.targets[0].handle])).status,401);
 }finally{await s.close();}
});
test('ordinary writes cannot remap a resolved binding, and a maintenance fence rejects addition at commit',{skip:!enabled},async()=>{
 const s=await createServer();try{const f=await fixture(),t=f.targets[0],w=domains();assert.equal((await call(s,f,[t.handle])).status,200);
 assert.equal((await req('users/'+t.handle+'/authUid','PUT','replacement',t.token)).status,401);
 await req('legacyIdentityFences/'+t.uid,'PUT',{state:'retired'});
 const r=await repository(w,f).applyOperation(await operation(w,f.uid,t,1));assert.equal(r.ok,false);assert.equal((await req('accountSync/'+f.uid+'/favorites/'+t.uid)).value,null);
 assert.equal((await call(s,f,[t.handle])).value.results[0].status,'unavailable');
 assert.equal((await req('legacyIdentityFences/'+t.uid,'GET',undefined,f.token)).status,401);
 }finally{await s.close();}
});
test('two independent devices at capacity commit exactly one new Favorite',{skip:!enabled},async()=>{
 const f=await fixture(2),w=domains(),records={};
 for(let i=0;i<99;i++){const t={uid:'existing-'+i,handle:'Existing'+i},op=await operation(w,f.uid,t,1000+i);records[t.uid]=w.PogoDomain.accountSyncMerge.mergeOperation(null,op,{acceptedAt:Date.now()}).value;}
 await req('accountSync/'+f.uid+'/favorites','PUT',records);
 let release,arrivals=0;const barrier=new Promise(r=>release=r);const beforeWrite=async()=>{if(arrivals<2){arrivals++;if(arrivals===2)release();await barrier;}};
 const results=await Promise.all(f.targets.map(async(t,i)=>repository(w,f,{beforeWrite}).applyOperation(await operation(w,f.uid,t,2000+i))));
 assert.equal(results.filter(x=>x.ok).length,1);assert.equal(results.find(x=>!x.ok).error.code,'account-sync/favorite-limit');
 const final=(await req('accountSync/'+f.uid+'/favorites')).value;assert.equal(Object.values(final).filter(x=>!x.deleted).length,100);assert.equal(Object.keys((await req('favoriteSlots/'+f.uid)).value).length,100);
});
test('ambiguous write readback preserves exact operation and retries do not duplicate it',{skip:!enabled},async()=>{
 const f=await fixture(1),w=domains(),op=await operation(w,f.uid,f.targets[0],3000),repo=repository(w,f,{afterWrite:()=>{throw Object.assign(new Error('response lost'),{code:'account-sync/network-failed'});}});
 assert.equal((await repo.applyOperation(op)).ok,true);assert.equal((await repo.applyOperation(op)).status,'idempotent');const value=(await req('accountSync/'+f.uid+'/favorites/'+f.targets[0].uid)).value;assert.equal(value.revision,1);assert.equal(value.lifecycleMutation,op.operationId);
 // An old completed add cannot resurrect a later deliberate deletion.
 const removed=await w.PogoDomain.accountSyncModel.createOperation({ownerUid:f.uid,entityType:'favorite',entityId:f.targets[0].uid,kind:'delete',baseGeneration:1,generation:2,baseFieldRevisions:{},patch:{},clientAt:Date.now()},{crypto:webcrypto});
 const tombstone=w.PogoDomain.accountSyncMerge.mergeOperation(value,removed.value,{acceptedAt:Date.now()}).value;assert.equal((await req('accountSync/'+f.uid+'/favorites/'+f.targets[0].uid,'PUT',tombstone,f.token)).status,200);
 assert.equal((await repo.applyOperation(op)).status,'conflict');assert.equal((await req('accountSync/'+f.uid+'/favorites/'+f.targets[0].uid)).value.deleted,true);
});
test('capacity slots cannot drop active membership or grant cross-account access',{skip:!enabled},async()=>{
 const f=await fixture(2),w=domains(),r=await repository(w,f).applyOperation(await operation(w,f.uid,f.targets[0],4000));assert.equal(r.ok,true);
 assert.equal((await req('favoriteSlots/'+f.uid+'/s0','DELETE',undefined,f.token)).status,401);
 assert.equal((await req('favoriteSlots/'+f.uid+'/s100','PUT',f.targets[0].uid,f.token)).status,401);
 assert.equal((await req('favoriteSlots/'+f.uid,'GET',undefined,f.targets[1].token)).status,401);
 assert.equal((await req('favoriteSlots/'+f.uid+'/s0','PUT',f.targets[1].uid,f.token)).status,401);
});
