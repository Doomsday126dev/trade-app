const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
const baseline=JSON.parse(fs.readFileSync(path.join(root,'tests/firebase/database.rules.narrow-read.json'),'utf8')).rules;
const candidate=JSON.parse(fs.readFileSync(path.join(root,'tests/firebase/database.rules.share-visibility.json'),'utf8')).rules;
const map=JSON.parse(fs.readFileSync(path.join(root,'tests/firebase/share-visibility-surface-map.json'),'utf8'));
const emulator=fs.readFileSync(path.join(root,'tests/firebase/share-visibility-rules.test.cjs'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const window={};vm.runInNewContext(fs.readFileSync(path.join(root,'js/data/firebaseReadRegistry.js'),'utf8'),{window});
const registry=new Map(Array.from(window.PogoData.firebaseReadRegistry.READ_SURFACES,entry=>[entry.id,entry]));

assert.equal(candidate['.read'],false);
for(const [key,value] of Object.entries(baseline))assert.deepEqual(candidate[key],value,`Live narrow-read rule changed at ${key}`);
const added=Object.keys(candidate).filter(key=>!Object.hasOwn(baseline,key)).sort();
assert.deepEqual(added,['accounts','groups','legacyShareOwners','shareAccess','shareDirectory','shareGroupAccess','shareVisibility','shareVisibilityConfig','trainerPreferencesConfig','trainerShares','userPreferences']);
assert.deepEqual(candidate.publicShares,baseline.publicShares,'Legacy publicShares compatibility changed');
assert.equal(new Set(map.surfaces.map(item=>item.registryId)).size,map.surfaces.length);
assert.equal(map.surfaces.length,11);
for(const surface of map.surfaces){
  const registered=registry.get(surface.registryId);assert.ok(registered,`Missing registry entry ${surface.registryId}`);
  assert.equal(registered.path,surface.path);assert.equal(registered.status,'candidate_inactive');
  assert.equal(surface.status,'disabled_future');assert.equal(surface.featureEnabled,false);assert.equal(surface.writeGateEnabled,false);
  assert.ok(emulator.includes(`test('${surface.emulatorTest}'`),`Missing emulator test ${surface.emulatorTest}`);
  const rule=surface.rulePath.split('/').reduce((node,key)=>node?.[key],candidate);assert.notEqual(rule?.['.read'],undefined,`Missing rule read ${surface.rulePath}`);
}
for(const pathName of ['accounts','shareVisibility','shareAccess','shareDirectory','trainerShares','legacyShareOwners'])assert.match(JSON.stringify(candidate[pathName]),/shareVisibilityConfig.*writesEnabled/);
assert.match(JSON.stringify(candidate.userPreferences),/trainerPreferencesConfig.*writesEnabled/);
assert.equal(candidate.groups['.read'],false);assert.equal(candidate.groups['.write'],false);assert.equal(candidate.shareGroupAccess.$ownerUid['.write'],false);
assert.doesNotMatch(html,/js\/domain\/shareVisibility\.js|SHARE_VISIBILITY_MODEL_ENABLED/);
assert.match(html,/js\/domain\/trainerPreferences\.js\?v=2026-08-05\.11/);
assert.match(html,/SYNCED_TRAINER_PREFERENCES_ENABLED!==false/);
console.log(`Share visibility additive contract passed (${Object.keys(baseline).length} live rule roots preserved; ${map.surfaces.length} disabled future surfaces mapped).`);
