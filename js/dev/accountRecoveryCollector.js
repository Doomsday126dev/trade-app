(function(global){
  'use strict';
  const root=global.PogoDev=global.PogoDev||{};
  const TYPES=['wishlist','dynamax','gmax','costumes'];
  const ACCOUNT_KEYS=['meta','profile','tradeEntries','favorites','tags','migrations','recoveryCandidates','recoveryReviewAcceptances'];
  const PROFILE_KEYS=['friendCode','bio','discord','avatarPokemon','specialTradeBoard','intentDeclarations','wallpaper','lastUpdated'];
  function fail(code){throw Object.assign(new Error(code),{code});}
  function object(value){return value&&typeof value==='object'&&!Array.isArray(value);}
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function createOwnerRecoveryReader({database,ref,get,uid,trainerHandle,sessionCurrent,readLocal,features={providerPublicShares:false,syncedPreferences:false,shareVisibility:false}}={}){
    if(!database||!ref||!get||!uid||!trainerHandle||/[.#$\[\]/\u0000-\u001f\u007f]/.test(uid+trainerHandle)||typeof sessionCurrent!=='function'||typeof readLocal!=='function')throw new TypeError('Owner recovery reader dependencies required');
    if(Object.keys(features).sort().join(',')!=='providerPublicShares,shareVisibility,syncedPreferences'||Object.values(features).some(Boolean))fail('recovery/feature-collector-required');
    const read=async path=>{if(!sessionCurrent())fail('recovery/session-changed');const snapshot=await get(ref(database,path));if(!sessionCurrent())fail('recovery/session-changed');return snapshot.exists()?snapshot.val():null;};
    async function capture(){
      const paths=[`users/${trainerHandle}`,`authIndex/${uid}`,`userCommunities/${uid}`,`publicShares/${trainerHandle}`,...TYPES.map(type=>`${type}/${trainerHandle}`)];
      const [profile,index,memberships,share,...lists]=await Promise.all(paths.map(read));
      if(profile?.authUid!==uid||index?.username!==trainerHandle)fail('recovery/identity-pair-invalid');
      const local=await readLocal();if(!sessionCurrent()||local?.owner?.uid!==uid||local.owner.username!==trainerHandle)fail('recovery/session-changed');
      const allowed=['owner','history','retainedHistory','lists','orders','preferences','pendingQueue'];
      if(Object.keys(local).sort().join(',')!==allowed.sort().join(',')||!object(local.orders)||!object(local.preferences)||!object(local.pendingQueue)||TYPES.some(type=>!object(local.lists?.[type])))fail('recovery/local-source-incomplete');
      for(const history of[local.history,local.retainedHistory].filter(Boolean))if(history.owner?.uid!==uid||history.owner?.username!==trainerHandle||Number(history.version)>3)fail('recovery/history-owner-or-version-invalid');
      return{owner:{uid,username:trainerHandle},features:{...features},profile:Object.fromEntries(PROFILE_KEYS.filter(key=>profile[key]!==undefined).map(key=>[key,profile[key]])),
        memberships:memberships||{},sharing:{legacyUrls:TYPES.map(type=>`https://doomsday126dev.github.io/trade-app/?view=${encodeURIComponent(trainerHandle)}&list=${type}`),legacyProjection:share},
        permissions:{legacyRoleReferences:{isAdmin:profile.isAdmin===true,isOwner:profile.isOwner===true},memberships:memberships||{}},
        legacyLists:Object.fromEntries(TYPES.map((type,index)=>[type,lists[index]||{}])),local:clone(local)};
    }
    return Object.freeze({capture});
  }
  function createAccountRecoveryCollector({repository,journal,ownerReader,getSession,bundleModel,sha256,validateEntity,clock=()=>Date.now()}={}){
    if(!repository?.readAccount||!journal?.captureOwnerSnapshot||!ownerReader?.capture||!getSession||!bundleModel?.create||!sha256||!validateEntity)throw new TypeError('Complete recovery collector dependencies required');
    const canonical=value=>global.PogoDomain.accountSyncModel.canonicalJson(value);
    async function collect(){
      const session=getSession();if(!session?.uid||!session.username||!session.lifecycleId||session.accountReady!==true)fail('recovery/session-not-ready');
      const current=()=>{const value=getSession();return value?.uid===session.uid&&value.username===session.username&&value.lifecycleId===session.lifecycleId&&value.accountReady===true;};
      async function capture(){
        const [remote,local,views]=await Promise.all([repository.readAccount(),journal.captureOwnerSnapshot(),ownerReader.capture()]);
        if(!current()||remote?.meta?.ownerUid!==session.uid||remote.meta.initialized!==true||local.ownerUid!==session.uid||views.owner.uid!==session.uid||views.owner.username!==session.username)fail('recovery/session-changed');
        if(remote.meta.schemaVersion!==1||local.schemaVersion!==1||Object.values(local.stores||{}).some(records=>!Array.isArray(records)||records.some(record=>record.ownerUid!==session.uid)))fail('recovery/source-owner-invalid');
        if(Object.keys(remote).some(key=>!ACCOUNT_KEYS.includes(key))||Object.keys(local.stores||{}).sort().join(',')!=='conflicts,entities,meta,operations,recoveryCandidates')fail('recovery/source-version-unsupported');
        return clone({remote,local,views});
      }
      const first=await capture(),digest=await sha256(canonical(first)),second=await capture();
      if(!current()||await sha256(canonical(second))!==digest)fail('recovery/source-changed');
      const sections=Object.fromEntries(global.PogoDev.accountRecoveryBundle.SECTIONS.map(name=>[name,{complete:true,records:[]} ]));
      const add=(section,id,value)=>sections[section].records.push({id,value});
      for(const [collection,type]of Object.entries({tradeEntries:'tradeEntry',favorites:'favorite',tags:'tag'}))for(const [id,value]of Object.entries(first.remote[collection]||{})){
        if(!validateEntity(value,{ownerUid:session.uid,entityType:type,entityId:id}).ok)fail('recovery/canonical-invalid');
        add('canonicalEntities',`${type}:${id}`,value);
      }
      add('profile','legacy-profile',first.views.profile);if(first.remote.profile){if(!global.PogoDomain.accountSyncModel.validateProfileRecord(first.remote.profile,{ownerUid:session.uid}).ok)fail('recovery/profile-invalid');add('profile','canonical-profile',first.remote.profile);}
      add('legacyLists','remote',first.views.legacyLists);add('legacyLists','local',first.views.local.lists);add('legacyLists','orders',first.views.local.orders||{});
      add('favorites','history',first.views.local.history?.favorites||[]);add('tags','history',first.views.local.history?.tags||{});
      add('groups','memberships',first.views.memberships);add('permissions','references',first.views.permissions);add('sharing','references',first.views.sharing);
      add('preferences','device',first.views.local.preferences||{});add('preferences','history',first.views.local.history||null);add('preferences','retainedHistory',first.views.local.retainedHistory||null);
      for(const name of['entities','operations','conflicts','meta'])add('journal',name,first.local.stores[name]);
      add('journal','legacy-pending-queue',first.views.local.pendingQueue||{});
      add('migration','canonical',first.remote.migrations||{});add('migration','account-meta',first.remote.meta);add('migration','feature-coverage',first.views.features);
      add('recovery','canonical-candidates',first.remote.recoveryCandidates||{});add('recovery','canonical-reviews',first.remote.recoveryReviewAcceptances||{});add('recovery','local-candidates',first.local.stores.recoveryCandidates);
      const bundle=await bundleModel.create({source:{ownerUid:session.uid,trainerHandle:session.username,capturedAt:clock(),revision:digest},sections});
      if(!current())fail('recovery/session-changed');return bundle;
    }
    return Object.freeze({collect});
  }
  root.accountRecoveryCollector=Object.freeze({createOwnerRecoveryReader,createAccountRecoveryCollector});
})(window);
