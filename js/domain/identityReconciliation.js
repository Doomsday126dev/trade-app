(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const trainerNames=root.trainerNames;
  if(!trainerNames)throw new Error('Trainer-name helpers failed to load');
  const {trainerNameParts}=trainerNames;

  const SCHEMA_VERSION=1;
  const NORMALIZATION_CONTRACT='trainer-name-nfkc-lower-v1';
  const CLASSIFICATIONS=Object.freeze([
    'duplicate_or_conflicting',
    'inconsistent_username_uid',
    'missing_uid_binding',
    'legacy_or_inactive',
    'manual_review',
    'ready_for_mapping'
  ]);
  const FIREBASE_FORBIDDEN_KEY=/[.#$\[\]\/\u0000-\u001f\u007f]/;

  function isPlainObject(value){
    return!!value&&typeof value==='object'&&!Array.isArray(value);
  }

  function stableCompare(a,b){
    const left=String(a??'');
    const right=String(b??'');
    return left<right?-1:left>right?1:0;
  }

  function fail(code,details={}){
    return{ok:false,error:{code,details}};
  }

  function validateAuthInput(authInput){
    if(authInput==null)return{ok:true,value:{status:'absent',identities:[]}};
    if(!isPlainObject(authInput)||authInput.schemaVersion!==1||!Array.isArray(authInput.identities)){
      return fail('invalid_auth_input_shape');
    }
    const allowed=new Set(['uid','disabled','emailVerified','providers','expectedSyntheticEmailMatches']);
    const unknownField=authInput.identities.find(identity=>isPlainObject(identity)&&Object.keys(identity).some(key=>!allowed.has(key)));
    if(unknownField)return fail('forbidden_auth_input_field');
    const identities=authInput.identities.map((identity,index)=>{
      const malformed=!isPlainObject(identity)||
        typeof identity?.uid!=='string'||!identity.uid||
        typeof identity?.disabled!=='boolean'||
        typeof identity?.emailVerified!=='boolean'||
        !Array.isArray(identity?.providers)||
        identity.providers.some(provider=>typeof provider!=='string'||!provider)||
        typeof identity?.expectedSyntheticEmailMatches!=='boolean';
      return malformed?{index,malformed:true,uid:typeof identity?.uid==='string'?identity.uid:''}:{
        index,
        malformed:false,
        uid:identity.uid,
        disabled:identity.disabled,
        emailVerified:identity.emailVerified,
        providers:[...identity.providers].sort(stableCompare),
        expectedSyntheticEmailMatches:identity.expectedSyntheticEmailMatches
      };
    });
    return{ok:true,value:{status:'provided',identities}};
  }

  function reconcileIdentitySources(input){
    if(!isPlainObject(input))return fail('invalid_reconciliation_input');
    for(const key of ['loginDirectory','users','authIndex','admins']){
      if(!isPlainObject(input[key]))return fail('invalid_source_root',{source:key});
    }
    const authResult=validateAuthInput(input.authInput);
    if(!authResult.ok)return authResult;

    const loginDirectory=input.loginDirectory;
    const users=input.users;
    const authIndex=input.authIndex;
    const admins=input.admins;
    const authSource=authResult.value;
    const authByUid=new Map();
    authSource.identities.forEach(identity=>{
      const rows=authByUid.get(identity.uid)||[];
      rows.push(identity);
      authByUid.set(identity.uid,rows);
    });

    const usernames=new Set([...Object.keys(loginDirectory),...Object.keys(users)]);
    const indexRows=[];
    Object.entries(authIndex).forEach(([uid,row])=>{
      const username=isPlainObject(row)&&typeof row.username==='string'?row.username:'';
      indexRows.push({uid,row,username,malformed:!isPlainObject(row)||!username});
      if(username)usernames.add(username);
    });

    const normalizedGroups=new Map();
    [...usernames].forEach(username=>{
      const normalized=trainerNameParts(username).normalizedTrainerName;
      if(!normalized)return;
      const group=normalizedGroups.get(normalized)||[];
      group.push(username);
      normalizedGroups.set(normalized,group);
    });
    const userUidOwners=new Map();
    Object.entries(users).forEach(([username,row])=>{
      if(!isPlainObject(row)||typeof row.authUid!=='string'||!row.authUid)return;
      const owners=userUidOwners.get(row.authUid)||[];
      owners.push(username);
      userUidOwners.set(row.authUid,owners);
    });
    const indexUsernameOwners=new Map();
    indexRows.forEach(({uid,username})=>{
      if(!username)return;
      const owners=indexUsernameOwners.get(username)||[];
      owners.push(uid);
      indexUsernameOwners.set(username,owners);
    });

    const records=[];
    [...usernames].sort(stableCompare).forEach(username=>{
      const directoryRow=loginDirectory[username];
      const userRow=users[username];
      const directoryValid=isPlainObject(directoryRow);
      const userValid=isPlainObject(userRow);
      const uid=userValid&&typeof userRow.authUid==='string'&&userRow.authUid?userRow.authUid:'';
      const parts=trainerNameParts(username);
      const matchingIndexRows=indexRows.filter(row=>row.username===username);
      const uidIndexRow=uid?authIndex[uid]:undefined;
      const uidIndexValid=isPlainObject(uidIndexRow)&&typeof uidIndexRow.username==='string';
      const authRows=uid?(authByUid.get(uid)||[]):[];
      const conflictReasons=[];
      const inconsistentReasons=[];
      const missingReasons=[];
      const legacyReasons=[];
      const manualReasons=[];

      if(parts.normalizedTrainerName&&(normalizedGroups.get(parts.normalizedTrainerName)||[]).length>1){
        conflictReasons.push('normalized_handle_collision');
      }
      if(uid&&(userUidOwners.get(uid)||[]).length>1)conflictReasons.push('uid_claimed_by_multiple_usernames');
      if((indexUsernameOwners.get(username)||[]).length>1)conflictReasons.push('username_has_multiple_auth_index_uids');
      if(uid&&authRows.length>1)conflictReasons.push('duplicate_auth_identity_uid');

      if(uid&&uidIndexValid&&uidIndexRow.username!==username)inconsistentReasons.push('uid_index_username_mismatch');
      if(uid&&matchingIndexRows.some(row=>row.uid!==uid))inconsistentReasons.push('username_index_uid_mismatch');

      if(!userValid)missingReasons.push('user_record_missing');
      if(userValid&&!uid)missingReasons.push('user_uid_missing');
      if(uid&&!uidIndexValid)missingReasons.push('auth_index_missing');

      if(!Object.prototype.hasOwnProperty.call(loginDirectory,username))legacyReasons.push('absent_from_login_directory');

      if(!directoryValid&&Object.prototype.hasOwnProperty.call(loginDirectory,username))manualReasons.push('malformed_login_directory_record');
      if(!userValid&&Object.prototype.hasOwnProperty.call(users,username))manualReasons.push('malformed_user_record');
      if(uidIndexRow!==undefined&&!uidIndexValid)manualReasons.push('malformed_auth_index_record');
      if(!parts.valid)manualReasons.push('normalized_handle_empty');
      if(FIREBASE_FORBIDDEN_KEY.test(username))manualReasons.push('illegal_firebase_key');
      if(parts.changedByTrimming||parts.changedByNfkc)manualReasons.push('normalization_uncertain');
      if(directoryValid&&directoryRow.authReady!==true)manualReasons.push('auth_not_ready');
      if(uid&&admins[uid]===true)manualReasons.push('protected_admin');
      if(userValid&&(userRow.isOwner===true||userRow.isAdmin===true))manualReasons.push('legacy_privileged_profile_flag');
      if(authSource.status==='absent')manualReasons.push('auth_source_absent');
      else if(uid&&authRows.length===0)manualReasons.push('auth_identity_missing');
      else if(uid&&authRows.length===1){
        const authIdentity=authRows[0];
        if(authIdentity.malformed)manualReasons.push('malformed_auth_identity');
        else{
          if(authIdentity.disabled)manualReasons.push('auth_identity_disabled');
          if(!authIdentity.providers.length)manualReasons.push('auth_provider_missing');
          if(!authIdentity.expectedSyntheticEmailMatches)manualReasons.push('auth_identity_not_corroborated');
        }
      }

      let classification='ready_for_mapping';
      let reasons=[];
      if(conflictReasons.length){classification='duplicate_or_conflicting';reasons=conflictReasons;}
      else if(inconsistentReasons.length){classification='inconsistent_username_uid';reasons=inconsistentReasons;}
      else if(missingReasons.length){classification='missing_uid_binding';reasons=missingReasons;}
      else if(legacyReasons.length){classification='legacy_or_inactive';reasons=legacyReasons;}
      else if(manualReasons.length){classification='manual_review';reasons=manualReasons;}

      records.push({
        internalKey:`username:${username}`,
        trainerName:username,
        normalizedTrainerName:parts.normalizedTrainerName,
        uid:uid||null,
        classification,
        reasonCodes:[...new Set(reasons)].sort(stableCompare),
        seedEligible:false,
        facts:{
          loginDirectoryPresent:Object.prototype.hasOwnProperty.call(loginDirectory,username),
          userPresent:Object.prototype.hasOwnProperty.call(users,username),
          authIndexPresent:uidIndexRow!==undefined,
          authIdentityPresent:authRows.length>0,
          authSourceStatus:authSource.status,
          authDisabled:authRows.length===1&&!authRows[0].malformed?authRows[0].disabled:null,
          emailVerified:authRows.length===1&&!authRows[0].malformed?authRows[0].emailVerified:null,
          providers:authRows.length===1&&!authRows[0].malformed?[...authRows[0].providers]:[],
          protectedAdmin:!!(uid&&admins[uid]===true),
          changedByTrimming:parts.changedByTrimming,
          changedByNfkc:parts.changedByNfkc
        }
      });
    });

    indexRows.filter(row=>row.malformed&&!row.username).sort((a,b)=>stableCompare(a.uid,b.uid)).forEach(row=>{
      records.push({internalKey:`authIndex:${row.uid}`,trainerName:null,normalizedTrainerName:null,uid:row.uid||null,
        classification:'missing_uid_binding',reasonCodes:['malformed_auth_index_record','username_missing'],seedEligible:false,
        facts:{loginDirectoryPresent:false,userPresent:false,authIndexPresent:true,authIdentityPresent:authByUid.has(row.uid),authSourceStatus:authSource.status,authDisabled:null,emailVerified:null,providers:[],protectedAdmin:admins[row.uid]===true,changedByTrimming:false,changedByNfkc:false}});
    });
    const referencedUids=new Set(indexRows.map(row=>row.uid));
    Object.values(users).forEach(row=>{if(isPlainObject(row)&&typeof row.authUid==='string'&&row.authUid)referencedUids.add(row.authUid);});
    [...authByUid.entries()].filter(([uid])=>uid&&!referencedUids.has(uid)).sort(([a],[b])=>stableCompare(a,b)).forEach(([uid,rows])=>{
      records.push({internalKey:`auth:${uid}`,trainerName:null,normalizedTrainerName:null,uid,
        classification:'missing_uid_binding',reasonCodes:rows.length>1?['duplicate_auth_identity_uid','username_missing']:['username_missing'],seedEligible:false,
        facts:{loginDirectoryPresent:false,userPresent:false,authIndexPresent:false,authIdentityPresent:true,authSourceStatus:authSource.status,authDisabled:rows.length===1&&!rows[0].malformed?rows[0].disabled:null,emailVerified:rows.length===1&&!rows[0].malformed?rows[0].emailVerified:null,providers:rows.length===1&&!rows[0].malformed?[...rows[0].providers]:[],protectedAdmin:admins[uid]===true,changedByTrimming:false,changedByNfkc:false}});
    });

    records.sort((a,b)=>stableCompare(a.internalKey,b.internalKey));
    const classificationCounts=Object.fromEntries(CLASSIFICATIONS.map(name=>[name,records.filter(record=>record.classification===name).length]));
    return{ok:true,value:{
      schemaVersion:SCHEMA_VERSION,
      normalizationContract:NORMALIZATION_CONTRACT,
      authSourceStatus:authSource.status,
      sourceCounts:{loginDirectory:Object.keys(loginDirectory).length,users:Object.keys(users).length,authIndex:Object.keys(authIndex).length,admins:Object.keys(admins).length,authIdentities:authSource.identities.length},
      classificationCounts,
      totalRecords:records.length,
      records,
      staleWarning:'This dry-run becomes stale as soon as any source changes. A future seeding tool must re-read and revalidate every approved mapping.'
    }};
  }

  root.identityReconciliation=Object.freeze({
    SCHEMA_VERSION,
    NORMALIZATION_CONTRACT,
    CLASSIFICATIONS,
    reconcileIdentitySources,
    validateAuthInput
  });
})(window);
