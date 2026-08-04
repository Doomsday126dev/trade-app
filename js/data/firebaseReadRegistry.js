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
    {id:'owned_inventory_live',path:'have/{currentUsername}',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['inventory'],status:'planned_retirement'},
    {id:'owned_auth_index_live',path:'authIndex/{currentUid}',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['login_freshness'],status:'transitional'},
    {id:'owned_memberships_live',path:'userCommunities/{currentUid}',method:'onValue',breadth:'exact',ownerScope:'session',audience:'owner',consumers:['community_switcher'],status:'planned_retirement'},
    {id:'public_share_read',path:'publicShares/{username}',method:'get',breadth:'exact',ownerScope:'selectedTrainer',audience:'anonymous',consumers:['share_view'],status:'retained'},
    {id:'public_share_live',path:'publicShares/{username}',method:'onValue',breadth:'exact',ownerScope:'selectedTrainer',audience:'anonymous',consumers:['share_view'],status:'retained'},
    {id:'login_identity_reads',path:'users/{username} + authIndex/{uid}',method:'get',breadth:'exact',ownerScope:'session',audience:'owner_or_admin',consumers:['login','account_binding'],status:'retained'},
    {id:'admin_verification_reads',path:'users/{username} + loginDirectory/{username}',method:'get',breadth:'exact',ownerScope:'legacyAdmin',audience:'admin',consumers:['account_repair','member_creation'],status:'transitional'},
    {id:'community_verification_reads',path:'communities/{communityId}',method:'get',breadth:'exact',ownerScope:'legacyAdmin',audience:'admin',consumers:['community_admin'],status:'planned_retirement'},
    {id:'health_check_read',path:'users or loginDirectory',method:'get',breadth:'dynamic',ownerScope:'legacyAdmin',audience:'anonymous_or_authenticated',consumers:['health_check'],status:'transitional'},
    {id:'legacy_seed_probe',path:'users',method:'get',breadth:'broad',ownerScope:'legacyAdmin',audience:'admin',consumers:['legacy_setup'],status:'planned_retirement'}
  ].map(freezeEntry));

  const SOURCE_CALL_CONTRACT=Object.freeze({
    directGetCount:14,
    directOnValueCount:0,
    managedListenCount:1,
    repositoryFiles:Object.freeze([
      'js/data/currentUserRepository.js',
      'js/data/publicShareRepository.js'
    ]),
    unchangedHandlerBlocks:Object.freeze([
      Object.freeze({
        start:'function _onSubSnapshot',
        end:'const _snapshotFirstSeen',
        sha256:'0b36e84971861a9a38f1094af42f634d696230c5256c8aa1acce84bfed69472d'
      }),
      Object.freeze({
        start:'function onPublicShareSnapshot',
        end:'function ensureShareViewSubscriptions',
        sha256:'9e01607fed3a4c0e4a9daceef4380b292cf7e8c01fcf53ef6605b1d73f677b74'
      })
    ]),
    needles:Object.freeze([
      Object.freeze({text:'get(ref(db,`users/${username}`))',count:2}),
      Object.freeze({text:'get(ref(db,`loginDirectory/${username}`))',count:2}),
      Object.freeze({text:'get(ref(db,`communities/${id}/memberUsernames/${username}`))',count:1}),
      Object.freeze({text:'get(indexRef)',count:1}),
      Object.freeze({text:'get(ref(db,`users/${username}/authUid`))',count:1}),
      Object.freeze({text:"get(ref(db,'users'))",count:1}),
      Object.freeze({text:'get(ref(db,`publicShares/${username}`))',count:1}),
      Object.freeze({text:'get(ref(db,path))',count:1}),
      Object.freeze({text:'get(ref(db,`users/${u}`))',count:2}),
      Object.freeze({text:'get(ref(db,`communities/${DEFAULT_COMMUNITY_ID}`))',count:1}),
      Object.freeze({text:'get(ref(db,`communities/${prep.id}`))',count:1})
    ]),
    broadSubscribePaths:Object.freeze(['authIndex','communities','communityRequests','costumes','dynamax','gmax','have','loginDirectory','offers','requests','trades','userCommunities','users','wishlist'])
  });

  root.firebaseReadRegistry=Object.freeze({READ_SURFACES,SOURCE_CALL_CONTRACT});
})(window);
