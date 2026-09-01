const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const app=readFileSync(path.join(root,'js/app/application.js'),'utf8');
const html=readFileSync(path.join(root,'index.html'),'utf8');
const manifest=JSON.parse(readFileSync(path.join(root,'scripts/pages/frontend-files.json'),'utf8'));

function section(start,end){
  const from=app.indexOf(start),to=app.indexOf(end,from+start.length);
  assert.notEqual(from,-1,`missing ${start}`);assert.notEqual(to,-1,`missing ${end}`);
  return app.slice(from,to);
}

test('Google identity resolution is Firestore first and provider-only accounts bypass reciprocal RTDB identity reads',()=>{
  const source=section('async function resolveGoogleAccountBinding','async function checkGoogleOnboardingHandle');
  const canonical=source.indexOf('ensureProviderAccountFoundationClient().read()');
  const legacy=source.indexOf('authIndex/${expectedUid}');
  assert.ok(canonical>=0&&legacy>canonical);
  assert.match(source,/foundation\.identityKind==='provider_only'\)return Object\.freeze\(\{status:'existing'/);
  assert.match(source,/provider-link\/legacy-migration-required/);
  assert.doesNotMatch(source,/email|displayName|avatar/);
});

test('provider-only activation creates no legacy identity projection and starts sync only after canonical validation',()=>{
  const source=section('async function activateGoogleResolvedAccount','function showGoogleOnboarding');
  assert.match(source,/validCanonicalFoundation\(foundation,uid\)/);
  assert.match(source,/legacyAccessConfigured:false,legacyUsername:null/);
  assert.match(source,/if\(!providerOnly\)local\.authIndex\[uid\]/);
  assert.ok(source.indexOf('activeCanonicalIdentity=')<source.indexOf('ensureAccountSyncRuntime()'));
  assert.match(source,/providerOnly&&\(!runtimeResult\?\.ok[\s\S]+managedAccountSyncRuntime\.profileReady!==true[\s\S]+!accountSyncProjectionReady\(\)\)/);
  assert.doesNotMatch(source,/(?:set|update|push)\(ref\(db,`(?:authIndex|loginDirectory|users)\//);
});

test('provider-only profile and activity writes are barred from every legacy identity queue',()=>{
  const queue=section('function providerOnlyLegacyWritePath','function queueItemIsCurrent');
  assert.match(queue,/target===`users\/\$\{name\}`/);assert.match(queue,/target===`loginDirectory\/\$\{name\}`/);
  assert.match(queue,/target===`authIndex\/\$\{owner\}`/);assert.match(queue,/if\(providerOnlyLegacyWritePath\(path\)\)return false/);
  const flush=section('async function flushSyncQueue','function showSyncDot');
  assert.match(flush,/if\(providerOnlyLegacyWritePath\(item\?\.path\|\|path\)\)[\s\S]+delete syncQueue\[path\]/);
  const listWrite=section('async function writeListSerialized','async function writeListItem');
  assert.match(listWrite,/if\(!providerOnlyIdentityActive\(\)\)\{[\s\S]+users\/\$\{u\}\/lastUpdated[\s\S]+users\/\$\{u\}\/lastSeen/);
  const profileWrite=section('async function saveProfile','async function savePinSettings');
  assert.match(profileWrite,/if\(providerOnlyIdentityActive\(\)\)[\s\S]+runtime\.updateProviderProfile\(upd\)[\s\S]+else\{[\s\S]+writeUser\(cur,upd\)/);
});

test('provider-only sessions skip legacy protected list and pending-decrement subscriptions',()=>{
  assert.match(app,/function ensureListSubscribed\(type\)[\s\S]{0,220}if\(providerOnlyIdentityActive\(\)\)return/);
  assert.match(app,/function ensureProtectedSubscriptions\(\)[\s\S]{0,260}if\(providerOnlyIdentityActive\(\)\)return/);
  assert.match(app,/if\(!providerOnlyIdentityActive\(\)\)subscribeMyPendingDecrements\(\)/);
});

test('provider-only account sync uses explicit initialization without legacy migration retirement',()=>{
  assert.match(app,/const initializationKind=providerOnlyIdentityActive\(uid\)\?'provider-only':'legacy-migration'/);
  assert.match(app,/if\(initializationKind==='legacy-migration'\)retireMigratedLegacyListQueue\(\)/);
  assert.match(app,/deferred-provider-public-projection/);
});

test('Google-only Settings hides PIN controls and labels legacy access as not configured',()=>{
  assert.match(html,/id="settings-security-pin-panel"/);
  assert.match(app,/pinPanel\.hidden=!usernamePinAvailable/);
  assert.match(app,/security\.usernamePinNotConfigured/);
});

test('provider account client is present only in the development-gated asset set',()=>{
  const asset='js/services/providerAccountFoundation.js';
  assert.ok(manifest.scriptFiles.includes(asset));
  assert.ok(manifest.developmentOnlyScriptFiles.includes(asset));
  assert.match(html,/data-pogo-provider-capability/);
});
