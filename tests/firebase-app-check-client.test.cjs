const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');
const source=readFileSync(path.join(root,'js/services/firebaseAppCheck.js'),'utf8');

function client(){
  const window={};
  vm.runInContext(source,vm.createContext({window,WeakMap,Object}));
  return window.PogoServices.firebaseAppCheck;
}

test('App Check reuses the existing Firebase app and initializes Enterprise exactly once',()=>{
  const api=client();
  const app={name:'pogo'};
  const calls=[];
  class Provider{
    constructor(siteKey){calls.push({kind:'provider',siteKey});}
  }
  const initializeAppCheck=(receivedApp,options)=>{
    calls.push({kind:'initialize',receivedApp,options});
    return{app:receivedApp};
  };
  const options={app,siteKey:'enterprise_site_key_1234567890',initializeAppCheck,ReCaptchaEnterpriseProvider:Provider};
  const first=api.initializeAppCheckOnce(options);
  const second=api.initializeAppCheckOnce(options);
  assert.equal(first.ok,true);
  assert.equal(second,first);
  assert.equal(calls.filter(call=>call.kind==='provider').length,1);
  assert.equal(calls.filter(call=>call.kind==='initialize').length,1);
  assert.equal(calls[1].receivedApp,app);
  assert.equal(calls[1].options.isTokenAutoRefreshEnabled,true);
  assert.ok(calls[1].options.provider instanceof Provider);
});

test('missing invalid or failed configuration stays inert without a debug fallback',()=>{
  const api=client();
  let calls=0;
  const dependency=()=>{calls++;};
  for(const siteKey of ['', 'short', 'contains spaces and is invalid']){
    const result=api.initializeAppCheckOnce({app:{},siteKey,initializeAppCheck:dependency,ReCaptchaEnterpriseProvider:dependency});
    assert.equal(result.ok,false);
    assert.equal(result.code,'app-check/not-configured');
  }
  assert.equal(calls,0);
  const failed=api.initializeAppCheckOnce({
    app:{},siteKey:'enterprise_site_key_1234567890',
    initializeAppCheck(){throw new Error('synthetic');},
    ReCaptchaEnterpriseProvider:class{}
  });
  assert.deepEqual(JSON.parse(JSON.stringify(failed)),{ok:false,code:'app-check/initialization-failed'});
  assert.doesNotMatch(source,/debugToken|FIREBASE_APPCHECK_DEBUG_TOKEN|CustomProvider/);
});

test('App Check starts after paint and activates the RTDB client only after successful initialization',()=>{
  assert.match(html,/import\(`\$\{base\}\/firebase-app-check\.js`\)/);
  assert.match(html,/ReCaptchaEnterpriseProvider:appCheckMod\.ReCaptchaEnterpriseProvider/);
  assert.match(html,/firebaseAppCheckInitializationPromise=loadFirebaseAppCheckSdk\(\)[\s\S]+initializeAppCheckOnce\(\{app,siteKey:FIREBASE_APP_CHECK_SITE_KEY,\.\.\.sdk\}\)/);
  assert.match(html,/fbApp=early\?\.app\|\|initializeApp\(firebaseConfig\(url\),'pogo'\);\s*firebaseDatabaseHandle=getDatabase\(fbApp,url\)/);
  assert.match(html,/afterFirstPaint\(\(\)=>\{\s*startBackgroundStartup\(\);\s*startFirebaseStartup\(shareReq\)/);
  assert.match(html,/ensureFirebaseDataProtection[\s\S]+if\(!status\?\.ok\)throw[\s\S]+activateFirebaseDataClient\(\)/);
  assert.match(html,/function activateFirebaseDataClient\(\)[\s\S]+db=firebaseDatabaseHandle[\s\S]+firebaseDataProtectionReady=true;\s*fbOn=true/);
  assert.match(html,/function startManagedSnapshotListener[\s\S]+if\(!firebaseDataProtectionReady\)/);
  assert.doesNotMatch(html,/setupFirebase\(url=FIREBASE_URL\)[\s\S]{0,260}startFirebaseAppCheck\(fbApp\)/);
  assert.match(html,/const FIREBASE_APP_CHECK_SITE_KEY="6Lc6-X8tAAAAAI-MY4WdeI8RV-njpbiFX5mFjDbz";/);
  assert.match(html,/state\.sdkPromise=Promise\.all\(\[import\(base\+'\/firebase-app\.js'\),import\(base\+'\/firebase-auth\.js'\)\]\)/);
  assert.match(html,/firebaseSdkPromise=Promise\.all\(\[[\s\S]+startPogoEarlyAuth\(\)[\s\S]+firebase-database\.js[\s\S]+\]\)/);
  assert.doesNotMatch(html,/getFunctions\(|httpsCallable\(|readE1AccountFoundation\(|reserveE1TrainerHandle\(/);
  assert.doesNotMatch(html,/FIREBASE_APPCHECK_DEBUG_TOKEN|ReCaptchaV3Provider|CustomProvider/);
});

test('App Check import and readiness waits fail closed with bounded stage-specific errors',()=>{
  assert.match(html,/const FIREBASE_APP_CHECK_STAGE_TIMEOUT_MS=30\*1000/);
  assert.match(html,/function appCheckStageTimeout\(promise,code\)[\s\S]+Promise\.race/);
  assert.match(html,/firebaseAppCheckStage='sdk-import';\s*firebaseAppCheckSdkPromise=import\(`\$\{base\}\/firebase-app-check\.js`\)/);
  assert.match(html,/app-check\/sdk-import-failed/);
  assert.match(html,/function firebaseAppCheckReady\(\)[\s\S]+app-check\/sdk-import-timeout[\s\S]+app-check\/initialization-timeout[\s\S]+app-check\/readiness-timeout/);
  assert.match(html,/service\.unavailable\(error\?\.code\|\|'app-check\/sdk-unavailable'\)/);
  assert.match(html,/startFirebaseAppCheck\(fbApp\);\s*firebaseDataProtectionPromise=firebaseAppCheckReady\(\)/);
  assert.match(html,/function startFirebaseAppCheck\(app\)\{\s*if\(firebaseAppCheckInitializationPromise\)return firebaseAppCheckInitializationPromise/);
  assert.match(html,/firebaseDataProtectionPromise=null;\s*throw error/);
  assert.doesNotMatch(html,/appCheckStageTimeout\(\s*import\(`\$\{base\}\/firebase-app-check\.js`\)/);
  assert.equal((html.match(/firebaseAppCheckSdkPromise=null/g)||[]).length,1);
});

test('current Auth behavior and callable monitor configuration remain unchanged',()=>{
  assert.match(html,/auth=early\?\.auth\|\|getAuth\(fbApp\);\s*bindAuthObserver\(\);/);
  assert.match(html,/signInWithEmailAndPassword\(auth,email,pin\)/);
  const gateway=readFileSync(path.join(root,'functions/e1-gateway/index.js'),'utf8');
  assert.match(gateway,/enforceAppCheck: configuration\.appCheckEnforcementMode === 'enforced'/);
  assert.match(gateway,/exports\.readE1AccountFoundation/);
  assert.match(gateway,/exports\.reserveE1TrainerHandle/);
});
