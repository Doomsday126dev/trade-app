'use strict';
const {fail}=require('../domain/errors');
const {fingerprint}=require('../domain/fingerprints');
function createDiscordAccessAuthority({firebaseAuth,store,verifyLegacyBinding,projectId,now=Date.now,onVerifiedAccountRead=async()=>{}}={}){
  if(!firebaseAuth?.verifyIdToken||!firebaseAuth?.getUser||!store?.readFoundation||typeof verifyLegacyBinding!=='function'||!/^[-a-z0-9]+$/.test(projectId||''))throw new TypeError('Verified Discord authority dependencies required');
  async function verified({idToken,lifecycleId,requirePassword=false,requireRecent=true}){
    if(typeof idToken!=='string'||idToken.length>16384||!/^[A-Za-z0-9._:-]{8,160}$/.test(lifecycleId||''))fail('unauthenticated','discord/auth_required');
    let claims,user;try{claims=await firebaseAuth.verifyIdToken(idToken,true);user=await firebaseAuth.getUser(claims.uid);}catch{fail('unauthenticated','discord/auth_invalid');}
    const at=now(),authAt=claims.auth_time*1000;
    if(!claims.uid||claims.sub!==claims.uid||claims.aud!==projectId||claims.iss!==`https://securetoken.google.com/${projectId}`||user.uid!==claims.uid||user.disabled===true||!Number.isSafeInteger(claims.exp)||!Number.isSafeInteger(at)||!Number.isSafeInteger(authAt)||authAt>at||(requireRecent&&at-authAt>600000)||claims.exp*1000<=at)fail('unauthenticated','discord/recent_auth_required');
    const revokedAt=Date.parse(user.tokensValidAfterTime||'');
    if(Number.isFinite(revokedAt)&&authAt<revokedAt)fail('unauthenticated','discord/auth_invalid');
    if(requirePassword&&(claims.firebase?.sign_in_provider!=='password'||!user.providerData?.some(provider=>provider.providerId==='password')))fail('permission_denied','discord/alternate_access_required');
    const foundation=await store.readFoundation({uid:claims.uid});
    if(foundation.account.identityKind==='legacy_migrated'||foundation.account.legacyAccessConfigured===true){
      const binding=await verifyLegacyBinding({uid:claims.uid,expectedUsername:foundation.account.legacyUsername,idToken});
      if(binding?.uid!==claims.uid||binding.username!==foundation.account.legacyUsername||binding.active!==true)fail('permission_denied','discord/legacy_binding_invalid');
    }else if(requirePassword)fail('permission_denied','discord/alternate_access_required');
    return{uid:claims.uid,lifecycleId,accountFingerprint:foundation.accountFingerprint,recentAuth:true,verifiedAt:at,bootstrapProof:claims.discordBootstrap,authCreatedAt:Date.parse(user.metadata?.creationTime)};
  }
  async function unlink({idToken,lifecycleId,requestId,expectedProviderRevision}){
    const current=await verified({idToken,lifecycleId,requirePassword:true});
    return store.unlinkSubjectAtomic({uid:current.uid,accountFingerprint:current.accountFingerprint,requestId,expectedProviderRevision,
      requestFingerprint:fingerprint({operation:'unlinkDiscordSubject',uid:current.uid,expectedProviderRevision,accountFingerprint:current.accountFingerprint}),timestamp:now(),
      alternateAccess:{kind:'verified-legacy-password',uid:current.uid,foundationFingerprint:current.accountFingerprint,verifiedAt:current.verifiedAt}});
  }
  async function mintCustomToken(uid){
    if(!/^[A-Za-z0-9_-]{6,128}$/.test(uid||'')||typeof firebaseAuth.createCustomToken!=='function')fail('unauthenticated','discord/auth_invalid');
    const user=await firebaseAuth.getUser(uid);if(user.uid!==uid||user.disabled)fail('unauthenticated','discord/auth_invalid');
    return firebaseAuth.createCustomToken(uid);
  }
  async function readAccount({idToken,lifecycleId}){
    const current=await verified({idToken,lifecycleId,requireRecent:false});
    const {account,providerSubjectKey}=await store.readDiscordAccount({uid:current.uid});
    await onVerifiedAccountRead({...current,providerSubjectKey});
    const keys=['schemaVersion','canonicalTrainerName','normalizedTrainerName','handleKey','identityKind','legacyAccessConfigured','legacyUsername','revision','status'];
    return Object.freeze({ok:true,operation:'read-account',foundation:Object.freeze(Object.fromEntries(keys.map(key=>[key,account[key]])))});
  }
  return Object.freeze({verify:verified,unlink,mintCustomToken,readAccount});
}
module.exports={createDiscordAccessAuthority};
