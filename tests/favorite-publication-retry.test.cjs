const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('js/app/application.js','utf8');
const favorite={key:'retryfixture',displayName:'RetryFixture',targetUid:''};
const share=()=>({version:1,username:favorite.displayName,profile:{},lists:{wishlist:{Pikachu:'H'},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:100});
const flush=()=>new Promise(setImmediate);
function harness(read){
 const window={},c=vm.createContext({window,console,setTimeout,clearTimeout,queueMicrotask});
 for(const f of ['js/domain/productLimits.js','js/domain/publicSharePublication.js','js/data/favoriteShareSessionCache.js'])vm.runInContext(fs.readFileSync(f,'utf8'),c,{filename:f});
 const timers=new Map();let timerId=0;
 const cache=window.PogoData.favoriteShareSessionCache.createFavoriteShareSessionCache({repository:{read},validateProjection:window.PogoDomain.publicSharePublication.publicShareProjectionStatus,projectSnapshot:()=>[],setTimer:fn=>{timers.set(++timerId,fn);return timerId;},clearTimer:id=>timers.delete(id)});cache.activate({uid:'owner',username:'Owner'});
 const field={outerHTML:'field'},card={dataset:{trainer:favorite.displayName},isConnected:true,querySelector:()=>field};
 Object.assign(c,{auth:{currentUser:{uid:'owner'}},cur:'Owner',trainerDiscoveryMode:'favorites',activeTabName:()=> 'find',favoriteShareSessionCache:cache,ensureFavoriteShareSessionCache:()=>cache,ensureTrainerHistoryStore:()=>({read:()=>({favorites:[favorite]})}),favoritePublicationObserver:null,favoritePublicationRetries:new WeakMap(),canonicalTrainerName:name=>name,document:{querySelectorAll:()=>[card],activeElement:null},favoritePublicationHtml:()=> 'field',scheduleFavoritePublicationOrder:()=>{}});
 c.IntersectionObserver=function(callback){this.disconnect=()=>{};this.unobserve=()=>{};this.observe=target=>queueMicrotask(()=>callback([{isIntersecting:true,target}]));};
 vm.runInContext(app.slice(app.indexOf('function observeFavoritePublications('),app.indexOf('async function renderTrainerQuickLists(')),c);
 return{c,cache,enter:async()=>{c.observeFavoritePublications();await flush();},expire:async()=>{const values=[...timers.values()];timers.clear();values.forEach(fn=>fn());await flush();},used:()=>c.favoritePublicationRetries.get(cache)?.has(favorite.displayName)===true};
}
test('favorite/unavailable is already a transient retryable cache error',()=>{const h=harness(async()=>({ok:true,value:share()}));assert.equal(h.c.window.PogoData.favoriteShareSessionCache.retryableReadError({code:'favorite/unavailable'}),true);});
test('joining a pending physical request must not consume the one new-read retry',async()=>{
 let reads=0,finish;const h=harness(async()=>{reads++;if(reads===1)return new Promise(resolve=>finish=resolve);return{ok:true,value:share()};});
 await h.enter();assert.equal(reads,1);await h.expire();assert.equal(h.cache.peek(favorite).error.code,'favorite-cache/deadline-exceeded');
 await h.enter();assert.equal(reads,1);assert.equal(h.used(),false,'joining the first unresolved request is not a fresh request');
 finish({ok:false,error:{code:'favorite/unavailable'}});await flush();assert.equal(h.cache.peek(favorite).retryable,true);assert.equal(h.cache.snapshot().physicalReferences,0);
 await h.enter();assert.equal(reads,2);assert.equal(h.cache.peek(favorite).status,'published');assert.equal(h.cache.peek(favorite).updatedAt,100);
 await h.enter();assert.equal(reads,2);assert.equal(h.used(),true);
});
test('a completed service failure gets only one fresh retry, even after repeated re-entry',async()=>{let reads=0;const h=harness(async()=>{reads++;return{ok:false,error:{code:'favorite/unavailable'}};});await h.enter();await h.enter();for(let i=0;i<5;i++)await h.enter();assert.equal(reads,2);assert.equal(h.cache.peek(favorite).status,'transport_error');assert.equal(h.cache.peek(favorite).updatedAt,null);assert.equal(h.used(),true);});
