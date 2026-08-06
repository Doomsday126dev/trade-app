const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function domain(){const window={};vm.runInNewContext(readFileSync(path.join(__dirname,'..','js/domain/trainerPreferences.js'),'utf8'),{window});return window.PogoDomain.trainerPreferences;}
function favorite(trainerName,addedAt=10,extra={}){return{trainerName,addedAt,note:'',tagIds:[],...extra};}

test('synced preferences stay disabled and bounded',()=>{const value=domain();assert.equal(value.SYNCED_TRAINER_PREFERENCES_ENABLED,false);assert.equal(value.MAX_RECENT_TRAINERS,30);assert.equal(value.MAX_HISTORY_ENTRIES,1500);});

test('future sync states are modeled while the active state remains local-only',()=>{
  const value=domain();
  assert.deepEqual(Array.from(value.PREFERENCE_SYNC_STATES),['local-only','pending-sync','synced','conflict','sync-error']);
  assert.equal(value.preferenceSyncState('pending-sync').state,'local-only');
  assert.equal(value.preferenceSyncState('pending-sync').remoteWritesAllowed,false);
  assert.equal(value.preferenceSyncState('synced',{enabled:true}).state,'local-only');
});

test('tag normalization is NFKC, case-insensitive, whitespace-stable, and display-preserving',()=>{
  const value=domain(),a=value.normalizeTagLabel('  Lucky   Trade  '),b=value.normalizeTagLabel('ＬＵＣＫＹ trade');
  assert.equal(a.displayLabel,'Lucky Trade');assert.equal(a.normalizedLabel,'lucky trade');assert.equal(a.labelKey,b.labelKey);
  assert.equal(value.normalizeTagLabel('   ').error.code,'trainer-preferences/tag-empty');assert.equal(value.normalizeTagLabel('x'.repeat(41)).error.code,'trainer-preferences/tag-too-long');
});

test('favorite and unfavorite are UID-keyed and idempotent',()=>{
  const value=domain();let state={favorites:{}};
  const first=value.favoriteTrainer(state,'owner-a',favorite('Trainer A',20));state={favorites:first.favorites};
  const second=value.favoriteTrainer(state,'owner-a',favorite('Renamed',99));assert.equal(first.changed,true);assert.equal(second.changed,false);assert.equal(second.favorites['owner-a'].addedAt,20);
  const removed=value.unfavoriteTrainer({favorites:second.favorites},'owner-a');assert.equal(removed.changed,true);assert.equal(value.unfavoriteTrainer({favorites:removed.favorites},'owner-a').changed,false);
});

test('cross-device favorite merge preserves earliest addedAt, latest display metadata, and private tags',()=>{
  const value=domain();
  const merged=value.mergeFavorites({a:favorite('Old Name',50,{tagIds:['tag_a']})},{a:favorite('New Name',20,{tagIds:{tag_b:true}}),b:favorite('Trainer B',30)});
  assert.equal(Object.keys(merged.favorites).length,2);assert.equal(merged.favorites.a.addedAt,20);assert.equal(merged.favorites.a.trainerName,'New Name');assert.deepEqual(Array.from(merged.favorites.a.tagIds),['tag_a','tag_b']);
});

test('private notes are bounded and affect only the viewer favorite',()=>{
  const value=domain(),state={favorites:{a:favorite('Trainer A')}};
  const updated=value.updateFavoriteNote(state,'a','  Meet at raid hour  ');assert.equal(updated.favorites.a.note,'Meet at raid hour');assert.equal(value.updateFavoriteNote(state,'a','x'.repeat(241)).error.code,'trainer-preferences/note-too-long');
});

