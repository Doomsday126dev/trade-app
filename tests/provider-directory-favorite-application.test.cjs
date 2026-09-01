const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const app=readFileSync(path.join(root,'js/app/application.js'),'utf8');
const cache=readFileSync(path.join(root,'js/data/favoriteShareSessionCache.js'),'utf8');
const publicApp=readFileSync(path.join(root,'js/app/publicShareApp.js'),'utf8');

function section(start,end){
  const from=app.indexOf(start),to=app.indexOf(end,from+start.length);
  assert.ok(from>=0,start);assert.ok(to>from,end);return app.slice(from,to);
}

test('normal trainer suggestions combine deduplicated legacy and canonical provider handles',()=>{
  const directory=section('function providerTrainerDirectorySession','function trainerSuggestionOptions');
  const ranking=section('function rankedTrainerSuggestions','function trainerSuggestionHtml');
  const keyboard=section('async function trainerSearchKeydown','function trainerViewedText');
  assert.match(directory,/listDirectory\(\{query:normalized,cursor,pageSize:25\}\)/);
  assert.match(directory,/Object\.keys\(allData\.loginDirectory\|\|\{\}\)/);
  assert.match(directory,/providerTrainerDirectory\.forEach/);
  assert.match(directory,/new Map\(\)/);
  assert.match(ranking,/combinedTrainerDirectoryNames\(\)/);
  assert.doesNotMatch(ranking,/Object\.keys\(allData\.loginDirectory/);
  assert.match(keyboard,/searchParams\.get\(['"]view['"]\)/);
  assert.match(keyboard,/ensureProviderTrainerDirectory\(lookup\)/);
});

test('Favorite migration and creation use canonical Firestore identity with an exact pre-provider legacy fallback',()=>{
  const migration=section('async function resolveCanonicalFavoriteIdentity','async function accountSyncReadLegacySources');
  const favorite=section('async function accountSyncFavoriteIdentity','function showFavoriteSavedPrompt');
  assert.match(migration,/resolveFavorite\?\.\(\{trainerHandle:displayName,expectedTargetUid\}\)/);
  assert.match(migration,/function resolveLegacyFavoriteIdentity/);
  assert.match(migration,/PROVIDER_CAPABILITIES\.providerPublicReadSupport[\s\S]+resolveCanonicalFavoriteIdentity[\s\S]+resolveLegacyFavoriteIdentity/);
  assert.match(migration,/async function accountSyncExactFavoriteUid/);
  assert.match(migration,/resolveFavoriteIdentityForSession\(displayName,expected\)/);
  assert.match(favorite,/await accountSyncFavoriteIdentity\(username\)/);
  assert.match(favorite,/entityId:targetUid,identity:\{targetUid\},values:\{displayName\}/);
  assert.doesNotMatch(favorite,/favoriteSyncUnavailable[\s\S]+accountSyncProduct\.exactFavoriteTargetUid[\s\S]+controller\.addEntity/);
});

test('Favorite cards and Find by Pokemon validate an existing UID before public-share hydration or opening',()=>{
  const cacheFactory=section('function ensureFavoriteShareSessionCache','function resetFavoriteBrowseSession');
  const open=section('async function openFavoriteTrainerByName','function showFavoriteSavedPrompt');
  assert.match(cache,/repository\.read\(favorite\.displayName,\{targetUid:favorite\.targetUid\|\|''\}\)/);
  assert.match(cacheFactory,/resolveFavoriteIdentityForSession\(displayName,targetUid\)/);
  assert.match(cacheFactory,/provider\?\.status!==['"]not_found['"]/);
  assert.match(open,/resolveFavoriteIdentityForSession\(favorite\.displayName,favorite\.targetUid\)/);
  assert.match(app,/if\(action===['"]open['"]\)openFavoriteTrainerByName\(username\)/);
});

test('anonymous public-share app remains Auth-free and cannot invoke the Favorite resolver',()=>{
  assert.match(publicApp,/createProviderPublicShareClient/);
  assert.doesNotMatch(publicApp,/resolveFavorite|listDirectory|firebase-auth\.js|getAuth\(|currentUser/);
});
