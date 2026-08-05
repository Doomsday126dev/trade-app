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

test('Favorites rendering is read-only and history advances only through an explicit open action',()=>{
  const html=readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const render=html.slice(html.indexOf('function renderTrainerQuickLists'),html.indexOf('function toggleTrainerFavorite'));
  assert.doesNotMatch(render,/rememberOpened|lastSeenShareVersion|writeDataPath|queueSync/);
  const opened=html.slice(html.indexOf('function rememberTrainerOpened'),html.indexOf('function publicShareSnapshotFromRuntime'));
  assert.match(opened,/rememberOpened/);
});

test('production page does not load or activate synced preference candidate',()=>{
  const html=readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.doesNotMatch(html,/js\/domain\/trainerPreferences\.js/);
  assert.doesNotMatch(html,/SYNCED_TRAINER_PREFERENCES_ENABLED/);
  assert.doesNotMatch(html,/trainerTagLabels\//);
});
