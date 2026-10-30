'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const ns='demo-pogo-background-reference-default-rtdb';
async function user(name){const r=await fetch('http://127.0.0.1:9319/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:name+'@example.test',password:'local-only-password',returnSecureToken:true})});assert.equal(r.status,200);return r.json();}
async function db(method,path,value,token){const r=await fetch('http://127.0.0.1:9220/'+path+'.json?ns='+ns+(token&&token!=='admin'?'&auth='+token:''),{method,headers:{'content-type':'application/json',...(token==='admin'?{authorization:'Bearer owner'}:{})},body:value===undefined?undefined:JSON.stringify(value)});return{status:r.status,value:await r.json()};}
const ok=r=>assert.equal(r.status,200,JSON.stringify(r));const denied=r=>assert.ok([401,403].includes(r.status),JSON.stringify(r));
test('current public reference only; owner retains bounded snapshots; draft and revocation fail closed',async()=>{
 const owner=await user('current-reference-owner'),stranger=await user('current-reference-stranger'),uid=owner.localId,token='bgs_'+'9'.repeat(32),store='backgroundStores/'+token;
 ok(await db('PUT','users/ReferenceTrainer',{authUid:uid},'admin'));ok(await db('PUT','authIndex/'+uid,{username:'ReferenceTrainer'},'admin'));
 ok(await db('PUT',store+'/ownerUid',uid,owner.idToken));ok(await db('PUT','backgroundOwnerIndex/'+uid+'/token',token,owner.idToken));
 const fs=require('node:fs'),vm=require('node:vm'),ctx={structuredClone,crypto:require('node:crypto').webcrypto};vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/domain/backgroundPersistence.js','utf8'),ctx);const {createProtocol}=ctx.BackgroundProtocol;const protocol=createProtocol({token,bounded:true,isEligible:()=>true,db:(m,p,v)=>db(m,p,v,owner.idToken)});const row=backgroundId=>({catalogId:'pokemon:25:standard:legacy:Pikachu',backgroundId,priority:'H',note:'public',gender:'',variant:'',shiny:false,lucky:false,xxl:false,xxs:false,quantity:1});
 assert.equal((await protocol.save(0,[row('a')])).ok,true);ok(await protocol.publish('r1'));ok(await db('PUT',store+'/visible',true,owner.idToken));
 denied(await db('GET',store+'/snapshots/r1'));denied(await db('GET',store+'/snapshots/r1',undefined,stranger.idToken));
 const share=r=>({version:3,backgroundRef:token,backgroundRevision:r,lists:{wishlist:{Pikachu:'H'}}});
 ok(await db('PUT','publicShares/ReferenceTrainer',share('r1'),owner.idToken));ok(await db('GET',store+'/snapshots/r1'));denied(await db('GET',store));denied(await db('GET',store+'/ownerUid'));
 assert.equal((await protocol.save(1,[row('b')])).ok,true);ok(await db('GET',store+'/snapshots/r1'));denied(await db('GET',store+'/snapshots/r2'));
 ok(await protocol.publish('r2'));denied(await db('GET',store+'/snapshots/r2'));ok(await db('PUT','publicShares/ReferenceTrainer',share('r2'),owner.idToken));
 ok(await db('GET',store+'/snapshots/r2'));denied(await db('GET',store+'/snapshots/r1'));ok(await db('GET',store+'/snapshots/r1',undefined,owner.idToken));
 denied(await db('GET',store+'/snapshots/r1',undefined,stranger.idToken));denied(await db('PUT','publicShares/ReferenceTrainer',{...share('r2'),backgroundRef:'bgs_'+'8'.repeat(32)},owner.idToken));
 ok(await db('PUT',store+'/visible',false,owner.idToken));denied(await db('GET',store+'/snapshots/r2'));ok(await db('GET',store+'/snapshots/r2',undefined,owner.idToken));
 ok(await db('PUT','publicShares/ReferenceTrainer',null,owner.idToken));denied(await db('GET',store+'/snapshots/r2'));
});