test('tags create, rename, soft-delete, assign, unassign, and filter without duplicate normalized labels',()=>{
  const value=domain();let state={tags:{},favorites:{uidA:{ownerUid:'uidA',...favorite('Trainer Alpha')},uidB:{ownerUid:'uidB',...favorite('Trainer Beta')}}};
  const created=value.createTag(state,'  Lucky Trade  ',{tagId:'tag_lucky',now:1});assert.equal(created.ok,true);state={...state,tags:created.tags};
  assert.equal(value.createTag(state,'ＬＵＣＫＹ trade',{tagId:'tag_duplicate'}).error.code,'trainer-preferences/tag-duplicate');
  const renamed=value.renameTag(state,'tag_lucky','High Priority',{now:2});state={...state,tags:renamed.tags};assert.equal(state.tags.tag_lucky.label,'High Priority');
  state={...state,favorites:value.setFavoriteTags(state,'uidA',['tag_lucky']).favorites};
  assert.deepEqual(Array.from(value.filterFavorites(state,{query:'priority',tagIds:['tag_lucky']}),item=>item.ownerUid),['uidA']);
  state={...state,favorites:value.setFavoriteTags(state,'uidA',[]).favorites};assert.deepEqual(Array.from(state.favorites.uidA.tagIds),[]);
  const deleted=value.softDeleteTag({...state,favorites:{...state.favorites,uidA:{...state.favorites.uidA,tagIds:['tag_lucky']}}},'tag_lucky',{now:3});
  assert.equal(deleted.tags.tag_lucky.active,false);assert.deepEqual(Array.from(deleted.favorites.uidA.tagIds),['tag_lucky']);assert.deepEqual(Array.from(value.filterFavorites({tags:deleted.tags,favorites:deleted.favorites},{tagIds:['tag_lucky']})),[]);
});

test('multi-tag filtering supports any/all and combined trainer/tag search',()=>{
  const value=domain(),state={tags:{tag_local:{tagId:'tag_local',label:'Local',active:true},tag_raid:{tagId:'tag_raid',label:'Raid Group',active:true}},favorites:{a:{ownerUid:'a',...favorite('Alpha'),tagIds:['tag_local','tag_raid']},b:{ownerUid:'b',...favorite('Beta'),tagIds:['tag_local']}}};
  assert.deepEqual(Array.from(value.filterFavorites(state,{tagIds:['tag_local','tag_raid'],matchAllTags:true}),x=>x.ownerUid),['a']);
  assert.deepEqual(Array.from(value.filterFavorites(state,{query:'raid'}),x=>x.ownerUid),['a']);assert.deepEqual(Array.from(value.filterFavorites(state,{query:'beta'}),x=>x.ownerUid),['b']);
});

test('recent trainers rotate deterministically, dedupe owners, and retain exactly 30',()=>{
  const value=domain(),initial=Object.fromEntries(Array.from({length:30},(_,index)=>[String(index).padStart(2,'0'),{ownerUid:`uid-${index}`,trainerName:`Trainer ${index}`,lastOpenedAt:100-index}]));
  const merged=value.mergeRecentTrainerSlots(initial,{ownerUid:'uid-new',trainerName:'New',lastOpenedAt:200});assert.equal(Object.keys(merged.slots).length,30);assert.equal(merged.slots['00'].ownerUid,'uid-new');assert.equal(Object.values(merged.slots).some(item=>item.ownerUid==='uid-29'),false);
  const stale=value.mergeRecentTrainerSlots(merged.slots,{ownerUid:'uid-new',lastOpenedAt:50});assert.equal(stale.slots['00'].lastOpenedAt,200);
});

test('cross-device recent merge converges independent of source order',()=>{
  const value=domain(),a={'00':{ownerUid:'a',trainerName:'A',lastOpenedAt:10}},b={'00':{ownerUid:'a',trainerName:'A2',lastOpenedAt:20},'01':{ownerUid:'b',trainerName:'B',lastOpenedAt:15}};
  assert.deepEqual(JSON.parse(JSON.stringify(value.mergeRecentSlotSets(a,b).slots)),JSON.parse(JSON.stringify(value.mergeRecentSlotSets(b,a).slots)));assert.equal(value.mergeRecentSlotSets(a,b).slots['00'].trainerName,'A2');
});

