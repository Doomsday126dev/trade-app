'use strict';
const {randomUUID}=require('node:crypto');
const {fingerprint}=require('../domain/fingerprints');
const clone=value=>JSON.parse(JSON.stringify(value));
function fail(code){throw Object.assign(new Error(code),{code});}
// No production endpoint/export. Writes only bounded demo sandbox documents.
function createRecoveryImportEmulator({enabled=false,firestore,authority,foundationStore,bundleModel,dryRun,model,merge,now=Date.now}={}){
  if(!enabled)return Object.freeze({available:false});
  function environment(){
    if(process.env.GCLOUD_PROJECT!=='demo-pogo-discord'||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST||'')||firestore?.projectId!=='demo-pogo-discord')fail('recovery/emulator-only');
  }
  environment();
  if(!authority?.verify||!foundationStore?.readFoundationInTransaction||!bundleModel?.verify||!dryRun?.prepare||!model?.verifyOperation||!merge?.mergeOperation)throw new TypeError('Verified import dependencies required');
  const account=uid=>firestore.doc(`recoveryImportSandboxes/${uid}`);
  const reviewRef=(uid,id)=>firestore.doc(`recoveryImportReviews/${uid}/reviews/${id}`);
  const receiptRef=(uid,id)=>firestore.doc(`recoveryImportReceipts/${uid}/receipts/${id}`);
  async function verified(context){environment();const value=await authority.verify(context);if(!/^[A-Za-z0-9_-]{6,128}$/.test(value?.uid||'')||value.recentAuth!==true)fail('recovery/auth-required');return value;}
  function bounded(bundle){if(Buffer.byteLength(JSON.stringify(bundle))>128*1024)fail('recovery/sandbox-size-limit');}
  async function prepare({sourceBundle}={},context){
    const identity=await verified(context);bounded(sourceBundle);const source=clone(await bundleModel.verify(sourceBundle));
    if(source.source.ownerUid!==identity.uid)fail('recovery/identity-recovery-required');
    const snapshot=await account(identity.uid).get();if(!snapshot.exists)fail('recovery/sandbox-missing');
    const target=clone(await bundleModel.verify(snapshot.data().bundle));if(target.source.ownerUid!==identity.uid)fail('recovery/owner-mismatch');
    const plan=clone(await dryRun.prepare({sourceBundle:source,currentBundle:target,targetUid:identity.uid}));
    if(plan.operations.length===0)fail('recovery/no-supported-additions');
    if(plan.operations.length>50)fail('recovery/sandbox-operation-limit');
    const reviewId=randomUUID(),digest=fingerprint(plan),createdAt=now(),record={schemaVersion:1,uid:identity.uid,source,plan,digest,targetDigest:target.integrity.digest,foundationFingerprint:identity.accountFingerprint,createdAt,expiresAt:createdAt+300000,status:'review'};
    bounded(record);
    await firestore.runTransaction(async tx=>{
      const foundation=await foundationStore.readFoundationInTransaction(tx,{uid:identity.uid}),latest=await tx.get(account(identity.uid));
      if(foundation.accountFingerprint!==identity.accountFingerprint||!latest.exists||latest.data().bundle?.integrity?.digest!==record.targetDigest)fail('recovery/stale-plan');
      const favoriteFoundations={};
      for(const operation of plan.operations)if(operation.entityType==='favorite'){const target=await foundationStore.readFoundationInTransaction(tx,{uid:operation.identity.targetUid});favoriteFoundations[operation.identity.targetUid]=target.accountFingerprint;}
      const reviewed={...record,favoriteFoundations};bounded(reviewed);tx.create(reviewRef(identity.uid,reviewId),reviewed);
    });
    return{reviewId,digest,plan,expiresAt:record.expiresAt,unsupportedSections:Object.keys(source.sections).filter(key=>key!=='canonicalEntities')};
  }
  async function confirm({reviewId,digest,accepted=false}={},context){
    const identity=await verified(context);
    if(accepted!==true||!/^[a-f0-9-]{36}$/.test(reviewId||'')||!/^[a-f0-9]{64}$/.test(digest||''))fail('recovery/explicit-review-required');
    const result=await firestore.runTransaction(async tx=>{
      const foundation=await foundationStore.readFoundationInTransaction(tx,{uid:identity.uid});
      const [reviewSnap,currentSnap,receiptSnap]=await Promise.all([tx.get(reviewRef(identity.uid,reviewId)),tx.get(account(identity.uid)),tx.get(receiptRef(identity.uid,reviewId))]);
      if(!reviewSnap.exists||!currentSnap.exists)fail('recovery/review-missing');
      const review=reviewSnap.data(),current=clone(await bundleModel.verify(currentSnap.data().bundle));
      if(review.uid!==identity.uid||review.digest!==digest||fingerprint(review.plan)!==digest||review.foundationFingerprint!==foundation.accountFingerprint||identity.accountFingerprint!==foundation.accountFingerprint||current.source.ownerUid!==identity.uid)fail('recovery/review-changed');
      if(receiptSnap.exists){const receipt=receiptSnap.data();if(receipt.digest!==digest||receipt.uid!==identity.uid)fail('recovery/receipt-conflict');return{receipt,replay:true};}
      if(review.status!=='review'||review.expiresAt<=now()||current.integrity.digest!==review.targetDigest)fail('recovery/stale-plan');
      await dryRun.revalidate({plan:review.plan,sourceBundle:review.source,currentBundle:current,targetUid:identity.uid});
      // A valid but changed Favorite foundation also requires fresh review.
      for(const operation of review.plan.operations)if(operation.entityType==='favorite'){
        const target=await foundationStore.readFoundationInTransaction(tx,{uid:operation.identity.targetUid});
        if(review.favoriteFoundations?.[operation.identity.targetUid]!==target.accountFingerprint)fail('recovery/favorite-foundation-changed');
      }
      const entities=new Map(current.sections.canonicalEntities.records.map(row=>[row.id,row.value]));
      for(const operation of review.plan.operations){
        if(operation.ownerUid!==identity.uid||operation.kind!=='add'||!['tradeEntry','favorite','tag'].includes(operation.entityType)||(await model.verifyOperation(operation)).ok!==true)fail('recovery/operation-invalid');
        const key=`${operation.entityType}:${operation.entityId}`,prior=entities.get(key)||null;
        if(prior)fail('recovery/conflict-review-required');
        const merged=merge.mergeOperation(null,operation,{acceptedAt:now()});if(!merged.ok||merged.status!=='applied')fail('recovery/operation-invalid');entities.set(key,clone(merged.value));
      }
      const sections=clone(current.sections);sections.canonicalEntities.records=[...entities].map(([id,value])=>({id,value}));
      const bundle=clone(await bundleModel.create({source:{...current.source,revision:fingerprint(sections)},sections}));bounded(bundle);
      const entityDigests=review.plan.operations.map(operation=>{const id=`${operation.entityType}:${operation.entityId}`;return{id,digest:fingerprint(entities.get(id))};});
      const receipt={schemaVersion:2,entityDigests,uid:identity.uid,reviewId,digest,sourceDigest:review.source.integrity.digest,resultDigest:bundle.integrity.digest,operations:review.plan.operations,committedAt:now()};
      tx.set(account(identity.uid),{...currentSnap.data(),bundle});tx.create(receiptRef(identity.uid,reviewId),receipt);tx.set(reviewRef(identity.uid,reviewId),{...review,status:'applied'});
      return{receipt,replay:false};
    });
    // Read back canonical content after commit; a receipt alone is not proof of current content.
    const response={replay:result.replay,reviewId,operationIds:result.receipt.operations.map(value=>value.operationId),resultDigest:result.receipt.resultDigest};
    try{
      const after=await account(identity.uid).get(),bundle=after.exists?await bundleModel.verify(after.data().bundle):null;
      const current=new Map((bundle?.sections?.canonicalEntities?.records||[]).map(row=>[row.id,row.value]));
      // ADD replay only proves lifecycle idempotency: later PATCH operations
      // retain that marker. Compare the exact entities captured in the commit.
      const expected=result.receipt.entityDigests;
      if(result.receipt.schemaVersion!==2||!Array.isArray(expected)||expected.length!==result.receipt.operations.length||expected.some((entry,index)=>entry.id!==`${result.receipt.operations[index].entityType}:${result.receipt.operations[index].entityId}`||!/^[a-f0-9]{64}$/.test(entry.digest||'')))fail('recovery/readback-proof-unavailable');
      const verifiedReadback=bundle?.source.ownerUid===identity.uid&&expected.every(entry=>current.has(entry.id)&&fingerprint(current.get(entry.id))===entry.digest);
      return{...response,status:verifiedReadback?'verified':'committed-content-changed'};
    }catch{
      // The transaction is already committed. Retrying the same review reads its
      // receipt and verifies content; it never reapplies or overwrites changes.
      return{...response,status:'committed-readback-unavailable'};
    }
  }
  return Object.freeze({available:true,environment:'demo-emulator-only',prepare,confirm});
}
module.exports={createRecoveryImportEmulator};
