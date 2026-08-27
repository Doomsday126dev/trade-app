const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const source=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);

function load(){
  const window={};
  vm.runInContext(readFileSync(path.join(root,'js/domain/loginDirectory.js'),'utf8'),vm.createContext({window}));
  return window.PogoDomain.loginDirectory;
}
function plain(value){return JSON.parse(JSON.stringify(value))}

test('query entered before hydration updates when the authoritative snapshot arrives',()=>{
  const domain=load();
  const state=domain.createLoginDirectoryState();
  const token=state.begin();
  assert.equal(state.suggestions('scoo').length,0);
  assert.equal(state.succeed(token,{ScoopskiPotat0:{authReady:true}}).ok,true);
  assert.deepEqual(plain(state.suggestions('scoo').map(item=>item.name)),['ScoopskiPotat0']);
});

test('snapshot integration rerenders an already-entered query without another input event',()=>{
  assert.match(source,/else populateLoginUsers\(loginUserSuggestionsShouldOpen\(\)\)/);
  assert.match(source,/function populateLoginUsers\(open=false\)/);
  assert.match(source,/renderLoginUserSuggestions\(open\)/);
});

test('failed loading is an error state and never a false no-match snapshot',()=>{
  const domain=load();
  const state=domain.createLoginDirectoryState();
  const token=state.begin();
  state.fail(token,{code:'permission_denied'});
  assert.equal(state.snapshot().status,domain.STATES.ERROR);
  assert.deepEqual(plain(state.snapshot().directory),{});
});

test('a newer server snapshot replaces stale cached names and removes deleted entries',()=>{
  const domain=load();
  const state=domain.createLoginDirectoryState();
  let token=state.begin();
  state.succeed(token,{StaleTrainer:{authReady:true},CurrentTrainer:{authReady:true}});
  token=state.begin();
  state.succeed(token,{CurrentTrainer:{authReady:true}});
  assert.deepEqual(plain(domain.usernames(state.snapshot().directory)),['CurrentTrainer']);
});

test('restored server entries appear without clearing browser storage',()=>{
  const domain=load();
  const state=domain.createLoginDirectoryState();
  let token=state.begin();
  state.succeed(token,{});
  assert.equal(state.suggestions('restored').length,0);
  token=state.begin();
  state.succeed(token,{RestoredTrainer:{authReady:true}});
  assert.equal(state.suggestions('restored')[0].name,'RestoredTrainer');
});

test('stale callbacks cannot replace a newer directory generation',()=>{
  const domain=load();
  const state=domain.createLoginDirectoryState();
  const oldToken=state.begin();
  const currentToken=state.begin();
  state.succeed(currentToken,{Current:{authReady:true}});
  assert.equal(state.succeed(oldToken,{Stale:{authReady:true}}).status,'stale');
  assert.deepEqual(plain(domain.usernames(state.snapshot().directory)),['Current']);
});

test('legacy approved records remain discoverable and ready',()=>{
  const domain=load();
  const directory={LegacyBoolean:true,LegacyApproved:{approved:true},Current:{authReady:true},Pending:{authReady:false}};
  assert.deepEqual(plain(domain.usernames(directory)),['LegacyBoolean','LegacyApproved','Current','Pending']);
  assert.equal(domain.readyRecord(directory.LegacyBoolean),true);
  assert.equal(domain.readyRecord(directory.LegacyApproved),true);
  assert.equal(domain.readyRecord(directory.Current),true);
  assert.equal(domain.readyRecord(directory.Pending),false);
});

test('desktop and mobile queries use the same deterministic case-insensitive ranking',()=>{
  const domain=load();
  const directory={ScoopskiPotat0:{authReady:true},OtherScoo:{authReady:true}};
  const desktop=domain.rankSuggestions(directory,'SCOO').map(item=>item.name);
  const mobile=domain.rankSuggestions(directory,'scoo').map(item=>item.name);
  assert.deepEqual(desktop,mobile);
});

