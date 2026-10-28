'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash,createHmac}=require('node:crypto');
const {createFirestoreDiscordOAuthStore}=require('../src/prototype/firestoreDiscordOAuthStore');
const {createDiscordOAuthPrototype}=require('../src/prototype/discordOAuthPrototype');
const NOW=1_800_000_000_000,hash=value=>createHash('sha256').update(value).digest('hex');
let sequence=0;
function fakeFirestore(){
  const docs=new Map();let tail=Promise.resolve();const snapshot=path=>({exists:docs.has(path),data:()=>structuredClone(docs.get(path))});
  const db={doc:path=>({path,get:async()=>snapshot(path),set:async value=>docs.set(path,structuredClone(value))}),runTransaction(work){
    const promise=tail.then(async()=>{const writes=[];let wrote=false;const result=await work({get:async ref=>{assert.equal(wrote,false,'Firestore reads precede writes');return snapshot(ref.path);},set:(ref,value)=>{wrote=true;writes.push([ref.path,structuredClone(value)]);},create:(ref,value)=>{assert.equal(docs.has(ref.path),false);wrote=true;writes.push([ref.path,structuredClone(value)]);}});for(const [path,value]of writes)docs.set(path,value);return result;});tail=promise.catch(()=>{});return promise;
  }};return db;
}
let realDb,app;
async function database(){
  if(process.env.DISCORD_FIRESTORE_EMULATOR!=='1')return fakeFirestore();
  if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||process.env.GCLOUD_PROJECT!=='demo-pogo-discord')throw Error('emulator-only');
  if(!realDb){const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');app=initializeApp({projectId:'demo-pogo-discord'},'discord-storage-proof');realDb=getFirestore(app);}return realDb;
}
test.after(async()=>{if(realDb)await realDb.terminate();if(app)await require('firebase-admin/app').deleteApp(app);});
async function harness(){
  const db=await database(),prefix=`discord${++sequence}x`,a=`${prefix}ownerA`,b=`${prefix}ownerB`,bindings=['a','b'].map(c=>Buffer.from(hash(prefix+c),'hex').toString('base64url'));
  for(const uid of[a,b]){
    const name=uid.toLowerCase(),handleKey=`v1_${Buffer.from(name).toString('hex')}`;
    await db.doc(`accounts/${uid}`).set({schemaVersion:1,uid,status:'active',canonicalTrainerName:uid,normalizedTrainerName:name,handleKey,identityKind:'legacy_migrated',legacyAccessConfigured:true,legacyUsername:uid,legacyAuthVersion:1,revision:1,createdAt:1,updatedAt:1});
    await db.doc(`trainerHandles/${handleKey}`).set({schemaVersion:1,uid,state:'active',canonicalTrainerName:uid,normalizedTrainerName:name,revision:1,claimedAt:1,updatedAt:1});
  }
  let clock=NOW,currentUid=a;
  const store=createFirestoreDiscordOAuthStore({firestore:db,now:()=>clock});
  const authority=async()=>currentUid?{uid:currentUid,lifecycleId:`lifecycle-${currentUid}`,accountFingerprint:(await store.readFoundation({uid:currentUid})).accountFingerprint,recentAuth:true}:null;
  const oauth=createDiscordOAuthPrototype({store,now:()=>clock,config:{clientId:'157730590492196864',clientSecret:'synthetic-client-secret',statePepper:'synthetic-state-pepper',subjectPepper:'synthetic-subject-pepper',redirectUri:'http://127.0.0.1:8886/callback'},discord:{exchangeCode:async({code})=>({accessToken:code,scope:'identify',tokenType:'Bearer'}),getCurrentUser:async({accessToken})=>({subject:accessToken.includes('other')?`803511102246${sequence}8913`:`803511102246${sequence}8912`,label:'SyntheticDiscord'}),revokeToken:async()=>{}},customTokenMinter:async uid=>`synthetic-token-${uid}`});
  async function review(label='first',index=0){const id=`${prefix}-request-${label}`,started=await oauth.begin({operation:'link',requestId:id,browserBinding:bindings[index],clientKey:bindings[index],currentAuthority:authority});const state=new URL(started.authorizeUrl).searchParams.get('state');const result=await oauth.complete({issuer:'https://discord.com',code:label.includes('other')?'synthetic-other-code':'synthetic-same-code',state,requestId:id,browserBinding:bindings[index],clientKey:bindings[index],observedRedirectUri:oauth.redirectUri,currentAuthority:authority});return{result,id,index};}
  async function confirm(value){return oauth.confirmLink({confirmationToken:value.result.confirmationToken,requestId:value.id,browserBinding:bindings[value.index],clientKey:bindings[value.index],currentAuthority:authority});}
  return{db,store,oauth,a,b,authority,review,confirm,setUid:uid=>{currentUid=uid;},advance:ms=>{clock+=ms;},get time(){return clock;}};
}
test('durable state survives a second adapter instance and consumes state once',async()=>{
  const h=await harness(),r=await h.review();const second=createFirestoreDiscordOAuthStore({firestore:h.db,now:()=>h.time});
  assert.equal((await second.readFoundation({uid:h.a})).account.uid,h.a);
  assert.equal((await h.confirm(r)).status,'linked');assert.equal((await h.confirm(r)).replay,true);
  const provider=(await h.db.doc(`accounts/${h.a}/providers/discord`).get()).data();
  assert.equal((await second.resolveSubject({providerSubjectKey:provider.providerSubjectKey})).uid,h.a);
  assert.equal(provider.state,'linked');
});
test('two competing account claims produce one exact UID and a no-mutation collision',async()=>{
  const h=await harness(),one=await h.review('first');await h.confirm(one);h.setUid(h.b);const two=await h.review('second',1);
  await assert.rejects(h.confirm(two),error=>error.reason==='provider/subject_already_linked');
  assert.equal((await h.db.doc(`accounts/${h.b}/providers/discord`).get()).exists,false);
});
test('foundation version and handle ownership are checked inside the claim transaction',async()=>{
  const h=await harness(),one=await h.review();const ref=h.db.doc(`accounts/${h.a}`),prior=(await ref.get()).data();await ref.set({...prior,revision:2});
  const reviewHash=createHmac('sha256','synthetic-state-pepper').update(`discord-oauth-state\0${one.result.confirmationToken}`).digest('hex');
  const review=(await h.db.doc(`discordLinkReviews/${reviewHash}`).get()).data();
  await assert.rejects(h.store.linkSubjectAtomic({uid:h.a,accountFingerprint:review.authority.accountFingerprint,providerSubjectKey:review.providerSubjectKey,requestId:one.id,requestFingerprint:hash('request'),reviewHash,timestamp:h.time}),error=>error.reason==='discord/foundation_changed');
  await assert.rejects(h.confirm(one),error=>error.reason==='discord/auth_lifecycle_changed');
  assert.equal((await h.db.doc(`accounts/${h.a}/providers/discord`).get()).exists,false);
});
test('unlink requires recent independently verified password fallback and preserves account identity',async()=>{
  const h=await harness(),r=await h.review();await h.confirm(r);
  const account=(await h.store.readFoundation({uid:h.a})),provider=(await h.db.doc(`accounts/${h.a}/providers/discord`).get()).data();
  const input={uid:h.a,accountFingerprint:account.accountFingerprint,expectedProviderRevision:provider.revision,requestId:`unlink-${h.a}`,requestFingerprint:hash('unlink'),timestamp:h.time};
  await assert.rejects(h.store.unlinkSubjectAtomic(input),error=>error.reason==='discord/alternate_access_required');
  input.alternateAccess={kind:'verified-legacy-password',uid:h.a,foundationFingerprint:account.accountFingerprint,verifiedAt:h.time};
  assert.equal((await h.store.unlinkSubjectAtomic(input)).status,'unlinked');assert.equal((await h.store.unlinkSubjectAtomic(input)).replay,true);
  assert.equal(await h.store.resolveSubject({providerSubjectKey:provider.providerSubjectKey}),null);
  assert.deepEqual((await h.store.readFoundation({uid:h.a})),account);
  h.setUid(h.b);const other=await h.review('reuse',1);await h.confirm(other);
  assert.equal((await h.store.resolveSubject({providerSubjectKey:provider.providerSubjectKey})).uid,h.b);
});
test('expired flow/review rows and exhausted shared rate windows cannot be reused across instances',async()=>{
  const h=await harness(),r=await h.review();h.advance(300000);await assert.rejects(h.confirm(r),error=>error.reason==='discord/confirmation_expired');
  const second=createFirestoreDiscordOAuthStore({firestore:h.db,now:()=>h.time}),keyHash=hash(h.a),args={keyHash,action:'begin',timestamp:h.time,windowMs:60000,limit:1};
  await h.store.consumeRateLimit(args);await assert.rejects(second.consumeRateLimit(args),error=>error.reason==='discord/rate_limited');
  await second.consumeRateLimit({...args,timestamp:h.time+60000});
});

