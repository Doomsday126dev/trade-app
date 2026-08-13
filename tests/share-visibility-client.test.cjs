const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function load(){
  const window={};
  const context=vm.createContext({window});
  for(const file of ['js/domain/shareVisibility.js','js/data/trainerShareRepository.js']){
    vm.runInContext(readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  }
  return window;
}

test('visibility modes use stable locale-independent values and inactive flags',()=>{
  const domain=load().PogoDomain.shareVisibility;
  assert.deepEqual(Array.from(domain.MODES),['public','approved_viewers','private']);
  assert.equal(domain.SHARE_VISIBILITY_MODEL_ENABLED,false);
  assert.equal(domain.LEGACY_PUBLIC_SHARE_COMPAT_ENABLED,true);
});

test('production page does not load or activate the candidate modules',()=>{
  const html=readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.doesNotMatch(html,/js\/domain\/shareVisibility\.js/);
  assert.doesNotMatch(html,/js\/data\/trainerShareRepository\.js/);
  assert.doesNotMatch(html,/SHARE_VISIBILITY_MODEL_ENABLED/);
  assert.doesNotMatch(html,/trainerShares\//);
  assert.doesNotMatch(html,/shareAccess\//);
});

test('rules candidate has no broad authenticated root read and gates every candidate write',()=>{
  const rules=JSON.parse(readFileSync(path.join(__dirname,'firebase','database.rules.share-visibility.json'),'utf8')).rules;
  assert.equal(rules['.read'],false);
  assert.equal(rules['.write'],undefined);
  for(const pathName of ['accounts','shareVisibility','shareAccess','shareDirectory','trainerShares','legacyShareOwners','userPreferences']){
    assert.match(JSON.stringify(rules[pathName]),/writesEnabled/);
  }
  assert.match(rules.trainerPreferencesConfig.readsEnabled['.validate'],/isBoolean/);
  assert.match(rules.userPreferences.$viewerUid['.read'],/readsEnabled/);
  assert.equal(rules.userPreferences.$viewerUid.favoriteTrainers['.write'],false);
  const baseline=JSON.parse(readFileSync(path.join(__dirname,'firebase','database.rules.narrow-read.json'),'utf8')).rules;
  assert.deepEqual(rules.publicShares,baseline.publicShares);
  assert.equal(rules.groups['.read'],false);
  assert.equal(rules.groups['.write'],false);
});

test('personal favorite state does not participate in access decisions',()=>{
  const {accessState}=load().PogoDomain.shareVisibility;
  assert.equal(accessState({mode:'approved_viewers',authenticated:true,personalFavorite:true,approved:false}).status,'approved_viewers_restricted');
  assert.equal(accessState({mode:'approved_viewers',authenticated:true,approved:true}).status,'published_authorized');
});

test('public, approved, private, and owner access states remain distinct without leaking list metadata',()=>{
  const {accessState}=load().PogoDomain.shareVisibility;
  assert.equal(accessState({mode:'public'}).status,'published_public');
  assert.equal(accessState({mode:'approved_viewers',authenticated:false}).status,'restricted');
  assert.equal(accessState({mode:'approved_viewers',authenticated:true}).status,'approved_viewers_restricted');
  assert.equal(accessState({mode:'private',authenticated:false}).status,'restricted');
  assert.equal(accessState({mode:'private',authenticated:true}).status,'private');
  assert.equal(accessState({mode:'private',authenticated:true,isOwner:true}).status,'private_owner');
  assert.equal('entryCount' in accessState({mode:'private'}),false);
});

test('unauthorized presentations expose no share metadata',()=>{
  const {visibilityPresentation}=load().PogoDomain.shareVisibility;
  for(const input of [{mode:'private'},{mode:'approved_viewers',authenticated:true,approved:false},{mode:'public',projectionStatus:'projection_incomplete'}]){
    const state=visibilityPresentation(input);assert.equal(state.metadataVisible,false);assert.equal(state.showEntryCount,false);assert.equal(state.showUpdatedAt,false);assert.equal(state.showFingerprint,false);
  }
  assert.equal(visibilityPresentation({mode:'public'}).metadataVisible,true);
});

test('projection and transport failures map to explicit client states',()=>{
  const {accessState}=load().PogoDomain.shareVisibility;
  for(const status of ['not_published','projection_incomplete','projection_unsupported','transport_error']){
    assert.equal(accessState({mode:'public',projectionStatus:status}).status,status);
  }
});

test('disabled model keeps the existing exact legacy path and never reads private lists',()=>{
  const {readPlan}=load().PogoDomain.shareVisibility;
  const plan=readPlan({enabled:false,legacyCompat:true,username:'Trainer'});
  assert.deepEqual(Array.from(plan.reads),['publicShares/Trainer']);
  assert.equal(JSON.stringify(plan).includes('wishlist/'),false);
  assert.equal(JSON.stringify(plan).includes('users/'),false);
});

test('enabled model reads only UID share and authenticated mode metadata',()=>{
  const {readPlan}=load().PogoDomain.shareVisibility;
  assert.deepEqual(Array.from(readPlan({enabled:true,ownerUid:'uid-a',authenticated:false}).reads),['trainerShares/uid-a']);
  assert.deepEqual(Array.from(readPlan({enabled:true,ownerUid:'uid-a',authenticated:true}).reads),['shareVisibility/uid-a/mode','trainerShares/uid-a']);
});

test('migration classifications never become seed-capable',()=>{
  const {classifyMigrationRecord}=load().PogoDomain.shareVisibility;
  const cases=[
    [{conflict:true},'duplicate_conflict'],
    [{active:false,resolvedOwner:true},'inactive_legacy'],
    [{resolvedOwner:false},'unresolved'],
    [{resolvedOwner:true,projectionStatus:'not_published'},'missing_projection'],
    [{resolvedOwner:true,projectionStatus:'projection_incomplete'},'incomplete_profile_only'],
    [{resolvedOwner:true,projectionStatus:'projection_unsupported'},'unsupported_malformed'],
    [{resolvedOwner:true,projectionStatus:'published'},'valid_complete_public']
  ];
  for(const [input,status] of cases){const result=classifyMigrationRecord(input);assert.equal(result.status,status);assert.equal(result.seedEligible,false);}
});

test('repository exposes read-only exact paths with no write capability',async()=>{
  const window=load();
  const calls=[];
  const client={read:async target=>{calls.push(['read',target]);return{ok:true};},listen:(target)=>{calls.push(['listen',target]);return{ok:true,unsubscribe(){}};}};
  const repo=window.PogoData.trainerShareRepository.createTrainerShareRepository(client,window.PogoDomain.shareVisibility);
  await repo.readDirectoryEntry('trainer');
  await repo.readMode('uid-a');
  await repo.readShare('uid-a');
  repo.listenShare('uid-a',{});
  await repo.readLegacy('Trainer');
  assert.deepEqual(calls,[['read','shareDirectory/trainer'],['read','shareVisibility/uid-a/mode'],['read','trainerShares/uid-a'],['listen','trainerShares/uid-a'],['read','publicShares/Trainer']]);
  assert.equal('write' in repo,false);
  assert.equal('grant' in repo,false);
});

test('Approved Viewer plans are owner controlled, idempotent, and independent from Favorites',()=>{
  const {approvedViewerPlan}=load().PogoDomain.shareVisibility;
  assert.equal(approvedViewerPlan({activeOwnerUid:'a',targetViewerUid:'a'}).status,'self_grant_denied');
  const disabled=approvedViewerPlan({activeOwnerUid:'a',targetViewerUid:'b',action:'grant'});assert.equal(disabled.status,'disabled_candidate');assert.equal(disabled.executable,false);assert.equal(disabled.favoriteMutation,false);assert.deepEqual(Array.from(disabled.preferencePaths),[]);
  assert.equal(approvedViewerPlan({enabled:true,writesEnabled:true,activeOwnerUid:'a',targetViewerUid:'b',currentGrant:true,action:'grant'}).status,'no_change');
  assert.equal(approvedViewerPlan({enabled:true,writesEnabled:true,activeOwnerUid:'a',targetViewerUid:'b',currentGrant:true,action:'revoke'}).executable,true);
});

test('visibility settings remain hidden-capable and language neutral',()=>{
  const {visibilitySettingsModel}=load().PogoDomain.shareVisibility,model=visibilitySettingsModel({enabled:false,currentMode:'approved_viewers'});
  assert.equal(model.status,'disabled_candidate');assert.equal(model.interactive,false);assert.equal(model.currentMode,'approved_viewers');assert.deepEqual(Array.from(model.options,x=>x.value),['public','approved_viewers','private']);
  assert.ok(model.options.every(option=>option.labelKey.startsWith('share.mode.')));
});

test('read registry preserves 40 surfaces and rejects disabled surface activation',()=>{
  const window={};vm.runInNewContext(readFileSync(path.join(__dirname,'..','js/data/firebaseReadRegistry.js'),'utf8'),{window});const registry=window.PogoData.firebaseReadRegistry;
  assert.equal(registry.READ_SURFACES.length,40);assert.equal(registry.READ_SURFACES.filter(item=>item.status==='candidate_inactive').length,11);
  assert.equal(registry.validateFeatureGateContract({}).ok,true);
  assert.equal(registry.validateFeatureGateContract({activeSurfaceIds:['candidate_trainer_share_read']}).violations[0],'firebase-reads/share-visibility-active-while-disabled');
  assert.equal(registry.validateFeatureGateContract({activeSurfaceIds:['candidate_preference_tags_live']}).violations[0],'firebase-reads/preferences-active-while-disabled');
  assert.equal(registry.validateFeatureGateContract({shareWritesEnabled:true}).ok,false);assert.equal(registry.validateFeatureGateContract({preferenceWritesEnabled:true}).ok,false);
});

test('disabled share controls remain hidden and expose no grant action',()=>{
  const window=load();vm.runInNewContext(readFileSync(path.join(__dirname,'..','js/ui/trainerTagPanel.js'),'utf8'),{window});const model=window.PogoUI.trainerTagPanel.shareControlsModel({shareDomain:window.PogoDomain.shareVisibility,currentMode:'private',width:375});
  assert.equal(model.hidden,true);assert.equal(model.interactive,false);assert.equal(model.grantActionEnabled,false);assert.equal(model.revokeActionEnabled,false);assert.equal(model.layout.mode,'mobile_sheet');
});

test('translation catalog covers visibility, Approved Viewer, sync, migration, tags, and unread states',()=>{
  const locale=readFileSync(path.join(__dirname,'..','js/i18n/locales/en.js'),'utf8');
  for(const key of ['share.mode.public','share.approvedViewersTitle','trainer.syncUnavailable','trainer.migrationReady','trainer.tagsAssign','trainer.unreadChanges','share.visibilityRestricted'])assert.ok(locale.includes(`'${key}'`),key);
});
