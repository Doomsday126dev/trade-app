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

async function registrationHarness({enabled=true,mint,minterFactory,at=NOW}={}){
  const db=await database(),n=++sequence;let clock=at,current=null,subject=`903511102246789${n}`;
  const binding=Buffer.from(hash(`registration-browser-${n}`),'hex').toString('base64url'),id=`discord-registration-${n}`;
  const freeze={schemaVersion:1,state:'active',provisioningModel:'bounded-legacy-provisioning-freeze',freezeId:'legacy-freeze-registration-0001',provisioningContractDigest:'d'.repeat(64),activatedAt:100,releasedAt:null};
  await db.doc('authorityConfig/legacyProvisioningFreeze').set(freeze);
  await db.doc('authorityConfig/providerAccountCreation').set({schemaVersion:2,state:'certified',provisioningModel:freeze.provisioningModel,freezeId:freeze.freezeId,provisioningContractDigest:freeze.provisioningContractDigest,normalizationVersion:1,legacyNamespaceCoverageCertified:true,activeLegacyHandleCount:0,certifiedHandleCount:0,coverageDigest:'c'.repeat(64),inventoryCapturedAt:200,certifiedAt:300,expiresAt:at+600000});
  const store=createFirestoreDiscordOAuthStore({firestore:db,now:()=>clock});
  const {createFirestoreDiscordRegistrationStore}=require('../src/prototype/firestoreDiscordRegistrationStore');
  const registrationStore=createFirestoreDiscordRegistrationStore({firestore:db,now:()=>clock});
  const config={clientId:'157730590492196864',clientSecret:'synthetic-client-secret',statePepper:'synthetic-state-pepper',subjectPepper:'synthetic-subject-pepper',redirectUri:'http://127.0.0.1:8886/callback'};
  const oauth=createDiscordOAuthPrototype({registrationEnabled:enabled,registrationStore,store,now:()=>clock,config,customTokenMinter:minterFactory?minterFactory({store,registrationStore}):mint||(async uid=>`synthetic-token-${uid}`),discord:{exchangeCode:async()=>({accessToken:'synthetic-access-token',scope:'identify',tokenType:'Bearer'}),getCurrentUser:async()=>({subject,label:'Synthetic Registration'}),revokeToken:async()=>{}}});
  const base={requestId:id,browserBinding:binding,clientKey:binding,currentAuthority:async()=>current};
  async function review(requestId=id){const args={...base,requestId},started=await oauth.begin({...args,operation:'sign-in'});return oauth.complete({...args,issuer:'https://discord.com',code:'synthetic-code',state:new URL(started.authorizeUrl).searchParams.get('state'),observedRedirectUri:config.redirectUri});}
  const token=await review();
  const input={...base,registrationToken:token.registrationToken,requestedHandle:`DiscordNew${n}`,reviewAccepted:true};
  return{db,n,oauth,store,registrationStore,token,input,review,confirm:extra=>oauth.confirmRegistration({...input,...extra}),cancel:()=>oauth.cancelRegistration(input),setCurrent:value=>{current=value;},advance:ms=>{clock+=ms;}};
}

