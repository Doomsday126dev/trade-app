const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');

function loadRelativeTimeDomain(){
  const window={};
  vm.runInNewContext(readFileSync(path.join(root,'js/domain/relativeTime.js'),'utf8'),{window});
  return window.PogoDomain.relativeTime;
}

function memoryStorage(){
  const values=new Map();
  return{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}

function createStore(maxFavorites=100){
  const window={};
  vm.runInNewContext(readFileSync(path.join(root,'js/data/trainerHistoryStore.js'),'utf8'),{window});
  return window.PogoData.trainerHistoryStore.createTrainerHistoryStore({
    storage:memoryStorage(),identity:{uid:'uid-local',username:'LocalTrainer'},maxFavorites,maxRecent:30,
    now:(()=>{let value=1000;return()=>++value;})()
  });
}

test('Find Trainer presents lookup, Favorites, then Recents without space-saving tabs',()=>{
  const markup=html.slice(html.indexOf('<!-- FIND TRAINER'),html.indexOf('<!-- MY LIST'));
  assert.ok(markup.indexOf('id="find-trainer-input"')<markup.indexOf('id="favorite-trainers"'));
  assert.ok(markup.indexOf('id="favorite-trainers"')<markup.indexOf('id="favorite-pokemon-browse"'));
  assert.ok(markup.indexOf('id="favorite-pokemon-browse"')<markup.indexOf('id="favorite-trainers-list"'));
  assert.ok(markup.indexOf('id="favorite-trainers"')<markup.indexOf('id="recent-trainers"'));
  assert.doesNotMatch(markup,/role="tablist"|trainer-history-tabs/);
  assert.match(html,/\.trainer-quick-grid,\.recent-trainer-list\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
});

test('Favorites retain exact local schema-v3 behavior through 0, 25, and 100 records',()=>{
  for(const count of [0,25,100]){
    const store=createStore(100);
    for(let index=0;index<count;index++)store.toggleFavorite(`Trainer ${String(index).padStart(3,'0')}`);
    const state=store.read();
    assert.equal(state.schemaVersion,3);
    assert.equal(state.syncState,'local-only');
    assert.equal(state.favorites.length,count);
    assert.equal(store.filterFavorites({query:'trainer',tagIds:[]}).length,count);
  }
});

test('favorite filters remain scoped, multi-tag, keyboard-native buttons with non-color state',()=>{
  const render=html.slice(html.indexOf('async function renderTrainerQuickLists'),html.indexOf('function toggleTrainerFavorite'));
  assert.match(render,/class="favorite-toolbar-search app-search-shell search-filter"/);
  assert.match(render,/aria-pressed="\$\{selected\}"/);
  assert.match(render,/favorite-filter-check/);
  assert.match(render,/favorite-filter-group/);
  assert.match(render,/favorite-filter-chip-surface/);
  assert.match(html,/function toggleFavoriteTagFilter[\s\S]*new Set\(trainerOrganizerState\.tagIds\)/);
  assert.match(html,/\.favorite-filter-chip\{[^}]*min-height:48px/);
  assert.match(html,/\.favorite-filter-chip-surface\{[^}]*min-height:30px/);
});

test('compact favorite rows preserve tags, Open Trainer, overflow, and optional swipe parity',()=>{
  const render=html.slice(html.indexOf('async function renderTrainerQuickLists'),html.indexOf('function toggleTrainerFavorite'));
  assert.match(render,/favoriteTagChips\(item,state\)/);
  assert.match(render,/favorite-card-add-tag/);
  assert.match(render,/favorite-card-open/);
  assert.match(render,/favorite-card-more[^>]+aria-haspopup="menu"/);
  assert.match(render,/favorite-card-menu" role="menu"/);
  assert.match(html,/touch-action:pan-y/);
  assert.match(html,/favorite-card-shell\.swipe-open/);
});

test('Recent Trainers render as one native row action without nested competing controls',()=>{
  const render=html.slice(html.indexOf('async function renderTrainerQuickLists'),html.indexOf('function toggleTrainerFavorite'));
  assert.match(render,/<button type="button" class="recent-trainer-row card-row"[^>]+data-trainer-action="open"/);
  assert.match(render,/class="recent-trainer-chevron" aria-hidden="true">\$\{uiIconMarkup\('chevron-right','ui-icon ui-icon-sm'\)\}<\/span><\/button>/);
  assert.match(render,/class="trainer-quick-name recent-trainer-name type-card"/);
  assert.match(render,/class="trainer-quick-meta recent-trainer-recency type-meta"/);
  assert.doesNotMatch(render,/recent-trainer-row[\s\S]{0,500}<button class="trainer-icon-btn/);
  assert.match(html,/\.recent-trainer-row\{[^}]*min-height:64px/);
});

test('Recent Trainer recency uses coarse deterministic thresholds without a timer',()=>{
  const {recentTrainerRecency}=loadRelativeTimeDomain();
  const now=Date.UTC(2026,7,9,12);
  assert.deepEqual({...recentTrainerRecency(now-30000,now)},{kind:'just-now',value:0,unit:'second',timestamp:now-30000});
  assert.deepEqual({...recentTrainerRecency(now-12*60000,now)},{kind:'relative',value:12,unit:'minute',timestamp:now-12*60000});
  assert.deepEqual({...recentTrainerRecency(now-3*3600000,now)},{kind:'relative',value:3,unit:'hour',timestamp:now-3*3600000});
  assert.deepEqual({...recentTrainerRecency(now-2*86400000,now)},{kind:'relative',value:2,unit:'day',timestamp:now-2*86400000});
  assert.deepEqual({...recentTrainerRecency(now-3*604800000,now)},{kind:'relative',value:3,unit:'week',timestamp:now-3*604800000});
  assert.deepEqual({...recentTrainerRecency(now-40*86400000,now)},{kind:'date',timestamp:now-40*86400000});
  assert.equal(/setInterval|setTimeout/.test(recentTrainerRecency.toString()),false);
});

test('favorite timestamps are omitted while unavailable/change state and recent recency remain',()=>{
  const render=html.slice(html.indexOf('async function renderTrainerQuickLists'),html.indexOf('function toggleTrainerFavorite'));
  assert.doesNotMatch(render,/trainerDate\(updatedAt\)/);
  assert.match(render,/trainer\.listUnavailable/);
  assert.match(render,/trainer-change-counts/);
  assert.match(render,/trainerViewedText\(item\.openedAt\)/);
  assert.match(html,/trainer\.viewedJustNow/);
  assert.match(html,/trainer\.viewedDate/);
});

test('empty and filtered states remain concise, localized, and local-only',()=>{
  for(const key of ['organizer.noFavorites','organizer.noFavoritesHelp','organizer.noMatches','organizer.noMatchesHelp','trainer.noRecents','trainer.noRecentsHelp']){
    assert.match(html,new RegExp(key.replace('.','\\.')));
  }
  assert.match(html,/noteEl\.style\.display='none'/);
  assert.match(html,/SYNCED_TRAINER_PREFERENCES_ENABLED!==false/);
  assert.doesNotMatch(html,/managedTrainerPreferencesRepository\.(?:mutate|write|save)/);
});

test('idle trainer lookup hides its live region until lookup work begins',()=>{
  assert.match(html,/\.trainer-search-status:empty\{display:none\}/);
  assert.match(html,/function renderFindTrainer\(\)[\s\S]*status\.textContent=''/);
  assert.match(html,/if\(query\.length<2\)[\s\S]*status\.textContent=''/);
  assert.match(html,/queueTrainerSuggestions[\s\S]*trainer\.searching/);
});
