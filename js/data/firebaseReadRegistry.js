(function(global){
  const root=global.PogoData=global.PogoData||{};
  const freezeEntry=entry=>Object.freeze({...entry,consumers:Object.freeze([...entry.consumers])});
  const READ_SURFACES=Object.freeze([
    {id:'login_directory_live',path:'loginDirectory',method:'onValue',breadth:'broad',ownerScope:'public',audience:'anonymous',consumers:['login'],status:'transitional'},
    {id:'users_live',path:'users',method:'onValue',breadth:'broad',ownerScope:'legacyAdmin',audience:'admin',consumers:['admin_on_demand'],status:'planned_retirement'},
    {id:'auth_index_live',path:'authIndex',method:'onValue',breadth:'broad',ownerScope:'legacyAdmin',audience:'admin',consumers:['admin_on_demand'],status:'planned_retirement'},
    {id:'requests_live',path:'requests',method:'onValue',breadth:'broad',ownerScope:'legacyAdmin',audience:'admin',consumers:['admin_on_demand'],status:'planned_retirement'},
    {id:'communities_live',path:'communities',method:'onValue',breadth:'broad',ownerScope:'legacyAdmin',audience:'admin',consumers:['admin_on_demand'],status:'planned_retirement'},
    {id:'user_communities_live',path:'userCommunities',method:'onValue',breadth:'broad',ownerScope:'legacyAdmin',audience:'admin',consumers:['admin_on_demand'],status:'planned_retirement'},
    {id:'community_requests_live',path:'communityRequests',method:'onValue',breadth:'broad',ownerScope:'legacyAdmin',audience:'admin',consumers:['admin_on_demand'],status:'planned_retirement'},
    {id:'wishlist_live',path:'wishlist',method:'onValue',breadth:'broad',ownerScope:'legacyAdmin',audience:'admin',consumers:['admin_on_demand'],status:'planned_retirement'},
    {id:'dynamax_live',path:'dynamax',method:'onValue',breadth:'broad',ownerScope:'legacyAdmin',audience:'admin',consumers:['admin_on_demand'],status:'planned_retirement'},
    {id:'gmax_live',path:'gmax',method:'onValue',breadth:'broad',ownerScope:'legacyAdmin',audience:'admin',consumers:['admin_on_demand'],status:'planned_retirement'},
    {id:'costumes_live',path:'costumes',method:'onValue',breadth:'broad',ownerScope:'legacyAdmin',audience:'admin',consumers:['admin_on_demand'],status:'planned_retirement'},
    {id:'inventory_live',path:'have',method:'onValue',breadth:'broad',ownerScope:'legacyAdmin',audience:'admin',consumers:['admin_on_demand'],status:'planned_retirement'},
    {id:'offers_live',path:'offers',method:'onValue',breadth:'broad',ownerScope:'legacyAdmin',audience:'admin',consumers:['admin_on_demand'],status:'planned_retirement'},
    {id:'trades_live',path:'trades',method:'onValue',breadth:'broad',ownerScope:'legacyAdmin',audience:'admin',consumers:['admin_on_demand'],status:'planned_retirement'},
    {id:'pending_decrements_live',path:'pendingDecrements/{username}',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner_or_admin',consumers:['inventory_reconciliation'],status:'planned_retirement'},
    {id:'owned_profile_live',path:'users/{currentUsername}',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['my_profile'],status:'transitional'},
    {id:'owned_wishlist_live',path:'wishlist/{currentUsername}',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['my_list'],status:'transitional'},
    {id:'owned_dynamax_live',path:'dynamax/{currentUsername}',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['my_list'],status:'transitional'},
    {id:'owned_gmax_live',path:'gmax/{currentUsername}',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['my_list'],status:'transitional'},
    {id:'owned_costumes_live',path:'costumes/{currentUsername}',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['my_list'],status:'transitional'},
    {id:'account_sync_migration_reads',path:'wishlist/{currentUsername} + dynamax/{currentUsername} + gmax/{currentUsername} + costumes/{currentUsername} + users/{currentUsername}',method:'get',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['account_sync_migration'],status:'transitional'},
    {id:'account_sync_recovery_review_read',path:'authIndex/{currentUid}/accountSyncRecoveryReviews/{evidenceFingerprint}',method:'get',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['account_sync_recovery_review'],status:'retained'},
    {id:'owned_inventory_live',path:'have/{currentUsername}',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['inventory'],status:'planned_retirement'},
    {id:'owned_auth_index_live',path:'authIndex/{currentUid}',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['login_freshness'],status:'transitional'},
    {id:'owned_memberships_live',path:'userCommunities/{currentUid}',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['community_switcher'],status:'planned_retirement'},
    {id:'public_share_read',path:'publicShares/{username}',method:'get',breadth:'exact',ownerScope:'selectedTrainer',audience:'anonymous',consumers:['share_view'],status:'retained'},
    {id:'public_share_live',path:'publicShares/{username}',method:'onValue',breadth:'exact',ownerScope:'selectedTrainer',audience:'anonymous',consumers:['share_view'],status:'retained'},
    {id:'candidate_share_directory_read',path:'shareDirectory/{normalizedTrainerName}',method:'get',breadth:'exact',ownerScope:'selectedTrainer',audience:'anonymous',consumers:['future_share_visibility'],status:'candidate_inactive'},
    {id:'candidate_share_mode_read',path:'shareVisibility/{ownerUid}/mode',method:'get',breadth:'exact',ownerScope:'selectedTrainer',audience:'authenticated',consumers:['future_share_visibility'],status:'candidate_inactive'},
    {id:'candidate_trainer_share_read',path:'trainerShares/{ownerUid}',method:'get',breadth:'exact',ownerScope:'selectedTrainer',audience:'visibility_authorized',consumers:['future_share_visibility'],status:'candidate_inactive'},
    {id:'candidate_trainer_share_live',path:'trainerShares/{ownerUid}',method:'onValue',breadth:'exact',ownerScope:'selectedTrainer',audience:'visibility_authorized',consumers:['future_share_visibility'],status:'candidate_inactive'},
    {id:'candidate_preference_metadata_live',path:'userPreferences/{viewerUid}/metadata',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['future_synced_preferences'],status:'candidate_inactive'},
    {id:'candidate_preference_favorites_live',path:'userPreferences/{viewerUid}/favoriteTrainers',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['future_synced_preferences'],status:'candidate_inactive'},
    {id:'candidate_preference_trainer_metadata_live',path:'userPreferences/{viewerUid}/trainerMetadata',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['future_synced_preferences'],status:'candidate_inactive'},
    {id:'candidate_preference_tags_live',path:'userPreferences/{viewerUid}/trainerTags',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['future_synced_preferences'],status:'candidate_inactive'},
    {id:'candidate_preference_tag_labels_live',path:'userPreferences/{viewerUid}/trainerTagLabels',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['future_synced_preferences'],status:'candidate_inactive'},
    {id:'candidate_preference_recents_live',path:'userPreferences/{viewerUid}/recentTrainerSlots',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['future_synced_preferences'],status:'candidate_inactive'},
    {id:'candidate_preference_history_live',path:'userPreferences/{viewerUid}/trainerHistory',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['future_synced_preferences'],status:'candidate_inactive'},
    {id:'login_identity_reads',path:'users/{username} + authIndex/{uid}',method:'get',breadth:'exact',ownerScope:'session',audience:'owner_or_admin',consumers:['login','account_binding'],status:'retained'},
    {id:'provider_account_resolution_reads',path:'authIndex/{providerUid} + users/{resolvedUsername}',method:'get',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['provider_sign_in'],status:'candidate_inactive'},
    {id:'provider_public_readback',path:'trainerShares/{currentUid}',method:'get',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['provider_publication_reconciliation'],status:'candidate_inactive'},
    {id:'provider_public_gateway',path:'public trainer-handle callable',method:'callable',breadth:'exact',ownerScope:'selectedTrainer',audience:'anonymous',consumers:['anonymous_public_share_bootstrap'],status:'candidate_inactive'},
    {id:'legacy_public_readback',path:'publicShares/{currentUsername}',method:'get',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['publication_confirmation'],status:'retained'},
    {id:'normal_sync_identity_reads',path:'authIndex/{currentUid} + users/{currentUsername}/authUid + accountSync/{currentUid}',method:'get',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['canonical_enrollment'],status:'transitional'},
    {id:'legacy_provisioning_freeze_read',path:'legacyProvisioningFreeze',method:'get',breadth:'exact',ownerScope:'legacyAdmin',audience:'admin',consumers:['legacy_creation_guard'],status:'candidate_inactive'},
    {id:'admin_verification_reads',path:'users/{username} + loginDirectory/{username}',method:'get',breadth:'exact',ownerScope:'legacyAdmin',audience:'admin',consumers:['account_repair','member_creation'],status:'transitional'},
    {id:'community_verification_reads',path:'communities/{communityId}',method:'get',breadth:'exact',ownerScope:'legacyAdmin',audience:'admin',consumers:['community_admin'],status:'planned_retirement'},
    {id:'health_check_read',path:'users or loginDirectory',method:'get',breadth:'dynamic',ownerScope:'legacyAdmin',audience:'anonymous_or_authenticated',consumers:['health_check'],status:'transitional'}
  ].map(freezeEntry));

  const profiles={
    provider:{audience:'owner',ownerScope:'session',status:'candidate_inactive',featureGate:'Google/provider capability and current authenticated UID; publicly disabled',executionSurface:'provider sign-in',consumer:'provider_identity_resolution'},
    providerShare:{audience:'owner',ownerScope:'session',status:'candidate_inactive',featureGate:'providerPublicWriteSupport and provider-only identity/session match; publicly disabled',executionSurface:'provider publication',consumer:'provider_publication_reconciliation'},
    publish:{audience:'owner',ownerScope:'session',status:'retained',featureGate:'publicShareSessionMatches and hydrated current session',executionSurface:'Share or canonical projection publication',consumer:'publication_confirmation'},
    admin:{audience:'admin',ownerScope:'legacyAdmin',status:'transitional',featureGate:'retained Admin action; Firebase Rules authorize current administrator',executionSurface:'Admin account maintenance',consumer:'account_verification'},
    community:{audience:'owner/admin',ownerScope:'legacyAdmin',status:'planned_retirement',featureGate:'owner community tools and selected community enrollment',executionSurface:'Admin community maintenance',consumer:'community_verification'},
    freeze:{audience:'admin',ownerScope:'legacyAdmin',status:'candidate_inactive',featureGate:'LEGACY_PROVISIONING_ENFORCEMENT_ENABLED && fbOn && db; default false',executionSurface:'legacy creation or identity repair guard',consumer:'legacy_creation_guard'},
    login:{audience:'owner',ownerScope:'session',status:'retained',featureGate:'current authenticated UID and exact Username/PIN account',executionSurface:'Username/PIN sign-in',consumer:'login_identity'},
    sync:{audience:'owner',ownerScope:'session',status:'transitional',featureGate:'ACCOUNT_SYNC_ROLLOUT enabled/writesEnabled; legacy identity; App Check ready',executionSurface:'canonical runtime enrollment',consumer:'canonical_enrollment'},
    migration:{audience:'owner',ownerScope:'session',status:'transitional',featureGate:'authenticated migration/adoption session; UID and generation rechecked',executionSurface:'first canonical adoption or recovery source inspection',consumer:'account_sync_migration'},
    public:{audience:'anonymous',ownerScope:'selectedTrainer',status:'retained',featureGate:'valid public trainer link; no private fallback',executionSurface:'public v1/v2 trainer share',consumer:'share_view'},
    health:{audience:'anonymous or authenticated; broad protected path requires Rules authorization',ownerScope:'screen',status:'transitional',featureGate:'explicit login-health diagnostic; signed-in status selects protected versus public path',executionSurface:'Having trouble signing in',consumer:'health_check'}
  };
  const site=(handler,expression,normalizedPath,surfaceId,profile,classification,justification)=>Object.freeze({
    file:'js/app/application.js',handler,expression,normalizedPath,surfaceId,operation:'get',
    ...profiles[profile],classification,justification,decision:'retained',redundant:false,
    activeInProduct:profiles[profile].status!=='candidate_inactive',canRemoveSafely:false,
    legacyOnly:!['provider','providerShare'].includes(profile),
    priorNeedle:classification==='A'?expression:null
  });
  // Ordered read sites bind each parsed call to its handler, path and reviewed purpose.
  const directReadSites=Object.freeze([
    site('resolveGoogleAccountBinding','get(ref(db,`authIndex/${expectedUid}`))','authIndex/{currentUid}','provider_account_resolution_reads','provider','D','New migrated-foundation branch verifies fresh legacy mapping; exclusive with missing-foundation branch, not a duplicate.'),
    site('resolveGoogleAccountBinding','get(ref(db,`users/${username}`))','users/{resolvedUsername}','provider_account_resolution_reads','provider','D','New migrated-foundation branch verifies reverse UID binding; canonical foundation alone does not prove legacy ownership.'),
    site('resolveGoogleAccountBinding','get(ref(db,`authIndex/${expectedUid}`))','authIndex/{currentUid}','provider_account_resolution_reads','provider','A','Existing missing-foundation branch distinguishes unlinked account from migration-required legacy account; no cached identity reuse.'),
    site('resolveGoogleAccountBinding','get(ref(db,`users/${username}`))','users/{resolvedUsername}','provider_account_resolution_reads','provider','A','Existing missing-foundation branch checks reverse mapping before fail-closed migration-required result.'),
    site('writeProviderPublicShareSnapshot','get(target)','trainerShares/{currentUid}','provider_public_readback','providerShare','D','New post-transaction readback distinguishes committed/reconciled content from timeout or conflict; earlier transaction evidence is not equivalent.'),
    site('writeVerifiedLegacyPublicSnapshot','get(target)','publicShares/{currentUsername}','legacy_public_readback','publish','C','New post-write content and hydration-token verification prevents reporting publication or copying a link before the matching projection is confirmed.'),
    site('repairMemberAccount','get(ref(db,`users/${username}`))','users/{username}','admin_verification_reads','admin','A','Verify intentionally retained Admin metadata repair; established UID replacement remains blocked before this path.'),
    site('repairMemberAccount','get(ref(db,`loginDirectory/${username}`))','loginDirectory/{username}','admin_verification_reads','admin','A','Verify repaired login directory exists before reporting success.'),
    site('createMemberNow','get(ref(db,`users/${username}`))','users/{username}','admin_verification_reads','admin','A','Verify newly created member profile before committing local success.'),
    site('createMemberNow','get(ref(db,`loginDirectory/${username}`))','loginDirectory/{username}','admin_verification_reads','admin','A','Verify new member is discoverable by the retained Username/PIN login flow.'),
    site('createMemberNow','get(ref(db,`communities/${id}/memberUsernames/${username}`))','communities/{selectedCommunity}/memberUsernames/{username}','community_verification_reads','community','A','Verify each explicitly selected legacy community membership; zero iterations without selected enrollment.'),
    site('createMemberNow','get(ref(db,`users/${username}`))','users/{username}','admin_verification_reads','admin','D','New error-path read protects a committed account from Auth cleanup after an ambiguous failed verification; success-path evidence may not exist or be current.'),
    site('readLegacyProvisioningFreeze',"get(ref(db,'legacyProvisioningFreeze'))",'legacyProvisioningFreeze','legacy_provisioning_freeze_read','freeze','D','New gated freeze evidence is read immediately before legacy creation/repair; default-disabled safety preparation is not proven dead and must not be removed here.'),
    site('syncOwnAuthIndex','get(indexRef)','authIndex/{currentUid}','login_identity_reads','login','A','Verify existing mapping before metadata refresh; do not overwrite authority fields.'),
    site('syncOwnAuthIndex','get(ref(db,`users/${username}/authUid`))','users/{currentUsername}/authUid','login_identity_reads','login','A','Only missing-index branch verifies reverse ownership before first index initialization.'),
    site('accountSyncRolloutEligible','get(ref(db,`authIndex/${owner}`))','authIndex/{currentUid}','normal_sync_identity_reads','sync','C','New canonical enrollment checks exact fresh UID-to-name mapping at runtime start, not a cached earlier login boundary.'),
    site('accountSyncRolloutEligible','get(ref(db,`users/${username}/authUid`))','users/{currentUsername}/authUid','normal_sync_identity_reads','sync','C','New canonical enrollment checks reverse binding; prevents adoption under a mismatched trainer identity.'),
    site('accountSyncRolloutEligible','get(ref(db,`accountSync/${owner}`))','accountSync/{currentUid}','normal_sync_identity_reads','sync','C','New enrollment reads canonical migration/recovery state before deciding eligibility; stale evidence could reseed or bypass unresolved recovery.'),
    site('accountSyncReadLegacySources','get(ref(db,path))','wishlist|dynamax|gmax|costumes/{currentUsername} + users/{currentUsername}','account_sync_migration_reads','migration','A','Read five exact current-user sources to preserve lists and Board during adoption; one call site iterates five paths, with session/reverse-UID validation.'),
    site('loadPublicShareData','get(ref(db,`publicShares/${username}`))','publicShares/{username}','public_share_read','public','A','Load public v1/v2 projection; provider unavailability may fall back only to this public projection, never private lists.'),
    site('runLoginHealthCheck','get(ref(db,path))','signed-in: users/{selectedUsername} or users; signed-out: loginDirectory/{selectedUsername} or loginDirectory','health_check_read','health','A','Explicit retained diagnostic; broad protected reads still obey Rules and are not part of startup. Broader diagnostic retirement is deferred.'),
    site('doLogin','get(ref(db,`users/${u}`))','users/{loginUsername}','login_identity_reads','login','A','Known-directory branch reads the exact account after Firebase sign-in; identity and credentials cannot be replaced by cached data.'),
    site('doLogin','get(ref(db,`users/${u}`))','users/{loginUsername}','login_identity_reads','login','A','Missing-directory fallback reads the exact account after successful Auth; mutually exclusive with the known-directory branch.'),
    site('prepareDefaultCommunity','get(ref(db,`communities/${DEFAULT_COMMUNITY_ID}`))','communities/{defaultCommunity}','community_verification_reads','community','A','Verify owner-requested default-community initialization; not an ordinary startup read.'),
    site('prepareNonDefaultCommunity','get(ref(db,`communities/${prep.id}`))','communities/{selectedCommunity}','community_verification_reads','community','A','Verify owner-requested non-default-community preparation; only retained explicit Admin tools can reach this consumer.')
  ]);

  const SOURCE_CALL_CONTRACT=Object.freeze({
    directGetCount:directReadSites.filter(site=>site.operation==='get').length,
    directReadSites,
    readHandlerHashes:Object.freeze({
      resolveGoogleAccountBinding:'f3e431d7873b3e6e52ab7996ded83d92e7e4c61d4b70ee0e2f0623f8e7f37c7d',
      writeProviderPublicShareSnapshot:'5835654f0e125a398c6931e97cf905549b5dc741c534fbd16572257bfa1914e6',
      writeVerifiedLegacyPublicSnapshot:'d50329ae64c23791516ca3b0d2d800ecc0c33b903c27f4b26969b049570cb62c',
      repairMemberAccount:'c9fc61723b6999aba4ad01dfa036025c570ecbbd7d3b9414e67f4ca2b0917f0a',
      createMemberNow:'3e7836dc7bc8bf1d3cfb0db1b8b02ee07bfd2d30c7d6dd8123afbdf218d6cc48',
      readLegacyProvisioningFreeze:'205cf1dddbfab5c8356c518ae48493f7620218549bf93ae282c9a2e99cfb5ca8',
      syncOwnAuthIndex:'ba9ba732bb8e7e4d37b857b4abd9b0c152765f43c050e29206bfc7c7c6944bcb',
      accountSyncRolloutEligible:'c1f5a8e7f551fed025ea12370d5ba84608be3590e30de6f4de14e863cefcd309',
      accountSyncReadLegacySources:'af2cce11993d102668d4875c77ab2927231d6cd13e981ef326380b3e8f2f4428',
      loadPublicShareData:'76a88a00a0bc891b17695eb49f76d626f585c2ee03a31f590290b95526df670d',
      runLoginHealthCheck:'61bfc130258e4b27ca6e20a155d0a2df0cf4aba8feb8adc2410120b7e79840f0',
      doLogin:'91de13ef5bb7bdd6e2c398e1b7df1991bb70b3066f1b1269aade0f2457b48128',
      prepareDefaultCommunity:'97ca74b9ea44fb53ecbeed39052a4f00ba827c5945f33c0a0af45d295bc1699a',
      prepareNonDefaultCommunity:'afe3eadfa54c591c16fbbd02f0e6a91ec70deeb0b5a617e40f1f09e498f4a983'
    }),
    directOnValueCount:0,
    managedListenCount:1,
    repositoryFiles:Object.freeze([
      'js/app/publicShareApp.js',
      'js/data/currentUserRepository.js',
      'js/data/publicShareRepository.js',
      'js/data/trainerShareRepository.js'
    ]),
    repositoryCalls:Object.freeze([
      {file:'js/app/publicShareApp.js',expression:'client.read(request.username)',surfaceId:'provider_public_gateway',purpose:'Anonymous public-handle callable gateway, not a private RTDB fallback'},
      {file:'js/data/currentUserRepository.js',expression:'client.read(path)',surfaceId:'owned_profile_live',purpose:'Validated exact current-user repository read dispatcher'},
      {file:'js/data/currentUserRepository.js',expression:'client.listen(path,handlers)',surfaceId:'owned_profile_live',purpose:'Validated exact current-user repository listener dispatcher'},
      {file:'js/data/publicShareRepository.js',expression:'client.read(`publicShares/${shareUsername(username)}`)',surfaceId:'public_share_read',purpose:'Exact public projection'},
      {file:'js/data/publicShareRepository.js',expression:'client.listen(`publicShares/${shareUsername(username)}`,handlers)',surfaceId:'public_share_live',purpose:'Exact public projection listener'},
      {file:'js/data/trainerShareRepository.js',expression:'client.read(`trainerShares/${key(ownerUid)}`)',surfaceId:'candidate_trainer_share_read',purpose:'Gated trainer projection'},
      {file:'js/data/trainerShareRepository.js',expression:'client.listen(`trainerShares/${key(ownerUid)}`,handlers)',surfaceId:'candidate_trainer_share_live',purpose:'Gated trainer projection listener'},
      {file:'js/data/trainerShareRepository.js',expression:'client.read(`shareVisibility/${key(ownerUid)}/mode`)',surfaceId:'candidate_share_mode_read',purpose:'Gated visibility evidence'},
      {file:'js/data/trainerShareRepository.js',expression:'client.read(`shareDirectory/${key(normalizedName)}`)',surfaceId:'candidate_share_directory_read',purpose:'Gated public directory resolution'},
      {file:'js/data/trainerShareRepository.js',expression:'client.read(`publicShares/${key(username)}`)',surfaceId:'public_share_read',purpose:'Public v1/v2 compatibility only'}
    ].map(Object.freeze)),
    unchangedHandlerBlocks:Object.freeze([
      Object.freeze({
        start:'function _onSubSnapshot',
        end:'const _snapshotFirstSeen',
        sha256:'fe49aaa53260e13b7ba10b62dbb419b16d943437ebafb1445839f9ccd9664fb1'
      }),
      Object.freeze({
        start:'function onPublicShareSnapshot',
        end:'function ensureShareViewSubscriptions',
        sha256:'651da0ca52e7d0d482127187edf7689db2ef1ad2b9874d3ac8503cbd6611eb70'
      })
    ]),
    needles:Object.freeze([
      Object.freeze({text:'get(ref(db,`users/${username}`))',count:5}),
      Object.freeze({text:'get(ref(db,`loginDirectory/${username}`))',count:2}),
      Object.freeze({text:'get(ref(db,`authIndex/${expectedUid}`))',count:2}),
      Object.freeze({text:'get(target)',count:2}),
      Object.freeze({text:"get(ref(db,'legacyProvisioningFreeze'))",count:1}),
      Object.freeze({text:'get(ref(db,`authIndex/${owner}`))',count:1}),
      Object.freeze({text:'get(ref(db,`accountSync/${owner}`))',count:1}),
      Object.freeze({text:'get(ref(db,`communities/${id}/memberUsernames/${username}`))',count:1}),
      Object.freeze({text:'get(indexRef)',count:1}),
      Object.freeze({text:'get(ref(db,`users/${username}/authUid`))',count:2}),
      Object.freeze({text:'get(ref(db,`publicShares/${username}`))',count:1}),
      Object.freeze({text:'get(ref(db,path))',count:2}),
      Object.freeze({text:"paths.map(path=>withTimeout(get(ref(db,path)),8000,'Reading account sync migration source timed out','account-sync/source-read-timeout'))",count:1}),
      Object.freeze({text:'get(ref(db,`users/${u}`))',count:2}),
      Object.freeze({text:'get(ref(db,`communities/${DEFAULT_COMMUNITY_ID}`))',count:1}),
      Object.freeze({text:'get(ref(db,`communities/${prep.id}`))',count:1})
    ]),
    broadSubscribePaths:Object.freeze(['authIndex','communities','communityRequests','costumes','dynamax','gmax','have','loginDirectory','offers','requests','trades','userCommunities','users','wishlist'])
  });

  const CANDIDATE_SURFACE_GROUPS=Object.freeze({
    shareVisibility:Object.freeze(['candidate_share_directory_read','candidate_share_mode_read','candidate_trainer_share_read','candidate_trainer_share_live']),
    syncedPreferences:Object.freeze(['candidate_preference_metadata_live','candidate_preference_favorites_live','candidate_preference_trainer_metadata_live','candidate_preference_tags_live','candidate_preference_tag_labels_live','candidate_preference_recents_live','candidate_preference_history_live'])
  });
  function validateFeatureGateContract({shareVisibilityEnabled=false,syncedPreferencesEnabled=false,shareWritesEnabled=false,preferenceWritesEnabled=false,activeSurfaceIds=[]}={}){
    const active=new Set(activeSurfaceIds);
    const violations=[];
    if(!shareVisibilityEnabled&&CANDIDATE_SURFACE_GROUPS.shareVisibility.some(id=>active.has(id)))violations.push('firebase-reads/share-visibility-active-while-disabled');
    if(!syncedPreferencesEnabled&&CANDIDATE_SURFACE_GROUPS.syncedPreferences.some(id=>active.has(id)))violations.push('firebase-reads/preferences-active-while-disabled');
    if(shareWritesEnabled&&!shareVisibilityEnabled)violations.push('firebase-reads/share-write-gate-without-feature');
    if(preferenceWritesEnabled&&!syncedPreferencesEnabled)violations.push('firebase-reads/preference-write-gate-without-feature');
    return Object.freeze({ok:violations.length===0,violations:Object.freeze(violations)});
  }

  root.firebaseReadRegistry=Object.freeze({READ_SURFACES,SOURCE_CALL_CONTRACT,CANDIDATE_SURFACE_GROUPS,validateFeatureGateContract});
})(window);