test('registration is default-off and unknown identity creates only a review when enabled',async()=>{
  const off=await registrationHarness({enabled:false});assert.deepEqual(off.token,{ok:true,operation:'sign-in',status:'onboarding-required'});
  await assert.rejects(off.confirm(),error=>error.reason==='discord/registration_disabled');
  const h=await registrationHarness();assert.equal(h.token.status,'onboarding-required');assert.ok(h.token.registrationToken);assert.equal(Object.hasOwn(h.token,'uid'),false);
});
test('registration atomically claims identity and replay survives a lost mint response',async()=>{
  let calls=0;const h=await registrationHarness({mint:async uid=>{if(++calls===1)throw Error('synthetic mint unavailable');return`synthetic-token-${uid}`;}});
  await assert.rejects(h.confirm(),/synthetic mint unavailable/);
  const result=await h.confirm();assert.equal(result.replay,true);assert.equal(result.status,'account-created');
  const account=(await h.db.doc(`accounts/${result.uid}`).get()).data();assert.equal(account.identityKind,'provider_only');assert.equal(account.legacyAccessConfigured,false);assert.equal(account.legacyUsername,null);
  const after=await h.review(`discord-login-after-${h.n}`);assert.equal(after.status,'existing-account');assert.equal(after.uid,result.uid);
  const changed=await h.cancel();assert.equal(changed.status,'already-created');assert.equal((await h.db.doc(`accounts/${result.uid}`).get()).exists,true);
  await assert.rejects(h.confirm({requestedHandle:'DifferentHandle'}),error=>error.reason==='discord/registration_changed');
});
test('cancel before registration invalidates the review and never claims an account',async()=>{
  const h=await registrationHarness();assert.equal((await h.cancel()).status,'canceled');assert.equal((await h.cancel()).status,'canceled');
  await assert.rejects(h.confirm(),error=>error.reason==='discord/registration_canceled');
});
test('registration rejects absent consent, wrong browser, expired review and authenticated account switching',async()=>{
  const h=await registrationHarness();await assert.rejects(h.confirm({reviewAccepted:false}),error=>error.reason==='discord/registration_review_required');
  await assert.rejects(h.confirm({browserBinding:'z'.repeat(43)}),error=>error.reason==='discord/registration_mismatch');
  h.setCurrent({uid:'existing-owner'});await assert.rejects(h.confirm(),error=>error.reason==='discord/sign_in_requires_signed_out');
  h.setCurrent(null);h.advance(300000);await assert.rejects(h.confirm(),error=>error.reason==='discord/registration_expired');
});
test('trainer name collision does not consume review or overwrite the existing owner',async()=>{
  const h=await registrationHarness(),{normalizeHandle}=require('../e1-authority-service/handleNormalization');
  const key=normalizeHandle(h.input.requestedHandle).handleKey,target=h.db.doc(`trainerHandles/${key}`),original={uid:'existing-name-owner',state:'legacy_hold',revision:1};await target.set(original);
  await assert.rejects(h.confirm(),error=>error.reason==='discord/handle_conflict');assert.deepEqual((await target.get()).data(),original);
  assert.equal((await h.confirm({requestedHandle:`Alternative${h.n}`})).status,'account-created');
});
test('two registrations for one subject produce one UID without cross-account rebind',async()=>{
  const h=await registrationHarness(),secondId=`discord-second-${h.n}`,second=await h.review(secondId);
  const results=await Promise.allSettled([h.confirm(),h.confirm({requestId:secondId,registrationToken:second.registrationToken,requestedHandle:`SecondName${h.n}`})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.find(x=>x.status==='rejected').reason.reason,'provider/subject_already_linked');
});
test('cancel racing confirm either prevents all claims or reports the retained completed account',async()=>{
  const h=await registrationHarness(),results=await Promise.allSettled([h.confirm(),h.cancel()]);
  if(results[0].status==='fulfilled'){assert.equal(results[1].value.status,'already-created');assert.equal((await h.db.doc(`accounts/${results[0].value.uid}`).get()).exists,true);}
  else{assert.equal(results[0].reason.reason,'discord/registration_canceled');assert.equal(results[1].value.status,'canceled');}
});
test('registration requires current namespace certification before claiming any identity',async()=>{
  const h=await registrationHarness();await h.db.doc('authorityConfig/legacyProvisioningFreeze').set({state:'released'});
  await assert.rejects(h.confirm(),error=>error.code==='e1/legacy-namespace-not-certified');
});
test('new Discord registration creates the exact Firebase UID only after canonical claims',{skip:process.env.DISCORD_FIRESTORE_EMULATOR!=='1'},async()=>{
  const adminApp=require('firebase-admin/app'),adminAuth=require('firebase-admin/auth'),app=adminApp.initializeApp({projectId:'demo-pogo-discord'},`discord-registration-${Date.now()}`);
  try{
    const {createDiscordCandidateTokenMinter}=require('../src/prototype/discordCandidateComposition');
    const h=await registrationHarness({at:Date.now(),minterFactory:({store,registrationStore})=>createDiscordCandidateTokenMinter({enabled:true,allowBootstrap:true,firebaseAuth:adminAuth.getAuth(app),store,registrationStore})}),created=await h.confirm();
    await assert.rejects(adminAuth.getAuth(app).getUser(created.uid),error=>error.code==='auth/user-not-found');
    const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=synthetic-key`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:created.customToken,returnSecureToken:true})});
    assert.equal(response.status,200);const result=await response.json();assert.equal((await adminAuth.getAuth(app).getUser(created.uid)).uid,created.uid);
    const verified=await adminAuth.getAuth(app).verifyIdToken(result.idToken);assert.equal(verified.uid,created.uid);
    const {createDiscordAccessAuthority}=require('../src/prototype/discordAccessAuthority');
    const authority=createDiscordAccessAuthority({firebaseAuth:adminAuth.getAuth(app),store:h.store,projectId:'demo-pogo-discord',now:()=>Date.now(),onVerifiedAccountRead:input=>h.registrationStore.markAuthActivated(input),verifyLegacyBinding:async()=>{throw Error('new Discord account must not require legacy data');}});
    const read=await authority.readAccount({idToken:result.idToken,lifecycleId:'synthetic-registration-read'});
    assert.equal(read.foundation.canonicalTrainerName,created.canonicalTrainerName);assert.equal(read.foundation.identityKind,'provider_only');assert.equal(Object.hasOwn(read.foundation,'uid'),false);
    const claim=(await h.db.doc(`discordRegistrationClaims/${created.uid}`).get()).data();assert.equal(claim.state,'active-auth');
    const minter=createDiscordCandidateTokenMinter({enabled:true,allowBootstrap:true,firebaseAuth:adminAuth.getAuth(app),store:h.store,registrationStore:h.registrationStore});
    const mapped=await h.store.resolveSubject({providerSubjectKey:claim.providerSubjectKey});assert.equal(typeof await minter(created.uid,{providerSubjectKey:claim.providerSubjectKey,mappingRevision:mapped.mappingRevision}),'string');
    const providerRef=h.db.doc(`accounts/${created.uid}/providers/discord`),provider=(await providerRef.get()).data();
    await providerRef.set({...provider,state:'unlinked',revision:2});
    await assert.rejects(authority.readAccount({idToken:result.idToken,lifecycleId:'synthetic-registration-read'}),error=>error.reason==='discord/provider_required');
    await providerRef.set(provider);
    await adminAuth.getAuth(app).deleteUser(created.uid);await assert.rejects(minter(created.uid,{providerSubjectKey:claim.providerSubjectKey,mappingRevision:mapped.mappingRevision}),error=>error.reason==='discord/auth_user_changed');
    // Deleted established Auth users are never recreated by the minter.
    await assert.rejects(adminAuth.getAuth(app).getUser(created.uid),error=>error.code==='auth/user-not-found');

  }finally{await adminApp.deleteApp(app);}
});

test('first-signup minter requires a durable fresh claim, refuses collisions and never treats infrastructure failures as missing users',async()=>{
 const {createDiscordCandidateTokenMinter,createDiscordCandidateComposition}=require('../src/prototype/discordCandidateComposition');assert.equal(createDiscordCandidateComposition().available,false);
 let user=null,errorCode='auth/user-not-found',mints=0,drop=true,claims;
 const auth={getUser:async uid=>{if(!user)throw Object.assign(Error('synthetic'),{code:errorCode});return{...user,uid};},createCustomToken:async(uid,value)=>{mints++;claims=value;if(drop){drop=false;throw Error('mint response lost');}return`synthetic-custom-token-${uid}`;}};
 const h=await registrationHarness({minterFactory:({store,registrationStore})=>createDiscordCandidateTokenMinter({enabled:true,allowBootstrap:true,firebaseAuth:auth,store,registrationStore})});
 await assert.rejects(h.confirm(),/mint response lost/);const created=await h.confirm();assert.equal(mints,2);assert.match(claims.discordBootstrap,/^[a-f0-9]{64}$/);assert.equal(created.replay,true);
 const claimRef=h.db.doc(`discordRegistrationClaims/${created.uid}`),claim=(await claimRef.get()).data(),request={providerSubjectKey:claim.providerSubjectKey,mappingRevision:1};
 const minter=createDiscordCandidateTokenMinter({enabled:true,allowBootstrap:true,firebaseAuth:auth,store:h.store,registrationStore:h.registrationStore});
 errorCode='auth/internal-error';await assert.rejects(minter(created.uid,request),error=>error.code==='auth/internal-error');assert.equal(mints,2);errorCode='auth/user-not-found';
 await assert.rejects(minter(created.uid,{...request,mappingRevision:2}),error=>error.reason==='discord/mapping_changed');
 user={disabled:false,metadata:{creationTime:new Date(NOW-10000).toISOString()},providerData:[]};await assert.rejects(minter(created.uid,request),error=>error.reason==='discord/auth_uid_collision');
 user={disabled:true,metadata:{creationTime:new Date(NOW).toISOString()},providerData:[]};await assert.rejects(minter(created.uid,request),error=>error.reason==='discord/auth_invalid');user=null;
 h.advance(300000);await assert.rejects(minter(created.uid,request),error=>error.reason==='discord/bootstrap_expired');assert.equal(mints,2);
 await h.registrationStore.markAuthActivated({uid:created.uid,providerSubjectKey:claim.providerSubjectKey,bootstrapProof:claim.creationFingerprint,authCreatedAt:NOW});
 await assert.rejects(minter(created.uid,request),error=>error.reason==='discord/auth_user_changed');
});

test('default-off server composition qualifies the entire new-signup and returning-signin protocol',{skip:process.env.DISCORD_FIRESTORE_EMULATOR!=='1'},async()=>{
 const adminApp=require('firebase-admin/app'),adminAuth=require('firebase-admin/auth'),app=adminApp.initializeApp({projectId:'demo-pogo-discord'},`composition-${Date.now()}`);
 try{
   const {createDiscordCandidateComposition}=require('../src/prototype/discordCandidateComposition'),h=await registrationHarness({at:Date.now()}),auth=adminAuth.getAuth(app),binding=Buffer.from(hash('composition-'+h.n),'hex').toString('base64url'),origin='https://synthetic.example.test';
   const options={enabled:true,registrationEnabled:true,firestore:h.db,firebaseAuth:auth,projectId:'demo-pogo-discord',verifyLegacyBinding:async()=>{throw Error('no legacy account');},allowedOrigin:origin,verifyAppCheck:async value=>value==='synthetic-app-check',
     config:{clientId:'157730590492196864',clientSecret:'synthetic-client-secret',statePepper:'synthetic-state-pepper',subjectPepper:'synthetic-subject-pepper',redirectUri:'http://127.0.0.1:8886/callback'},discord:{exchangeCode:async()=>({accessToken:'synthetic-access',scope:'identify',tokenType:'Bearer'}),getCurrentUser:async()=>({subject:`7035111022467${String(h.n).padStart(5,'0')}`,label:'SyntheticComposition'}),revokeToken:async()=>{}}};
   assert.throws(()=>createDiscordCandidateComposition({...options,projectId:'wrong-project'}),/same explicit project/);const candidate=createDiscordCandidateComposition(options),context={origin,appCheckToken:'synthetic-app-check'},base={browserBinding:binding,lifecycleId:'composition-lifecycle'};
   const complete=async(id,service=candidate)=>{const begin=await service.invoke('begin',{...base,operation:'sign-in',requestId:id},context);assert.equal(typeof begin.authorizeUrl,'string');return service.invoke('complete',{...base,issuer:'https://discord.com',code:'synthetic-code',state:new URL(begin.authorizeUrl).searchParams.get('state'),requestId:id},context);};
   const review=await complete(`composition-new-${h.n}`);assert.equal(review.status,'onboarding-required');const created=await candidate.invoke('register',{...base,registrationToken:review.registrationToken,requestId:`composition-new-${h.n}`,requestedHandle:`ComposedTrainer${h.n}`,reviewAccepted:true},context);assert.equal(created.status,'account-created');
   await assert.rejects(auth.getUser(created.uid),error=>error.code==='auth/user-not-found');const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=synthetic-key`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:created.customToken,returnSecureToken:true})});assert.equal(response.status,200);const result=await response.json();assert.equal((await auth.verifyIdToken(result.idToken)).uid,created.uid);
   const read=await candidate.invoke('readAccount',base,{...context,idToken:result.idToken});assert.equal(read.ok,true);assert.equal(read.foundation.canonicalTrainerName,created.canonicalTrainerName);assert.equal((await h.db.doc(`discordRegistrationClaims/${created.uid}`).get()).data().state,'active-auth');
   const existingOnly=createDiscordCandidateComposition({...options,registrationEnabled:false}),signin=await complete(`composition-existing-${h.n}`,existingOnly);assert.equal(signin.status,'existing-account');assert.equal(signin.uid,created.uid);
   const privateRead=await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-pogo-discord/databases/(default)/documents/discordRegistrationClaims/${created.uid}`);assert.equal(privateRead.status,403);
 }finally{await adminApp.deleteApp(app);}
});
