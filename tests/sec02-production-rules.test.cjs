const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const root=path.join(__dirname,'..');
const readJson=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const baseline=readJson('tests/firebase/database.rules.narrow-read.json');
const requestCandidate=readJson('tests/firebase/database.rules.request-access-candidate.json');
const production=readJson('tests/firebase/database.rules.sec02-production.json');
const deployConfig=readJson('firebase.sec02-production.json');
const rollbackConfig=readJson('firebase.sec02-rollback.json');
const rollbackPath='release/firebase/sec02/rollback/database.rules.trade-list-a4297-default-rtdb.pre-sec02-20260817T040808Z.json';
const rollback=readJson(rollbackPath);
const rollbackMetadata=readJson('release/firebase/sec02/rollback/database.rules.trade-list-a4297-default-rtdb.pre-sec02-20260817T040808Z.metadata.json');

test('production candidate preserves every authoritative root and changes only /requests',()=>{
  assert.deepEqual(Object.keys(production.rules),Object.keys(baseline.rules));
  assert.deepEqual(production.rules.requests,requestCandidate.rules.requests);
  for(const rootName of Object.keys(baseline.rules)){
    if(rootName!=='requests')assert.deepEqual(production.rules[rootName],baseline.rules[rootName],rootName);
  }
});

test('production candidate retains active identity list share community trade and decrement roots',()=>{
  const required=['users','authIndex','loginDirectory','wishlist','dynamax','gmax','costumes','have','publicShares','communities','userCommunities','communityRequests','offers','trades','pendingDecrements'];
  for(const rootName of required)assert.ok(Object.hasOwn(production.rules,rootName),rootName);
});

test('production deployment config targets exactly one RTDB instance and one complete Rules artifact',()=>{
  assert.deepEqual(Object.keys(deployConfig),['database']);
  assert.deepEqual(deployConfig.database,[{
    instance:'trade-list-a4297-default-rtdb',
    rules:'tests/firebase/database.rules.sec02-production.json'
  }]);
  assert.doesNotMatch(JSON.stringify(deployConfig),/request-access-candidate/u);
});

test('emulator-only request candidate remains separate from the production artifact',()=>{
  assert.notDeepEqual(Object.keys(requestCandidate.rules),Object.keys(production.rules));
  assert.deepEqual(Object.keys(requestCandidate.rules),['.read','.write','admins','requests']);
});

test('rollback config targets only the exact exported pre-SEC-02 Rules artifact',()=>{
  assert.deepEqual(Object.keys(rollbackConfig),['database']);
  assert.deepEqual(rollbackConfig.database,[{
    instance:'trade-list-a4297-default-rtdb',
    rules:rollbackPath
  }]);
  assert.deepEqual(rollback,baseline);
  assert.equal(rollbackMetadata.project,'trade-list-a4297');
  assert.equal(rollbackMetadata.instance,'trade-list-a4297-default-rtdb');
  assert.equal(rollbackMetadata.sha256,'b1fe3b0a7ac4158fb29df8408b199a5ec865a51d1ceec89a013ef0d08bad5d62');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,rollbackPath))).digest('hex'),rollbackMetadata.sha256);
  assert.equal(rollbackMetadata.semanticallyMatchesBaseline,true);
});
