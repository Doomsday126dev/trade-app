const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {loadFrontendManifest}=require('../scripts/pages/validate-release.cjs');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('index.html'),application=read('js/app/application.js');
const removed=['js/data/firebaseReadRegistry.js','js/domain/trainerPreferenceSync.js','js/data/trainerPreferencesRepository.js','js/data/trainerPreferenceSyncQueue.js','js/ui/trainerTagPanel.js','js/app/publicShareApp.js'];
const template=html.match(/<template id="pogo-feature-assets">([\s\S]*?)<\/template>/)[1];
const tags=[...template.matchAll(/<script src="([^"]+)"([^>]*)>/g)];
function defaultScripts(locale){return tags.filter(([,src,attrs])=>{
  if(/data-pogo-provider/.test(attrs))return false;
  const language=src.match(/js\/i18n\/locales\/([a-z]+)\.js/);
  return!language||language[1]==='en'||language[1]===locale;
}).map(([,src])=>src.split('?')[0]);}
function workerRequired(){
  const context=vm.createContext({self:{location:{href:'https://example.test/trade-app/sw.js'},addEventListener(){}} ,URL});
  vm.runInContext(read('sw.js'),context);
  return Array.from(vm.runInContext('REQUIRED_SHELL_URLS',context),url=>url.replace(/^\.\//,'').split('?')[0]);
}

test('default signed-in graph excludes all six candidates in every locale',()=>{
  for(const locale of ['en','de','ja','es']){
    const scripts=defaultScripts(locale);
    for(const file of removed)assert.ok(!scripts.includes(file),`${locale}: ${file}`);
    assert.equal(scripts.length,locale==='en'?75:76);
    assert.equal(scripts.at(-1),'js/app/application.js');
    for(const file of ['js/domain/trainerPreferences.js','js/data/accountSyncRuntime.js','js/services/firebaseAppCheck.js','js/data/listenerLifecycle.js','js/data/sessionCacheBoundary.js'])assert.ok(scripts.includes(file),file);
  }
  assert.doesNotMatch(application,/firebaseReadRegistryData|trainerPreferenceSyncDomain|trainerPreferencesRepositoryData|trainerPreferenceSyncQueueData|trainerTagPanelUi|managedTrainerPreferencesRepository/);
});

test('hosted, cached, signed-in and anonymous ownership remain distinct',()=>{
  const manifest=loadFrontendManifest(root),cached=workerRequired();
  for(const file of removed)assert.ok(manifest.files.includes(file)&&fs.existsSync(path.join(root,file)),file);
  assert.deepEqual(manifest.hostedOnlyScriptFiles,removed.slice(0,-1));
  for(const file of manifest.hostedOnlyScriptFiles)assert.ok(!cached.includes(file),file);
  assert.ok(cached.includes('js/app/publicShareApp.js'));
  assert.ok(manifest.lazyScriptFiles.includes('js/app/publicShareApp.js'));
});

test('every independent public-route script and locale remains in the offline shell',()=>{
  const loader=html.slice(html.indexOf('async function loadPublicShareScripts()'),html.indexOf('function ensurePublicShareApp()'));
  const scripts=[...loader.matchAll(/'(js\/[^']+\.js)'/g)].map(match=>match[1]);
  assert.ok(scripts.includes('js/app/publicShareApp.js'));
  const cached=workerRequired();
  for(const file of [...scripts,'js/i18n/core.js',...['en','de','ja','es'].map(locale=>`js/i18n/locales/${locale}.js`)])assert.ok(cached.includes(file),file);
  assert.ok(!scripts.some(file=>/accountSync|trainerPreferenceSync|trainerTagPanel|firebaseReadRegistry/.test(file)));
  assert.match(html,/const start=window\.__pogoStartPublicShare/);
  assert.match(read('js/app/publicShareApp.js'),/global\.__pogoStartPublicShare=start/);
});

test('active Groups retain shared tag-label helpers and canonical accountSync authority',()=>{
  assert.match(application,/trainerPreferencesDomain\.normalizeTagLabel/);
  assert.match(application,/trainerPreferencesDomain\.MAX_TAG_LABEL_LENGTH/);
  assert.match(application,/SYNCED_TRAINER_PREFERENCES_ENABLED!==false/);
  assert.match(application,/async function saveTrainerGroup/);
  assert.match(application,/accountSyncMutationAuthority/);
});