test('seen history is monotonic and only advances from an authorized available share',()=>{
  const value=domain(),previous={lastSeenShareVersion:5,lastSeenUpdatedAt:500,lastSeenFingerprint:'v5'};
  assert.equal(value.advanceSeenState(previous,{shareStatus:'restricted',lastSeenShareVersion:6}).error.code,'trainer-preferences/share-unavailable');assert.equal(value.advanceSeenState(previous,{shareStatus:'published_public',lastSeenShareVersion:4}).error.code,'trainer-preferences/stale-seen-write');
  assert.equal(value.advanceSeenState(previous,{shareStatus:'published_public',lastSeenShareVersion:5,lastSeenFingerprint:'different'}).error.code,'trainer-preferences/seen-conflict');
  const next=value.advanceSeenState(previous,{shareStatus:'published_public',lastSeenShareVersion:6,lastSeenUpdatedAt:600,lastSeenFingerprint:'v6',lastSeenSnapshot:{Pikachu:{category:'wishlist',fingerprint:'a'}}});assert.equal(next.value.entryCount,1);
});

test('history merge favors newer version and detects same-version conflicts',()=>{
  const value=domain(),old={lastSeenShareVersion:2,lastSeenUpdatedAt:20,lastSeenFingerprint:'a'},newer={lastSeenShareVersion:3,lastSeenUpdatedAt:10,lastSeenFingerprint:'b'};
  assert.equal(value.mergeHistoryState(old,newer).value.lastSeenShareVersion,3);assert.equal(value.mergeHistoryState(old,{...old,lastSeenUpdatedAt:30}).value.lastSeenUpdatedAt,30);assert.equal(value.mergeHistoryState(old,{...old,lastSeenFingerprint:'x'}).error.code,'trainer-preferences/seen-conflict');
});

test('unavailable shares stay neutral and never become mass-removal diffs',()=>{
  const value=domain(),status=value.historyStatus({status:'transport_error',shareVersion:4},{lastSeenShareVersion:3,lastSeenFingerprint:'a'});assert.equal(status.unread,false);assert.equal(status.diffAllowed,false);assert.equal(status.status,'unavailable');
  const diff=value.diffPublicSnapshots({a:{category:'wishlist',fingerprint:'x'}},{a:{category:'gmax',fingerprint:'x'},b:{category:'wishlist',fingerprint:'y'}});assert.deepEqual(JSON.parse(JSON.stringify(diff.counts)),{added:1,removed:0,modified:0,moved:1});
});

test('snapshots over 1500 or with private/malformed fields are rejected',()=>{
  const value=domain(),tooLarge=Object.fromEntries(Array.from({length:1501},(_,index)=>[`entry-${index}`,{category:'wishlist',fingerprint:'x'}]));
  assert.equal(value.normalizeHistorySnapshot(tooLarge).error.code,'trainer-preferences/history-too-large');assert.equal(value.normalizeHistorySnapshot({x:{category:'inventory',fingerprint:'secret'}}).error.code,'trainer-preferences/history-entry-invalid');
});

test('local migration requires matching identity, completed reads, and explicit disabled review',()=>{
  const value=domain(),active={uid:'uid-a',username:'TrainerA'};
  assert.equal(value.planLocalImport({activeIdentity:active,partitionIdentity:{uid:'uid-b',username:'TrainerA'},serverReadsComplete:true}).error.code,'trainer-preferences/partition-mismatch');
  assert.equal(value.planLocalImport({activeIdentity:active,partitionIdentity:active}).error.code,'trainer-preferences/server-read-required');
  const plan=value.planLocalImport({activeIdentity:active,partitionIdentity:active,serverReadsComplete:true,userApproved:true,featureEnabled:false,writesEnabled:false});assert.equal(plan.status,'review_required');assert.equal(plan.writesEnabled,false);assert.equal(plan.deleteLocal,false);
});

