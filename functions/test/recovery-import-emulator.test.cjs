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
 async function favoriteFixture(){
  const h=await fixture(),friend=await fixture(),retainedFriend=await fixture();
  async function entity(entityType,entityId,identity,patch,label){
   const operation=await model.createOperation({ownerUid:h.uid,entityType,entityId,identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:Object.fromEntries(Object.keys(patch).map(key=>[key,0])),patch,clientAt:10,operationId:`op_synthetic_${label}_12345678`});
   assert.equal(operation.ok,true,JSON.stringify(operation.error));const merged=merge.mergeOperation(null,operation.value,{acceptedAt:11});assert.equal(merged.status,'applied');return{id:`${entityType}:${entityId}`,value:JSON.parse(JSON.stringify(merged.value))};
  }
  const retained=[await entity('tag','tag_retained',{tagId:'tag_retained'},{label:'Retained'},'retained_tag'),await entity('favorite',retainedFriend.uid,{targetUid:retainedFriend.uid},{displayName:'Retained Friend','tagIds/tag_retained':true},'retained_favorite')];
  const additions=[await entity('tag','tag_imported',{tagId:'tag_imported'},{label:'Imported'},'imported_tag'),await entity('favorite',friend.uid,{targetUid:friend.uid},{displayName:'Imported Friend','tagIds/tag_imported':true,'tagIds/tag_retained':true},'imported_favorite')];
  const targetSections=JSON.parse(JSON.stringify(h.target.sections));targetSections.canonicalEntities.records=retained;targetSections.preferences.records=[{id:'existing-device',value:{theme:'dark'}}];
  h.target=await bundleModel.create({source:h.target.source,sections:targetSections});await db.doc(`recoveryImportSandboxes/${h.uid}`).set({bundle:JSON.parse(JSON.stringify(h.target)),sentinel:'preserve'});
  const sourceSections=JSON.parse(JSON.stringify(h.source.sections));sourceSections.canonicalEntities.records.push(...retained,...additions);h.source=await bundleModel.create({source:h.source.source,sections:sourceSections});
  return{...h,friend,retained,additions};
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
 await t.test('ordinary domain PATCH after import is changed content despite idempotent ADD replay',async()=>{
  const h=await fixture(),review=await h.api.prepare({sourceBundle:h.source},h.authContext),input={reviewId:review.reviewId,digest:review.digest,accepted:true};
  assert.equal((await h.api.confirm(input,h.authContext)).status,'verified');
  const target=db.doc(`recoveryImportSandboxes/${h.uid}`),data=(await target.get()).data(),row=data.bundle.sections.canonicalEntities.records[0],before=row.value;
  const patch=await model.createOperation({ownerUid:h.uid,entityType:before.entityType,entityId:before.entityId,kind:'patch',baseGeneration:before.generation,generation:before.generation,baseFieldRevisions:{priority:before.fieldRevisions[model.fieldMetadataPath(before.entityType,'priority')]},patch:{priority:'L'},clientAt:2000,operationId:'op_synthetic_owner_patch_1234'});
  assert.equal(patch.ok,true,JSON.stringify(patch.error));const updated=merge.mergeOperation(before,patch.value,{acceptedAt:Math.max(Date.now(),before.updatedAt+1)});assert.equal(updated.status,'applied');
  assert.equal(updated.value.lifecycleMutation,before.lifecycleMutation);assert.equal(updated.value.lifecycleMutationHash,before.lifecycleMutationHash);
  assert.equal(merge.mergeOperation(updated.value,review.plan.operations[0],{acceptedAt:2002}).status,'idempotent');
  row.value=JSON.parse(JSON.stringify(updated.value));data.bundle=JSON.parse(JSON.stringify(await bundleModel.create({source:data.bundle.source,sections:data.bundle.sections})));await target.set(data);
  const beforeRetry=JSON.stringify((await target.get()).data()),receiptRef=db.doc(`recoveryImportReceipts/${h.uid}/receipts/${review.reviewId}`),receiptBefore=JSON.stringify((await receiptRef.get()).data());
  const result=await make().confirm(input,h.authContext);assert.equal(result.status,'committed-content-changed');assert.equal(result.replay,true);
  assert.equal(JSON.stringify((await target.get()).data()),beforeRetry);assert.equal(JSON.stringify((await receiptRef.get()).data()),receiptBefore);
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

 await t.test('Favorite and tag transaction additions preserve existing entities, references and unrelated data on retry',async()=>{
  const h=await favoriteFixture(),review=await h.api.prepare({sourceBundle:h.source},h.authContext),input={reviewId:review.reviewId,digest:review.digest,accepted:true};
  assert.equal(JSON.stringify(review.plan.operations.map(row=>row.entityType)),JSON.stringify(['tag','favorite','tradeEntry']));
  const first=await h.api.confirm(input,h.authContext);assert.equal(first.status,'verified');const target=db.doc(`recoveryImportSandboxes/${h.uid}`),after=(await target.get()).data();
  assert.equal(after.bundle.sections.canonicalEntities.records.length,5);assert.equal(after.sentinel,'preserve');
  for(const row of h.retained)assert.deepEqual(after.bundle.sections.canonicalEntities.records.find(record=>record.id===row.id),row);
  const favorite=after.bundle.sections.canonicalEntities.records.find(row=>row.id===`favorite:${h.friend.uid}`).value;assert.equal(favorite.identity.targetUid,h.friend.uid);assert.deepEqual(favorite.values.tagIds,{tag_imported:true,tag_retained:true});
  for(const section of Object.keys(h.target.sections).filter(key=>key!=='canonicalEntities'))assert.deepEqual(after.bundle.sections[section],JSON.parse(JSON.stringify(h.target.sections[section])));
  const snapshot=JSON.stringify(after);assert.equal((await make().confirm(input,h.authContext)).status,'verified');assert.equal(JSON.stringify((await target.get()).data()),snapshot);assert.equal((await db.collection(`recoveryImportReceipts/${h.uid}/receipts`).get()).size,1);
 });
 await t.test('changed Favorite foundation between review and confirm rejects atomically and requires fresh review',async()=>{
  const h=await favoriteFixture(),review=await h.api.prepare({sourceBundle:h.source},h.authContext),input={reviewId:review.reviewId,digest:review.digest,accepted:true},target=db.doc(`recoveryImportSandboxes/${h.uid}`),before=JSON.stringify((await target.get()).data());
  const account=db.doc(`accounts/${h.friend.uid}`),foundation=(await account.get()).data();await account.set({...foundation,revision:foundation.revision+1});
  await assert.rejects(h.api.confirm(input,h.authContext),{code:'recovery/favorite-foundation-changed'});assert.equal(JSON.stringify((await target.get()).data()),before);assert.equal((await db.collection(`recoveryImportReceipts/${h.uid}/receipts`).get()).size,0);
  const fresh=await make().prepare({sourceBundle:h.source},h.authContext);assert.equal((await make().confirm({reviewId:fresh.reviewId,digest:fresh.digest,accepted:true},h.authContext)).status,'verified');
 });
 await t.test('unrelated post-import preferences do not invalidate exact imported entity readback',async()=>{
  const h=await fixture(),review=await h.api.prepare({sourceBundle:h.source},h.authContext),input={reviewId:review.reviewId,digest:review.digest,accepted:true};await h.api.confirm(input,h.authContext);
  const target=db.doc(`recoveryImportSandboxes/${h.uid}`),data=(await target.get()).data();data.bundle.sections.preferences.records=[{id:'owner-preference',value:{theme:'dark'}}];data.bundle=JSON.parse(JSON.stringify(await bundleModel.create({source:data.bundle.source,sections:data.bundle.sections})));await target.set(data);
  assert.equal((await make().confirm(input,h.authContext)).status,'verified');assert.deepEqual((await target.get()).data(),data);
 });

 await t.test('older receipts without exact entity evidence report committed but unverifiable without rewriting',async()=>{
  const h=await fixture(),review=await h.api.prepare({sourceBundle:h.source},h.authContext),input={reviewId:review.reviewId,digest:review.digest,accepted:true};await h.api.confirm(input,h.authContext);
  const receiptRef=db.doc(`recoveryImportReceipts/${h.uid}/receipts/${review.reviewId}`),receipt=(await receiptRef.get()).data();receipt.schemaVersion=1;delete receipt.entityDigests;await receiptRef.set(receipt);
  const target=db.doc(`recoveryImportSandboxes/${h.uid}`),before=(await target.get()).data();assert.equal((await make().confirm(input,h.authContext)).status,'committed-readback-unavailable');assert.deepEqual((await target.get()).data(),before);assert.deepEqual((await receiptRef.get()).data(),receipt);
 });

 await t.test('cross-UID recovery requires both fresh proofs and a single bound transfer grant',async()=>{
  const source=await fixture(),target=await fixture();
  const {createRecoveryTransferAuthorityEmulator}=require('../src/prototype/recoveryTransferAuthorityEmulator');
  const transfer=createRecoveryTransferAuthorityEmulator({enabled:true,firestore:db,authority,foundationStore:store});
  const api=createRecoveryImportEmulator({enabled:true,firestore:db,authority,foundationStore:store,bundleModel,dryRun,model,merge,transferAuthority:transfer});
  const grant=await transfer.prepare({sourceDigest:source.source.integrity.digest,accepted:true,sourceContext:source.authContext,targetContext:target.authContext});
  const context={...target.authContext,sourceContext:source.authContext};
  await assert.rejects(api.prepare({sourceBundle:source.source,transferGrant:grant.grantId},{...target.authContext,sourceContext:target.authContext}),{code:'recovery/transfer-owner-invalid'});
  const review=await api.prepare({sourceBundle:source.source,transferGrant:grant.grantId},context);
  assert.equal(review.plan.sameOwner,false);assert.equal(review.plan.operations[0].ownerUid,target.uid);
  const input={reviewId:review.reviewId,digest:review.digest,accepted:true};
  await assert.rejects(api.confirm(input,target.authContext),{code:'recovery/transfer-mismatch'});
  const original=JSON.stringify((await db.doc(`recoveryImportSandboxes/${source.uid}`).get()).data());
  assert.equal((await api.confirm(input,context)).status,'verified');assert.equal((await api.confirm(input,context)).replay,true);
  const after=(await db.doc(`recoveryImportSandboxes/${target.uid}`).get()).data().bundle;
  assert.equal(after.sections.canonicalEntities.records[0].value.ownerUid,target.uid);assert.equal(after.sections.permissions.records.length,0);assert.equal(after.sections.groups.records.length,0);
  assert.equal(JSON.stringify((await db.doc(`recoveryImportSandboxes/${source.uid}`).get()).data()),original);
  const proof=await transfer.proof({sourceContext:source.authContext,targetContext:target.authContext});
  await assert.rejects(db.runTransaction(tx=>transfer.check(tx,{grantId:grant.grantId,sourceUid:source.uid,targetUid:target.uid,sourceDigest:source.source.integrity.digest,proof,reviewId:'another-review'})),{code:'recovery/transfer-consumed'});
 });
 await t.test('cross-UID grant cannot authorize another bundle or a revoked source account',async()=>{
  const source=await fixture(),target=await fixture();
  const {createRecoveryTransferAuthorityEmulator}=require('../src/prototype/recoveryTransferAuthorityEmulator');
  const transfer=createRecoveryTransferAuthorityEmulator({enabled:true,firestore:db,authority,foundationStore:store});
  const api=createRecoveryImportEmulator({enabled:true,firestore:db,authority,foundationStore:store,bundleModel,dryRun,model,merge,transferAuthority:transfer});
  const grant=await transfer.prepare({sourceDigest:'a'.repeat(64),accepted:true,sourceContext:source.authContext,targetContext:target.authContext});
  await assert.rejects(api.prepare({sourceBundle:source.source,transferGrant:grant.grantId},{...target.authContext,sourceContext:source.authContext}),{code:'recovery/transfer-mismatch'});
  const correct=await transfer.prepare({sourceDigest:source.source.integrity.digest,accepted:true,sourceContext:source.authContext,targetContext:target.authContext});
  const context={...target.authContext,sourceContext:source.authContext},review=await api.prepare({sourceBundle:source.source,transferGrant:correct.grantId},context);
  await admin.updateUser(source.uid,{disabled:true});
  await assert.rejects(api.confirm({reviewId:review.reviewId,digest:review.digest,accepted:true},context));
  assert.equal((await db.doc(`recoveryImportSandboxes/${target.uid}`).get()).data().bundle.sections.canonicalEntities.records.length,0);
 });

 await t.test('typed profile, legacy content, device preferences and history restore additively with exact readback',async()=>{
  const h=await fixture(),{createRecoveryContentAdapters}=require('../src/prototype/recoveryContentAdapters');
  const contentAdapters=createRecoveryContentAdapters({model});
  const api=createRecoveryImportEmulator({enabled:true,firestore:db,authority,foundationStore:store,bundleModel,dryRun,model,merge,contentAdapters});
  const sections=JSON.parse(JSON.stringify(h.source.sections));sections.canonicalEntities.records=[];
  sections.profile.records=[{id:'legacy-profile',value:{friendCode:'0000 1111 2222',bio:'Preserved',specialTradeBoard:{lf:[],ft:[]}}}];
  sections.legacyLists.records=[{id:'remote',value:{wishlist:{Pikachu:'H'},dynamax:{},gmax:{},costumes:{}}},{id:'orders',value:{wishlist:['Pikachu']}}];
  sections.preferences.records=[{id:'device',value:{theme:'dark'}},{id:'history',value:{version:3,owner:{uid:h.uid,username:h.uid},favorites:[],snapshots:{public:{seenAt:123}},recent:[]}}];
  const source=await bundleModel.create({source:h.source.source,sections}),review=await api.prepare({sourceBundle:source},h.authContext),input={reviewId:review.reviewId,digest:review.digest,accepted:true};
  assert.equal(review.plan.content.additions.length,5);assert.equal((await api.confirm(input,h.authContext)).status,'verified');assert.equal((await api.confirm(input,h.authContext)).replay,true);
  const ref=db.doc(`recoveryImportSandboxes/${h.uid}`),data=(await ref.get()).data();assert.equal(data.bundle.sections.profile.records[0].value.bio,'Preserved');assert.equal(data.bundle.sections.preferences.records.find(row=>row.id==='device').value.theme,'dark');
  const profile=data.bundle.sections.profile.records[0];profile.value.bio='New owner edit';data.bundle=JSON.parse(JSON.stringify(await bundleModel.create({source:data.bundle.source,sections:data.bundle.sections})));await ref.set(data);
  assert.equal((await api.confirm(input,h.authContext)).status,'committed-content-changed');assert.equal((await ref.get()).data().bundle.sections.profile.records[0].value.bio,'New owner edit');
 });

 await t.test('unconsumed transfer expiry and source-foundation changes require a new authorization',async()=>{
  const source=await fixture(),target=await fixture();let clock=Date.now();
  const {createRecoveryTransferAuthorityEmulator}=require('../src/prototype/recoveryTransferAuthorityEmulator');
  const transfer=createRecoveryTransferAuthorityEmulator({enabled:true,firestore:db,authority,foundationStore:store,now:()=>clock});
  const proof=await transfer.proof({sourceContext:source.authContext,targetContext:target.authContext});
  const grant=await transfer.prepare({sourceDigest:source.source.integrity.digest,accepted:true,sourceContext:source.authContext,targetContext:target.authContext});
  clock+=300001;
  await assert.rejects(db.runTransaction(tx=>transfer.check(tx,{grantId:grant.grantId,sourceUid:source.uid,targetUid:target.uid,sourceDigest:source.source.integrity.digest,proof})),{code:'recovery/transfer-expired'});
  clock-=300001;
  const ref=db.doc(`accounts/${source.uid}`),prior=(await ref.get()).data();await ref.set({...prior,revision:prior.revision+1});
  await assert.rejects(db.runTransaction(tx=>transfer.check(tx,{grantId:grant.grantId,sourceUid:source.uid,targetUid:target.uid,sourceDigest:source.source.integrity.digest,proof})),{code:'recovery/stale-plan'});
 });

});
