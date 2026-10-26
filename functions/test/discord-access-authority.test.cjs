'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDiscordAccessAuthority}=require('../src/prototype/discordAccessAuthority');
const NOW=1_800_000_000_000,UID='synthetic-owner',PROJECT='demo-pogo-discord';
function harness(){
  const claims={uid:UID,sub:UID,aud:PROJECT,iss:`https://securetoken.google.com/${PROJECT}`,auth_time:NOW/1000-10,exp:NOW/1000+60,firebase:{sign_in_provider:'password'}},user={uid:UID,disabled:false,providerData:[{providerId:'password'}]},calls=[];
  let legacy={uid:UID,username:'SyntheticTrainer',active:true};
  const foundation={account:{uid:UID,identityKind:'legacy_migrated',legacyAccessConfigured:true,legacyUsername:'SyntheticTrainer'},accountFingerprint:'a'.repeat(64)};
  const api=createDiscordAccessAuthority({projectId:PROJECT,now:()=>NOW,firebaseAuth:{verifyIdToken:async(token,revoked)=>{assert.equal(revoked,true);return claims;},getUser:async()=>user,createCustomToken:async uid=>{calls.push(['mint',uid]);return'synthetic-custom-token';}},
    store:{readFoundation:async()=>foundation,unlinkSubjectAtomic:async input=>{calls.push(['unlink',input]);return{status:'unlinked',replay:false};}},verifyLegacyBinding:async()=>legacy});
  return{api,claims,user,calls,setLegacy:value=>{legacy=value;}};
}
test('unlink only accepts recent verified password auth plus exact reciprocal legacy ownership',async()=>{
  const h=harness();assert.equal((await h.api.unlink({idToken:'synthetic-token',lifecycleId:'synthetic-life',requestId:'synthetic-unlink',expectedProviderRevision:1})).status,'unlinked');
  assert.equal(h.calls[0][1].alternateAccess.kind,'verified-legacy-password');assert.equal(h.calls[0][1].alternateAccess.uid,UID);
});
test('last-method fallback rejects provider-only auth, disabled users, revoked/stale auth and wrong legacy mappings',async()=>{
  for(const mutate of[h=>h.claims.firebase.sign_in_provider='custom',h=>h.user.providerData=[],h=>h.user.disabled=true,h=>h.claims.auth_time=NOW/1000-601,h=>h.claims.exp=undefined,h=>h.user.tokensValidAfterTime=new Date(NOW).toISOString(),h=>h.setLegacy({uid:'other-owner',username:'SyntheticTrainer',active:true})]){
    const h=harness();mutate(h);await assert.rejects(h.api.unlink({idToken:'synthetic-token',lifecycleId:'synthetic-life',requestId:'synthetic-unlink',expectedProviderRevision:1}));assert.equal(h.calls.length,0);
  }
});
test('cross-project token and custom-token UID substitution are rejected',async()=>{
  const h=harness();h.claims.aud='wrong-project';await assert.rejects(h.api.verify({idToken:'synthetic-token',lifecycleId:'synthetic-life'}));
  assert.equal(await h.api.mintCustomToken(UID),'synthetic-custom-token');
  await assert.rejects(h.api.mintCustomToken('other-owner'));assert.deepEqual(h.calls,[['mint',UID]]);
});
