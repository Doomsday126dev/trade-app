const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
function load(){
  const window={};const context=vm.createContext({window});
  for(const file of ['js/domain/trainerPreferenceSync.js','js/ui/trainerTagPanel.js','js/testing/trainerPreferenceSyncMockAdapter.js']){
    vm.runInContext(readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  }
  return window;
}
function adapter(window){return window.PogoTesting.trainerPreferenceSyncMockAdapter.createTrainerPreferenceSyncMockAdapter({testMode:true,environment:'test'});}

test('only local-only status is reachable while either sync gate is disabled',()=>{
  const window=load(),ui=window.PogoUI.trainerTagPanel,sync=window.PogoDomain.trainerPreferenceSync;
  for(const state of ['pending-sync','synced','conflict','sync-error']){
    assert.equal(ui.syncStatusViewModel({featureEnabled:false,writesEnabled:true,state,syncDomain:sync}).state,'local-only');
    assert.equal(ui.syncStatusViewModel({featureEnabled:true,writesEnabled:false,state,syncDomain:sync}).state,'local-only');
  }
  const status=ui.syncStatusViewModel({state:'pending-sync',reducedMotion:false,syncDomain:sync});
  assert.deepEqual([status.icon,status.statusKey,status.detailKey,status.animated],['device','trainer.syncState.local-only','trainer.syncStatus.localOnlyDetail',false]);
});

test('future status presentation uses icon and text with reduced-motion-safe announcements',()=>{
  const window=load(),ui=window.PogoUI.trainerTagPanel,sync=window.PogoDomain.trainerPreferenceSync;
  assert.equal(ui.syncStatusViewModel({featureEnabled:true,writesEnabled:true,state:'pending-sync',syncDomain:sync}).state,'local-only');
  const pending=ui.syncStatusViewModel({featureEnabled:true,writesEnabled:true,previewSource:'deterministic-mock',state:'pending-sync',reducedMotion:true,lastSuccessfulSyncAt:50,syncDomain:sync});
  assert.equal(pending.iconAndText,true);assert.equal(pending.colorOnly,false);assert.equal(pending.ariaLive,'polite');assert.equal(pending.animated,false);
  assert.equal(pending.lastSuccessKey,'trainer.syncLastSuccess');
  const local=ui.syncStatusViewModel({syncDomain:sync});assert.equal(local.lastSuccessKey,'trainer.syncLastSuccessNever');
});

test('all conflict components accept deterministic fixtures only and stay hidden while disabled',()=>{
  const window=load(),ui=window.PogoUI.trainerTagPanel,mock=adapter(window);
  for(const kind of ['tag-rename','favorite-stale','offline-newer-remote','stale-schema']){
    const fixture=mock.fixture(kind),disabled=ui.conflictViewModel({kind,fixture,width:390,height:300});
    assert.equal(disabled.fixtureAccepted,true);assert.equal(disabled.hidden,true);assert.equal(disabled.interactive,false);
    assert.ok(disabled.choices.every(choice=>choice.disabled));assert.equal(disabled.layout.horizontalOverflow,false);assert.equal(disabled.layout.touchTargetPx,48);
    const enabled=ui.conflictViewModel({kind,fixture,featureEnabled:true,writesEnabled:true,width:390,height:300});
    assert.equal(enabled.hidden,false);assert.equal(enabled.localValue,fixture.localValue);assert.equal(enabled.remoteValue,fixture.remoteValue);
  }
  assert.equal(ui.conflictViewModel({kind:'unknown',fixture:{kind:'unknown',source:'production'}}).fixtureAccepted,false);
});

test('conflict choices preserve both fixture copies where promised',()=>{
  const window=load(),mock=adapter(window);
  for(const kind of ['tag-rename','offline-newer-remote']){
    const fixture=mock.fixture(kind),result=mock.resolveFixture(kind,'keep-both');
    assert.equal(result.ok,true);assert.deepEqual(JSON.parse(JSON.stringify(result.preserved)),{device:fixture.localValue,cloud:fixture.remoteValue});assert.deepEqual(Array.from(result.discarded),[]);
  }
  assert.equal(mock.resolveFixture('favorite-stale','keep-current').discarded[0],'device-fixture');
  assert.equal(mock.resolveFixture('stale-schema','refresh').reloadRequired,true);
});

test('migration preview reports bounded categories but has no execution action',()=>{
  const window=load(),ui=window.PogoUI.trainerTagPanel;
  assert.equal(ui.migrationPreviewViewModel({featureEnabled:true,writesEnabled:true}).hidden,true);
  const preview=ui.migrationPreviewViewModel({localCounts:{favorites:3,tags:2,recents:4,history:5},cloudCounts:{favorites:1},conflictCount:2,width:390,height:420});
  assert.equal(preview.hidden,true);assert.equal(preview.previewOnly,true);assert.equal(preview.executionAvailable,false);assert.equal(preview.controls.confirmDisabled,true);assert.equal(preview.controls.executeAbsent,true);
  assert.deepEqual(JSON.parse(JSON.stringify(preview.localCounts)),{favorites:3,tags:2,recents:4,history:5});
  assert.ok(preview.steps.includes('trainer.syncMigration.nothingDeleted'));assert.equal(preview.layout.internalScroll,true);
  const mock=adapter(window),mockPreview=mock.migrationPreview({localCounts:{favorites:3},cloudCounts:{favorites:1}});
  assert.equal(mockPreview.executable,false);assert.equal(mockPreview.localDeletionAllowed,false);assert.equal(typeof mock.executeMigration,'undefined');
});

test('cloud deletion choices explain consequences and remain nonfunctional',()=>{
  const window=load(),ui=window.PogoUI.trainerTagPanel;
  assert.equal(ui.cloudDeletionViewModel({featureEnabled:true,writesEnabled:true}).hidden,true);
  const deletion=ui.cloudDeletionViewModel({featureEnabled:true,writesEnabled:true,previewSource:'deterministic-mock',width:390,height:300});
  assert.equal(deletion.operationAvailable,false);assert.equal(deletion.controls.confirmDisabled,true);assert.equal(deletion.accessibility.confirmationRequired,true);
  assert.deepEqual(Array.from(deletion.choices,choice=>choice.id),['cloud-only','cloud-and-device','device-only']);
  assert.ok(deletion.choices.every(choice=>choice.disabled&&choice.consequenceKey));
});

test('future detail surfaces retain dialog, focus, Escape, touch, and mobile-sheet contracts',()=>{
  const window=load(),ui=window.PogoUI.trainerTagPanel,mock=adapter(window);
  for(const height of [420,300]){
    const conflict=ui.conflictViewModel({kind:'tag-rename',fixture:mock.fixture('tag-rename'),featureEnabled:true,writesEnabled:true,width:390,height});
    assert.equal(conflict.layout.mode,'mobile_sheet');assert.equal(conflict.layout.touchTargetPx,48);assert.equal(conflict.layout.internalScroll,true);
    assert.equal(conflict.accessibility.focusTrap,true);assert.equal(conflict.accessibility.escapeCloses,true);assert.equal(conflict.accessibility.restoreFocus,true);assert.equal(conflict.accessibility.visibleFocus,true);
  }
});

test('mock adapter is local, deterministic, test-gated, and capability-free',()=>{
  const source=readFileSync(path.join(root,'js/testing/trainerPreferenceSyncMockAdapter.js'),'utf8');
  assert.doesNotMatch(source,/firebase|fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|indexedDB|localStorage|sessionStorage|userPreferences|https?:\/\//i);
  const window=load(),factory=window.PogoTesting.trainerPreferenceSyncMockAdapter.createTrainerPreferenceSyncMockAdapter;
  assert.throws(()=>factory(),/test-only/);assert.throws(()=>factory({testMode:true,environment:'production'}),/test-only/);
  const mock=factory({testMode:true,environment:'development'}),a=mock.fixture('tag-rename'),b=mock.fixture('tag-rename');
  assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
  assert.deepEqual(JSON.parse(JSON.stringify(mock.snapshot())),{adapter:'deterministic-local-mock',namespace:'pogo-sync-ux-test-v1',fixtureCount:4,networkRequests:0,browserStorageWrites:0,remoteSdkImports:0,productionAvailable:false});
});

test('active UI exposes one local-only status surface and no sync or migration command',()=>{
  const html=readFileSync(path.join(root,'index.html'),'utf8');
  const worker=readFileSync(path.join(root,'sw.js'),'utf8');
  assert.match(html,/id="trainer-sync-local-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html,/data-i18n="trainer\.syncState\.local-only"/);assert.match(html,/data-i18n="trainer\.syncStatus\.localOnlyDetail"/);
  assert.doesNotMatch(html,/id="[^"]*(?:sync-preference|preference-sync|migration-sync|cloud-delete)[^"]*"/i);
  assert.doesNotMatch(html,/createTrainerPreferenceSyncQueue\s*\(/);assert.doesNotMatch(html,/managedTrainerPreferencesRepository\.(?:read|subscribe|mutate|transaction|write)/);
  assert.doesNotMatch(html,/js\/testing\/trainerPreferenceSyncMockAdapter\.js/);
  assert.doesNotMatch(worker,/js\/testing\/trainerPreferenceSyncMockAdapter\.js/);
});

test('long German and Japanese sync labels retain key parity and overflow-safe presentation',()=>{
  const files=['en','ja','es','de'],catalogs={};
  const window={};const context=vm.createContext({window});
  for(const locale of files)vm.runInContext(readFileSync(path.join(root,`js/i18n/locales/${locale}.js`),'utf8'),context);
  Object.assign(catalogs,window.PogoLocales);
  const keys=Object.keys(catalogs.en).sort();for(const locale of files.slice(1))assert.deepEqual(Object.keys(catalogs[locale]).sort(),keys);
  assert.ok(catalogs.de['trainer.syncConflict.tagRename.title'].length>20);assert.ok(catalogs.ja['trainer.syncDelete.cloud-and-device.consequence']);
  assert.match(readFileSync(path.join(root,'index.html'),'utf8'),/\.trainer-sync-status-detail\{[^}]*overflow-wrap:anywhere/);
});

test('user-created tags remain raw fixture values rather than translation keys',()=>{
  const window=load(),ui=window.PogoUI.trainerTagPanel,mock=adapter(window),fixture=mock.fixture('tag-rename');
  const model=ui.conflictViewModel({kind:'tag-rename',fixture,featureEnabled:true,writesEnabled:true});
  assert.equal(model.localValue,'Next meetup');assert.equal(model.remoteValue,'Weekend group');
  assert.equal(model.localValue.startsWith('trainer.'),false);assert.equal(model.remoteValue.startsWith('trainer.'),false);
});

test('future sync copy avoids backend implementation jargon in every locale',()=>{
  const window={};const context=vm.createContext({window});
  for(const locale of ['en','ja','es','de'])vm.runInContext(readFileSync(path.join(root,`js/i18n/locales/${locale}.js`),'utf8'),context);
  for(const [locale,catalog] of Object.entries(window.PogoLocales)){
    const futureCopy=Object.entries(catalog).filter(([key])=>key.startsWith('trainer.sync')).map(([,value])=>String(value)).join(' ');
    assert.doesNotMatch(futureCopy,/\brevision(?:s)?\b|tombstone|fingerprint|RTDB|transaction/i,locale);
  }
});
