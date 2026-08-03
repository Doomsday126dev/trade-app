(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  const SCHEMA_VERSION=1;
  const DISPOSITIONS=Object.freeze([
    'passive_login',
    'conflict_review',
    'protected_review',
    'legacy_hold',
    'unassociated_hold',
    'no_action'
  ]);
  const REVIEW_DECISIONS=Object.freeze(['unreviewed']);
  const SOURCE_HASH_KEYS=Object.freeze(['loginDirectory','users','authIndex','admins','authInput']);
  const AUTH_IDENTITY_FIELDS=Object.freeze(['uid','disabled','emailVerified','providers','expectedSyntheticEmailMatches']);

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

  function timestamp(value){
    return typeof value==='number'&&Number.isFinite(value)?value:null;
  }

  function dispositionFor(record){
    const reasons=new Set(record.reasonCodes||[]);
    if(record.facts?.protectedAdmin||reasons.has('protected_admin'))return'protected_review';
    if(record.classification==='duplicate_or_conflicting'||record.classification==='inconsistent_username_uid')return'conflict_review';
    if(record.classification==='missing_uid_binding'&&reasons.has('auth_index_missing'))return'passive_login';
    if(record.classification==='missing_uid_binding')return'unassociated_hold';
    if(record.classification==='legacy_or_inactive')return'legacy_hold';
    if(record.classification==='manual_review')return'conflict_review';
    return'no_action';
  }

  function deriveIdentityConflictDiagnostics(input){
    if(!isPlainObject(input)||!isPlainObject(input.report)||!isPlainObject(input.sources))return fail('invalid_diagnostics_input');
    const report=input.report;
    const sources=input.sources;
    for(const key of ['loginDirectory','users','authIndex','admins']){
      if(!isPlainObject(sources[key]))return fail('invalid_source_root',{source:key});
    }
    if(!isPlainObject(sources.authInput)||sources.authInput.schemaVersion!==1||!Array.isArray(sources.authInput.identities))return fail('invalid_auth_input');
    const allowedAuthFields=new Set(AUTH_IDENTITY_FIELDS);
    for(const identity of sources.authInput.identities){
      if(!isPlainObject(identity)||Object.keys(identity).some(key=>!allowedAuthFields.has(key)))return fail('forbidden_auth_input_field');
      if(typeof identity.uid!=='string'||!identity.uid||typeof identity.disabled!=='boolean'||typeof identity.emailVerified!=='boolean'||
        !Array.isArray(identity.providers)||identity.providers.some(provider=>typeof provider!=='string'||!provider)||
        typeof identity.expectedSyntheticEmailMatches!=='boolean')return fail('malformed_auth_identity');
    }
    if(!Array.isArray(report.records)||!isPlainObject(report.source?.snapshotHashes))return fail('invalid_reconciliation_report');
    if(!isPlainObject(input.actualSnapshotHashes))return fail('missing_actual_snapshot_hashes');

    const mismatchedSources=SOURCE_HASH_KEYS.filter(key=>report.source.snapshotHashes[key]!==input.actualSnapshotHashes[key]);
    const authByUid=new Map();
    sources.authInput.identities.forEach(identity=>{
      const uid=typeof identity?.uid==='string'?identity.uid:'';
      if(!uid)return;
      const rows=authByUid.get(uid)||[];
      rows.push(identity);
      authByUid.set(uid,rows);
    });
    const indexRows=Object.entries(sources.authIndex).map(([uid,row])=>({uid,row:isPlainObject(row)?row:{}}));

    const records=report.records.map(record=>{
      const trainerName=typeof record.trainerName==='string'?record.trainerName:null;
      const directoryRow=trainerName&&isPlainObject(sources.loginDirectory[trainerName])?sources.loginDirectory[trainerName]:null;
      const userRow=trainerName&&isPlainObject(sources.users[trainerName])?sources.users[trainerName]:null;
      const rowsForUsername=trainerName?indexRows.filter(item=>item.row.username===trainerName):[];
      const candidateUids=new Set();
      if(typeof record.uid==='string'&&record.uid)candidateUids.add(record.uid);
      if(typeof userRow?.authUid==='string'&&userRow.authUid)candidateUids.add(userRow.authUid);
      rowsForUsername.forEach(item=>candidateUids.add(item.uid));

      const uidEvidence=[...candidateUids].sort(stableCompare).map(uid=>{
        const authRows=authByUid.get(uid)||[];
        const authIdentity=authRows.length===1&&isPlainObject(authRows[0])?authRows[0]:null;
        const indexRow=isPlainObject(sources.authIndex[uid])?sources.authIndex[uid]:null;
        return{
          uid,
          existsInSanitizedAuth:authRows.length>0,
          sanitizedAuthRowCount:authRows.length,
          authDisabled:authIdentity&&typeof authIdentity.disabled==='boolean'?authIdentity.disabled:null,
          emailVerified:authIdentity&&typeof authIdentity.emailVerified==='boolean'?authIdentity.emailVerified:null,
          providers:authIdentity&&Array.isArray(authIdentity.providers)?[...authIdentity.providers].sort(stableCompare):[],
          expectedSyntheticEmailMatches:authIdentity&&typeof authIdentity.expectedSyntheticEmailMatches==='boolean'?authIdentity.expectedSyntheticEmailMatches:null,
          matchesUserAuthUid:!!(userRow&&userRow.authUid===uid),
          authIndexPresent:!!indexRow,
          authIndexUsername:typeof indexRow?.username==='string'?indexRow.username:null,
          authIndexUsernameMatchesTrainer:!!(trainerName&&indexRow?.username===trainerName),
          protectedAdmin:sources.admins[uid]===true,
          authIndexLastSeen:timestamp(indexRow?.lastSeen)
        };
      });

      return{
        recordId:record.recordId,
        trainerName,
        normalizedTrainerName:record.normalizedTrainerName??null,
        classification:record.classification,
        reasonCodes:Array.isArray(record.reasonCodes)?[...record.reasonCodes].sort(stableCompare):[],
        suggestedDisposition:dispositionFor(record),
        reviewDecision:'unreviewed',
        seedEligible:false,
        sourceEvidence:{
          loginDirectory:{
            present:trainerName!==null&&Object.prototype.hasOwnProperty.call(sources.loginDirectory,trainerName),
            valid:!!directoryRow,
            authReady:directoryRow&&typeof directoryRow.authReady==='boolean'?directoryRow.authReady:null,
            authVersion:directoryRow&&Number.isFinite(directoryRow.authVersion)?directoryRow.authVersion:null
          },
          user:{
            present:trainerName!==null&&Object.prototype.hasOwnProperty.call(sources.users,trainerName),
            valid:!!userRow,
            authUid:typeof userRow?.authUid==='string'?userRow.authUid:null,
            joinedAt:timestamp(userRow?.joined),
            lastSeenAt:timestamp(userRow?.lastSeen),
            lastUpdatedAt:timestamp(userRow?.lastUpdated)
          },
          authIndex:{rowsForUsername:rowsForUsername.length},
          sanitizedAuth:{candidateRows:uidEvidence.reduce((total,item)=>total+item.sanitizedAuthRowCount,0)},
          protectedAdmin:{candidateCount:uidEvidence.filter(item=>item.protectedAdmin).length}
        },
        uidEvidence
      };
    }).sort((a,b)=>stableCompare(a.recordId,b.recordId));

    const dispositionCounts=Object.fromEntries(DISPOSITIONS.map(disposition=>[
      disposition,
      records.filter(record=>record.suggestedDisposition===disposition).length
    ]));

    return{ok:true,value:{
      schemaVersion:SCHEMA_VERSION,
      freshness:{stale:mismatchedSources.length>0,mismatchedSources:[...mismatchedSources]},
      dispositionCounts,
      records,
      ignoredAuthoritySignals:Object.freeze([
        'email_prefix',
        'firebase_display_name',
        'pokemon_lists',
        'public_shares',
        'community_membership',
        'profile_privilege_flags',
        'similar_trainer_names'
      ])
    }};
  }

  root.identityConflictDiagnostics=Object.freeze({
    SCHEMA_VERSION,
    DISPOSITIONS,
    REVIEW_DECISIONS,
    SOURCE_HASH_KEYS,
    AUTH_IDENTITY_FIELDS,
    deriveIdentityConflictDiagnostics
  });
})(window);
