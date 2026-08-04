const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const source=readFileSync(path.join(__dirname,'..','index.html'),'utf8');

test('production remains on legacy broad reads with narrow mode disabled',()=>{
  assert.match(source,/const NARROW_READ_CLIENT_ENABLED=false;/);
  assert.match(source,/const LEGACY_BROAD_READS_ENABLED=true;/);
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
  assert.match(callback,/cacheAdapterDomain\.applyExactRecord\(getLocal\(\),path,value\)/);
  assert.match(callback,/runtimeDataWithSelectedTrainer\(s\)/);
  assert.match(callback,/Object\.values\(syncQueue\|\|\{\}\)/);
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