test('emulator client rules deny direct access to private OAuth documents',{skip:process.env.DISCORD_FIRESTORE_EMULATOR!=='1'},async()=>{
  const h=await harness(),r=await h.review();
  const key=createHmac('sha256','synthetic-state-pepper').update(`discord-oauth-state\0${r.result.confirmationToken}`).digest('hex');
  const response=await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-pogo-discord/databases/(default)/documents/discordLinkReviews/${key}`);
  assert.equal(response.status,403);
});
test('concurrent claims across UIDs serialize to one owner, and an old confirmation cannot reconnect after unlink',async()=>{
  const h=await harness(),aReview=await h.review('race-a'),aAuthority=await h.authority();h.setUid(h.b);const bReview=await h.review('race-b',1),bAuthority=await h.authority();
  const bindings=['a','b'].map(c=>Buffer.from(hash(`discord${sequence}x`+c),'hex').toString('base64url'));
  const confirm=(value,authority)=>h.oauth.confirmLink({confirmationToken:value.result.confirmationToken,requestId:value.id,browserBinding:bindings[value.index],clientKey:bindings[value.index],currentAuthority:async()=>authority});
  const results=await Promise.allSettled([confirm(aReview,aAuthority),confirm(bReview,bAuthority)]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
  assert.equal(results.find(row=>row.status==='rejected').reason.reason,'provider/subject_already_linked');
  const winner=results[0].status==='fulfilled'?h.a:h.b,review=winner===h.a?aReview:bReview,current=winner===h.a?aAuthority:bAuthority,provider=(await h.db.doc(`accounts/${winner}/providers/discord`).get()).data();
  await h.store.unlinkSubjectAtomic({uid:winner,accountFingerprint:current.accountFingerprint,expectedProviderRevision:provider.revision,requestId:`unlink-race-${winner}`,requestFingerprint:hash('unlink-race'),timestamp:h.time,alternateAccess:{kind:'verified-legacy-password',uid:winner,foundationFingerprint:current.accountFingerprint,verifiedAt:h.time}});
  await assert.rejects(confirm(review,current),error=>error.reason==='provider/link_state_invalid');
  assert.equal(await h.store.resolveSubject({providerSubjectKey:provider.providerSubjectKey}),null);
});
test('an unconsumed review from before unlink cannot reconnect, while fresh explicit consent can',async()=>{
  const h=await harness(),first=await h.review('before-a'),pending=await h.review('before-b');await h.confirm(first);
  const authority=await h.authority(),provider=(await h.db.doc(`accounts/${h.a}/providers/discord`).get()).data();
  await h.store.unlinkSubjectAtomic({uid:h.a,accountFingerprint:authority.accountFingerprint,expectedProviderRevision:provider.revision,requestId:`unlink-second-${h.a}`,requestFingerprint:hash('unlink-second'),timestamp:h.time,alternateAccess:{kind:'verified-legacy-password',uid:h.a,foundationFingerprint:authority.accountFingerprint,verifiedAt:h.time}});
  await assert.rejects(h.confirm(pending),error=>error.reason==='discord/provider_changed');
  assert.equal(await h.store.resolveSubject({providerSubjectKey:provider.providerSubjectKey}),null);
  const fresh=await h.review('fresh-after-unlink');assert.equal((await h.confirm(fresh)).status,'linked');
});
test('confirm racing unlink never reconnects the method after the release transaction',async()=>{
  const h=await harness(),first=await h.review('race-initial');await h.confirm(first);
  const pending=await h.review('race-pending'),authority=await h.authority(),provider=(await h.db.doc(`accounts/${h.a}/providers/discord`).get()).data();
  const results=await Promise.allSettled([
    h.confirm(pending),
    h.store.unlinkSubjectAtomic({uid:h.a,accountFingerprint:authority.accountFingerprint,expectedProviderRevision:provider.revision,requestId:`unlink-consent-race-${h.a}`,requestFingerprint:hash('unlink-consent-race'),timestamp:h.time,alternateAccess:{kind:'verified-legacy-password',uid:h.a,foundationFingerprint:authority.accountFingerprint,verifiedAt:h.time}})
  ]);
  assert.equal(results[1].status,'fulfilled');if(results[0].status==='rejected')assert.equal(results[0].reason.reason,'discord/provider_changed');
  assert.equal(await h.store.resolveSubject({providerSubjectKey:provider.providerSubjectKey}),null);
});

test('Discord provider-only foundation is resolvable by the existing Discord sign-in store',async()=>{
  const db=await database(),n=++sequence,uid=`discord-new-${n}`,handle=`DiscordTrainer${n}`;
  const {createFirestoreE1AuthorityAdapter}=require('../e1-authority-service/firestoreE1AuthorityAdapter');
  const {normalizeHandle}=require('../e1-authority-service/handleNormalization');
  const normalized=normalizeHandle(handle),key=`v1_discord_${hash('new-discord-'+n)}`;
  await db.doc('authorityConfig/legacyProvisioningFreeze').set({schemaVersion:1,state:'active',provisioningModel:'bounded-legacy-provisioning-freeze',freezeId:'legacy-freeze-synthetic-0001',provisioningContractDigest:'d'.repeat(64),activatedAt:100,releasedAt:null});
  await db.doc('authorityConfig/providerAccountCreation').set({schemaVersion:2,state:'certified',provisioningModel:'bounded-legacy-provisioning-freeze',freezeId:'legacy-freeze-synthetic-0001',provisioningContractDigest:'d'.repeat(64),normalizationVersion:1,legacyNamespaceCoverageCertified:true,activeLegacyHandleCount:0,certifiedHandleCount:0,coverageDigest:'c'.repeat(64),inventoryCapturedAt:200,certifiedAt:300,expiresAt:10000});
  const adapter=createFirestoreE1AuthorityAdapter({firestore:db,now:()=>1000});
  const input={uid,canonicalTrainerName:normalized.display,normalizedTrainerName:normalized.normalized,handleKey:normalized.handleKey,requestId:`discord-create-${n}`,providerKey:'discord',providerId:'discord.com',providerSubjectKey:key,providerSubjectKeyVersion:1,fingerprint:hash('create-'+n)};
  await adapter.createProviderAccountFoundation(input);
  const store=createFirestoreDiscordOAuthStore({firestore:db,now:()=>1000});
  assert.equal((await store.resolveSubject({providerSubjectKey:key})).uid,uid);
});
