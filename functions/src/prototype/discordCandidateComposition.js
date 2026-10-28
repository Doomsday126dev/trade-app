'use strict';
const {fail}=require('../domain/errors');
const {createFirestoreDiscordOAuthStore}=require('./firestoreDiscordOAuthStore');
const {createFirestoreDiscordRegistrationStore}=require('./firestoreDiscordRegistrationStore');
const {createDiscordAccessAuthority}=require('./discordAccessAuthority');
const {createDiscordOAuthPrototype}=require('./discordOAuthPrototype');
const {createDiscordCandidateGateway}=require('./discordCandidateGateway');
function createDiscordCandidateTokenMinter({enabled=false,allowBootstrap=false,firebaseAuth,store,registrationStore}={}){
  if(typeof enabled!=='boolean'||typeof allowBootstrap!=='boolean')throw new TypeError('Explicit minter capability flags required');
  if(!enabled)return async()=>fail('unavailable','discord/minter_disabled');
  if(!firebaseAuth?.getUser||!firebaseAuth?.createCustomToken||!store?.resolveSubject||!store?.readDiscordAccount||!registrationStore?.authorizeMint)throw new TypeError('Private token minter dependencies required');
  return async function mint(uid,{providerSubjectKey,mappingRevision}={}){
    const binding=await store.resolveSubject({providerSubjectKey});
    if(binding?.uid!==uid||binding.mappingRevision!==mappingRevision)fail('stale_state','discord/mapping_changed');
    const foundation=await store.readDiscordAccount({uid});
    if(foundation.providerSubjectKey!==providerSubjectKey)fail('stale_state','discord/mapping_changed');
    let user;try{user=await firebaseAuth.getUser(uid);}catch(error){if(error?.code!=='auth/user-not-found')throw error;}
    if(user&&(user.uid!==uid||user.disabled===true))fail('unauthenticated','discord/auth_invalid');
    if(!user&&foundation.account.identityKind!=='provider_only')fail('unauthenticated','discord/auth_user_missing');
    const claims=await registrationStore.authorizeMint({uid,providerSubjectKey,user,allowBootstrap});
    const token=await firebaseAuth.createCustomToken(uid,claims||undefined);
    const after=await store.resolveSubject({providerSubjectKey});
    if(after?.uid!==uid||after.mappingRevision!==mappingRevision)fail('stale_state','discord/mapping_changed');
    return token;
  };
}
// An injected, default-off composition only: no Admin initialization, environment
// secret lookup, runtime export, provider setting, IAM mutation or deployment.
function createDiscordCandidateComposition({enabled=false,registrationEnabled=false,firestore,firebaseAuth,discord,config,projectId,verifyAppCheck,verifyLegacyBinding,allowedOrigin,now=Date.now}={}){
  if(typeof enabled!=='boolean'||typeof registrationEnabled!=='boolean')throw new TypeError('Explicit composition capability flags required');
  if(!enabled)return Object.freeze({available:false});
  if(firebaseAuth?.app?.options?.projectId!==projectId||firestore?.projectId!==projectId)throw new TypeError('Auth and private database must target the same explicit project');
  const store=createFirestoreDiscordOAuthStore({firestore,now}),registrationStore=createFirestoreDiscordRegistrationStore({firestore,now});
  const authority=createDiscordAccessAuthority({firebaseAuth,store,verifyLegacyBinding,projectId,now,onVerifiedAccountRead:input=>registrationStore.markAuthActivated(input)});
  const customTokenMinter=createDiscordCandidateTokenMinter({enabled:true,allowBootstrap:registrationEnabled,firebaseAuth,store,registrationStore});
  const oauth=createDiscordOAuthPrototype({config,store,discord,customTokenMinter,registrationStore,registrationEnabled,now});
  return Object.freeze({available:true,invoke:createDiscordCandidateGateway({enabled:true,oauth,authority,verifyAppCheck,allowedOrigin})});
}
module.exports={createDiscordCandidateComposition,createDiscordCandidateTokenMinter};
