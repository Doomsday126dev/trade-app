const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');

function memoryStorage(){const values=new Map();return{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
function store(){const window={};for(const file of ['js/domain/productLimits.js','js/data/trainerHistoryStore.js'])vm.runInNewContext(readFileSync(path.join(root,file),'utf8'),{window});return window.PogoData.trainerHistoryStore.createTrainerHistoryStore({storage:memoryStorage(),identity:{uid:'uid-a',username:'TrainerA'},now:(()=>{let n=100;return()=>++n;})()});}

test('Find Trainer uses one compact combobox with inline clear and no submit button',()=>{
  const block=html.slice(html.indexOf('<!-- FIND TRAINER'),html.indexOf('<!-- MY LIST'));
  assert.match(block,/class="trainer-search-shell discovery-search-shell search-lookup"/);
  assert.match(block,/role="combobox" aria-autocomplete="list"/);
  assert.match(block,/id="find-trainer-clear"/);
  assert.doesNotMatch(block,/id="find-trainer-button"/);
  assert.match(html,/function syncTrainerSearchClear/);
  assert.match(html,/event\.key==='Enter'/);
});

test('Favorites search is a stable shared-shell control outside the rendered results subtree',()=>{
  const html=readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const setter=html.slice(html.indexOf('function setFavoriteSearch'),html.indexOf('function favoriteTrainerAction'));
  const render=html.slice(html.indexOf('async function renderTrainerQuickLists'),html.indexOf('function toggleTrainerFavorite'));
  assert.match(setter,/renderTrainerQuickLists\(\{favoritesOnly:true\}\)/);
  assert.doesNotMatch(setter,/renderTrainerQuickLists\(\)/);
  assert.match(html,/id="favorite-trainer-search"/);
  assert.ok(html.indexOf('id="favorite-trainer-search"')<html.indexOf('id="favorite-trainers-controls"'));
  assert.match(render,/if\(!preserveFavoriteControls\)favoritesControlsEl\.innerHTML/);
  assert.match(render,/if\(favoritesOnly\)return/);
  assert.match(render,/data-favorite-clear/);
});

test('Favorite Browse derives reciprocal hints from the canonical legacy inventory shape',()=>{
  const render=html.slice(html.indexOf('function renderFavoriteBrowseResults'),html.indexOf('async function hydrateFavoriteBrowse'));
  assert.match(render,/Object\.entries\(allData\.have\?\.\[cur\]\|\|\{\}\)/);
  assert.match(render,/haveEntryInfo\(value\)\.qty>0/);
  assert.match(render,/splitHaveKey\(key\)\.name/);
  assert.doesNotMatch(render,/diffInventoryEntries/);
});

test('trainer search, Favorites, and Find by Pokémon are sibling discovery modes',()=>{
  const block=html.slice(html.indexOf('<!-- FIND TRAINER'),html.indexOf('<!-- MY LIST'));
  const trainer=block.indexOf('class="trainer-search-shell discovery-search-shell search-lookup"');
  const favorites=block.indexOf('id="favorite-trainers"');
  const browse=block.indexOf('id="favorite-pokemon-browse"');
  const favoriteList=block.indexOf('id="favorite-trainers-list"');
  const recents=block.indexOf('id="recent-trainers"');
  assert.ok(trainer>=0&&favorites>trainer&&favoriteList>favorites&&browse>favoriteList&&recents>browse);
  assert.match(block,/class="trainer-discovery-modes"/);
  assert.match(block,/class="trainer-discovery-workspace"/);
  assert.match(block,/class="trainer-discovery-primary"/);
  assert.match(block,/focusTrainerDiscoveryMode\('trainers'\)/);
  assert.match(block,/focusTrainerDiscoveryMode\('favorites'\)/);
  assert.match(block,/focusTrainerDiscoveryMode\('pokemon'\)/);
  assert.doesNotMatch(block,/id="favorite-browse-toggle"|favorite-browse-disclosure/);
  assert.match(block,/id="favorite-pokemon-browse"[^>]+data-expanded="true"/);
  assert.match(block,/class="favorite-browse-content" id="favorite-browse-panel"/);
  assert.doesNotMatch(block,/class="favorite-browse-panel"/);
  assert.doesNotMatch(block,/id="favorite-browse-panel" hidden/);
  assert.match(block,/id="favorite-browse-input"[^>]*role="combobox" aria-autocomplete="list"/);
  assert.match(block,/id="favorite-browse-results" role="region" aria-live="polite"/);
  assert.match(block,/role="tab"[^>]+data-discovery-mode="trainers"[^>]+aria-selected="true" aria-current="true"/);
  for(const mode of ['trainers','favorites','pokemon'])assert.match(block,new RegExp(`data-discovery-panel="${mode}"`));
  assert.equal((block.match(/id="find-trainer-input"/g)||[]).length,1);
  assert.match(html,/favoriteBrowseCatalog\(\)[\s\S]*rankAutocompleteItems/);
  assert.match(html,/favoriteBrowseState\.selected=\{name:item\.name,dn:item\.dn,no:item\.no\};favoriteBrowseState\.error=false;favoriteBrowseState\.expanded=true/);
  const focus=html.slice(html.indexOf('function setTrainerDiscoveryMode'),html.indexOf('function positionTrainerSuggestions'));
  assert.match(focus,/content\.dataset\.mode=trainerDiscoveryMode/);
  assert.match(focus,/panel\.hidden=panel\.dataset\.discoveryPanel!==trainerDiscoveryMode/);
  assert.match(focus,/setAttribute\('aria-selected',String\(selected\)\)/);
  assert.match(focus,/focus\(\{preventScroll:true\}\)/);
  assert.doesNotMatch(focus,/scrollIntoView|scrollTo/);
  assert.match(focus,/\['ArrowLeft','ArrowRight','Home','End'\]/);
  const inputFocusStart=html.indexOf('function trainerSearchFocused');
  const inputFocus=html.slice(inputFocusStart,html.indexOf('window.visualViewport',inputFocusStart));
  assert.match(inputFocus,/queueTrainerSuggestions/);
  assert.doesNotMatch(inputFocus,/scrollIntoView|scrollTo/);
  assert.match(block,/class="trainer-search-shell discovery-search-shell search-lookup"/);
  assert.match(html,/class="favorite-toolbar-search discovery-search-shell app-search-shell search-filter"/);
  assert.match(block,/class="favorite-browse-search discovery-search-shell app-search-shell search-lookup"/);
  assert.equal((block.match(/discovery-search-shell/g)||[]).length,3);
  assert.match(block,/id="trainer-favorites-preview"/);
  assert.match(block,/class="trainer-discovery-supporting"/);
  assert.match(html,/\.trainer-discovery-workspace\{display:grid;grid-template-columns:/);
  assert.match(html,/@media\(max-width:899px\)\{\.trainer-discovery-workspace\{grid-template-columns:minmax\(0,1fr\)/);
});

test('trainer suggestions suppress stale renders and always settle loading or explicit error state',()=>{
  assert.match(html,/let trainerSuggestionGeneration=0/);
  assert.match(html,/const generation=\+\+trainerSuggestionGeneration/);
  assert.match(html,/generation!==trainerSuggestionGeneration/);
  assert.match(html,/trainer-suggestion-name/);
  assert.match(html,/setTimeout\(\(\)=>settleTrainerSuggestions\(value,generation\)/);
  assert.match(html,/function settleTrainerSuggestions[\s\S]*trainer\.searchError/);
  assert.match(html,/setTrainerRecovery\(true,\{retry:true\}\)/);
  assert.match(html,/id="find-trainer-retry"/);
  assert.doesNotMatch(html,/tradeListOffers\(/);
  assert.match(html,/trainer\.noVisibleMatch/);
});

test('Favorite creation is idempotent and saves stable tag assignments',()=>{
  const value=store(),raid=value.ensureTag('Raid'),friend=value.ensureTag('Friend');
  const first=value.saveFavoriteOrganization('ScoopskiPotat0',{tagIds:[raid.id,friend.id]});
  const second=value.saveFavoriteOrganization('scoopskipotat0',{tagIds:[raid.id]});
  assert.equal(first.ok,true);assert.equal(first.created,true);assert.equal(second.created,false);
  const favorite=value.favoriteFor('ScoopskiPotat0');assert.equal(value.read().favorites.length,1);assert.deepEqual(Array.from(favorite.tagIds),[raid.id]);assert.equal('note' in favorite,false);
});

test('Favorite creation supports no organization and normalized tag reuse',()=>{
  const value=store(),empty=value.saveFavoriteOrganization('PlainTrainer'),first=value.ensureTag(' Trade Often '),duplicate=value.ensureTag('ＴＲＡＤＥ　ＯＦＴＥＮ');
  assert.equal(empty.ok,true);assert.deepEqual(Array.from(value.favoriteFor('PlainTrainer').tagIds),[]);assert.equal(value.favoriteFor('PlainTrainer').note,undefined);
  assert.equal(first.created,true);assert.equal(duplicate.created,false);assert.equal(duplicate.id,first.id);assert.equal(Object.keys(value.read().tags).length,1);
});

test('Favorite UI uses one compact tag organizer and makes removal destructive',()=>{
  assert.match(html,/showFavoriteSavedPrompt\(username\)/);
  assert.match(html,/openTrainerOrganizer\(username\)/);
  assert.doesNotMatch(html,/organizer-note|favorite-note-indicator|organizer\.hasPrivateNote/);
  assert.match(html,/function removeTrainerFavorite[\s\S]*organizer\.removeConfirm/);
  assert.match(html,/class="favorite-card-menu" role="menu" hidden/);
  assert.match(html,/role="menuitem" class="danger" data-trainer-action="remove"/);
});

test('inline tag creation selects new or normalized-existing tags and has scoped keyboard behavior',()=>{
  const create=html.slice(html.indexOf('function createLocalTrainerTag'),html.indexOf('function renameLocalTrainerTag'));
  assert.match(create,/ensureTag/);assert.match(create,/setFavoriteTags/);assert.match(create,/organizer\.tagSelected/);
  assert.match(html,/function trainerTagInputKeydown[\s\S]*event\.key==='Enter'[\s\S]*event\.key==='Escape'/);
  assert.match(html,/onkeydown="trainerTagInputKeydown\(event\)"/);
});

test('Settings exposes seven semantic sections with desktop and mobile navigation',()=>{
  for(const section of ['profile','language','appearance','security','tools','data','legal']){assert.match(html,new RegExp(`data-settings-target="${section}"`));assert.match(html,new RegExp(`data-settings-section="${section}"`));}
  assert.match(html,/function selectSettingsSection/);assert.match(html,/function showSettingsSectionList/);
  assert.match(html,/settings-layout\.mobile-list \.settings-detail\{display:none\}/);
  assert.match(html,/settingsDetailIsOpenOnMobile/);
  assert.match(html,/const SETTINGS_SECTIONS=Object\.freeze\(\['profile','language','appearance','security','tools','data','legal'\]\)/);
  assert.match(html,/function parseSettingsRoute/);
  assert.match(html,/settings-page-mode/);
  for(const tool of ['inventory','import','export','safe-transfer','shortcuts','health','backup'])assert.match(html,new RegExp(`openSettingsTool\\('${tool}'\\)`));
  assert.doesNotMatch(html,/openSettingsTool\('restore'\)/);
  assert.match(html,/settings-admin-only[^>]+hidden/);
  assert.match(html,/\.settings-account-only\[hidden\],\.settings-admin-only\[hidden\]\{display:none!important\}/);
});

test('Settings keeps language behavior, provider rows inert, and local-only data status',()=>{
  assert.match(html,/id="settings-language" onchange="changeInterfaceLocale\(this\.value\)"/);
  const security=html.slice(html.indexOf('id="settings-account-security"'),html.indexOf('</section>',html.indexOf('id="settings-account-security"')));
  assert.doesNotMatch(security,/linkWithPopup|linkWithRedirect|data-action=/);
  assert.match(html,/data-i18n="trainer\.syncState\.local-only"/);
  assert.match(html,/id="settings-install" onclick="triggerInstall\(\)"/);
  assert.match(html,/createTrainerPreferencesRepository\(\{enabled:false\}\)/);
});

test('responsive contracts retain 48px targets, wrapping, and no parallel organizer store',()=>{
  assert.match(html,/@media\(max-width:767px\)[\s\S]*settings-layout\.mobile-list/);
  assert.match(html,/\.organizer-selectable-chip\{[^}]*min-height:48px/);
  assert.match(html,/\.favorite-saved-prompt button\{min-height:48px/);
  assert.match(html,/overflow-wrap:anywhere/);
  assert.equal((html.match(/createTrainerHistoryStore\(/g)||[]).length,1);
});

test('release and safety boundaries remain coherent',()=>{
  assert.match(html,/2026-08-27\.75/);assert.doesNotMatch(html,/2026-08-27\.74/);
  assert.match(readFileSync(path.join(root,'js/domain/shareVisibility.js'),'utf8'),/SHARE_VISIBILITY_MODEL_ENABLED\s*:\s*false/);assert.match(html,/SYNCED_TRAINER_PREFERENCES_ENABLED!==false/);
  assert.doesNotMatch(html,/managedTrainerPreferencesRepository\.(?:mutate|write|save)/);
});
