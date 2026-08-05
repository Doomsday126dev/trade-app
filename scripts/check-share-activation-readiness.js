const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const baselineFile=path.join(root,'tests/firebase/database.rules.narrow-read.json');
const candidateFile=path.join(root,'tests/firebase/database.rules.share-visibility.json');
const baselineBytes=fs.readFileSync(baselineFile),candidateBytes=fs.readFileSync(candidateFile);
const baseline=JSON.parse(baselineBytes).rules,candidate=JSON.parse(candidateBytes).rules;
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const expectedBaseline='e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf';
const expectedCandidate='fc781919003a5afcba4fcf1e5235498090352deb1448e746b6c69ec61add6ac3';
const futureRoots=['accounts','groups','legacyShareOwners','shareAccess','shareDirectory','shareGroupAccess','shareVisibility','shareVisibilityConfig','trainerPreferencesConfig','trainerShares','userPreferences'];

assert.equal(sha(baselineBytes),expectedBaseline);
assert.equal(sha(candidateBytes),expectedCandidate);
assert.equal(baseline['.read'],false);assert.equal(candidate['.read'],false);
for(const [key,value] of Object.entries(baseline))assert.deepEqual(candidate[key],value,`Live root changed: ${key}`);
assert.deepEqual(Object.keys(candidate).filter(key=>!Object.hasOwn(baseline,key)).sort(),futureRoots);
assert.deepEqual(candidate.publicShares,baseline.publicShares);
assert.match(JSON.stringify(candidate.shareVisibility),/shareVisibilityConfig.*writesEnabled/);
assert.match(JSON.stringify(candidate.trainerShares),/shareVisibilityConfig.*writesEnabled/);
assert.match(JSON.stringify(candidate.userPreferences),/trainerPreferencesConfig.*writesEnabled/);
assert.equal(candidate.groups['.read'],false);assert.equal(candidate.groups['.write'],false);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.doesNotMatch(html,/shareActivationPlanning|trustedBackendContracts/);
assert.match(html,/SYNCED_TRAINER_PREFERENCES_ENABLED!==false/);
console.log(JSON.stringify({status:'share-activation-readiness-passed',liveRootsPreserved:Object.keys(baseline).length,futureRootsInactive:futureRoots.length,baselineSha256:expectedBaseline,candidateSha256:expectedCandidate,productionReads:0,productionWrites:0},null,2));