test('login cache normalization no longer manufactures directory rows from private users',()=>{
  const block=source.slice(source.indexOf('function normalizeData(s){'),source.indexOf('function initLocal(){'));
  assert.doesNotMatch(block,/s\.loginDirectory\[u\]\s*=\s*normalizedLoginDirectoryRecord/);
  const known=source.slice(source.indexOf('function knownLoginUsernames(){'),source.indexOf('function canonicalUsernameInput'));
  assert.doesNotMatch(known,/allData\.users/);
  assert.match(known,/loginDirectoryDomain\.usernames/);
});

test('routine profile persistence cannot write or downgrade the directory for ordinary users',()=>{
  const writeUser=source.slice(source.indexOf('async function writeUser(u,data){'),source.indexOf('async function writeUserNow'));
  const writeNow=source.slice(source.indexOf('async function writeUserNow(u,data){'),source.indexOf('async function writeUserStrict'));
  for(const block of [writeUser,writeNow])assert.match(block,/if\(canWriteLoginDirectoryNow\(\)\).*normalizedLoginDirectoryRecord/);
});

test('a loaded directory cannot fall back to a stale private user for login eligibility',()=>{
  const login=source.slice(source.indexOf('async function doLogin(){'),source.indexOf('function logout(){'));
  const unknownGuard=login.indexOf("if(!dirEntry){err.textContent=i18nCore.t('login.directoryUnknown');return;}");
  const cachedUserRead=login.indexOf('let ud=allData.users?.[u]');
  assert.ok(unknownGuard>=0,'missing authoritative directory rows must hard-stop login');
  assert.ok(unknownGuard<cachedUserRead,'directory eligibility must be checked before cached private user state');
});

test('directory repair preserves richer reverse-index membership metadata and stronger roles',()=>{
  const repair=source.slice(source.indexOf('async function repairMemberAccount'),source.indexOf('async function createMemberNow'));
  assert.match(repair,/existingReverse/);
  assert.match(repair,/role:strongerCommunityRole\(existingReverse\.role,proposed\.role\)/);
  assert.match(repair,/joinedAt:existingReverse\.joinedAt\|\|proposed\.joinedAt/);
});

test('logout, auth loss, and public-share availability remain independent from login eligibility',()=>{
  const logout=source.slice(source.indexOf('function logout(){'),source.indexOf('// ── NAV'));
  const authLoss=source.slice(source.indexOf('function bindAuthObserver(){'),source.indexOf('function waitForAuthState'));
  assert.doesNotMatch(logout,/loginDirectory\/|queueSync\(`loginDirectory/);
  assert.doesNotMatch(authLoss,/loginDirectory\/|queueSync\(`loginDirectory/);
  const login=source.slice(source.indexOf('async function doLogin(){'),source.indexOf('function logout(){'));
  assert.doesNotMatch(login,/publicShares/);
});

test('login UI distinguishes loading, error, retry, and authoritative no-match states',()=>{
  const render=source.slice(source.indexOf('function renderLoginUserSuggestions'),source.indexOf('function hideLoginUserSuggestions'));
  for(const key of ['login.directoryLoading','login.directoryError','login.directoryRetry','login.directoryNoMatch'])assert.match(render,new RegExp(key.replace('.','\\.')));
  assert.match(source,/managedSubscriptions\.unsubscribeByKey\('public:loginDirectory'\)/);
  const login=source.slice(source.indexOf('async function doLogin(){'),source.indexOf('function logout(){'));
  assert.match(login,/directoryState\.status===loginDirectoryDomain\.STATES\.LOADED\?directoryState\.directory\[u\]/);
  assert.match(login,/STATES\.LOADING\|\|directoryState\.status===loginDirectoryDomain\.STATES\.IDLE/);
  assert.match(login,/STATES\.ERROR/);
});
