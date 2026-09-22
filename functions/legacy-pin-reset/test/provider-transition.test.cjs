'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAdapter}=require('../adapter');
const {createResetService}=require('../reset');
const {createJournal}=require('../journal');
const {randomUUID}=require('node:crypto');
const now=1800000000000,uid='trainer-uid',name='Trainer',key='v1_747261696e6572';
function fixture(){
  const documents={['accounts/'+uid]:{schemaVersion:1,uid,canonicalTrainerName:name,normalizedTrainerName:'trainer',handleKey:key,
    identityKind:'legacy_migrated',legacyAccessConfigured:true,legacyUsername:name,legacyAuthVersion:1,status:'active',revision:1,createdAt:1,updatedAt:1},
    ['trainerHandles/'+key]:{schemaVersion:1,uid,canonicalTrainerName:name,normalizedTrainerName:'trainer',state:'active',revision:1,claimedAt:1,updatedAt:1}};
  let conflict=false,mutations=0,password='123456',ledger={schemaVersion:1,records:[]},generation=1;
  const evidence={users:{Doomsday126:{authUid:'owner-uid',isAdmin:true},Trainer:{authUid:uid,authEmail:'trainer@pogotrades.nyc',authVersion:1}},
    loginDirectory:{Trainer:{authReady:true,authVersion:1}},authIndex:{'owner-uid':{username:'Doomsday126'},[uid]:{username:name}},admins:{'owner-uid':true}};
  const user={uid,email:'trainer@pogotrades.nyc',disabled:false,metadata:{creationTime:'2026-01-01T00:00:00Z'},
    providerData:[{providerId:'password',uid:'trainer@pogotrades.nyc'},{providerId:'google.com',uid:'synthetic-subject'}]};
  const firestore={doc:path=>({get:async()=>({exists:!!documents[path],data:()=>structuredClone(documents[path])})}),
    collection:()=>({limit:()=>({get:async()=>({empty:!conflict})})})};
  const adapter=createAdapter({firestore,database:{ref:path=>({get:async()=>({val:()=>evidence[path]??null})})},
    auth:{getUser:async id=>id==='owner-uid'?{uid:id,disabled:false}:structuredClone(user),listUsers:async()=>({users:[user]})},
    updatePassword:async(id,pin)=>{assert.equal(id,uid);mutations++;password=pin;}});
  const journal=createJournal({read:async()=>({generation,value:structuredClone(ledger)}),compareAndSwap:async(_generation,value)=>{ledger=structuredClone(value);generation++;}});
  const service=createResetService({adapter,journal,ownerUid:'owner-uid',hmacKey:'synthetic-key'.repeat(4),now:()=>now});
  const context={uid:'owner-uid',authTime:now/1000,appVerified:true};
  return{adapter,service,context,documents,user,evidence,setConflict:()=>{conflict=true;},mutations:()=>mutations,password:()=>password};
}
test('exact migrated legacy account with Google retains same-UID PIN reset without weakening obsolete-slot eligibility',async()=>{
  const f=fixture(),before=JSON.stringify([f.documents,f.evidence,f.user]);
  assert.equal(await f.adapter.legacyOnly(uid,name),false);
  const inspected=await f.service.run(f.context,{action:'inspect',username:name});
  const result=await f.service.run(f.context,{action:'reset',username:name,targetUid:uid,fingerprint:inspected.fingerprint,requestId:randomUUID(),pin:'654321'});
  assert.equal(result.status,'completed');assert.equal(f.mutations(),1);assert.equal(f.password(),'654321');
  assert.equal(JSON.stringify([f.documents,f.evidence,f.user]),before);
});
for(const [label,change] of [
  ['conflict',f=>f.setConflict()],['hold',f=>f.documents['trainerHandles/'+key].state='held'],
  ['wrong UID',f=>f.documents['trainerHandles/'+key].uid='other'],['missing account',f=>delete f.documents['accounts/'+uid]],
  ['provider only',f=>f.documents['accounts/'+uid].identityKind='provider_only'],
  ['retired PIN',f=>f.documents['accounts/'+uid].legacyAccessConfigured=false],
  ['wrong version',f=>f.documents['accounts/'+uid].legacyAuthVersion=2],
  ['removed password',f=>f.user.providerData=f.user.providerData.filter(p=>p.providerId!=='password')]
])test(`migrated reset rejects ${label} without mutation`,async()=>{
  const f=fixture();change(f);await assert.rejects(f.service.run(f.context,{action:'inspect',username:name}));assert.equal(f.mutations(),0);
});
test('canonical revision drift after inspection invalidates the reset fingerprint',async()=>{
  const f=fixture(),inspected=await f.service.run(f.context,{action:'inspect',username:name});
  f.documents['accounts/'+uid].updatedAt=2;
  await assert.rejects(f.service.run(f.context,{action:'reset',username:name,targetUid:uid,fingerprint:inspected.fingerprint,requestId:randomUUID(),pin:'654321'}),{code:'reset/stale-identity'});
  assert.equal(f.mutations(),0);
});
