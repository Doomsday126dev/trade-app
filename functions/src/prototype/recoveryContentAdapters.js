'use strict';
const {fingerprint}=require('../domain/fingerprints');
const clone=value=>JSON.parse(JSON.stringify(value));
function fail(code){throw Object.assign(new Error(code),{code});}
// Typed content adapters for sandbox qualification. No arbitrary path, journal
// replay, role, membership, identity, or sharing-ownership adapter exists.
function createRecoveryContentAdapters({model}={}){
  if(!model?.validateProfileRecord||!model?.normalizeProfileValues)throw new TypeError('Profile domain required');
  const supported={profile:new Set(['legacy-profile','canonical-profile']),legacyLists:new Set(['remote','local','orders']),preferences:new Set(['device','history','retainedHistory'])};
  function contentOnly(input){
    if(input&&typeof input==='object')for(const[key,value]of Object.entries(input)){
      if(/^(?:isAdmin|isOwner|role|roles|permissions|memberships|authUid|authEmail|providerSubjectKey)$/i.test(key))fail('recovery/privileged-content-forbidden');
      contentOnly(value);
    }
  }
  function value(section,row,source,target){
    const input=clone(row.value);contentOnly(input);
    if(section==='profile'){
      if(row.id==='canonical-profile'){
        if(!model.validateProfileRecord(input,{ownerUid:source.source.ownerUid}).ok)fail('recovery/profile-invalid');
        return{...input,ownerUid:target.source.ownerUid};
      }
      const keys=['friendCode','bio','discord','avatarPokemon','specialTradeBoard','intentDeclarations','wallpaper','lastUpdated'];
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!keys.includes(key)))fail('recovery/legacy-profile-invalid');
      const normalized=model.normalizeProfileValues(Object.fromEntries(['friendCode','bio','discord','avatarPokemon'].filter(key=>input[key]!==undefined).map(key=>[key,input[key]])));
      if(!normalized.ok)fail('recovery/profile-invalid');return input;
    }
    if(section==='preferences'&&row.id!=='device'){
      if(input===null)return null;
      if(!input||!Number.isSafeInteger(input.version)||input.version<1||input.version>3||input.owner?.uid!==source.source.ownerUid||input.owner?.username!==source.source.trainerHandle)fail('recovery/history-owner-or-version-invalid');
      return{...input,owner:{uid:target.source.ownerUid,username:target.source.trainerHandle}};
    }
    if(!input||typeof input!=='object'||Array.isArray(input))fail('recovery/content-invalid');
    if(section==='legacyLists'&&Object.keys(input).some(key=>!['wishlist','dynamax','gmax','costumes'].includes(key)))fail('recovery/legacy-list-type-invalid');
    return input;
  }
  function prepare({source,current}){
    const additions=[],rows=[];
    for(const[section,ids]of Object.entries(supported))for(const row of source.sections[section].records){
      if(!ids.has(row.id)){rows.push({section,id:row.id,status:'unsupported-content-review'});continue;}
      const accepted=value(section,row,source,current),existing=current.sections[section].records.find(item=>item.id===row.id);
      const status=existing?(fingerprint(existing.value)===fingerprint(accepted)?'unchanged':'conflict-review'):'proposed-content-add';
      rows.push({section,id:row.id,status});if(!existing)additions.push({section,id:row.id,value:accepted});
    }
    return{schemaVersion:1,sourceDigest:source.integrity.digest,targetDigest:current.integrity.digest,additions,rows};
  }
  function apply(sections,plan){
    for(const row of plan.additions){
      if(!supported[row.section]?.has(row.id)||sections[row.section].records.some(item=>item.id===row.id))fail('recovery/content-conflict');
      sections[row.section].records.push({id:row.id,value:clone(row.value)});
    }
    return sections;
  }
  return Object.freeze({prepare,apply});
}
module.exports={createRecoveryContentAdapters};
