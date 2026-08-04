const assert=require('node:assert/strict');
const {readFileSync,readdirSync}=require('node:fs');
const {createHash}=require('node:crypto');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const indexSource=readFileSync(path.join(root,'index.html'),'utf8');
const registrySource=readFileSync(path.join(root,'js/data/firebaseReadRegistry.js'),'utf8');
const window={};
vm.runInNewContext(registrySource,{window});
const {READ_SURFACES,SOURCE_CALL_CONTRACT}=window.PogoData.firebaseReadRegistry;

const requiredFields=['id','path','method','breadth','ownerScope','audience','consumers','status'];
const validScopes=new Set(['public','session','screen','selectedTrainer','legacyAdmin']);
const validBreadths=new Set(['exact','broad','dynamic']);
const validStatuses=new Set(['transitional','retained','planned_retirement']);

assert.ok(READ_SURFACES.length>0,'Firebase read registry must not be empty');
assert.equal(new Set(READ_SURFACES.map(entry=>entry.id)).size,READ_SURFACES.length,'Firebase read registry IDs must be unique');
for(const entry of READ_SURFACES){
  for(const field of requiredFields)assert.ok(entry[field]!==undefined,`Read registry entry ${entry.id||'<missing>'} lacks ${field}`);
  assert.ok(validScopes.has(entry.ownerScope),`Read registry entry ${entry.id} has an invalid owner scope`);
  assert.ok(validBreadths.has(entry.breadth),`Read registry entry ${entry.id} has an invalid breadth`);
  assert.ok(validStatuses.has(entry.status),`Read registry entry ${entry.id} has an invalid lifecycle status`);
  assert.ok(Array.isArray(entry.consumers)&&entry.consumers.length>0,`Read registry entry ${entry.id} must name a consumer`);
}

function directCallCount(name){
  return[...indexSource.matchAll(new RegExp(`(^|[^\\w$.])${name}\\s*\\(`,'gm'))].length;
}
function occurrenceCount(needle){return indexSource.split(needle).length-1;}
function jsFiles(directory){
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const target=path.join(directory,entry.name);
    if(entry.isDirectory())return jsFiles(target);
    return entry.isFile()&&entry.name.endsWith('.js')?[target]:[];
  });
}
function sourceBetween(start,end){
  const startAt=indexSource.indexOf(start);
  const endAt=indexSource.indexOf(end,startAt);
  assert.notEqual(startAt,-1,`Missing registered source marker: ${start}`);
  assert.notEqual(endAt,-1,`Missing registered source marker: ${end}`);
  return indexSource.slice(startAt,endAt);
}

assert.equal(directCallCount('get'),SOURCE_CALL_CONTRACT.directGetCount,
  'Unregistered direct Firebase get() call detected; update the explicit registry and this contract intentionally');
assert.equal(directCallCount('onValue'),SOURCE_CALL_CONTRACT.directOnValueCount,
  'Unregistered direct Firebase onValue() call detected; update the explicit registry and this contract intentionally');
assert.equal(occurrenceCount('managedFirebaseClient.listen('),SOURCE_CALL_CONTRACT.managedListenCount,
  'Managed Firebase listener entry points changed; register the lifecycle wiring intentionally');
for(const contract of SOURCE_CALL_CONTRACT.needles){
  assert.equal(occurrenceCount(contract.text),contract.count,
    `Firebase read wiring changed for registered source call: ${contract.text}`);
}
for(const handlerContract of SOURCE_CALL_CONTRACT.unchangedHandlerBlocks){
  const handlerHash=createHash('sha256')
    .update(sourceBetween(handlerContract.start,handlerContract.end))
    .digest('hex');
  assert.equal(handlerHash,handlerContract.sha256,
    `Existing Firebase snapshot behavior changed at ${handlerContract.start}`);
}

