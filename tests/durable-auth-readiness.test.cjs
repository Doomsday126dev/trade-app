const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const domainSource=fs.readFileSync(path.join(root,'js/domain/authenticationReadiness.js'),'utf8');

function loadDomain(){
  const window={};
  vm.runInNewContext(domainSource,{window});
  return window.PogoDomain.authenticationReadiness;
}

test('durable provider activation is hard-disabled and exposes no executable action',()=>{
  const domain=loadDomain();
  assert.equal(domain.DURABLE_AUTH_PROVIDERS_ENABLED,false);
  assert.equal(domain.providerActionAllowed('google','link'),false);
  assert.equal(domain.providerActionAllowed('discord','unlink'),false);
  assert.deepEqual(Array.from(domain.PROVIDERS),['google','email','discord','legacy-pin']);
});

test('Account & Security is informational, account-only, and has no provider buttons',()=>{
  const start=html.indexOf('id="settings-account-security-heading"');
  const end=html.indexOf('</section>',start);
  assert.ok(start>0&&end>start);
  const panel=html.slice(start,end);
  const methods=panel.slice(panel.indexOf('class="account-security-methods"'),panel.indexOf('class="account-security-notice"'));
  assert.match(panel,/data-provider="google"/);
  assert.match(panel,/data-provider="email"/);
  assert.match(panel,/data-provider="discord"/);
  assert.match(panel,/data-provider="legacy-pin"/);
  assert.doesNotMatch(methods,/<button|onclick=|href=|data-action=/);
  assert.match(panel,/id="settings-logout" onclick="logout\(\)"/);
  assert.match(html,/account-security-panel settings-account-only/);
});

test('future provider states cannot be supplied by URL, storage, console flags, or Firebase data',()=>{
  const domain=loadDomain();
  const model=domain.accountSecurityModel({signedIn:true,links:{google:{state:'linked'}}});
  assert.equal(model.enabled,false);
  assert.deepEqual(Array.from(model.rows,row=>[row.provider,row.state,row.interactive]),[
    ['google','not-linked',false],['email','not-linked',false],['discord','not-linked',false],['legacy-pin','linked',false]
  ]);
  assert.doesNotMatch(domainSource,/location|URLSearchParams|localStorage|sessionStorage|indexedDB|firebase|fetch\(|WebSocket|XMLHttpRequest/i);
});

test('legacy repair can never replace an established Firebase UID',()=>{
  const domain=loadDomain();
  assert.deepEqual(JSON.parse(JSON.stringify(domain.legacyRepairDecision({currentUid:'uid-current',replacementUid:'uid-replacement'}))),{allowed:false,code:'auth/immutable-uid'});
  assert.equal(domain.legacyRepairDecision({currentUid:'uid-current',replacementUid:'uid-current'}).allowed,true);
  const repair=html.slice(html.indexOf('async function repairMemberAccount'),html.indexOf('async function createMemberNow'));
  assert.match(repair,/legacyRepairDecision/);
  assert.ok(repair.indexOf('legacyRepairDecision')<repair.indexOf('provisionFreshFirebaseAuthForTrainer'));
});

test('unlink policy blocks the final method and requires stronger Admin recovery',()=>{
  const domain=loadDomain();
  assert.equal(domain.unlinkDecision({usableMethodCount:1,recentAuth:true}).code,'auth/final-method');
  assert.equal(domain.unlinkDecision({usableMethodCount:2,recentAuth:false}).code,'auth/recent-auth-required');
  assert.equal(domain.unlinkDecision({usableMethodCount:2,recentAuth:true,isAdmin:true}).code,'auth/admin-strong-reauth-required');
  assert.equal(domain.unlinkDecision({usableMethodCount:2,recentAuth:true}).code,'auth/unlink-not-implemented');
});

test('OAuth authentication cannot create a trainer profile before explicit handle reservation',()=>{
  const domain=loadDomain();
  assert.equal(domain.onboardingDecision({oauthAuthenticated:true,handleReserved:false}).mayCreateTrainerProfile,false);
  assert.equal(domain.onboardingDecision({oauthAuthenticated:true,handleReserved:false}).nextStep,'reserve-trainer-handle');
  assert.equal(domain.onboardingDecision({oauthAuthenticated:true,handleReserved:true}).mayCreateTrainerProfile,false);
});

test('provider metadata roots remain absent from client reads, writes, and current Rules',()=>{
  const clientFiles=['index.html',...fs.readdirSync(path.join(root,'js'),{recursive:true}).filter(name=>/\.js$/.test(name)).map(name=>`js/${name}`)];
  const clientText=clientFiles.map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n');
  for(const rootName of ['authProviders','authProviderSubjects','authLinkAttempts']){
    const matches=clientText.match(new RegExp(rootName,'g'))||[];
    assert.equal(matches.length,0,rootName);
  }
  const rules=fs.readFileSync(path.join(root,'tests/firebase/database.rules.share-visibility.json'),'utf8');
  assert.match(rules,/"\.read": false/);
  assert.match(rules,/"\.write": false/);
  assert.doesNotMatch(rules,/authProviders|authProviderSubjects|authLinkAttempts/);
});

test('PIN remains the active login and provider SDK methods are not imported',()=>{
  assert.match(html,/signInWithEmailAndPassword=authMod\.signInWithEmailAndPassword/);
  assert.match(html,/id="login-pin"/);
  assert.doesNotMatch(html,/linkWithPopup|linkWithRedirect|GoogleAuthProvider|sendSignInLinkToEmail|OAuthProvider\(['"]oidc\.discord/);
});

test('provider readiness preserves disabled share and preference flags',()=>{
  const prefs=fs.readFileSync(path.join(root,'js/domain/trainerPreferences.js'),'utf8');
  const visibility=fs.readFileSync(path.join(root,'js/domain/shareVisibility.js'),'utf8');
  assert.match(prefs,/SYNCED_TRAINER_PREFERENCES_ENABLED\s*:\s*false/);
  assert.match(visibility,/SHARE_VISIBILITY_MODEL_ENABLED\s*:\s*false/);
});