test('local migration is deterministic, idempotent, and retains local state until reread verification',()=>{
  const value=domain(),identity={uid:'uid-a',username:'TrainerA'},input={activeIdentity:identity,partitionIdentity:identity,serverReadsComplete:true,local:{favorites:{ownerA:favorite('Alpha',20)}},server:{favorites:{ownerA:favorite('Alpha',10)}}};
  const a=value.planLocalImport(input),b=value.planLocalImport(input);assert.equal(a.fingerprint,b.fingerprint);assert.equal(a.counts.favorites,1);assert.equal(a.preview.favorites.ownerA.addedAt,10);
  assert.equal(value.verifyLocalImport(a,a.preview).deleteLocal,true);assert.equal(value.verifyLocalImport(a,{favorites:{}}).retainLocal,true);
});

test('Favorites rendering is read-only and history advances only through an explicit open action',()=>{
  const html=readFileSync(path.join(__dirname,'..','index.html'),'utf8'),render=html.slice(html.indexOf('function renderTrainerQuickLists'),html.indexOf('function toggleTrainerFavorite'));
  assert.doesNotMatch(render,/rememberOpened|lastSeenShareVersion|writeDataPath|queueSync/);const opened=html.slice(html.indexOf('function rememberTrainerOpened'),html.indexOf('function publicShareSnapshotFromRuntime'));assert.match(opened,/rememberOpened/);
});

test('production page loads the preference candidate but keeps repository and UI inactive',()=>{
  const html=readFileSync(path.join(__dirname,'..','index.html'),'utf8');assert.match(html,/js\/domain\/trainerPreferences\.js\?v=/);assert.match(html,/SYNCED_TRAINER_PREFERENCES_ENABLED!==false/);assert.match(html,/createTrainerPreferencesRepository\(\{enabled:false\}\)/);assert.doesNotMatch(html,/managedTrainerPreferencesRepository\.(read|subscribe|save|remove|merge)/);
});

test('repository exposes no writes until both feature and write gate are true',async()=>{
  const window={};vm.runInNewContext(readFileSync(path.join(__dirname,'..','js/data/trainerPreferencesRepository.js'),'utf8'),{window});const factory=window.PogoData.trainerPreferencesRepository.createTrainerPreferencesRepository;
  const disabled=factory({enabled:false});assert.equal(disabled.enabled,false);assert.equal(typeof disabled.saveFavorite,'undefined');
  const paths=[],readOnly=factory({enabled:true,writesEnabled:false,readExact:async p=>paths.push(p),listenExact:p=>paths.push(p)});await readOnly.readFavorites('viewer-a');readOnly.subscribeHistory('viewer-a',{});assert.equal(typeof readOnly.saveFavorite,'undefined');
  let payload;const writable=factory({enabled:true,writesEnabled:true,readExact:async()=>{},listenExact:()=>{},writeExact:(p,v)=>{paths.push(p);payload=v;},removeExact:(p)=>paths.push(p),transactionExact:(p)=>paths.push(p)});writable.saveFavorite('viewer-a','owner-a',favorite('A',10,{tagIds:['tag_a'],domainOnly:'ignored'}));assert.equal(typeof writable.saveFavorite,'function');assert.ok(paths.includes('userPreferences/viewer-a/favoriteTrainers/owner-a'));assert.deepEqual(JSON.parse(JSON.stringify(payload)),{trainerName:'A',addedAt:10,note:'',tagIds:{tag_a:true}});
});

test('disabled UI models are hidden, inaccessible to save, responsive, and translation-key driven',()=>{
  const window={};vm.runInNewContext(readFileSync(path.join(__dirname,'..','js/domain/trainerPreferences.js'),'utf8'),{window});vm.runInNewContext(readFileSync(path.join(__dirname,'..','js/ui/trainerTagPanel.js'),'utf8'),{window});
  const preferences={tags:{tag_local:{tagId:'tag_local',label:'Local',active:true}},favorites:{ownerA:{ownerUid:'ownerA',...favorite('A very long trainer name that must wrap'),tagIds:['tag_local']}}};
  for(const width of [320,375,390,430,768,1024,1440]){const model=window.PogoUI.trainerTagPanel.viewModel({preferences,width,height:420,domain:window.PogoDomain.trainerPreferences});assert.equal(model.hidden,true);assert.equal(model.interactive,false);assert.equal(model.controls.saveDisabled,true);assert.equal(model.layout.horizontalOverflow,false);assert.equal(model.layout.touchTargetPx>=48,true);assert.equal(model.accessibility.focusTrap,true);}
  assert.equal(window.PogoUI.trainerTagPanel.layoutForWidth(390).mode,'mobile_sheet');assert.equal(window.PogoUI.trainerTagPanel.layoutForWidth(768).mode,'desktop_dialog');
});

