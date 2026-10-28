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
    const target=ref(input.reviewHash),initial=checked(data(await target.get()),input);
    const identity={uid:initial.uid,canonicalTrainerName:handle.display,normalizedTrainerName:handle.normalized,handleKey:handle.handleKey,
      requestId:initial.requestId,providerKey:'discord',providerId:'discord.com',providerSubjectKey:initial.providerSubjectKey,providerSubjectKeyVersion:1};
    identity.fingerprint=fingerprint({operation:'registerDiscord',reviewHash:input.reviewHash,...identity});
    const adapter=createFirestoreE1AuthorityAdapter({now,firestore:{doc:path=>firestore.doc(path),runTransaction:work=>firestore.runTransaction(async tx=>{
      const current=checked(data(await tx.get(target)),input);
      if(current.uid!==initial.uid||current.providerSubjectKey!==initial.providerSubjectKey)fail('stale_state','discord/registration_changed');
      if(current.status==='complete'){
        if(current.creationFingerprint!==identity.fingerprint)fail('replay_mismatch','discord/registration_changed');
        const reverse=data(await tx.get(firestore.doc(`providerSubjects/${initial.providerSubjectKey}`)));
        if(reverse?.state!=='claimed'||reverse.uid!==initial.uid||reverse.revision!==1)fail('stale_state','discord/provider_changed');
      }
      const result=await work(tx);
      tx.set(target,{...current,status:'complete',creationFingerprint:identity.fingerprint});
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
  return Object.freeze({createReview,confirm,cancel});
}
module.exports={createFirestoreDiscordRegistrationStore};
