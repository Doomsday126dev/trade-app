'use strict';
const {randomUUID}=require('node:crypto');
function fail(code){throw Object.assign(new Error(code),{code});}
// A file digest is not ownership proof. This demo-only transfer requires fresh
// verified control of BOTH UIDs at preparation and confirmation.
function createRecoveryTransferAuthorityEmulator({enabled=false,firestore,authority,foundationStore,now=Date.now}={}){
  if(!enabled)return Object.freeze({available:false});
  if(process.env.GCLOUD_PROJECT!=='demo-pogo-discord'||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST||'')||firestore?.projectId!=='demo-pogo-discord')fail('recovery/emulator-only');
  if(!authority?.verify||!foundationStore?.readFoundationInTransaction)throw new TypeError('Verified transfer dependencies required');
  const ref=id=>{if(!/^[a-f0-9-]{36}$/.test(id||''))fail('recovery/transfer-invalid');return firestore.doc(`recoveryTransferGrants/${id}`);};
  async function identities(sourceContext,targetContext){
    const source=await authority.verify(sourceContext),target=await authority.verify(targetContext);
    if(!source?.recentAuth||!target?.recentAuth||source.uid===target.uid)fail('recovery/transfer-owner-invalid');return{source,target};
  }
  async function prepare({sourceDigest,accepted=false,sourceContext,targetContext}={}){
    if(accepted!==true||!/^[a-f0-9]{64}$/.test(sourceDigest||''))fail('recovery/explicit-review-required');
    const {source,target}=await identities(sourceContext,targetContext),grantId=randomUUID(),expiresAt=now()+300000;
    await firestore.runTransaction(async tx=>{
      const a=await foundationStore.readFoundationInTransaction(tx,{uid:source.uid}),b=await foundationStore.readFoundationInTransaction(tx,{uid:target.uid});
      if(a.accountFingerprint!==source.accountFingerprint||b.accountFingerprint!==target.accountFingerprint)fail('recovery/stale-plan');
      tx.create(ref(grantId),{schemaVersion:1,sourceUid:source.uid,targetUid:target.uid,sourceDigest,sourceFoundation:a.accountFingerprint,targetFoundation:b.accountFingerprint,expiresAt,status:'prepared'});
    });return{grantId,sourceUid:source.uid,targetUid:target.uid,sourceDigest,expiresAt,requiresFreshSourceProof:true};
  }
  async function proof({sourceContext,targetContext}){return identities(sourceContext,targetContext);}
  async function check(tx,{grantId,sourceUid,targetUid,sourceDigest,proof:verified,reviewId}){
    const snap=await tx.get(ref(grantId));if(!snap.exists)fail('recovery/transfer-required');const grant=snap.data();
    if(grant.schemaVersion!==1||grant.sourceUid!==sourceUid||grant.targetUid!==targetUid||grant.sourceDigest!==sourceDigest||verified?.source?.uid!==sourceUid||verified?.target?.uid!==targetUid||grant.sourceFoundation!==verified.source.accountFingerprint||grant.targetFoundation!==verified.target.accountFingerprint)fail('recovery/transfer-mismatch');
    if(grant.status==='consumed'&&grant.reviewId!==reviewId)fail('recovery/transfer-consumed');
    if(!['prepared','consumed'].includes(grant.status)||grant.status==='prepared'&&grant.expiresAt<=now())fail('recovery/transfer-expired');
    const a=await foundationStore.readFoundationInTransaction(tx,{uid:sourceUid}),b=await foundationStore.readFoundationInTransaction(tx,{uid:targetUid});
    if(a.accountFingerprint!==grant.sourceFoundation||b.accountFingerprint!==grant.targetFoundation)fail('recovery/stale-plan');return grant;
  }
  function consume(tx,grantId,grant,reviewId){tx.set(ref(grantId),{...grant,status:'consumed',reviewId});}
  return Object.freeze({available:true,prepare,proof,check,consume});
}
module.exports={createRecoveryTransferAuthorityEmulator};
