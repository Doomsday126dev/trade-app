'use strict';
const {fail}=require('../domain/errors');
const {fingerprint}=require('../domain/fingerprints');
const HASH=/^[a-f0-9]{64}$/,UID=/^[A-Za-z0-9_-]{6,128}$/,REQUEST=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/,SUBJECT=/^v1_discord_[a-f0-9]{64}$/;
function check(value,pattern,reason){if(typeof value!=='string'||!pattern.test(value))fail('invalid_argument',reason);return value;}
function createFirestoreDiscordOAuthStore({firestore,now=Date.now}={}){
  if(!firestore?.doc||!firestore?.runTransaction)throw new TypeError('Private Firestore adapter required');
  const ref=(collection,id)=>firestore.doc(`${collection}/${id}`);
  const flowRef=hash=>ref('discordOAuthFlows',check(hash,HASH,'discord/state_invalid'));
  const reviewRef=hash=>ref('discordLinkReviews',check(hash,HASH,'discord/confirmation_invalid'));
  const accountRef=uid=>ref('accounts',check(uid,UID,'discord/uid_invalid'));
  const providerRef=uid=>firestore.doc(`accounts/${check(uid,UID,'discord/uid_invalid')}/providers/discord`);
  const subjectRef=key=>ref('providerSubjects',check(key,SUBJECT,'discord/subject_invalid'));
  const requestRef=(uid,id)=>firestore.doc(`operationRequests/${check(uid,UID,'discord/uid_invalid')}/requests/${check(id,REQUEST,'discord/request_invalid')}`);
  const data=snapshot=>snapshot.exists?snapshot.data():null;
  function timestamp(value){if(!Number.isSafeInteger(value)||value<0)fail('invalid_argument','discord/time_invalid');return value;}
  async function foundation(tx,uid){
    const account=data(await tx.get(accountRef(uid)));
    if(!account||account.schemaVersion!==1||account.uid!==uid||account.status!=='active'||!/^v1_[a-f0-9]{2,512}$/.test(account.handleKey||'')||!Number.isSafeInteger(account.revision)||account.revision<1)fail('permission_denied','identity/account_foundation_invalid');
    const handle=data(await tx.get(ref('trainerHandles',account.handleKey)));
    if(!handle||handle.schemaVersion!==1||handle.uid!==uid||handle.state!=='active'||handle.canonicalTrainerName!==account.canonicalTrainerName||handle.normalizedTrainerName!==account.normalizedTrainerName||!Number.isSafeInteger(handle.revision)||handle.revision<1)fail('permission_denied','identity/handle_ownership_invalid');
    return{account,handle,accountFingerprint:fingerprint({account,handle})};
  }
  function lifecycle(provider){
    if(!provider)return 0;
    if(!Number.isSafeInteger(provider.revision)||provider.revision<1||!['linked','unlinked'].includes(provider.state))fail('conflict','provider/link_state_invalid');
    return provider.revision;
  }
  async function readProviderLifecycle({uid}){return firestore.runTransaction(async tx=>{await foundation(tx,uid);return lifecycle(data(await tx.get(providerRef(uid))));});}
  async function readFoundation({uid}){return firestore.runTransaction(tx=>foundation(tx,uid));}
  async function consumeRateLimit({keyHash,action,timestamp:at,windowMs,limit}){
    check(keyHash,HASH,'discord/rate_key_invalid');timestamp(at);
    if(!['begin','complete','unlink'].includes(action)||!Number.isSafeInteger(windowMs)||windowMs<60_000||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('invalid_argument','discord/rate_key_invalid');
    return firestore.runTransaction(async tx=>{
      const target=ref('discordRateLimits',`${action}_${keyHash}`),current=data(await tx.get(target));
      if(current&&(!Number.isSafeInteger(current.startedAt)||!Number.isSafeInteger(current.count)||current.count<1||at<current.startedAt))fail('conflict','discord/rate_state_invalid');
      const same=current&&at-current.startedAt<windowMs,count=same?current.count:0,startedAt=same?current.startedAt:at;
      if(count>=limit)fail('unavailable','discord/rate_limited');
      tx.set(target,{schemaVersion:1,startedAt,count:count+1,deleteAfter:new Date(startedAt+windowMs*2)});
    });
  }
  async function createFlow(record){
    timestamp(record.createdAt);timestamp(record.expiresAt);
    if(record.expiresAt<=record.createdAt||record.expiresAt-record.createdAt>300_000||!HASH.test(record.browserBindingHash)||!['link','sign-in'].includes(record.operation)||!/^[A-Za-z0-9_-]{43}$/.test(record.codeVerifier))fail('invalid_argument','discord/flow_invalid');
    return firestore.runTransaction(async tx=>{
      const target=flowRef(record.stateHash);if((await tx.get(target)).exists)fail('replay_mismatch','discord/state_collision');
      tx.create(target,{...record,status:'pending',consumedAt:null,deleteAfter:new Date(record.expiresAt+300_000)});
    });
  }
  async function consumeFlow(input){return firestore.runTransaction(async tx=>{
    const target=flowRef(input.stateHash),record=data(await tx.get(target));timestamp(input.timestamp);
    if(!record)fail('permission_denied','discord/state_unknown');
    if(record.status!=='pending'||record.consumedAt!==null)fail('replay_mismatch','discord/state_replayed');
    if(input.timestamp>=record.expiresAt)fail('stale_state','discord/state_expired');
    if(record.browserBindingHash!==input.browserBindingHash)fail('permission_denied','discord/browser_binding_mismatch');
    if(record.requestId!==input.requestId)fail('replay_mismatch','idempotency/request_reused');
    if(record.redirectUri!==input.redirectUri)fail('permission_denied','discord/redirect_mismatch');
    const next={...record,status:'processing',consumedAt:input.timestamp};tx.set(target,next);return next;
  });}
  async function finishFlow({stateHash,status,reason,timestamp:at}){return firestore.runTransaction(async tx=>{
    const target=flowRef(stateHash),record=data(await tx.get(target));timestamp(at);
    if(!record||record.status!=='processing'||!['complete','failed'].includes(status))fail('conflict','discord/flow_state_invalid');
    const next={...record,status,completedAt:at,terminalReason:String(reason||'').slice(0,80)};delete next.codeVerifier;tx.set(target,next);
  });}
  async function createLinkReview(record){return firestore.runTransaction(async tx=>{
    const target=reviewRef(record.reviewHash);if((await tx.get(target)).exists)fail('conflict','discord/confirmation_invalid');
    check(record.providerSubjectKey,SUBJECT,'discord/subject_invalid');timestamp(record.expiresAt);
    if(record.expiresAt<=now()||record.expiresAt-now()>300_000||!HASH.test(record.browserBindingHash))fail('invalid_argument','discord/confirmation_invalid');
    const provider=data(await tx.get(providerRef(record.authority.uid))),reverse=data(await tx.get(subjectRef(record.providerSubjectKey)));
    if(!Number.isSafeInteger(record.providerLifecycleRevision)||record.providerLifecycleRevision!==lifecycle(provider))fail('stale_state','discord/provider_changed');
    tx.create(target,{...record,providerSubjectRevision:reverse?.revision||0,status:'pending',deleteAfter:new Date(record.expiresAt+300_000)});
  });}
  function exactReview(record,input){
    if(!record||record.expiresAt<=input.timestamp)fail('stale_state','discord/confirmation_expired');
    if(record.requestId!==input.requestId||record.browserBindingHash!==input.browserBindingHash)fail('permission_denied','discord/confirmation_mismatch');
    return record;
  }
  async function readLinkReview(input){return firestore.runTransaction(async tx=>exactReview(data(await tx.get(reviewRef(input.reviewHash))),input));}
  async function finishLinkReview(){/* The claim transaction already records completion. */}
  function coherent(provider,reverse,uid,key){
    if(!provider&&!reverse)return false;
    if(!provider||!reverse||provider.schemaVersion!==1||reverse.schemaVersion!==1||provider.state!=='linked'||reverse.state!=='claimed'||
      provider.provider!=='discord'||reverse.provider!=='discord'||provider.providerId!=='discord.com'||reverse.providerId!=='discord.com'||
      provider.providerSubjectKey!==key||reverse.providerSubjectKey!==key||reverse.uid!==uid||provider.revision!==reverse.revision||!Number.isSafeInteger(provider.revision)||provider.revision<1)fail('conflict','provider/link_state_invalid');
    return true;
  }
  async function linkSubjectAtomic(input){
    check(input.requestFingerprint,HASH,'discord/fingerprint_invalid');timestamp(input.timestamp);
    return firestore.runTransaction(async tx=>{
      const reviewTarget=reviewRef(input.reviewHash),review=data(await tx.get(reviewTarget));
      if(!review||review.expiresAt<=input.timestamp||review.requestId!==input.requestId||review.authority.uid!==input.uid||review.authority.accountFingerprint!==input.accountFingerprint||review.providerSubjectKey!==input.providerSubjectKey)fail('stale_state','discord/confirmation_expired');
      const accepted=await foundation(tx,input.uid);
      if(accepted.accountFingerprint!==input.accountFingerprint)fail('stale_state','discord/foundation_changed');
      const providerTarget=providerRef(input.uid),subjectTarget=subjectRef(input.providerSubjectKey),receiptTarget=requestRef(input.uid,input.requestId);
      const [provider,reverse,receipt]=await Promise.all([tx.get(providerTarget).then(data),tx.get(subjectTarget).then(data),tx.get(receiptTarget).then(data)]);
      if(receipt){
        if(receipt.operation!=='linkDiscordSubject'||receipt.fingerprint!==input.requestFingerprint||!['linked','already-linked'].includes(receipt.result?.status))fail('replay_mismatch','idempotency/request_reused');
        if(!coherent(provider,reverse,input.uid,input.providerSubjectKey)||receipt.result.providerLifecycleRevision!==provider.revision)fail('conflict','provider/link_state_invalid');return{status:receipt.result.status,replay:true};
      }
      if(!Number.isSafeInteger(review.providerLifecycleRevision)||review.providerLifecycleRevision!==lifecycle(provider))fail('stale_state','discord/provider_changed');
      if(reverse&&reverse.state!=='released'&&reverse.uid!==input.uid)fail('conflict','provider/subject_already_linked');
      if(review.providerSubjectRevision!==(reverse?.revision||0))fail('stale_state','discord/provider_changed');
      if(provider?.state==='linked'&&provider.providerSubjectKey!==input.providerSubjectKey)fail('conflict','provider/account_already_linked');
      if(reverse?.state==='released'&&reverse.uid!==input.uid){
        const old=data(await tx.get(providerRef(reverse.uid)));
        if(!old||!['linked','unlinked'].includes(old.state)||old.state==='linked'&&old.providerSubjectKey===input.providerSubjectKey)fail('conflict','provider/link_state_invalid');
      }
      let already=false;
      if(provider?.state==='linked'||reverse?.state==='claimed')already=coherent(provider,reverse,input.uid,input.providerSubjectKey);
      else if(provider&&provider.state!=='unlinked'||reverse&&reverse.state!=='released')fail('conflict','provider/link_state_invalid');
      const status=already?'already-linked':'linked';
      const revision=already?provider.revision:Math.max(provider?.revision||0,reverse?.revision||0)+1;
      if(!already){
        const base={schemaVersion:1,provider:'discord',providerId:'discord.com',providerSubjectKey:input.providerSubjectKey,providerSubjectKeyVersion:1,revision,linkedAt:input.timestamp,updatedAt:input.timestamp};
        tx.set(providerTarget,{...base,state:'linked'});tx.set(subjectTarget,{...base,uid:input.uid,state:'claimed'});
      }
      tx.create(receiptTarget,{schemaVersion:1,operation:'linkDiscordSubject',fingerprint:input.requestFingerprint,result:{status,providerLifecycleRevision:revision},createdAt:input.timestamp});
      tx.set(reviewTarget,{...review,status:'complete'});return{status,replay:false};
    });
  }
  async function resolveSubject({providerSubjectKey}){return firestore.runTransaction(async tx=>{
    const reverse=data(await tx.get(subjectRef(providerSubjectKey)));if(!reverse||reverse.state==='released')return null;
    await foundation(tx,reverse.uid);
    coherent(data(await tx.get(providerRef(reverse.uid))),reverse,reverse.uid,providerSubjectKey);
    return{uid:reverse.uid,mappingRevision:reverse.revision};
  });}
  async function readDiscordAccount({uid}){return firestore.runTransaction(async tx=>{
    const accepted=await foundation(tx,uid),provider=data(await tx.get(providerRef(uid)));
    if(!provider||provider.state!=='linked')fail('permission_denied','discord/provider_required');
    coherent(provider,data(await tx.get(subjectRef(provider.providerSubjectKey))),uid,provider.providerSubjectKey);
    return{...accepted,providerSubjectKey:provider.providerSubjectKey};
  });}
  async function unlinkSubjectAtomic(input){
    check(input.requestFingerprint,HASH,'discord/fingerprint_invalid');timestamp(input.timestamp);
    return firestore.runTransaction(async tx=>{
      const accepted=await foundation(tx,input.uid);
      if(accepted.accountFingerprint!==input.accountFingerprint)fail('stale_state','discord/foundation_changed');
      // The server verifier supplies exact, recent password-auth evidence, never a client boolean.
      if(input.alternateAccess?.kind!=='verified-legacy-password'||!Number.isSafeInteger(input.alternateAccess.verifiedAt)||input.alternateAccess.verifiedAt<0||input.alternateAccess.uid!==input.uid||input.alternateAccess.foundationFingerprint!==accepted.accountFingerprint||input.alternateAccess.verifiedAt>input.timestamp||input.timestamp-input.alternateAccess.verifiedAt>30_000)fail('permission_denied','discord/alternate_access_required');
      const providerTarget=providerRef(input.uid),receiptTarget=requestRef(input.uid,input.requestId);
      const provider=data(await tx.get(providerTarget)),receipt=data(await tx.get(receiptTarget));
      if(receipt){if(receipt.operation!=='unlinkDiscordSubject'||receipt.fingerprint!==input.requestFingerprint)fail('replay_mismatch','idempotency/request_reused');return{status:'unlinked',replay:true};}
      if(!provider||provider.state!=='linked'||provider.revision!==input.expectedProviderRevision)fail('conflict','discord/provider_changed');
      const subjectTarget=subjectRef(provider.providerSubjectKey),reverse=data(await tx.get(subjectTarget));coherent(provider,reverse,input.uid,provider.providerSubjectKey);
      const revision=provider.revision+1;
      tx.set(providerTarget,{...provider,state:'unlinked',revision,updatedAt:input.timestamp});
      tx.set(subjectTarget,{...reverse,state:'released',revision,updatedAt:input.timestamp});
      tx.create(receiptTarget,{schemaVersion:1,operation:'unlinkDiscordSubject',fingerprint:input.requestFingerprint,result:{status:'unlinked'},createdAt:input.timestamp});
      return{status:'unlinked',replay:false};
    });
  }
  return Object.freeze({readFoundation,readFoundationInTransaction:(tx,{uid})=>foundation(tx,uid),readProviderLifecycle,readDiscordAccount,consumeRateLimit,createFlow,consumeFlow,finishFlow,createLinkReview,readLinkReview,finishLinkReview,linkSubjectAtomic,resolveSubject,unlinkSubjectAtomic});
}
module.exports={createFirestoreDiscordOAuthStore};
