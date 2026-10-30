const vm=require('node:vm');
// Load the actual state/resolver functions alongside the extracted click handler.
module.exports=function installShareLinkState(source,context,domain){
  const gate=domain.createPublicSharePublicationGate(),token=gate.activate({uid:context.auth.currentUser.uid,username:context.cur}).token;
  for(const field of ['profile','wishlist','dynamax','gmax','costumes'])gate.markLoaded(token,field);
  Object.assign(context,{activePublicShareHydrationToken:token,managedPublicSharePublication:gate,
    publicLinkConfirmation:null,publicLinkConfirmationEpoch:0,publicLinkBusy:null,publicLinkPublicationError:null,
    allData:{users:{Owner:{}},wishlist:{Owner:{}},dynamax:{Owner:{}},gmax:{Owner:{}},costumes:{Owner:{}}},
    publicSharePublicationDomain:domain,accountSyncModel:{canonicalJson:value=>JSON.stringify(value)},
    BACKGROUND_ROLLOUT:{enabled:false},backgroundOwnerRuntime:null,PUBLIC_SHARE_TYPES:['wishlist','dynamax','gmax','costumes'],syncQueue:{},accountSyncUiState:null,managedAccountSyncRuntime:null,
    accountSyncProjectionReady:()=>false,publicShareSessionMatches:name=>name===context.cur&&context.auth.currentUser.uid===token.uid});
  vm.runInContext(source.slice(source.indexOf('function publicShareSnapshotForUser('),source.indexOf('function applyPublicShareSnapshot(')),context);
  vm.runInContext(source.slice(source.indexOf('function publicSnapshotContentKey('),source.indexOf('function observePublicWriteCompletion(')),context);
  vm.runInContext(source.slice(source.indexOf('function currentPublicLinkConfirmation('),source.indexOf('function ownerShareNoticeKey(')),context);
};
