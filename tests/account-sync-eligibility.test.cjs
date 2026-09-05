const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.join(__dirname,'..'),app=fs.readFileSync(path.join(root,'js/app/application.js'),'utf8');
function fixture(){
  const window={crypto:webcrypto},context=vm.createContext({window,Uint8Array,console});
  for(const name of ['accountSyncModel','accountSyncProduct'])vm.runInContext(fs.readFileSync(path.join(root,'js/domain',name+'.js'),'utf8'),context);
  const input={authenticatedUid:'normal-uid',username:'NormalTrainer',indexRecord:{username:'NormalTrainer'},userAuthUid:'normal-uid',account:null};
  const meta={schemaVersion:1,featureVersion:1,ownerUid:'normal-uid',initialized:true,initializedAt:1,updatedAt:2};
  return{context,api:window.PogoDomain.accountSyncProduct,input,meta};
}
test('normal reciprocal admission needs no canary membership and enrollment pause preserves initialized users',()=>{
  const {api,input,meta}=fixture();assert.equal(api.normalSyncEligibility(input).ok,true);
  assert.equal(api.normalSyncEligibility({...input,enrollmentEnabled:false}).error.code,'account-sync/enrollment-disabled');
  assert.equal(api.normalSyncEligibility({...input,account:{meta},enrollmentEnabled:false}).kind,'resume');
});
for(const [name,override] of Object.entries({
  'missing auth':{authenticatedUid:null},'wrong UID':{authenticatedUid:'another-uid'},
  'missing index':{indexRecord:null},'conflicting index':{indexRecord:{username:'SomeoneElse'}},
  'malformed index':{indexRecord:['NormalTrainer']},'coerced index':{indexRecord:{username:7}},
  'malformed user UID':{userAuthUid:{uid:'normal-uid'}},'unpaired user':{userAuthUid:null},
  'unsafe username':{username:'Normal/Trainer'},'coerced UID':{authenticatedUid:7},'malformed account':{account:[]}
}))test(`normal admission rejects ${name}`,()=>{
  const {api,input}=fixture();assert.equal(api.normalSyncEligibility({...input,...override}).ok,false);
});
for(const [name,override] of Object.entries({schema:{schemaVersion:2},owner:{ownerUid:'other'},feature:{featureVersion:2},timestamp:{updatedAt:0},extra:{unknown:true},initialization:{initialized:false}}))test(`canonical admission rejects incompatible ${name}`,()=>{
  const {api,input,meta}=fixture();assert.equal(api.normalSyncEligibility({...input,account:{meta:{...meta,...override}}}).ok,false);
});
function appFixture(){
  const f=fixture(),c=f.context,reads=[];
  Object.assign(c,{auth:{currentUser:{uid:'normal-uid'}},cur:'NormalTrainer',_sessionTransientGeneration:1,db:{},firebaseDataProtectionReady:true,
    ACCOUNT_SYNC_ROLLOUT:{enabled:true,writesEnabled:true,normalEnrollmentEnabled:true},ACCOUNT_SYNC_CANARY:{uidHashes:[]},
    accountSyncModel:c.window.PogoDomain.accountSyncModel,accountSyncProduct:f.api,providerOnlyIdentityActive:()=>false,withTimeout:async value=>value,ref:(_db,path)=>path,
    get:async path=>{reads.push(path);return{val:()=>path==='authIndex/normal-uid'?f.input.indexRecord:path==='users/NormalTrainer/authUid'?f.input.userAuthUid:f.input.account};}});
  vm.runInContext(app.slice(app.indexOf('async function accountSyncRolloutEligible('),app.indexOf('function accountSyncMigratedLegacyQueueItem(')),c);
  return{...f,c,reads};
}
test('application admission reads exact server identity and canonical paths without identity creation',async()=>{
  const {c,reads}=appFixture();assert.equal(await c.accountSyncCanaryMember(),false);assert.equal(await c.accountSyncRolloutEligible(),true);
  assert.deepEqual(reads,['authIndex/normal-uid','users/NormalTrainer/authUid','accountSync/normal-uid']);
  await assert.rejects(c.accountSyncRolloutEligible('client-selected-uid'),error=>error.code==='account-sync/identity-auth-required');assert.equal(reads.length,3);
});
for(const replacement of ['auth-object','generation','username'])test(`application admission rejects ${replacement} replacement even with an unchanged UID`,async()=>{
  const {c}=appFixture(),get=c.get;c.get=async path=>{const value=await get(path);if(replacement==='auth-object')c.auth.currentUser={uid:'normal-uid'};if(replacement==='generation')c._sessionTransientGeneration++;if(replacement==='username')c.cur='Other';return value;};
  await assert.rejects(c.accountSyncRolloutEligible(),error=>error.code==='account-sync/session-changed');
});
