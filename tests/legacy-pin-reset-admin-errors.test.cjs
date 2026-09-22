'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const acorn=require('acorn');
const {createResetService}=require('../functions/legacy-pin-reset/reset');
const source=fs.readFileSync(path.join(__dirname,'../js/app/application.js'),'utf8');
const declaration=acorn.parse(source,{ecmaVersion:'latest',sourceType:'script'}).body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='legacyPinResetFailure');
const failure=vm.runInNewContext(`(${source.slice(declaration.start,declaration.end)})`);

test('owner-only error mapping distinguishes identity, eligibility, authorization and service failures',()=>{
  for(const [code,text] of [
    ['reset/identity-conflict','Account identity is inconsistent.'],
    ['reset/identity-not-legacy','Account is not eligible for legacy PIN reset.'],
    ['reset/legacy-credential-required','Account is not eligible for legacy PIN reset.'],
    ['reset/owner-required','Owner authorization could not be verified.'],
    ['functions/unauthenticated','Owner sign-in or app verification failed.'],
    ['reset/not-enabled','Reset service unavailable.']
  ]){
    const result=failure(code.startsWith('reset/')?{message:code,code:'functions/failed-precondition'}:{code});
    assert.equal(result.code,code);assert.ok(result.message.startsWith(text));
  }
  assert.doesNotMatch(failure({message:'reset/identity-conflict'}).message,/sign.in/i);
});

test('owner diagnostics never echo unknown SDK details, identifiers, credentials or prototype keys',()=>{
  for(const error of [null,{},new Error('SDK failure contains 001234 secret-token private-user-id'),{message:'constructor'},
    {message:'__proto__'},{message:'reset/identity-conflict 001234'},{message:'reset/unknown-internal-path'},
    {message:'reset/identity-conflict',code:'private-token'}]){
    const result=failure(error);
    assert.ok(['reset/unavailable','reset/identity-conflict'].includes(result.code));
    assert.doesNotMatch(JSON.stringify(result),/001234|secret-token|private-user-id|private-token|constructor|__proto__|unknown-internal-path/);
  }
});

function legacyV3Fixture({missingIndex=false,duplicateSlot=false,fences={}}={}){
  const now=1800000000000,uid='legacy-v3-target';
  const evidence={users:{Doomsday126:{authUid:'owner-uid',isAdmin:true},Trainer:{authUid:uid,authVersion:3,authEmail:'trainer_v3@pogotrades.nyc'}},
    admins:{'owner-uid':true},loginDirectory:{Trainer:{authReady:true,authVersion:3}},
    authIndex:{'owner-uid':{username:'Doomsday126'},...(missingIndex?{}:{[uid]:{username:'Trainer',authVersion:3}})}};
  let legacyReads=0,mutations=0,journalReads=0;const fenceReads=[];
  const service=createResetService({ownerUid:'owner-uid',hmacKey:'test-only'.repeat(8),now:()=>now,
    journal:{get:async()=>{journalReads++;throw Error('inspect must not read receipts');}},
    adapter:{readIdentityFence:async id=>{fenceReads.push(id);return structuredClone(fences[id]??null);},
      readEvidence:async()=>structuredClone(evidence),legacyOnly:async()=>true,legacyResetEvidence:async()=>{legacyReads++;return 'a'.repeat(64);},
      getAuthUser:async id=>id==='owner-uid'?{uid:id,disabled:false}:{uid,email:'trainer_v3@pogotrades.nyc',disabled:false,metadata:{creationTime:'2026-05-26T12:48:15.135Z'},providerData:[{providerId:'password',uid:'trainer_v3@pogotrades.nyc'}]},
      listAuthIdentities:async()=>[{uid,email:'trainer_v3@pogotrades.nyc',disabled:false},...(duplicateSlot?[{uid:'older-v2-target',email:'trainer_v2@pogotrades.nyc',disabled:false}]:[])],
      updatePassword:async()=>{mutations++;throw Error('No credential mutation permitted');}}});
  return{service,evidence,fenceReads,context:{uid:'owner-uid',authTime:now/1000,appVerified:true},counts:()=>({legacyReads,mutations,journalReads})};
}

test('Login ready v3 with absent reciprocal index fails before Firestore eligibility and never repairs identity',async()=>{
  const f=legacyV3Fixture({missingIndex:true,duplicateSlot:true}),before=structuredClone(f.evidence);
  await assert.rejects(f.service.run(f.context,{action:'inspect',username:'Trainer'}),{code:'reset/identity-conflict'});
  assert.deepEqual(f.fenceReads,['owner-uid','legacy-v3-target']);
  assert.deepEqual(f.counts(),{legacyReads:0,mutations:0,journalReads:0});assert.deepEqual(f.evidence,before);
});

test('a second enabled legacy Auth slot still fails when v3 reciprocity is present',async()=>{
  const f=legacyV3Fixture({duplicateSlot:true});
  await assert.rejects(f.service.run(f.context,{action:'inspect',username:'Trainer'}),{code:'reset/identity-conflict'});
  assert.deepEqual(f.fenceReads,['owner-uid','legacy-v3-target']);
  assert.deepEqual(f.counts(),{legacyReads:1,mutations:0,journalReads:0});
});

test('consistent existing v3 identity remains inspectable with recent owner auth',async()=>{
  const f=legacyV3Fixture(),result=await f.service.run(f.context,{action:'inspect',username:'Trainer'});
  assert.equal(result.targetUid,'legacy-v3-target');assert.equal(result.username,'Trainer');
  assert.deepEqual(f.fenceReads,['owner-uid','legacy-v3-target']);
  assert.deepEqual(f.counts(),{legacyReads:1,mutations:0,journalReads:0});
});

for(const [uid,code] of [['owner-uid','reset/owner-required'],['legacy-v3-target','reset/identity-conflict']]){
  test(`v3 inspection rejects a fenced ${uid} before eligibility or credential mutation`,async()=>{
    const f=legacyV3Fixture({fences:{[uid]:{state:'retired'}}});
    await assert.rejects(f.service.run(f.context,{action:'inspect',username:'Trainer'}),{code});
    assert.equal(f.fenceReads.at(-1),uid);
    assert.deepEqual(f.counts(),{legacyReads:0,mutations:0,journalReads:0});
  });
}
