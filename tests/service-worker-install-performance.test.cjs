const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {profileServiceWorkerInstall}=require('../scripts/profile-service-worker-install.cjs');

const source=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');

test('service-worker cold install bounds network work and writes each required asset once',async()=>{
  const profile=await profileServiceWorkerInstall({source,fetchDelayMs:2,putDelayMs:1});
  assert.equal(profile.complete,true);
  assert.equal(profile.skipWaiting,1);
  assert.equal(profile.fetchCount,profile.requiredAssetCount);
  assert.equal(profile.cacheWrites,profile.requiredAssetCount);
  assert.equal(profile.duplicateCopyWrites,0);
  assert.ok(profile.peakFetchConcurrency<=8,JSON.stringify(profile));
  assert.equal(profile.cacheNames.filter(name=>name.startsWith('shell-pogo-trades-')).length,1);
});

test('same-release complete cache performs no network or duplicate cache work',async()=>{
  const profile=await profileServiceWorkerInstall({source,fetchDelayMs:2,putDelayMs:1,seedCurrent:true});
  assert.equal(profile.complete,true);
  assert.equal(profile.fetchCount,0);
  assert.equal(profile.reusedAssetCount,profile.requiredAssetCount);
  assert.equal(profile.cacheWrites,0);
  assert.equal(profile.peakFetchConcurrency,0);
});

test('bounded install candidates remain explicit and the selected pool is eight',async()=>{
  const candidates=[];
  for(const concurrency of [3,4,6,8]){
    const result=await profileServiceWorkerInstall({source,fetchDelayMs:2,putDelayMs:0,concurrencyOverride:concurrency});
    candidates.push({concurrency,duration:result.installDurationMs,peak:result.peakFetchConcurrency});
    assert.ok(result.peakFetchConcurrency<=concurrency,JSON.stringify(result));
    assert.equal(result.complete,true);
  }
  assert.match(source,/const INSTALL_FETCH_CONCURRENCY=8;/);
  assert.deepEqual(candidates.map(item=>item.peak),[3,4,6,8]);
});
