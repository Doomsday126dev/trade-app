'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const {createRecoveryImportEmulator}=require('../src/prototype/recoveryImportEmulator'),{createFirestoreDiscordOAuthStore}=require('../src/prototype/firestoreDiscordOAuthStore'),{createDiscordAccessAuthority}=require('../src/prototype/discordAccessAuthority');
const enabled=process.env.DISCORD_FIRESTORE_EMULATOR==='1';
test('import executor is disabled by default and cannot target production',()=>{
 assert.equal(createRecoveryImportEmulator().available,false);assert.throws(()=>createRecoveryImportEmulator({enabled:true,firestore:{projectId:'trade-list-a4297'}}),{code:'recovery/emulator-only'});
});
test('server-authorized import stores durable receipts and verifies additive readback in the demo emulator',{skip:!enabled},async t=>{
 assert.equal(process.env.GCLOUD_PROJECT,'demo-pogo-discord');assert.match(process.env.FIRESTORE_EMULATOR_HOST,/^127\.0\.0\.1:\d+$/);assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST,/^127\.0\.0\.1:\d+$/);
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth');
 const app=initializeApp({projectId:'demo-pogo-discord'},`recovery-${Date.now()}`),db=getFirestore(app),admin=getAuth(app);t.after(async()=>{await db.terminate();await deleteApp(app);});
 const window={crypto:webcrypto,btoa},context=vm.createContext({window,TextEncoder,Uint8Array,JSON,Object,Number,Error,TypeError,URL});
 for(const file of['js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/dev/accountRecoveryBundle.js','js/dev/accountRecoveryDryRun.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../..',file),'utf8'),context);
 const model=window.PogoDomain.accountSyncModel,merge=window.PogoDomain.accountSyncMerge,bundleModel=window.PogoDev.accountRecoveryBundle.createAccountRecoveryBundle(),store=createFirestoreDiscordOAuthStore({firestore:db});
 const authority=createDiscordAccessAuthority({firebaseAuth:admin,store,projectId:'demo-pogo-discord',verifyLegacyBinding:async({uid,expectedUsername})=>({uid,username:expectedUsername,active:true})});
 const dryRun=window.PogoDev.accountRecoveryDryRun.createAccountRecoveryDryRun({bundleModel,resolveFavoriteTarget:async({expectedUid})=>({uid:(await store.readFoundation({uid:expectedUid})).account.uid})});
 const make=()=>createRecoveryImportEmulator({enabled:true,firestore:db,authority,foundationStore:store,bundleModel,dryRun,model,merge});
 let sequence=0;
 async function fixture(){
  const uid=`recovery_${Date.now()}_${++sequence}`,name=uid.toLowerCase(),handleKey=`v1_${Buffer.from(name).toString('hex')}`;
  await admin.createUser({uid});await db.doc(`accounts/${uid}`).set({schemaVersion:1,uid,status:'active',canonicalTrainerName:uid,normalizedTrainerName:name,handleKey,identityKind:'legacy_migrated',legacyAccessConfigured:true,legacyUsername:uid,revision:1});
  await db.doc(`trainerHandles/${handleKey}`).set({schemaVersion:1,uid,state:'active',canonicalTrainerName:uid,normalizedTrainerName:name,revision:1});
  const token=await admin.createCustomToken(uid),response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=synthetic-demo-api-key`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,returnSecureToken:true})});assert.equal(response.ok,true);const authContext={idToken:(await response.json()).idToken,lifecycleId:`life-${uid}`};
  const identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:25:base'},entityId=model.tradeEntryId(identity);
  const operation=(await model.createOperation({ownerUid:uid,entityType:'tradeEntry',entityId,identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},patch:{priority:'H'},clientAt:10,operationId:'op_synthetic_original_1234'})).value;
  const entity=merge.mergeOperation(null,operation,{acceptedAt:11}).value,sections=Object.fromEntries(window.PogoDev.accountRecoveryBundle.SECTIONS.map(key=>[key,{complete:true,records:[]} ]));
  const metadata={ownerUid:uid,trainerHandle:uid,capturedAt:1000,revision:'b'.repeat(64)},target=await bundleModel.create({source:metadata,sections});
  sections.canonicalEntities.records=[{id:`tradeEntry:${entityId}`,value:entity}];sections.permissions.records=[{id:'references',value:{isAdmin:true}}];sections.groups.records=[{id:'memberships',value:{syntheticGroup:{role:'owner'}}}];
  const source=await bundleModel.create({source:{...metadata,revision:'a'.repeat(64)},sections});
  await db.doc(`recoveryImportSandboxes/${uid}`).set({bundle:JSON.parse(JSON.stringify(target)),sentinel:'preserve'});
  return{uid,authContext,source,target,entityId,api:make()};
 }
 await t.test('explicit confirmation, concurrent replay and process restart preserve data without importing privileges',async()=>{
  const h=await fixture(),review=await h.api.prepare({sourceBundle:h.source},h.authContext),input={reviewId:review.reviewId,digest:review.digest,accepted:true};
  assert.ok(review.unsupportedSections.includes('permissions'));await assert.rejects(h.api.confirm({...input,accepted:false},h.authContext),{code:'recovery/explicit-review-required'});
  const results=await Promise.all([h.api.confirm(input,h.authContext),h.api.confirm(input,h.authContext)]);assert.ok(results.every(row=>row.status==='verified'));assert.equal(results.filter(row=>row.replay).length,1);
  assert.equal((await make().confirm(input,h.authContext)).replay,true);
  const data=(await db.doc(`recoveryImportSandboxes/${h.uid}`).get()).data();assert.equal(data.sentinel,'preserve');assert.equal(data.bundle.sections.canonicalEntities.records.length,1);assert.equal(data.bundle.sections.permissions.records.length,0);assert.equal(data.bundle.sections.groups.records.length,0);
  assert.equal((await db.collection(`recoveryImportReceipts/${h.uid}/receipts`).get()).size,1);
 });
 await t.test('wrong UID, edited review, changed target and revoked access cannot write',async()=>{
  const h=await fixture(),other=await fixture(),review=await h.api.prepare({sourceBundle:h.source},h.authContext),input={reviewId:review.reviewId,digest:review.digest,accepted:true};
  await assert.rejects(h.api.prepare({sourceBundle:h.source},other.authContext),{code:'recovery/identity-recovery-required'});
  await assert.rejects(h.api.confirm(input,other.authContext));await assert.rejects(h.api.confirm({...input,digest:'0'.repeat(64)},h.authContext),{code:'recovery/review-changed'});
  const changed=await bundleModel.create({source:{...h.target.source,revision:'c'.repeat(64)},sections:h.target.sections});await db.doc(`recoveryImportSandboxes/${h.uid}`).set({bundle:JSON.parse(JSON.stringify(changed))});await assert.rejects(h.api.confirm(input,h.authContext),{code:'recovery/stale-plan'});
  await admin.updateUser(other.uid,{disabled:true});await assert.rejects(other.api.prepare({sourceBundle:other.source},other.authContext));
  assert.equal((await db.collection(`recoveryImportReceipts/${h.uid}/receipts`).get()).size,0);
 });
 await t.test('readback detects content edited after commit and never overwrites it on retry',async()=>{
  const h=await fixture(),review=await h.api.prepare({sourceBundle:h.source},h.authContext),input={reviewId:review.reviewId,digest:review.digest,accepted:true};await h.api.confirm(input,h.authContext);
  const target=db.doc(`recoveryImportSandboxes/${h.uid}`),data=(await target.get()).data();data.bundle.sections.canonicalEntities.records=[];data.bundle=JSON.parse(JSON.stringify(await bundleModel.create({source:data.bundle.source,sections:data.bundle.sections})));await target.set(data);
  assert.equal((await make().confirm(input,h.authContext)).status,'committed-content-changed');assert.equal((await target.get()).data().bundle.sections.canonicalEntities.records.length,0);
 });
 await t.test('readback outage reports committed outcome and a retry verifies its durable receipt',async()=>{
  const h=await fixture(),review=await h.api.prepare({sourceBundle:h.source},h.authContext),input={reviewId:review.reviewId,digest:review.digest,accepted:true};
  let failReadback=false;
  const faultyDb={projectId:db.projectId,doc:path=>{
   const ref=db.doc(path);return path===`recoveryImportSandboxes/${h.uid}`?new Proxy(ref,{get(target,key){if(key==='get')return()=>{if(failReadback)throw Error('synthetic readback outage');return target.get();};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}}):ref;
  },runTransaction:async work=>{const result=await db.runTransaction(work);failReadback=true;return result;}};
  const api=createRecoveryImportEmulator({enabled:true,firestore:faultyDb,authority,foundationStore:store,bundleModel,dryRun,model,merge});
  const result=await api.confirm(input,h.authContext);assert.equal(result.status,'committed-readback-unavailable');assert.equal(result.operationIds.length,1);
  assert.equal((await make().confirm(input,h.authContext)).status,'verified');assert.equal((await db.collection(`recoveryImportReceipts/${h.uid}/receipts`).get()).size,1);
 });
 await t.test('unsupported-only bundles cannot create an import receipt or rewrite target data',async()=>{
  const h=await fixture(),sections=JSON.parse(JSON.stringify(h.source.sections));sections.canonicalEntities.records=[];
  const source=await bundleModel.create({source:h.source.source,sections});
  await assert.rejects(h.api.prepare({sourceBundle:source},h.authContext),{code:'recovery/no-supported-additions'});
  assert.equal((await db.doc(`recoveryImportSandboxes/${h.uid}`).get()).data().bundle.integrity.digest,h.target.integrity.digest);
  assert.equal((await db.collection(`recoveryImportReceipts/${h.uid}/receipts`).get()).size,0);
 });

});
