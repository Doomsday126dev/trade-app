const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>readFileSync(path.join(root,file),'utf8');
const html=read('index.html'),application=read('js/app/application.js'),worker=read('sw.js');
const inventory=JSON.parse(read('scripts/pages/frontend-files.json'));
const releaseAssets=new Set([...worker.matchAll(/^\s+'([^']+)',?$/gm)].map(match=>match[1]));

test('production Connected Accounts exposes username and PIN while providers stay hidden and inert',()=>{
  const start=html.indexOf('id="settings-account-security"'),end=html.indexOf('</section>',start),panel=html.slice(start,end);
  assert.match(panel,/data-i18n="security\.connectedAccounts"/);
  assert.match(panel,/data-provider="username-pin"/);assert.match(panel,/data-provider="username-pin"[\s\S]*data-i18n="security\.connected"/);
  for(const provider of['google','discord'])assert.match(panel,new RegExp(`account-security-provider-development[^>]+data-provider="${provider}" hidden`));
  assert.doesNotMatch(panel,/data-provider="email"|data-provider="legacy-pin"/);
  const primary=panel.slice(panel.indexOf('data-provider="username-pin"'),panel.indexOf('data-provider="google"'));
  assert.doesNotMatch(primary,/<button|onclick=|href=|data-action=/);
  assert.match(panel,/data-provider="google" hidden[\s\S]*data-provider-action[^>]+onclick="handleGoogleAccountAction\(\)" hidden/);
});

test('provider implementation stays in the capability-gated lazy feature graph',()=>{
  const files=['js/domain/authProviderRegistry.js','js/domain/providerContinuationState.js','js/domain/accountLinkingModel.js','js/domain/accountLinkingController.js','js/domain/providerOnboardingModel.js','js/services/googleAuthAdapter.js','js/services/providerAccountFoundation.js'];
  const template=html.slice(html.indexOf('<template id="pogo-feature-assets">'),html.indexOf('</template>'));
  for(const file of files){assert.match(template,new RegExp(`${file.replace(/[.]/g,'\\.')}[^>]+data-pogo-provider-capability`));assert.ok(inventory.scriptFiles.includes(file));assert.ok(inventory.developmentOnlyScriptFiles.includes(file));assert.equal(releaseAssets.has(file),false);}
  const preTemplate=html.slice(0,html.indexOf('<template id="pogo-feature-assets">'));
  for(const file of files)assert.equal(preTemplate.includes(file),false,file);
  assert.match(html,/node\.hasAttribute\('data-pogo-provider-capability'\)&&!providerModulesRequired\(\)/);
  assert.match(application,/if\(PROVIDER_MODULES_ENABLED&&\(!authProviderRegistryDomain/);
  assert.match(application,/providerLinkingRegistry=PROVIDER_MODULES_ENABLED\?/);
});

test('independent capability policy controls Google actions',()=>{
  assert.match(application,/resolveProviderCapabilities/);
  assert.match(application,/PROVIDER_CAPABILITIES\.googleExistingAccountLinking/);
  assert.match(application,/PROVIDER_CAPABILITIES\.providerAccountCreation/);
  const registry=read('js/domain/authProviderRegistry.js'),adapter=read('js/services/googleAuthAdapter.js');
  assert.match(registry,/actionable:available/);assert.match(adapter,/linkWithPopup\(user,googleProvider\(\)\)/);assert.match(html,/providerCapabilities\(\)\.googlePublicEntry/);
  assert.doesNotMatch(adapter,/linkWithRedirect|signInWithRedirect/);
});

test('same-UID providerData callbacks preserve the active owned session',()=>{
  const observer=application.slice(application.indexOf('function bindAuthObserver'),application.indexOf('function waitForAuthState'));
  assert.match(observer,/if\(!ownedSessionAlreadyActive\(user\.uid,rememberedUsername\)\)activateOwnedSession/);
  assert.match(application,/function ownedSessionAlreadyActive\(uid,username\)[\s\S]*snapshot\(\)\.activeOwner/);
  assert.match(observer,/if\(user&&_lastAuthenticatedIdentityUid!==user\.uid\)/);
});

test('Connected Accounts runtime renders only sanitized states and translated copy',()=>{
  const render=application.slice(application.indexOf('const PROVIDER_LINKING_STATUS_KEYS'),application.indexOf('function configureSettingsPanel'));
  for(const state of['connected','not-connected','connecting','prepared','waiting-browser','needs-attention','reauthenticate','disconnecting','unavailable'])assert.match(render,new RegExp(state));
  assert.match(render,/i18nCore\.t\(/);assert.doesNotMatch(render,/email|displayName|accessToken|refreshToken|error\.message/);
  assert.doesNotMatch(render,/textContent\s*=.*(?:uid|providerId)/);
});

test('all supported locales provide the provider-linking state vocabulary',()=>{
  const keys=['connectedAccounts','connectedAccountsHelp','usernamePin','usernamePinHelp','connected','notConnected','connecting','googleReady','googleReadyHelp','waitingBrowser','needsAttention','reauthenticate','disconnecting','unavailable','providerDevelopmentOnly','foundationNotice'];
  for(const locale of['en','ja','es','de']){const source=read(`js/i18n/locales/${locale}.js`);for(const key of keys)assert.match(source,new RegExp(`'security\\.${key}'`),`${locale}:${key}`);}
});

test('provider continuation code excludes URL and persistent local account storage',()=>{
  const source=read('js/domain/providerContinuationState.js');
  assert.match(source,/sessionStorage/);assert.doesNotMatch(source,/localStorage|location\.|URLSearchParams|accessToken|refreshToken|clientSecret|\bpin\b/i);
});
