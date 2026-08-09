const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');

function memoryStorage(){const values=new Map();return{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
function store(){const window={};vm.runInNewContext(readFileSync(path.join(root,'js/data/trainerHistoryStore.js'),'utf8'),{window});return window.PogoData.trainerHistoryStore.createTrainerHistoryStore({storage:memoryStorage(),identity:{uid:'uid-a',username:'TrainerA'},now:(()=>{let n=100;return()=>++n;})()});}

test('Find Trainer uses one compact combobox with inline clear and no submit button',()=>{
  const block=html.slice(html.indexOf('<!-- FIND TRAINER'),html.indexOf('<!-- MY LIST'));
  assert.match(block,/class="trainer-search-shell search-lookup"/);
  assert.match(block,/role="combobox" aria-autocomplete="list"/);
  assert.match(block,/id="find-trainer-clear"/);
  assert.doesNotMatch(block,/id="find-trainer-button"/);
  assert.match(html,/function syncTrainerSearchClear/);
  assert.match(html,/event\.key==='Enter'/);
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
  assert.match(html,/role="menuitem" class="danger" onclick="removeTrainerFavorite/);
});

test('inline tag creation selects new or normalized-existing tags and has scoped keyboard behavior',()=>{
  const create=html.slice(html.indexOf('function createLocalTrainerTag'),html.indexOf('function renameLocalTrainerTag'));
  assert.match(create,/ensureTag/);assert.match(create,/setFavoriteTags/);assert.match(create,/organizer\.tagSelected/);
  assert.match(html,/function trainerTagInputKeydown[\s\S]*event\.key==='Enter'[\s\S]*event\.key==='Escape'/);
  assert.match(html,/onkeydown="trainerTagInputKeydown\(event\)"/);
});

test('Settings exposes six semantic sections with desktop and mobile navigation',()=>{
  for(const section of ['profile','language','appearance','security','tools','data']){assert.match(html,new RegExp(`data-settings-target="${section}"`));assert.match(html,new RegExp(`data-settings-section="${section}"`));}
  assert.match(html,/function selectSettingsSection/);assert.match(html,/function showSettingsSectionList/);
  assert.match(html,/settings-layout\.mobile-list \.settings-detail\{display:none\}/);
  assert.match(html,/settingsDetailIsOpenOnMobile/);
  assert.match(html,/const SETTINGS_SECTIONS=Object\.freeze\(\['profile','language','appearance','security','tools','data'\]\)/);
  assert.match(html,/function parseSettingsRoute/);
  assert.match(html,/settings-page-mode/);
  for(const tool of ['inventory','import','export','safe-transfer','shortcuts','health','backup','restore'])assert.match(html,new RegExp(`openSettingsTool\\('${tool}'\\)`));
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
  assert.match(html,/2026-08-05\.30/);assert.doesNotMatch(html,/2026-08-05\.29/);
  assert.match(readFileSync(path.join(root,'js/domain/shareVisibility.js'),'utf8'),/SHARE_VISIBILITY_MODEL_ENABLED\s*:\s*false/);assert.match(html,/SYNCED_TRAINER_PREFERENCES_ENABLED!==false/);
  assert.doesNotMatch(html,/managedTrainerPreferencesRepository\.(?:mutate|write|save)/);
});
