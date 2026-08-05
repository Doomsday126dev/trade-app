(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const trainerNames=root.trainerNames;
  const publication=root.publicSharePublication;
  if(!trainerNames||!publication)throw new Error('Share migration audit dependencies failed to load');

  const CLASSIFICATIONS=Object.freeze([
    'valid_complete_projection','incomplete_profile_only','missing_projection','unsupported_malformed',
    'identity_mapping_conflict','normalized_name_collision','protected_account','inactive_or_legacy','unresolved'
  ]);
  const REVIEW_CLASSIFICATION='individually_reviewable';

  function plain(value){return!!value&&typeof value==='object'&&!Array.isArray(value);}
  function own(value,key){return Object.prototype.hasOwnProperty.call(value,key);}
  function stable(a,b){return String(a??'').localeCompare(String(b??''),'en',{sensitivity:'variant'});}
  function unique(values){return[...new Set(values)].sort(stable);}
  function authRows(authInput){
    if(!plain(authInput)||authInput.schemaVersion!==1||!Array.isArray(authInput.identities))return null;
    return authInput.identities.filter(row=>plain(row)&&typeof row.uid==='string'&&row.uid);
  }
  function auditShareMigration(input){
    for(const key of ['loginDirectory','users','authIndex','admins','publicShares']){
      if(!plain(input?.[key]))return{ok:false,error:{code:'share-audit/invalid-source',source:key}};
    }
    const identities=authRows(input.authInput);
    if(!identities)return{ok:false,error:{code:'share-audit/auth-input-required'}};
    const authByUid=new Map();
    for(const row of identities){const rows=authByUid.get(row.uid)||[];rows.push(row);authByUid.set(row.uid,rows);}

    const names=new Set([...Object.keys(input.loginDirectory),...Object.keys(input.users),...Object.keys(input.publicShares)]);
    for(const row of Object.values(input.authIndex))if(plain(row)&&typeof row.username==='string'&&row.username)names.add(row.username);
    const normalizedGroups=new Map();
    for(const name of names){
      const key=trainerNames.trainerNameParts(name).normalizedTrainerName;
      if(!key)continue;
      const group=normalizedGroups.get(key)||[];group.push(name);normalizedGroups.set(key,group);
    }
    const indexByUsername=new Map();
    for(const [uid,row] of Object.entries(input.authIndex)){
      if(!plain(row)||typeof row.username!=='string'||!row.username)continue;
      const rows=indexByUsername.get(row.username)||[];rows.push(uid);indexByUsername.set(row.username,rows);
    }
    const uidOwners=new Map();
    for(const [name,row] of Object.entries(input.users)){
      if(!plain(row)||typeof row.authUid!=='string'||!row.authUid)continue;
      const rows=uidOwners.get(row.authUid)||[];rows.push(name);uidOwners.set(row.authUid,rows);
    }

    const records=[...names].sort(stable).map(username=>{
      const directory=input.loginDirectory[username];
      const user=input.users[username];
      const share=input.publicShares[username];
      const parts=trainerNames.trainerNameParts(username);
      const uid=plain(user)&&typeof user.authUid==='string'?user.authUid:'';
      const uidIndex=uid?input.authIndex[uid]:undefined;
      const matchingIndex=indexByUsername.get(username)||[];
      const auth=uid?(authByUid.get(uid)||[]):[];
      const reasons=[];

      const normalizedCollision=!!parts.normalizedTrainerName&&(normalizedGroups.get(parts.normalizedTrainerName)||[]).length>1;
      const identityConflict=!!uid&&(
        (uidOwners.get(uid)||[]).length>1||matchingIndex.length>1||
        (plain(uidIndex)&&uidIndex.username!==username)||matchingIndex.some(value=>value!==uid)||auth.length>1
      );
      const protectedAccount=!!uid&&input.admins[uid]===true;
      const directoryPresent=own(input.loginDirectory,username);
      const directoryReady=plain(directory)&&directory.authReady===true;
      const userValid=plain(user)&&!!uid;
      const indexValid=plain(uidIndex)&&uidIndex.username===username;
      const authValid=auth.length===1&&!auth[0].disabled&&Array.isArray(auth[0].providers)&&auth[0].providers.length>0&&auth[0].expectedSyntheticEmailMatches===true;
      const completeIdentity=directoryReady&&userValid&&indexValid&&authValid;
      const inactive=(!directoryPresent&&own(input.users,username))||(plain(directory)&&directory.authReady===false);
      const projection=publication.publicShareProjectionStatus(share,{username});

      if(parts.changedByTrimming)reasons.push('username_trim_drift');
      if(parts.changedByNfkc)reasons.push('username_nfkc_drift');
      if(plain(share)&&typeof share.username==='string'&&share.username!==username)reasons.push('projection_username_mismatch');
      if(!directoryPresent&&userValid)reasons.push('valid_account_missing_directory');
      if(directoryPresent&&!userValid)reasons.push('directory_without_user_binding');
      if(uid&&!indexValid)reasons.push('auth_index_linkage_invalid');
      if(!uid)reasons.push('user_uid_missing');
      if(uid&&auth.length===0)reasons.push('auth_identity_missing');
      if(auth.length===1&&auth[0].disabled)reasons.push('auth_identity_disabled');
      if(auth.length===1&&auth[0].expectedSyntheticEmailMatches!==true)reasons.push('auth_identity_not_corroborated');
      if(projection.status==='projection_incomplete')reasons.push('projection_completeness_markers_missing');
      for(const reason of Object.keys(projection.rejectionCounts||{}))if(projection.rejectionCounts[reason])reasons.push(`projection_${reason}`);

      let classification;
      if(identityConflict)classification='identity_mapping_conflict';
      else if(normalizedCollision)classification='normalized_name_collision';
      else if(protectedAccount)classification='protected_account';
      else if(inactive)classification='inactive_or_legacy';
      else if(!completeIdentity)classification='unresolved';
      else if(projection.status==='published'||projection.status==='published_empty')classification='valid_complete_projection';
      else if(projection.status==='projection_incomplete')classification='incomplete_profile_only';
      else if(projection.status==='not_published')classification='missing_projection';
      else classification='unsupported_malformed';

      const individuallyReviewable=completeIdentity&&!protectedAccount&&!identityConflict&&!normalizedCollision&&classification==='valid_complete_projection';
      return{
        internalKey:`trainer:${username}`,trainerName:username,normalizedTrainerName:parts.normalizedTrainerName,uid:uid||null,
        classification,reviewClassification:individuallyReviewable?REVIEW_CLASSIFICATION:null,
        reasonCodes:unique(reasons),seedEligible:false,
        facts:{directoryPresent,directoryReady,userPresent:own(input.users,username),authIndexConsistent:indexValid,
          authIdentityPresent:auth.length>0,authIdentityEnabled:auth.length===1?!auth[0].disabled:null,
          protectedAccount,projectionPresent:own(input.publicShares,username),projectionStatus:projection.status,
          projectionEntryCount:projection.ok?projection.entryCount:null,changedByTrimming:parts.changedByTrimming,changedByNfkc:parts.changedByNfkc}
      };
    });
    const classificationCounts=Object.fromEntries(CLASSIFICATIONS.map(key=>[key,records.filter(record=>record.classification===key).length]));
    classificationCounts[REVIEW_CLASSIFICATION]=records.filter(record=>record.reviewClassification===REVIEW_CLASSIFICATION).length;
    const reasonCodeCounts={};
    for(const record of records)for(const code of record.reasonCodes)reasonCodeCounts[code]=(reasonCodeCounts[code]||0)+1;
    return{ok:true,value:{schemaVersion:1,toolVersion:'share-migration-audit-v1',normalizationContract:'trainer-name-nfkc-lower-v1',
      staleWarning:'Audit results become stale as soon as any source changes.',totalRecords:records.length,
      classificationCounts,reasonCodeCounts:Object.fromEntries(Object.entries(reasonCodeCounts).sort(([a],[b])=>stable(a,b))),records}};
  }

  root.shareMigrationAudit=Object.freeze({CLASSIFICATIONS,REVIEW_CLASSIFICATION,auditShareMigration});
})(window);
