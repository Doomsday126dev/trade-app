const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const source=readFileSync(path.join(root,'index.html'),'utf8');
const locale=readFileSync(path.join(root,'js/i18n/locales/en.js'),'utf8');
const manifest=JSON.parse(readFileSync(path.join(root,'manifest.json'),'utf8'));

function between(start,end){
  const from=source.indexOf(start),to=source.indexOf(end,from);
  assert.notEqual(from,-1,`Missing ${start}`);
  assert.notEqual(to,-1,`Missing ${end}`);
  return source.slice(from,to);
}

test('interim navigation exposes trainer-first retained surfaces only',()=>{
  const tabs=between('<div class="tabs" role="tablist"','</div>');
  for(const tab of ['mylist','find','schedule','have','settings','admin'])assert.match(tabs,new RegExp(`data-tab="${tab}"`));
  assert.doesNotMatch(tabs,/data-tab="strings"/);
  assert.doesNotMatch(tabs,/data-tab="browse"/);
  assert.match(tabs,/Legacy Inventory/);
  assert.match(tabs,/Events/);
  assert.deepEqual(manifest.shortcuts.slice(2).map(item=>item.name),['Find Trainer','Legacy Inventory','Pokémon GO Events']);
});

test('exact owned mode is active and startup has no broad private listeners',()=>{
  assert.match(source,/const NARROW_READ_CLIENT_ENABLED=true;/);
  assert.match(source,/const LEGACY_BROAD_READS_ENABLED=false;/);
  const protectedReads=between('function ensureProtectedSubscriptions(){','function startListener(){');
  const exactBranch=protectedReads.slice(protectedReads.indexOf('if(ownedExactReadsEnabled())'),protectedReads.indexOf('if(!LEGACY_BROAD_READS_ENABLED)return;'));
  assert.doesNotMatch(exactBranch,/subscribePath\(/);
});

test('selected-trainer bridge loads and listens to publicShares only',()=>{
  const load=between('async function loadShareViewData','function renderUnavailableShareView');
  const listen=between('function ensureShareViewSubscriptions','async function openShareViewFromRequest');
  assert.match(load,/loadPublicShareData/);
  assert.doesNotMatch(load,/users\/|wishlist\/|dynamax\/|gmax\/|costumes\//);
  assert.match(listen,/publicShares\/\$\{username\}/);
  assert.doesNotMatch(listen,/authenticated:true|shareDataPaths/);
});

test('My List owns current-user strings and Trade Match is not in retained navigation',()=>{
  const strings=between('function _renderStringsInner(){','// ── EXPORT');
  assert.match(strings,/const users=\[cur\]\.filter/);
  const tabs=between('<div class="tabs" role="tablist"','</div>');
  assert.doesNotMatch(tabs,/Trade Match|Offers/);
  assert.match(source,/id="my-strings-out"/);
});

test('Find Trainer autocomplete uses the public directory and selected trainer uses public shares only',()=>{
  const find=between('function renderFindTrainer(){','function publicShareRequestFromInput');
  assert.match(find,/Object\.keys\(allData\.loginDirectory\|\|\{\}\)/);
  assert.match(find,/managedPublicShareRepository\.read/);
  assert.match(source,/trainerDiscoveryDomain\.fold\(name\)===trainerDiscoveryDomain\.fold\(value\)/);
  assert.match(source,/bestTrainerSuggestion\(Object\.keys\(allData\.loginDirectory\|\|\{\}\)/);
  assert.match(source,/const resolved=resolvedTrainerSearchValue\(requested\)/);
  assert.doesNotMatch(find,/allData\.users\?\.|wishlist\[|have\[/);
});

test('favorites are owner-scoped local state and event cards use grouped presentation helpers',()=>{
  assert.match(source,/createTrainerHistoryStore\(\{storage:localStorage,identity:\{uid,username:cur\}\}\)/);
  assert.match(source,/eventPresentationDomain\.prepareEvents/);
  for(const key of ['trainer.searchStart','trainer.favoritesTitle','trainer.changesTitle','events.groupNow','events.filterMax']){
    assert.match(locale,new RegExp(`'${key.replace('.','\\.')}'`));
  }
});

test('Legacy Inventory is read-only and export does not write Firebase',()=>{
  const write=between('async function writeHave','function setHaveView');
  assert.match(write,/if\(LEGACY_INVENTORY_READ_ONLY\)/);
  const exportSource=between('function exportLegacyInventoryCsv','function openIncomingOffersModal');
  assert.match(exportSource,/downloadBlob/);
  assert.doesNotMatch(exportSource,/queueSync|set\(|update\(|writeHave/);
});

test('Events bypasses personal schedule, trade, reserved, and quota rendering',()=>{
  const schedule=between('function renderSchedule(){','// ── RESERVED TRADES');
  assert.match(schedule,/if\(TRAINER_FIRST_INTERIM_ENABLED\)\{renderEventsOnly\(\);return;\}/);
});

test('Admin broad reads are owner-gated, on demand, and lifecycle-owned',()=>{
  const adminReads=between('function protectedOwnerSession','function ownedExactReadsEnabled');
  assert.match(adminReads,/cur===OWNER/);
  assert.match(adminReads,/subscribeLegacyAdmin/);
  assert.match(adminReads,/clearLegacyAdmin/);
  const switcher=between('function switchTab','function refreshAll');
  assert.match(switcher,/previous==='admin'.*stopLegacyAdminReads/s);
});

test('retired records remain present and no deletion migration is introduced',()=>{
  for(const pathName of ['offers','trades','communities','communityRequests','have'])assert.match(source,new RegExp(`'${pathName}'`));
  assert.doesNotMatch(source,/deleteRetired|purgeLegacy|removeLegacyData/);
});

test('new unavailable and read-only states use locale keys',()=>{
  for(const key of ['trainer.publicUnavailable','inventory.legacyReadOnly','events.empty','settings.title']){
    assert.match(locale,new RegExp(`'${key.replace('.','\\.')}'`));
  }
  assert.match(source,/i18nCore\.t\('trainer\.publicUnavailable'\)/);
  assert.match(source,/i18nCore\.t\('inventory\.legacyReadOnly'\)/);
});
