const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const app=readFileSync(path.join(root,'js/app/application.js'),'utf8');
const runtime=readFileSync(path.join(root,'js/data/accountSyncRuntime.js'),'utf8');
const publicApp=readFileSync(path.join(root,'js/app/publicShareApp.js'),'utf8');
const html=readFileSync(path.join(root,'index.html'),'utf8');
const manifest=JSON.parse(readFileSync(path.join(root,'scripts/pages/frontend-files.json'),'utf8'));

function section(start,end){
  const from=app.indexOf(start),to=app.indexOf(end,from+start.length);
  assert.notEqual(from,-1,`missing ${start}`);assert.notEqual(to,-1,`missing ${end}`);return app.slice(from,to);
}

test('provider-only publication writes only the authenticated UID-rooted projection transaction',()=>{
  const source=section('async function writeProviderPublicShareSnapshot','function queueHydratedPublicShareSnapshot');
  assert.match(source,/trainerShares\/\$\{session\.uid\}/);assert.match(source,/runTransaction\(target/);assert.match(source,/get\(target\)/);
  assert.match(source,/providerPublicProjectionSessionMatches\(session\)/);
  assert.doesNotMatch(source,/set\(ref\(db,`publicShares|runTransaction\(ref\(db,`publicShares|authIndex|loginDirectory|users\//);
});

test('canonical provider publication is awaited durable and never reported as deferred success',()=>{
  const publish=section('async function publishAccountSyncProjection','function retireMigratedLegacyListQueue');
  const queued=section('function queueHydratedPublicShareSnapshot','function requestPublicSharePublication');
  const explicit=section('async function publishPublicShareNow','function ownerShareNoticeKey');
  assert.doesNotMatch(publish,/deferred-provider-public-projection/);
  assert.match(publish,/await .*writeProviderPublicShareSnapshot|retryPublicProjection/);
  assert.doesNotMatch(queued,/writeProviderPublicShareSnapshot\([^;]+\)\.catch\(/s);
  assert.ok(queued.indexOf('runtime.publishCurrentProjection')<queued.indexOf('publicShareSnapshotForUser'));
  assert.ok(explicit.indexOf('runtime.publishCurrentProjection')<explicit.indexOf('publicShareSnapshotForUser'));
  assert.match(runtime,/provider-publication-pending-v1/);
});

test('exact no-change reconciliation is current and hydration waits for provider publication settlement',()=>{
  const status=section('function publicSharePublicationCurrent','async function writeProviderPublicShareSnapshot');
  const hydration=section('function _onOwnedDataSnapshot','function _onOwnedDataError');
  const republish=section('async function republishOwnPublicShare','async function writeUser(u,data)');
  const copy=section('async function copyShareLink','function getSpecialBoard');
  assert.match(status,/status==='published'\|\|result\.status==='reconciled'/);
  assert.match(hydration,/typeof pendingPublication\?\.then==='function'/);
  assert.ok(hydration.indexOf('pendingPublication.then')<hydration.indexOf('inspectOwnPublicShareAfterHydration'));
  assert.match(republish,/publicSharePublicationCurrent\(result\)/);
  assert.match(copy,/publicSharePublicationCurrent\(result\)/);
});

test('provider-only publication is blocked when its independent public-write capability is off',()=>{
  const queued=section('function queueHydratedPublicShareSnapshot','function requestPublicSharePublication');
  const immediate=section('async function publishPublicShareNow','async function writeUser(u,data)');
  assert.match(`${queued}\n${immediate}`,/provider-public\/projection-disabled/);
  assert.match(app,/PROVIDER_CAPABILITIES\.providerPublicWriteSupport/);
  assert.match(html,/providerPublicProjection\.js[^>]+data-pogo-provider-public-capability/);
  assert.match(html,/providerPublicShareGateway\.js[^>]+data-pogo-provider-public-capability/);
  assert.match(html,/data-pogo-provider-public-capability[\s\S]+providerPublicWriteSupport/);
  assert.doesNotMatch(`${app}\n${html}`,/__POGO_PROVIDER_PUBLIC_PROJECTION_DEV__/);
});

test('trainer search and direct share URLs resolve provider handles first then retain exact legacy fallback',()=>{
  const load=section('async function loadPublicShareData','async function loadShareViewData');
  assert.ok(load.indexOf('ensureProviderPublicShareClient().read(username)')<load.indexOf('publicShares/${username}'));
  assert.match(load,/selectedTrainerData\(canonicalUsername\)/);assert.match(load,/source='legacy'/);
  assert.match(app,/loaded\.username\|\|loaded\.snapshot\?\.username\|\|req\.username/);
});

test('anonymous standalone share uses App Check without Auth and falls back to the legacy exact URL',()=>{
  assert.match(publicApp,/providerPublicShareGateway\.createProviderPublicShareClient/);
  assert.match(publicApp,/gateway:trainer-handle/);assert.match(publicApp,/publicShares\/\$\{request\.username\}/);
  assert.doesNotMatch(publicApp,/firebase-auth\.js|getAuth\(|signIn|currentUser/);
});

test('new provider projection assets are versioned and production release remains unchanged',()=>{
  for(const file of ['js/domain/providerPublicProjection.js','js/services/providerPublicShareGateway.js']){
    assert.ok(manifest.scriptFiles.includes(file),file);assert.match(html,new RegExp(file.replaceAll('/','\\/')+'\\?v=2026-08-31\\.86'));
  }
  assert.match(html,/window\.__POGO_RELEASE_ID=['"]2026-08-31\.86['"]/);
  assert.match(html,/usernameValid=\/\^\[\^\.\#\$\\\/\\\[\\\]\\u0000-\\u001f\\u007f\]\{2,64\}\$\//);
});
