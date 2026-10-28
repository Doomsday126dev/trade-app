'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(status,body){
 const window={},context=vm.createContext({window,AbortController,setTimeout,clearTimeout});
 for(const file of ['js/services/favoriteResolverClient.js','js/domain/productLimits.js','js/data/favoriteShareSessionCache.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
 let requests=0;
 const user={uid:'synthetic-owner',getIdToken:async()=> 'synthetic-token'};
 const client=window.PogoServices.favoriteResolverClient.createFavoriteResolverClient({auth:{currentUser:user},enabled:true,sessionCurrent:()=>true,
 appCheckReady:async()=>({ok:true,instance:{}}),loadAppCheckSdk:async()=>({getLimitedUseToken:async()=>({token:'synthetic-app-token'})}),
 fetch:async()=>{requests++;return{ok:status>=200&&status<300,status,text:async()=>body,headers:{get:name=>name==='Retry-After'?'7':null}};}});
 return{client,retryable:window.PogoData.favoriteShareSessionCache.retryableReadError,requests:()=>requests};
}
for(const [status,body] of [[500,''],[502,'Bad Gateway'],[503,'<html>Service Unavailable</html>'],[504,'Gateway Timeout']])test(`non-JSON HTTP${status} is retryable without an internal replay`,async()=>{
 const f=fixture(status,body);await assert.rejects(f.client.resolve(['SyntheticTarget']),error=>error.code==='favorite/unavailable'&&f.retryable(error));assert.equal(f.requests(),1);
});
for(const status of [200,400,401,403,404,429])test(`malformed HTTP${status} keeps response validation fail-closed`,async()=>{
 const f=fixture(status,'<html>not the contract</html>');await assert.rejects(f.client.resolve(['SyntheticTarget']),error=>error.code==='favorite/response-invalid'&&!f.retryable(error));assert.equal(f.requests(),1);
});
for(const [status,code] of [[401,'favorite/auth-required'],[403,'favorite/caller-unavailable'],[429,'favorite/rate-limited'],[429,'favorite/busy'],[503,'favorite/not-enabled'],[503,'favorite/quota-unavailable'],[503,'favorite/unavailable']])test(`HTTP${status} preserves structured ${code}`,async()=>{
 const f=fixture(status,JSON.stringify({code}));await assert.rejects(f.client.resolve(['SyntheticTarget']),error=>error.code===code&&error.retryAfter===7);assert.equal(f.requests(),1);
});
test('oversized infrastructure response is still rejected',async()=>{
 const f=fixture(503,'x'.repeat(32769));await assert.rejects(f.client.resolve(['SyntheticTarget']),{code:'favorite/response-invalid'});assert.equal(f.requests(),1);
});
test('malformed successful identity response cannot become a resolved identity',async()=>{
 const f=fixture(200,JSON.stringify({version:1,results:[{handle:'WrongTarget',status:'resolved',targetUid:'other',canonicalHandle:'WrongTarget'}]}));await assert.rejects(f.client.resolve(['SyntheticTarget']),{code:'favorite/response-invalid'});
});
