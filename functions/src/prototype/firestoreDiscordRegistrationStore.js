'use strict';
const crypto=require('node:crypto');
const {fail}=require('../domain/errors');
const {fingerprint}=require('../domain/fingerprints');
const {normalizeHandle}=require('../../e1-authority-service/handleNormalization');
const {createFirestoreE1AuthorityAdapter}=require('../../e1-authority-service/firestoreE1AuthorityAdapter');
const HASH=/^[a-f0-9]{64}$/,SUBJECT=/^v1_discord_[a-f0-9]{64}$/;
// Private server dependency only. No public export or deployment activation.
function createFirestoreDiscordRegistrationStore({firestore,now=Date.now,randomBytes=crypto.randomBytes}={}){
  if(!firestore?.doc||!firestore?.runTransaction)throw new TypeError('Private Firestore required');
  const ref=hash=>{if(!HASH.test(hash||''))fail('invalid_argument','discord/registration_invalid');return firestore.doc(`discordRegistrationReviews/${hash}`);};
  const data=s=>s.exists?s.data():null;
  function checked(record,input,{allowCanceled=false}={}){
    if(!record||record.schemaVersion!==1||!/^discord_[A-Za-z0-9_-]{32}$/.test(record.uid||'')||!SUBJECT.test(record.providerSubjectKey||'')||
      record.requestId!==input.requestId||record.browserBindingHash!==input.browserBindingHash)fail('permission_denied','discord/registration_mismatch');
    if(!Number.isSafeInteger(record.expiresAt)||now()>=record.expiresAt)fail('stale_state','discord/registration_expired');
    if(record.status==='canceled'&&!allowCanceled)fail('stale_state','discord/registration_canceled');
    if(!['pending','complete',...(allowCanceled?['canceled']:[])].includes(record.status))fail('conflict','discord/registration_invalid');
    return record;
  }
  async function createReview(input){
    if(!HASH.test(input.browserBindingHash||'')||!SUBJECT.test(input.providerSubjectKey||'')||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.requestId||'')||!Number.isSafeInteger(input.expiresAt)||input.expiresAt<=now()||input.expiresAt>now()+300000)fail('invalid_argument','discord/registration_invalid');
    const uid=`discord_${randomBytes(24).toString('base64url')}`;
    return firestore.runTransaction(async tx=>{
      const target=ref(input.reviewHash),prior=await tx.get(target),subject=await tx.get(firestore.doc(`providerSubjects/${input.providerSubjectKey}`));
      if(prior.exists)fail('conflict','discord/registration_invalid');
      if(subject.exists)fail('conflict','provider/subject_already_linked');
      tx.create(target,{schemaVersion:1,uid,requestId:input.requestId,browserBindingHash:input.browserBindingHash,providerSubjectKey:input.providerSubjectKey,
        expiresAt:input.expiresAt,status:'pending',deleteAfter:new Date(input.expiresAt+300000)});
    });
  }
  async function confirm(input){
    if(input.reviewAccepted!==true)fail('permission_denied','discord/registration_review_required');
    let handle;try{handle=normalizeHandle(input.requestedHandle);}catch{fail('invalid_argument','discord/handle_invalid');}
    const target=ref(input.reviewHash),initial=checked(data(await target.get()),input),claimTarget=firestore.doc(`discordRegistrationClaims/${initial.uid}`);
    const identity={uid:initial.uid,canonicalTrainerName:handle.display,normalizedTrainerName:handle.normalized,handleKey:handle.handleKey,
      requestId:initial.requestId,providerKey:'discord',providerId:'discord.com',providerSubjectKey:initial.providerSubjectKey,providerSubjectKeyVersion:1};
    identity.fingerprint=fingerprint({operation:'registerDiscord',reviewHash:input.reviewHash,...identity});
    const adapter=createFirestoreE1AuthorityAdapter({now,firestore:{doc:path=>firestore.doc(path),runTransaction:work=>firestore.runTransaction(async tx=>{
      const current=checked(data(await tx.get(target)),input);
      const claim=data(await tx.get(claimTarget));
      if(current.status==='pending'&&claim)fail('conflict','discord/registration_claim_invalid');
      if(current.uid!==initial.uid||current.providerSubjectKey!==initial.providerSubjectKey)fail('stale_state','discord/registration_changed');
      if(current.status==='complete'){
        if(current.creationFingerprint!==identity.fingerprint)fail('replay_mismatch','discord/registration_changed');
        if(claim?.creationFingerprint!==identity.fingerprint)fail('conflict','discord/registration_claim_invalid');
        const reverse=data(await tx.get(firestore.doc(`providerSubjects/${initial.providerSubjectKey}`)));
        if(reverse?.state!=='claimed'||reverse.uid!==initial.uid||reverse.revision!==1)fail('stale_state','discord/provider_changed');
      }
      const result=await work(tx);
      tx.set(target,{...current,status:'complete',creationFingerprint:identity.fingerprint});
      if(!claim)tx.create(claimTarget,{schemaVersion:1,uid:initial.uid,providerSubjectKey:initial.providerSubjectKey,creationFingerprint:identity.fingerprint,state:'pending-auth',createdAt:now(),bootstrapExpiresAt:now()+300000,firstMintAt:null,activatedAt:null,authCreatedAt:null});
      return result;
    })}});
    const result=await adapter.createProviderAccountFoundation(identity);
    return{uid:initial.uid,providerSubjectKey:initial.providerSubjectKey,replay:result.replay===true,canonicalTrainerName:handle.display};
  }
  async function cancel(input){return firestore.runTransaction(async tx=>{
    const target=ref(input.reviewHash),record=checked(data(await tx.get(target)),input,{allowCanceled:true});
    if(record.status==='complete')return{status:'already-created'};
    if(record.status==='canceled')return{status:'canceled'};
    tx.set(target,{...record,status:'canceled'});return{status:'canceled'};
  });}
  function claimRef(uid){if(!/^[A-Za-z0-9_-]{6,128}$/.test(uid||''))fail('invalid_argument','discord/uid_invalid');return firestore.doc(`discordRegistrationClaims/${uid}`);}
  function validateClaim(claim,uid,subject){
    if(!claim||claim.schemaVersion!==1||claim.uid!==uid||claim.providerSubjectKey!==subject||!HASH.test(claim.creationFingerprint||'')||!['pending-auth','active-auth'].includes(claim.state)||!Number.isSafeInteger(claim.createdAt)||!Number.isSafeInteger(claim.bootstrapExpiresAt)||claim.bootstrapExpiresAt!==claim.createdAt+300000)fail('permission_denied','discord/registration_claim_invalid');
    if(claim.firstMintAt!==null&&(!Number.isSafeInteger(claim.firstMintAt)||claim.firstMintAt<Math.floor(claim.createdAt/1000)*1000||claim.firstMintAt>claim.bootstrapExpiresAt)||claim.state==='pending-auth'&&(claim.activatedAt!==null||claim.authCreatedAt!==null)||claim.state==='active-auth'&&(!Number.isSafeInteger(claim.firstMintAt)||!Number.isSafeInteger(claim.activatedAt)||!Number.isSafeInteger(claim.authCreatedAt)||claim.authCreatedAt<claim.firstMintAt||claim.authCreatedAt>claim.bootstrapExpiresAt))fail('permission_denied','discord/registration_claim_invalid');
  }
  async function authorizeMint({uid,providerSubjectKey,user,allowBootstrap=false}={}){return firestore.runTransaction(async tx=>{
    const target=claimRef(uid),claim=data(await tx.get(target));
    if(!claim){if(!user)fail('unauthenticated','discord/auth_user_missing');return null;}
    validateClaim(claim,uid,providerSubjectKey);
    if(claim.state==='active-auth'){
      if(!user||Date.parse(user.metadata?.creationTime)!==claim.authCreatedAt)fail('unauthenticated','discord/auth_user_changed');return null;
    }
    if(allowBootstrap!==true||now()<claim.createdAt||now()>=claim.bootstrapExpiresAt)fail('stale_state','discord/bootstrap_expired');
    if(user&&(!Number.isSafeInteger(claim.firstMintAt)||Date.parse(user.metadata?.creationTime)<claim.firstMintAt||!Number.isFinite(Date.parse(user.metadata?.creationTime))||user.email||user.phoneNumber||(user.providerData||[]).length))fail('conflict','discord/auth_uid_collision');
    // Firebase creationTime has whole-second precision. The first missing-user
    // observation must precede any allowed existing-user bootstrap retry.
    if(claim.firstMintAt===null)tx.set(target,{...claim,firstMintAt:Math.floor(now()/1000)*1000});
    return{discordBootstrap:claim.creationFingerprint};
  });}
  async function markAuthActivated({uid,providerSubjectKey,bootstrapProof,authCreatedAt}={}){return firestore.runTransaction(async tx=>{
    const target=claimRef(uid),claim=data(await tx.get(target));if(!claim)return;
    validateClaim(claim,uid,providerSubjectKey);
    if(!Number.isSafeInteger(authCreatedAt))fail('unauthenticated','discord/auth_user_changed');
    if(claim.state==='active-auth'){if(claim.authCreatedAt!==authCreatedAt)fail('unauthenticated','discord/auth_user_changed');return;}
    if(bootstrapProof!==claim.creationFingerprint||!Number.isSafeInteger(claim.firstMintAt)||authCreatedAt<claim.firstMintAt||authCreatedAt>claim.bootstrapExpiresAt)fail('permission_denied','discord/bootstrap_proof_required');
    tx.set(target,{...claim,state:'active-auth',activatedAt:now(),authCreatedAt});
  });}
  return Object.freeze({createReview,confirm,cancel,authorizeMint,markAuthActivated});
}
module.exports={createFirestoreDiscordRegistrationStore};
