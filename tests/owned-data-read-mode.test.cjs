const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const source=require('../scripts/lib/frontend-source.cjs').readFrontendSource(path.join(__dirname,'..'));

test('production activates exact owned reads with legacy broad startup disabled',()=>{
  assert.match(source,/const TRAINER_FIRST_INTERIM_ENABLED=true;/);
  assert.match(source,/const NARROW_READ_CLIENT_ENABLED=true;/);
  assert.match(source,/const LEGACY_BROAD_READS_ENABLED=false;/);
  assert.match(source,/return NARROW_READ_CLIENT_ENABLED&&!LEGACY_BROAD_READS_ENABLED;/);
});

test('exact mode and legacy owned listeners cannot run together',()=>{
  const protectedSource=source.slice(source.indexOf('function ensureProtectedSubscriptions(){'),source.indexOf('function startListener(){'));
  assert.ok(protectedSource.indexOf('if(ownedExactReadsEnabled())')<protectedSource.indexOf("subscribePath('users')"));
  assert.match(protectedSource,/ensureOwnedExactSubscriptions\(\);[\s\S]*return;/);
  assert.match(protectedSource,/if\(!LEGACY_BROAD_READS_ENABLED\)return;/);
});

test('exact snapshots preserve global cache shape and overlay pending local writes',()=>{
  const callback=source.slice(source.indexOf('function _onOwnedDataSnapshot'),source.indexOf('function _onOwnedDataError'));
  assert.match(callback,/const canonicalActive=accountSyncProjectionReady\(\)/);
  assert.match(callback,/if\(!\(canonicalActive&&OWNED_MY_LIST_TYPES\.includes\(surface\)\)\)s=cacheAdapterDomain\.applyExactRecord\(s,path,value\)/);
  assert.match(callback,/if\(canonicalActive&&surface==='profile'\)/);
  assert.match(callback,/specialTradeBoard:canonicalBoard/);
  assert.match(callback,/runtimeDataWithSelectedTrainer\(s\)/);
  assert.match(callback,/Object\.values\(syncQueue\|\|\{\}\)/);
  assert.match(callback,/if\(canonicalActive&&\(/);
  assert.match(callback,/applyAccountSyncCanonicalEntities\(accountSyncCanonicalEntities\)/);
  assert.doesNotMatch(callback,/replaceTopLevel/);
});

test('owned-data errors use a translation key and preserve offline cache',()=>{
  const callback=source.slice(source.indexOf('function _onOwnedDataError'),source.indexOf('function ensureOwnedExactSubscriptions'));
  assert.match(callback,/i18nCore\.t\('data\.ownedReadUnavailable'\)/);
  assert.doesNotMatch(callback,/saveLocal\(|managedSessionCache\.clear/);
});

test('deferred write and broad discovery surfaces are not migrated',()=>{
  const coordinator=readFileSync(path.join(__dirname,'..','js/data/ownedDataCoordinator.js'),'utf8');
  for(const forbidden of ['offers','trades','requests','communities','communityRequests']){
    assert.equal(coordinator.includes(`surface==='${forbidden}'`),false);
  }
  assert.doesNotMatch(coordinator,/(?:repository|client)\.(?:set|update|remove|write)\s*\(/);
});

test('broad private consumers are retired from exact-mode startup',()=>{
  const protectedSource=source.slice(source.indexOf('function ensureProtectedSubscriptions(){'),source.indexOf('function startListener(){'));
  const exactBranch=protectedSource.slice(protectedSource.indexOf('if(ownedExactReadsEnabled())'),protectedSource.indexOf('if(!LEGACY_BROAD_READS_ENABLED)return;'));
  assert.doesNotMatch(exactBranch,/subscribePath\(/);
  assert.match(source,/const LEGACY_ADMIN_COLLECTION_PATHS=Object\.freeze/);
  assert.match(source,/managedListenerLifecycle\.subscribeLegacyAdmin/);
});

test('cross-trainer reads use only publicShares and never authenticated private fallback',()=>{
  const shareSubscriptions=source.slice(source.indexOf('function ensureShareViewSubscriptions'),source.indexOf('async function openShareViewFromRequest'));
  assert.match(shareSubscriptions,/publicShares\/\$\{username\}/);
  assert.doesNotMatch(shareSubscriptions,/shareDataPaths\(|authenticated:true|users\/\$\{username\}/);
  const loader=source.slice(source.indexOf('async function loadShareViewData'),source.indexOf('function renderUnavailableShareView'));
  assert.match(loader,/return loadPublicShareData\(username\)/);
  assert.doesNotMatch(loader,/Promise\.all|get\(ref/);
});

test('retired surfaces are replaced by owned or read-only interim behavior',()=>{
  assert.match(source,/const LEGACY_INVENTORY_READ_ONLY=true;/);
  assert.match(source,/if\(LEGACY_INVENTORY_READ_ONLY\)\{toast\(i18nCore\.t\('inventory\.legacyReadOnly'/);
  assert.match(source,/const users=\[cur\]\.filter/);
  assert.match(source,/if\(TRAINER_FIRST_INTERIM_ENABLED\)\{renderEventsOnly\(\);return;\}/);
  assert.match(source,/typeof TRAINER_FIRST_INTERIM_ENABLED!=='undefined'&&TRAINER_FIRST_INTERIM_ENABLED/);
});
