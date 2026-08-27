const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);
const manifest=JSON.parse(readFileSync(path.join(root,'manifest.json'),'utf8'));
const physicalSmoke=readFileSync(path.join(root,'docs/TRAINER-FIRST-PHYSICAL-SMOKE.md'),'utf8');
const shareVisibility=readFileSync(path.join(root,'js/domain/shareVisibility.js'),'utf8');
const trainerPreferences=readFileSync(path.join(root,'js/domain/trainerPreferences.js'),'utf8');

function block(start,end){
  const from=html.indexOf(start),to=html.indexOf(end,from);
  assert.notEqual(from,-1,`missing ${start}`);assert.notEqual(to,-1,`missing ${end}`);
  return html.slice(from,to);
}

test('conflict safety requires an explicit choice and inaction never selects saved data',()=>{
  const source=block('function showConflictModal','// ── IMPORT FROM SEARCH STRING');
  assert.match(source,/conflict\.reviewLater/);
  assert.match(source,/conflict\.useSaved/);
  assert.match(source,/conflict\.keepDevice/);
  assert.match(source,/event\.key==='Escape'/);
  assert.match(source,/previousFocus\?\.focus\?\.\(\{preventScroll:true\}\)/);
  assert.doesNotMatch(source,/aria-modal/);
  assert.doesNotMatch(source,/setTimeout|30000|default to remote/);
  assert.match(source,/`\$\{id\}-later`\)\.onclick=close/);
  assert.doesNotMatch(source,/`\$\{id\}-later`\)\.onclick=.*onRemote/);
});

test('contextual trainer-first guidance is visible without enabling the retired forced tour',()=>{
  assert.match(html,/id="mylist-guidance-title"/);
  assert.doesNotMatch(html,/id="find-guidance-title"/);
  assert.match(html,/data-i18n="trainer\.findDescription"|id="find-trainer-description"/);
  for(const key of ['guidance.myListBody','guidance.findTrainer','guidance.exploreEvents'])assert.match(html,new RegExp(key.replace('.','\\.')));
  const tour=block('function maybeStartTour','// ── EXPOSE');
  assert.match(tour,/if\(TRAINER_FIRST_INTERIM_ENABLED\)return/);
});

test('Legacy Inventory is a Settings App & Data read-only route and no longer a tab or shortcut',()=>{
  const tabs=block('<div class="tabs" role="tablist"','<!-- BROWSE -->');
  assert.doesNotMatch(tabs,/data-tab="have"|Legacy Inventory/);
  assert.doesNotMatch(html,/id="account-legacy-inventory-action"/);
  assert.match(html,/onclick="openSettingsTool\('inventory'\)"/);
  assert.match(html,/function openLegacyInventoryTool\(\)\{closeAccountMenu\(false\);switchTab\('have'\);\}/);
  assert.match(html,/else if\(action==='have'\)/);
  assert.equal(manifest.shortcuts.some(item=>item.url.includes('action=have')),false);
});

test('Events expose Now Soon Later hierarchy accessible filters and one source action',()=>{
  const source=block('function setEventTypeFilter','function renderSchedule');
  assert.match(source,/eventFilterKeydown/);
  assert.match(source,/ArrowLeft.*ArrowRight.*Home.*End/s);
  assert.match(source,/role="group".*aria-pressed=/s);
  assert.match(source,/data-group="\$\{section\.group\}"/);
  assert.match(source,/section\.group==='now'\?'is-active'/);
  assert.match(source,/eventPresentationDomain\.eventTiming/);
  assert.match(source,/const tag=link\?'a':'article'/);
  assert.match(source,/aria-label=.*events\.openDetailsFor/s);
  assert.doesNotMatch(source,/event-card-bonuses|visibleBonuses/);
  assert.match(html,/\.event-filter\{[^}]*min-height:48px/);
});

test('backup export remains while production root restore is fail-closed',()=>{
  const source=block('function exportData','function renderSecurityPanel');
  assert.match(source,/new Blob\(\[JSON\.stringify\(s,null,2\)\]/);
  assert.match(source,/PRODUCTION_ROOT_RESTORE_ENABLED=false/);
  assert.doesNotMatch(html,/restore-file|function restoreData|function triggerRestore|set\(ref\(db,'\/'\)/);
});

test('locale changes rerender only the active heavy surface',()=>{
  const source=block('function changeInterfaceLocale','let trainerSuggestionTimer');
  for(const name of ['mylist','find','schedule','have','admin'])assert.match(source,new RegExp(`active==='${name}'`));
  assert.doesNotMatch(source,/renderBrowse\(\)/);
  assert.match(source,/settings-modal.*renderSettings\(\)/s);
  assert.match(source,/_activeShareView\?\.username.*renderShareView/s);
  assert.doesNotMatch(source,/fetchPogoEvents|Firebase|queueSync|writeList/);
});

test('Find Trainer no-result recovery stays deterministic',()=>{
  const source=block('function renderTrainerSuggestions','function trainerSearchKeydown');
  assert.match(source,/trainer\.noVisibleMatch/);
  assert.match(source,/setTrainerRecovery\(true\)/);
  assert.match(source,/function clearTrainerSearch/);
  assert.match(source,/function focusTrainerSearch/);
  assert.match(source,/matchType/);
  assert.match(source,/trainerSuggestionGeneration/);
});

test('physical smoke checklist remains explicitly pending',()=>{
  for(const label of ['iPhone Safari','Installed iOS PWA','Android Chrome','Installed Android PWA'])assert.match(physicalSmoke,new RegExp(label));
  assert.match(physicalSmoke,/externally pending/i);
  assert.match(physicalSmoke,/Do not mark a row passed/i);
});

test('safety flags and backend gates remain disabled',()=>{
  assert.match(shareVisibility,/SHARE_VISIBILITY_MODEL_ENABLED\s*:\s*false/);
  assert.match(trainerPreferences,/SYNCED_TRAINER_PREFERENCES_ENABLED\s*:\s*false/);
  assert.doesNotMatch(shareVisibility,/SHARE_VISIBILITY_MODEL_ENABLED\s*:\s*true/);
  assert.doesNotMatch(trainerPreferences,/SYNCED_TRAINER_PREFERENCES_ENABLED\s*:\s*true/);
});