const repositoryCallFiles=jsFiles(path.join(root,'js'))
  .filter(file=>/client\.(?:read|listen)\s*\(/.test(readFileSync(file,'utf8')))
  .map(file=>path.relative(root,file).split(path.sep).join('/'))
  .sort();
assert.deepEqual(repositoryCallFiles,Array.from(SOURCE_CALL_CONTRACT.repositoryFiles).sort(),
  'A repository Firebase read/listen call was added outside the registered data-access files');

const expectedBroad=[...SOURCE_CALL_CONTRACT.broadSubscribePaths].sort();
const registeredBroad=READ_SURFACES
  .filter(entry=>entry.method==='onValue'&&entry.breadth==='broad')
  .map(entry=>entry.path).sort();
assert.deepEqual(Array.from(registeredBroad),Array.from(expectedBroad),
  'Broad onValue paths must be fully represented in the read registry');
const requiredOwnedExactPaths=[
  'users/{currentUsername}','wishlist/{currentUsername}','dynamax/{currentUsername}',
  'gmax/{currentUsername}','costumes/{currentUsername}','have/{currentUsername}',
  'authIndex/{currentUid}','userCommunities/{currentUid}','pendingDecrements/{username}'
];
const registeredExact=new Set(READ_SURFACES
  .filter(entry=>entry.method==='onValue'&&entry.breadth==='exact')
  .map(entry=>entry.path));
for(const exactPath of requiredOwnedExactPaths){
  assert.ok(registeredExact.has(exactPath),`Owned exact read is not registered: ${exactPath}`);
}

const literalSubscriptions=[...indexSource.matchAll(/subscribePath\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match=>match[1]);
for(const pathName of literalSubscriptions){
  assert.ok(expectedBroad.includes(pathName),`Literal subscribePath(${pathName}) is not registered`);
}
assert.ok(indexSource.includes("if(!['wishlist','dynamax','gmax','costumes'].includes(type))return;"),
  'Legacy lazy list subscriptions must remain explicitly constrained');
assert.ok(indexSource.includes('subscribePath(`pendingDecrements/${cur}`);'),
  'Current-user pending decrement listener must remain exact');
assert.ok(!indexSource.includes('_activeSubs'),
  'Legacy _activeSubs ownership must not coexist with managed listeners');
assert.ok(!indexSource.includes('_activeShareSubs'),
  'Legacy _activeShareSubs ownership must not coexist with managed listeners');
assert.ok(indexSource.includes("managedListenerLifecycle.subscribePublic({...options,key:'public:loginDirectory'})"),
  'loginDirectory must use the managed public listener scope');
assert.ok(indexSource.includes('managedListenerLifecycle.subscribeSession({...options,key:`session:${path}`})'),
  'Protected subscribePath listeners must use the managed session scope');
assert.ok(indexSource.includes('managedListenerLifecycle.subscribeSelectedTrainer({'),
  'Share listeners must use selected-trainer ownership');
assert.ok(indexSource.includes("return[`users/${username}`,...PUBLIC_SHARE_TYPES.map(t=>`${t}/${username}`)];"),
  'Authenticated share fallback paths must remain users plus the four existing list paths');
assert.ok(indexSource.includes('const NARROW_READ_CLIENT_ENABLED=false;'),
  'Narrow-read client must remain disabled during exact-read migration');
assert.ok(indexSource.includes('const LEGACY_BROAD_READS_ENABLED=true;'),
  'Legacy broad reads must remain the production default during exact-read migration');
assert.ok(indexSource.includes('return NARROW_READ_CLIENT_ENABLED&&!LEGACY_BROAD_READS_ENABLED;'),
  'Exact and legacy owned-data listeners must be mutually exclusive');
assert.ok(indexSource.includes("managedOwnedDataCoordinator?.subscribeList(type)"),
  'Lazy owned lists must route through the exact-read coordinator when enabled');
assert.ok(indexSource.includes("managedOwnedDataCoordinator?.subscribeSurface('pendingDecrements')"),
  'Pending decrements must route through the exact-read coordinator when enabled');
const logoutSource=sourceBetween('function logout(){','// ── NAV');
assert.ok(logoutSource.indexOf("managedListenerLifecycle.deactivateSession('logout');")<logoutSource.indexOf('cur=null;'),
  'Logout must invalidate protected listeners before clearing app identity');
assert.ok(logoutSource.indexOf('clearOwnedSession();')<logoutSource.indexOf('cur=null;'),
  'Logout must clear protected cache and queue state before clearing app identity');
assert.ok(logoutSource.indexOf('cur=null;')<logoutSource.indexOf('firebaseSignOut(auth)'),
  'Logout must clear local app identity before Firebase sign-out');
const authObserverSource=sourceBetween('function bindAuthObserver(){','function waitForAuthState');
assert.ok(authObserverSource.indexOf("managedListenerLifecycle.deactivateSession('auth_loss');")<authObserverSource.indexOf("currentAuthUid=user?.uid||'';"),
  'Auth loss must invalidate protected listeners before clearing the authenticated UID');
assert.ok(authObserverSource.indexOf("suspendOwnedSession('auth_loss');")<authObserverSource.indexOf("currentAuthUid=user?.uid||'';"),
  'Auth loss must lock protected cache and queue state before clearing the authenticated UID');
const publicShareHandler=sourceBetween('function onPublicShareSnapshot(username,snap){','function onShareSnapshot(path,snap){');
const authenticatedShareHandler=sourceBetween('function onShareSnapshot(path,snap){','function ensureShareViewSubscriptions(username){');
assert.ok(!publicShareHandler.includes('saveLocal(')&&!authenticatedShareHandler.includes('saveLocal('),
  'Selected-trainer snapshots must remain runtime-only and outside the protected persisted cache');
assert.ok(indexSource.includes('managedSessionCache.writeData(normalizeData(s))'),
  'Protected session-cache writes must pass through the session cache boundary');
assert.ok(indexSource.includes('managedSessionCache.writeQueue(syncQueue||{})'),
  'Pending sync writes must pass through the owner-bound queue boundary');
assert.ok(!indexSource.includes("const SYNC_QUEUE_KEY='pogoSyncQueue_v1';"),
  'The unowned legacy sync queue must not remain active');
const moduleOrder=[
  'js/i18n/locales/en.js','js/i18n/core.js','js/services/firebaseClient.js',
  'js/data/subscriptionManager.js','js/data/listenerLifecycle.js','js/data/sessionCacheBoundary.js','js/data/firebaseReadRegistry.js',
  'js/data/currentUserRepository.js','js/data/ownedDataCoordinator.js','js/data/publicShareRepository.js',
  'js/domain/cacheAdapters.js'
];
let previous=-1;
for(const modulePath of moduleOrder){
  const at=indexSource.indexOf(`<script src="${modulePath}"></script>`);
  assert.ok(at>previous,`Read-boundary module load order is invalid at ${modulePath}`);
  previous=at;
}
assert.ok(previous<indexSource.indexOf('<script>\nlet initializeApp'),
  'Read-boundary modules must load before the main inline script');

console.log(`Firebase read registry checks passed (${READ_SURFACES.length} surfaces; ${SOURCE_CALL_CONTRACT.directGetCount} get; ${SOURCE_CALL_CONTRACT.directOnValueCount} onValue).`);
