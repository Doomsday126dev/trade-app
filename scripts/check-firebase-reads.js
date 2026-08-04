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
const validScopes=new Set(['session','screen','selectedTrainer','legacyAdmin']);
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
for(const contract of SOURCE_CALL_CONTRACT.needles){
  assert.equal(occurrenceCount(contract.text),contract.count,
    `Firebase read wiring changed for registered source call: ${contract.text}`);
}
const legacyContract=SOURCE_CALL_CONTRACT.legacyListenerBlock;
const legacyHash=createHash('sha256')
  .update(sourceBetween(legacyContract.start,legacyContract.end))
  .digest('hex');
assert.equal(legacyHash,legacyContract.sha256,
  'Existing production listener block changed during the inert read-boundary phase');

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

const literalSubscriptions=[...indexSource.matchAll(/subscribePath\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match=>match[1]);
for(const pathName of literalSubscriptions){
  assert.ok(expectedBroad.includes(pathName),`Literal subscribePath(${pathName}) is not registered`);
}
assert.ok(indexSource.includes("['wishlist','dynamax','gmax','costumes'].includes(type))subscribePath(type);"),
  'Lazy list subscriptions must remain explicitly constrained');
assert.ok(indexSource.includes('subscribePath(`pendingDecrements/${cur}`);'),
  'Current-user pending decrement listener must remain exact');
assert.ok(indexSource.includes('const _activeSubs={};'),
  'Phase 1 must preserve the existing production listener implementation');
assert.ok(indexSource.includes('const NARROW_READ_CLIENT_ENABLED=false;'),
  'Narrow-read client foundation must remain disabled in Phase 1');
const moduleOrder=[
  'js/i18n/locales/en.js','js/i18n/core.js','js/services/firebaseClient.js',
  'js/data/subscriptionManager.js','js/data/firebaseReadRegistry.js',
  'js/data/currentUserRepository.js','js/data/publicShareRepository.js',
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
