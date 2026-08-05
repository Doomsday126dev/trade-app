const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function domain(){
  const window={};vm.runInNewContext(readFileSync(path.join(__dirname,'..','js/domain/trainerPreferences.js'),'utf8'),{window});return window.PogoDomain.trainerPreferences;
}

test('synced preferences stay disabled and bounded',()=>{
  const value=domain();assert.equal(value.SYNCED_TRAINER_PREFERENCES_ENABLED,false);assert.equal(value.MAX_RECENT_TRAINERS,30);assert.equal(value.MAX_HISTORY_ENTRIES,1500);
});

test('tag normalization is NFKC, case-insensitive, whitespace-stable, and display-preserving',()=>{
  const value=domain();
  const a=value.normalizeTagLabel('  Lucky   Trade  '),b=value.normalizeTagLabel('ＬＵＣＫＹ trade');
  assert.equal(a.displayLabel,'Lucky Trade');assert.equal(a.normalizedLabel,'lucky trade');assert.equal(a.labelKey,b.labelKey);
  assert.equal(value.normalizeTagLabel('   ').error.code,'trainer-preferences/tag-empty');
  assert.equal(value.normalizeTagLabel('x'.repeat(41)).error.code,'trainer-preferences/tag-too-long');
});

test('recent trainers merge by owner, never move backward, and retain exactly 30',()=>{
  const value=domain();
  const initial=Object.fromEntries(Array.from({length:30},(_,index)=>[String(index).padStart(2,'0'),{ownerUid:`uid-${index}`,trainerName:`Trainer ${index}`,lastOpenedAt:100-index}]));
  const merged=value.mergeRecentTrainerSlots(initial,{ownerUid:'uid-new',trainerName:'New',lastOpenedAt:200});
  assert.equal(Object.keys(merged.slots).length,30);assert.equal(merged.slots['00'].ownerUid,'uid-new');assert.equal(Object.values(merged.slots).some(item=>item.ownerUid==='uid-29'),false);
  const stale=value.mergeRecentTrainerSlots(merged.slots,{ownerUid:'uid-new',lastOpenedAt:50});assert.equal(stale.slots['00'].lastOpenedAt,200);
});

test('seen history is monotonic and only advances from an authorized available share',()=>{
  const value=domain();
  const previous={lastSeenShareVersion:5,lastSeenUpdatedAt:500,lastSeenFingerprint:'v5'};
  assert.equal(value.advanceSeenState(previous,{shareStatus:'restricted',lastSeenShareVersion:6}).error.code,'trainer-preferences/share-unavailable');
  assert.equal(value.advanceSeenState(previous,{shareStatus:'published_public',lastSeenShareVersion:4}).error.code,'trainer-preferences/stale-seen-write');
  assert.equal(value.advanceSeenState(previous,{shareStatus:'published_public',lastSeenShareVersion:5,lastSeenFingerprint:'different'}).error.code,'trainer-preferences/seen-conflict');
  const next=value.advanceSeenState(previous,{shareStatus:'published_public',lastSeenShareVersion:6,lastSeenUpdatedAt:600,lastSeenFingerprint:'v6',lastSeenSnapshot:{Pikachu:{category:'wishlist',fingerprint:'a'}}});
  assert.equal(next.value.lastSeenShareVersion,6);assert.equal(next.value.lastSeenUpdatedAt,600);assert.equal(next.value.entryCount,1);
});

test('large snapshots are bounded and unavailable shares cannot become mass removals',()=>{
  const value=domain();
  const tooLarge=Object.fromEntries(Array.from({length:1501},(_,index)=>[`entry-${index}`,{category:'wishlist',fingerprint:'x'}]));
  assert.equal(value.advanceSeenState({}, {shareStatus:'published_public',lastSeenShareVersion:1,lastSeenSnapshot:tooLarge}).error.code,'trainer-preferences/history-too-large');
  assert.equal(value.advanceSeenState({lastSeenShareVersion:2},{shareStatus:'transport_error',lastSeenShareVersion:3,lastSeenSnapshot:{}}).ok,false);
});

test('local migration accepts only the matching UID and username partition',()=>{
  const value=domain();
  const active={uid:'uid-a',username:'TrainerA'};
  assert.equal(value.planLocalImport({activeIdentity:active,partitionIdentity:{uid:'uid-b',username:'TrainerA'}}).error.code,'trainer-preferences/partition-mismatch');
  const plan=value.planLocalImport({activeIdentity:active,partitionIdentity:active,local:{favorites:{x:true},recents:{y:true}}});
  assert.equal(plan.status,'review_required');assert.equal(plan.writesEnabled,false);assert.equal(plan.deleteLocal,false);
});

test('local migration deduplicates favorites and preserves newer local seen state until server verification',()=>{
  const value=domain(),identity={uid:'uid-a',username:'TrainerA'};
  const plan=value.planLocalImport({activeIdentity:identity,partitionIdentity:identity,
    local:{favorites:{ownerA:{trainerName:'Alpha'}},history:{ownerA:{lastSeenUpdatedAt:20}}},
    server:{favorites:{ownerA:{trainerName:'Alpha'}},history:{ownerA:{lastSeenUpdatedAt:10}}}});
  assert.equal(plan.counts.favorites,1);assert.equal(plan.counts.history,1);
  assert.equal(plan.strategy.preserveNewerHistoryBy,'lastSeenUpdatedAt');assert.equal(plan.strategy.requireServerVerification,true);
  assert.equal(plan.deleteLocal,false);assert.equal(plan.writesEnabled,false);
});

