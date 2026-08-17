const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');

function between(start,end){
  const from=html.indexOf(start),to=html.indexOf(end,from);
  assert.notEqual(from,-1,`missing ${start}`);
  assert.notEqual(to,-1,`missing ${end}`);
  return html.slice(from,to);
}

test('accessible pre-auth markup precedes the optional application script graph',()=>{
  const preauth=html.indexOf('id="preauth-pg"');
  const firstAppScript=html.indexOf('<script src="data.js');
  assert.ok(preauth>0&&preauth<firstAppScript);
  assert.match(html,/id="login-pg" data-bootstrap-pending="true" aria-busy="true"/);
  assert.match(html,/id="preauth-pg" class="login-bootstrap-status" aria-labelledby="preauth-title" role="status" aria-live="polite" aria-atomic="true" aria-busy="true"/);
  assert.match(html,/id="preauth-title" data-i18n="app\.preparing">Preparing your trade list/);
  assert.match(html,/id="login-user"[\s\S]+disabled data-bootstrap-disabled="true"/);
  assert.match(html,/id="app" style="display:none"/);
});

test('the first paint uses stable local system fonts without a font-network dependency',()=>{
  assert.doesNotMatch(html,/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(html,/--font:system-ui,-apple-system/);
  assert.match(html,/--mono:ui-monospace,SFMono-Regular/);
});

test('startup waits for a paint opportunity before Firebase App Check and background work',()=>{
  assert.match(html,/function afterFirstPaint\(task\)[\s\S]+requestAnimationFrame\(\(\)=>requestAnimationFrame/);
  const boot=between("document.addEventListener('DOMContentLoaded'",'</script>');
  assert.match(boot,/showPreAuth\(\)[\s\S]+afterFirstPaint\(\(\)=>\{\s*startBackgroundStartup\(\);\s*startFirebaseStartup\(shareReq\)/);
  assert.doesNotMatch(boot,/\bbuildAcItems\(\);/);
  assert.doesNotMatch(boot,/\bloadTypeCache\(\);/);
  assert.doesNotMatch(boot,/if\(s&&allData\.users\?\.\[s\]\)\{cur=s;showApp\(\);\}/);
});

test('Auth-only bootstrap reuses one Firebase app without exposing data or activating login controls',()=>{
  const early=between('window.__pogoEarlyAuth=','try{performance.mark(\'pogo:preauth-markup-ready\')}');
  assert.match(early,/firebase-app\.js[\s\S]+firebase-auth\.js/);
  assert.doesNotMatch(early,/firebase-database\.js|firebase-app-check\.js|ReCaptcha/);
  assert.match(early,/state\.user=user\|\|null;state\.stateKnown=true/);
  assert.doesNotMatch(early,/bootstrapDisabled|login-user|login-pg/);
  assert.doesNotMatch(early,/document\.getElementById\('app'\)[\s\S]+style\.display='flex'/);
  assert.match(html,/startPogoEarlyAuth\(\)[\s\S]+firebaseDatabaseHandle=getDatabase\(fbApp,url\)/);
  assert.match(html,/fbApp=early\?\.app\|\|initializeApp/);
  assert.match(html,/auth=early\?\.auth\|\|getAuth/);
});

test('cached private UI cannot replace pre-auth before Firebase Auth restoration',()=>{
  const startup=between('async function startFirebaseStartup(shareReq){','// ── BOOT');
  assert.match(startup,/setupFirebase\(FIREBASE_URL\);\s*const restoredUser=await waitForAuthState\(\)/);
  assert.match(startup,/else if\(restoredUser&&cur&&document\.getElementById\('app'\)\?\.style\.display==='none'\)showApp\(\)/);
  assert.doesNotMatch(startup,/showApp\(\)[\s\S]+waitForAuthState/);
  for(const fn of ['showConfig','showLogin'])assert.match(between(`function ${fn}(`,'\n}'),/hidePreAuth\(\)/);
  assert.match(between('function showApp(){','const renderFrame='),/hidePreAuth\(\)/);
});

test('RTDB handles and listeners fail closed until App Check initialization succeeds',()=>{
  const setup=between('function setupFirebase(url=FIREBASE_URL){','async function ensureFirebaseIdentity');
  assert.match(setup,/firebaseDatabaseHandle=getDatabase\(fbApp,url\)/);
  assert.doesNotMatch(setup,/\bdb=getDatabase\(fbApp\)/);
  assert.doesNotMatch(setup,/\bfbOn=true/);
  const protection=between('function ensureFirebaseDataProtection(){','const DB=');
  assert.match(protection,/if\(!status\?\.ok\)throw/);
  assert.match(protection,/activateFirebaseDataClient\(\)/);
  assert.match(protection,/catch\(error=>\{\s*db=null;fbOn=false;firebaseDataProtectionReady=false/);
  assert.match(html,/function startListener\(\)\{\s*if\(!firebaseDataProtectionReady\|\|!db\)return false/);
  assert.match(html,/function ensureProtectedSubscriptions\(\)\{\s*if\(!firebaseDataProtectionReady\|\|!db/);
});

test('Request Access cannot persist locally or remotely before App Check readiness',()=>{
  const submit=between('async function submitRequest(){','function renderPendingRequests');
  const guard=submit.indexOf('await ensureFirebaseDataProtection()');
  const localWrite=submit.indexOf('const s=getLocal()');
  const remoteWrite=submit.indexOf("set(ref(db,`requests/${reqId}`)");
  assert.ok(guard>0&&guard<localWrite&&localWrite<remoteWrite);
  assert.match(submit,/catch\(e\)[\s\S]+request\.sendFailed[\s\S]+return;/);
});

test('signed-in catalog and preference caches initialize only inside showApp',()=>{
  const showApp=between('function showApp(){','const renderFrame=');
  assert.match(showApp,/loadTypeCache\(\);\s*syncSpeedAddMode\(\)/);
  assert.match(showApp,/buildAcItems\(\)/);
  assert.match(showApp,/pogo:signed-in-ready/);
});
