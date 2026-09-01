const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>readFileSync(path.join(root,file),'utf8');
const html=read('index.html'),app=read('js/app/application.js'),adapter=read('js/services/googleAuthAdapter.js'),worker=read('sw.js');
const inventory=JSON.parse(read('scripts/pages/frontend-files.json'));
const releaseAssets=new Set([...worker.matchAll(/^\s+'([^']+)',?$/gm)].map(match=>match[1]));

test('ordinary production startup exposes no Google action or provider module',()=>{
  assert.match(html,/id="google-login-option" hidden/);
  assert.match(html,/googleOption\.hidden=!providerCapabilities\(\)\.googlePublicEntry/);
  const beforeTemplate=html.slice(0,html.indexOf('<template id="pogo-feature-assets">'));
  assert.equal(beforeTemplate.includes('googleAuthAdapter.js'),false);assert.equal(beforeTemplate.includes('providerOnboardingModel.js'),false);
  assert.match(html,/data-provider="google" hidden/);
});

test('public privacy notice is standalone and discloses the Google identity boundary',()=>{
  assert.match(html,/window\.__pogoPrivacyRequest=parsePogoPrivacyRequest\(\)/);
  assert.match(html,/if\(!window\.__pogoPublicShareRequest&&!window\.__pogoPrivacyRequest\)/);
  assert.match(html,/id="privacy-pg"[^>]+hidden/);
  for(const disclosure of['does not use an email address, display name, photo, or name similarity','requests no additional Google API scopes','does not separately copy, log, or store Google OAuth access or refresh tokens','does not sell personal information'])assert.match(html,new RegExp(disclosure));
  assert.match(html,/if\(window\.__pogoPrivacyRequest\)[\s\S]+revealPrivacyNotice/);
});

test('Google implementation modules are inventoried but omitted from the production shell cache',()=>{
  for(const file of['js/domain/providerOnboardingModel.js','js/services/googleAuthAdapter.js']){
    assert.match(html,new RegExp(`${file.replaceAll('.','\\.')}[^>]+data-pogo-provider-capability`));
    assert.ok(inventory.scriptFiles.includes(file));assert.ok(inventory.developmentOnlyScriptFiles.includes(file));assert.equal(releaseAssets.has(file),false);
  }
});

test('existing-user connect cannot call independent sign-in',()=>{
  const link=adapter.slice(adapter.indexOf('async function linkCurrentUser'),adapter.indexOf('async function signInProvider'));
  assert.match(link,/linkWithPopup\(user,googleProvider\(\)\)/);assert.doesNotMatch(link,/signInWithPopup/);
  assert.match(app,/linkCurrentUser:options=>google\.linkCurrentUser\(options\)/);assert.match(app,/signInProvider:async options/);
});

test('same-UID observer refresh preserves lifecycle and asks the controller to reject real authority changes',()=>{
  const observer=app.slice(app.indexOf('function bindAuthObserver'),app.indexOf('function waitForAuthState'));
  assert.match(observer,/noteProviderAuthState\(user\);\s*providerLinkingController\?\.observeAuth\(\)/);
  const note=app.slice(app.indexOf('function noteProviderAuthState'),app.indexOf('function noteProviderReauthentication'));
  assert.match(note,/if\(uid!==providerAuthLifecycleUid\)/);assert.doesNotMatch(note,/providerData/);
});

test('Google link verifies every accepted account and sync boundary',()=>{
  const boundary=app.slice(app.indexOf('async function providerAccountBoundarySnapshot'),app.indexOf('async function resolveGoogleAccountBinding'));
  for(const token of['accountDataFingerprint','journalOwner','journalGeneration','migrationGeneration','recoveryEvidenceFingerprint','reviewedEvidenceCount','activeEvidenceCount','listenerAuthority','publicIdentityFingerprint','trainerIdentityFingerprint'])assert.match(boundary,new RegExp(token));
  assert.match(boundary,/favorites:history\.favorites/);assert.match(boundary,/tags:history\.tags/);assert.match(boundary,/board:profile\.specialTradeBoard/);
  assert.doesNotMatch(boundary,/catch\{\}/);assert.match(boundary,/providerBoundaryFingerprint\(candidates\)/);
});

test('signed-out Google account resolution uses exact UID mappings and no profile inference',()=>{
  const resolution=app.slice(app.indexOf('async function resolveGoogleAccountBinding'),app.indexOf('async function checkGoogleOnboardingHandle'));
  assert.match(resolution,/authIndex\/\$\{expectedUid\}/);assert.match(resolution,/userRecord\.authUid!==expectedUid/);
  assert.doesNotMatch(resolution,/email|displayName|photoURL/);
});

test('Connected Accounts presents all required safe states and actions',()=>{
  const surface=app.slice(app.indexOf('const GOOGLE_PROVIDER_STATE'),app.indexOf('function configureSettingsPanel'));
  for(const value of['already-connected','collision','popup-blocked','canceled','recent-auth-required','network-failed','auth-lifecycle-changed','connecting','prepared','disconnecting','reauthenticate','retry','disconnect','continue','connect'])assert.match(surface,new RegExp(value));
  assert.match(surface,/controller\.prepareLinkPopup\('google'\)/);
  assert.match(surface,/controller\.completeLinkPopup\('google'\)/);
  assert.doesNotMatch(surface,/error\.message|accessToken|refreshToken|displayName|\.email/);
});

test('Google unlink requires an exact usable Username and PIN account record',()=>{
  assert.match(app,/function usernamePinAccessUsable\(\)/);
  assert.match(app,/user\.authUid===auth\?\.currentUser\?\.uid/);
  assert.match(app,/String\(user\.pin\?\?'\'\)\.trim\(\)/);
  assert.match(app,/controller\.unlink\('google',\{usernamePinAvailable:usernamePinAccessUsable\(\)\}\)/);
});

test('all supported locales contain Google, onboarding, and recovery copy',()=>{
  const keys=['login.continueGoogle','security.connect','security.disconnect','security.retry','security.googleReady','security.googleReadyHelp','security.googleConnected','security.googleAlreadyConnected','security.googleCollision','security.googlePopupBlocked','security.googleCanceled','security.googleReauthRequired','security.googleNetworkFailed','security.googleNeedsAttention','providerOnboarding.title','providerOnboarding.description','providerOnboarding.handle','providerOnboarding.check','providerOnboarding.cancel'];
  for(const locale of['en','ja','es','de']){const source=read(`js/i18n/locales/${locale}.js`);for(const key of keys)assert.match(source,new RegExp(`'${key.replaceAll('.','\\.')}'`),`${locale}:${key}`);}
});

test('Google source contains no redirect fallback, broad scopes, secrets, or token persistence',()=>{
  const combined=`${adapter}\n${app.slice(app.indexOf('function createGoogleProviderAdapter'),app.indexOf('let _authObserverBound'))}`;
  assert.doesNotMatch(combined,/linkWithRedirect|signInWithRedirect|addScope|contacts|drive|calendar|gmail|photos/i);
  assert.doesNotMatch(adapter,/clientSecret|refreshToken|localStorage|sessionStorage|indexedDB/);
  assert.match(app,/beginRedirectLink:unsupported/);assert.match(app,/beginRedirectSignIn:unsupported/);
});