test('tags create, rename, soft-delete, assign, and filter without duplicate normalized labels',()=>{
  const value=domain();
  let state={tags:{},favorites:{uidA:{ownerUid:'uidA',trainerName:'Trainer Alpha',tagIds:[]},uidB:{ownerUid:'uidB',trainerName:'Trainer Beta',tagIds:[]}}};
  const created=value.createTag(state,'  Lucky Trade  ',{tagId:'tag_lucky',now:1});assert.equal(created.ok,true);state={...state,tags:created.tags};
  assert.equal(value.createTag(state,'ＬＵＣＫＹ trade',{tagId:'tag_duplicate'}).error.code,'trainer-preferences/tag-duplicate');
  const renamed=value.renameTag(state,'tag_lucky','High Priority',{now:2});state={...state,tags:renamed.tags};assert.equal(state.tags.tag_lucky.displayLabel,'High Priority');
  const assigned=value.setFavoriteTags(state,'uidA',['tag_lucky']);state={...state,favorites:assigned.favorites};
  assert.deepEqual(Array.from(value.filterFavorites(state,{query:'priority',tagIds:['tag_lucky']}),item=>item.ownerUid),['uidA']);
  const deleted=value.softDeleteTag(state,'tag_lucky',{now:3});assert.equal(deleted.tags.tag_lucky.deletedAt,3);assert.deepEqual(Array.from(deleted.favorites.uidA.tagIds),[]);
});

test('Favorites rendering is read-only and history advances only through an explicit open action',()=>{
  const html=readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const render=html.slice(html.indexOf('function renderTrainerQuickLists'),html.indexOf('function toggleTrainerFavorite'));
  assert.doesNotMatch(render,/rememberOpened|lastSeenShareVersion|writeDataPath|queueSync/);
  const opened=html.slice(html.indexOf('function rememberTrainerOpened'),html.indexOf('function publicShareSnapshotFromRuntime'));
  assert.match(opened,/rememberOpened/);
});

test('production page loads the preference candidate but keeps repository and UI inactive',()=>{
  const html=readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.match(html,/js\/domain\/trainerPreferences\.js\?v=/);
  assert.match(html,/js\/data\/trainerPreferencesRepository\.js\?v=/);
  assert.match(html,/js\/ui\/trainerTagPanel\.js\?v=/);
  assert.match(html,/SYNCED_TRAINER_PREFERENCES_ENABLED!==false/);
  assert.match(html,/createTrainerPreferencesRepository\(\{enabled:false\}\)/);
  assert.doesNotMatch(html,/managedTrainerPreferencesRepository\.(read|subscribe)\(/);
});

test('disabled repository has no Firebase write capability',()=>{
  const window={};vm.runInNewContext(readFileSync(path.join(__dirname,'..','js/data/trainerPreferencesRepository.js'),'utf8'),{window});
  const repository=window.PogoData.trainerPreferencesRepository.createTrainerPreferencesRepository({enabled:false});
  assert.equal(repository.enabled,false);assert.equal(typeof repository.write,'undefined');assert.equal(typeof repository.update,'undefined');
  assert.equal(typeof repository.readFavorites,'function');assert.equal(typeof repository.subscribeTags,'function');
  assert.doesNotMatch(readFileSync(path.join(__dirname,'..','js/domain/trainerPreferences.js'),'utf8'),/shareAccess/);
});

test('enabled repository contract is limited to exact private preference child paths',async()=>{
  const window={};vm.runInNewContext(readFileSync(path.join(__dirname,'..','js/data/trainerPreferencesRepository.js'),'utf8'),{window});
  const paths=[];
  const repository=window.PogoData.trainerPreferencesRepository.createTrainerPreferencesRepository({enabled:true,readExact:async path=>{paths.push(path);return{ok:true};},listenExact:path=>{paths.push(path);return{ok:true};}});
  await repository.readFavorites('viewer-a');await repository.readTags('viewer-a');repository.subscribeTagLabels('viewer-a',{});repository.subscribeRecents('viewer-a',{});repository.subscribeHistory('viewer-a',{});
  assert.deepEqual(paths,['userPreferences/viewer-a/favoriteTrainers','userPreferences/viewer-a/trainerTags','userPreferences/viewer-a/trainerTagLabels','userPreferences/viewer-a/recentTrainerSlots','userPreferences/viewer-a/trainerHistory']);
  assert.equal(typeof repository.write,'undefined');
});

test('disabled tag UI models compact mobile chips and rich desktop cards with translation keys',()=>{
  const window={};
  vm.runInNewContext(readFileSync(path.join(__dirname,'..','js/domain/trainerPreferences.js'),'utf8'),{window});
  vm.runInNewContext(readFileSync(path.join(__dirname,'..','js/ui/trainerTagPanel.js'),'utf8'),{window});
  const preferences={tags:{tag_local:{tagId:'tag_local',displayLabel:'Local'}},favorites:{ownerA:{ownerUid:'ownerA',trainerName:'Trainer A',tagIds:['tag_local']}}};
  const mobile=window.PogoUI.trainerTagPanel.viewModel({preferences,compact:true,domain:window.PogoDomain.trainerPreferences});
  const desktop=window.PogoUI.trainerTagPanel.viewModel({preferences,compact:false,domain:window.PogoDomain.trainerPreferences});
  assert.equal(mobile.presentation,'compact_mobile');assert.equal(mobile.favorites[0].presentation,'compact_chip_row');
  assert.equal(desktop.presentation,'rich_desktop');assert.equal(desktop.favorites[0].presentation,'rich_tagged_card');
  assert.deepEqual(Array.from(mobile.actions),['trainer.tagsCreate','trainer.tagsRename','trainer.tagsDelete','trainer.tagsFilter','trainer.tagsSearch']);
  assert.deepEqual(JSON.parse(JSON.stringify(mobile.favorites[0].chips)),[{id:'tag_local',label:'Local'}]);
});
