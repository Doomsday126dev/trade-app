const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ctx=vm.createContext({window:{},structuredClone,crypto:globalThis.crypto});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/domain/backgroundPersistence.js'),'utf8'),ctx);
const{createRepository}=ctx.BackgroundRepository;
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function fixture(protocol,readHead){const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};const open=()=>createRepository({uid:'owner',token:'bgs_'+'a'.repeat(32),protocol,readHead,storage,currentSession:()=>({uid:'owner',generation:1})});return{open,map};}
test('late hydration cannot erase a durable pending edit after an uncertain save',async()=>{
 const old=deferred(),save=deferred();let heads=0;const protocol={validate(){},read:async()=>[{note:'cloud'}],save:()=>save.promise};
 const f=fixture(protocol,()=>++heads===1?old.promise:Promise.resolve(0)),repo=f.open();const hydration=repo.hydrate(),write=repo.replace([{note:'new local note'}]);
 old.resolve(0);await hydration;assert.equal(repo.snapshot().pending.entries[0].note,'new local note');
 save.resolve({ok:false,code:'transport-unknown'});assert.equal((await write).ok,false);assert.equal(f.open().snapshot().pending.entries[0].note,'new local note');
 assert.equal(JSON.parse(repo.exportData({includePending:true})).backgroundRequests[0].note,'new local note');
});
test('late hydration cannot roll back a save that completed while reads were in flight',async()=>{
 const old=deferred();let heads=0;const f=fixture({validate(){},read:async()=>[{note:'cloud'}],save:async()=>({ok:true})},()=>++heads===1?old.promise:Promise.resolve(0));
 const repo=f.open(),hydration=repo.hydrate();assert.equal((await repo.replace([{note:'saved new note'}])).ok,true);old.resolve(0);await hydration;
 assert.equal(repo.snapshot().head,1);assert.equal(repo.snapshot().entries[0].note,'saved new note');assert.equal(f.open().snapshot().head,1);
});
test('an older hydration cannot replace the result of a newer head notification',async()=>{
 const old=deferred();let heads=0;const f=fixture({validate(){},read:async r=>[{note:r}]},()=>++heads===1?old.promise:Promise.resolve(2));
 const repo=f.open(),first=repo.hydrate();await repo.hydrate();old.resolve(1);await first;assert.equal(repo.snapshot().head,2);assert.equal(repo.snapshot().entries[0].note,'r2');
});
test('a pending edit created while snapshot rows load remains durable',async()=>{
 const rows=deferred(),saving=deferred();let reading=false;const f=fixture({validate(){},read:()=>{reading=true;return rows.promise;},save:()=>saving.promise},async()=>1);
 f.map.set('background-journal-v1:owner:bgs_'+'a'.repeat(32),JSON.stringify({head:1,entries:[{note:'cloud'}],pending:null}));
 const repo=f.open(),hydration=repo.hydrate();while(!reading)await Promise.resolve();const write=repo.replace([{note:'keep this draft'}]);rows.resolve([{note:'older cloud'}]);await hydration;
 assert.equal(f.open().snapshot().pending.entries[0].note,'keep this draft');saving.resolve({ok:false,code:'offline'});await write;assert.equal(repo.snapshot().pending.entries[0].note,'keep this draft');
});
test('a cloud-recovery read cannot discard an edit created after that choice began',async()=>{
 const old=deferred(),saving=deferred();let heads=0;const f=fixture({validate(){},read:async()=>[],save:()=>saving.promise},()=>++heads===1?old.promise:Promise.resolve(0));
 const repo=f.open(),recovery=repo.keepRemote(),write=repo.replace([{note:'new draft after recovery began'}]);old.resolve(0);assert.equal((await recovery).ok,false);
 saving.resolve({ok:false,code:'offline'});await write;assert.equal(f.open().snapshot().pending.entries[0].note,'new draft after recovery began');
});