test('local organizer model is interactive without enabling remote preference sync',()=>{
  const window={};vm.runInNewContext(readFileSync(path.join(__dirname,'..','js/domain/trainerPreferences.js'),'utf8'),{window});vm.runInNewContext(readFileSync(path.join(__dirname,'..','js/ui/trainerTagPanel.js'),'utf8'),{window});
  const preferences={tags:{tag_local:{tagId:'tag_local',label:'Raid',active:true}},favorites:{ownerA:{ownerUid:'ownerA',...favorite('Trainer A'),tagIds:['tag_local']}}};
  const model=window.PogoUI.trainerTagPanel.localOrganizerViewModel({preferences,query:'raid',tagIds:['tag_local'],width:390,height:300,domain:window.PogoDomain.trainerPreferences});
  assert.equal(model.hidden,false);assert.equal(model.interactive,true);assert.equal(model.syncState,'local-only');assert.equal(model.controls.saveDisabled,false);assert.equal(model.layout.mode,'mobile_sheet');assert.equal(model.layout.touchTargetPx,48);
});

test('private organizer data is absent from public-share publication code',()=>{
  const html=readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const publication=html.slice(html.indexOf('function publicShareSnapshotForUser'),html.indexOf('function applyPublicShareSnapshot'));
  assert.doesNotMatch(publication,/trainerHistoryStore|tagIds|privateNote|\.note\b/);
  assert.match(html,/createTrainerPreferencesRepository\(\{enabled:false\}\)/);
});

test('local organizer storage has no network, logging, URL, clipboard, or export capability',()=>{
  const store=readFileSync(path.join(__dirname,'..','js/data/trainerHistoryStore.js'),'utf8'),html=readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.doesNotMatch(store,/Firebase|firebase|fetch\(|XMLHttpRequest|writeDataPath|queueSync|console\.|location\.|URLSearchParams|copyText|clipboard|export/);
  const references=[...html.matchAll(/trainerHistoryStore/g)].length;
  assert.equal(references,10);
  for(const boundary of [
    ['function publicShareSnapshotForUser','function requestPublicSharePublication'],
    ['function renderStrings','function renderBrowse'],
    ['function exportMyListMarkdown','function exportMyListCSV'],
    ['function exportMyListCSV','function copyShareLink'],
    ['function checkShareViewParam','function enterShareView']
  ]){
    const section=html.slice(html.indexOf(boundary[0]),html.indexOf(boundary[1],html.indexOf(boundary[0])));
    assert.doesNotMatch(section,/trainerHistoryStore|trainerOrganizerState|draftNote|draftTagIds/);
  }
});

test('tag deletion is confirmed and stable IDs preserve assignments across rename',()=>{
  const html=readFileSync(path.join(__dirname,'..','index.html'),'utf8'),deletion=html.slice(html.indexOf('function deleteLocalTrainerTag'),html.indexOf('function saveTrainerOrganizer'));
  assert.match(deletion,/confirm\(i18nCore\.t\('organizer\.deleteConfirm'/);
  const value=domain(),created=value.createTag({tags:{}},'Raid',{tagId:'tag_stable',now:1});
  const renamed=value.renameTag({tags:created.tags},'tag_stable','レイド',{now:2});
  assert.equal(renamed.ok,true);assert.equal(renamed.tags.tag_stable.displayLabel,'レイド');
});
