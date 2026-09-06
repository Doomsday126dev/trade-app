const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {detectUpstreamChanges,mappingReviewCandidates,validateCatalog}=require('../scripts/backgrounds/background-catalog-lib.cjs');

const root=path.join(__dirname,'..');
const catalog=JSON.parse(readFileSync(path.join(root,'data','backgrounds.json'),'utf8'));
const snapshot=JSON.parse(readFileSync(path.join(root,'data','background-upstream-snapshot.json'),'utf8'));
const fixture=JSON.parse(readFileSync(path.join(__dirname,'fixtures','background-upstream-signals.json'),'utf8'));


test('canonical registry is complete, deterministic, and provenance-bearing',()=>{
  const result=validateCatalog(catalog);
  assert.deepEqual(result.errors,[]);
  assert.equal(result.total,246);
  assert.equal(result.released,241);
  assert.equal(result.candidates,5);
  assert.equal(catalog.catalogVersion,'2026-08-26');
  assert.equal(catalog.asOf,'2026-08-26');
  assert.deepEqual(catalog.sources.map(source=>source.id),[
    'serebii-backgrounds','pokeminers-location-cards','pokemon-go-live-official'
  ]);
  assert.equal(snapshot.sourceCommit,'acd2f4a5a98790c84782f24322c0840b1a4f1838');
  assert.equal(snapshot.files.length,239);
  const mappingReview=mappingReviewCandidates(catalog);
  assert.ok(mappingReview.some(item=>item.id==='location-2026pokemonworldchampionships'&&item.reason==='eligible-pokemon-unmapped'));
});

test('released records have stable IDs, valid metadata, and no hosted artwork',()=>{
  const released=catalog.backgrounds.filter(record=>record.status==='released');
  assert.equal(new Set(catalog.backgrounds.map(record=>record.id)).size,catalog.backgrounds.length);
  assert.ok(released.length>200);
  for(const record of catalog.backgrounds){
    assert.match(record.id,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(['location','special'].includes(record.type));
    assert.ok(['released','candidate','retired'].includes(record.status));
    assert.ok(record.displayName&&record.shortName);
    assert.ok(record.aliases.length>=2);
    assert.ok(record.source.catalogId&&record.source.assetKey&&record.source.retrievedAt);
    assert.equal(Object.hasOwn(record,'imageUrl'),false);
    assert.equal(Object.hasOwn(record,'artwork'),false);
    assert.equal(record.pokemon.some(name=>/\(\s*\)$/.test(name)),false);
  }
});



test('offline upstream fixture deterministically reports review candidates and removals',()=>{
  assert.deepEqual(detectUpstreamChanges(fixture.accepted,fixture.current),fixture.expected);
  assert.deepEqual(detectUpstreamChanges(fixture.accepted,fixture.accepted.files),{added:[],removed:[]});
});

test('catalog validation rejects duplicate IDs and nondeterministic ordering',()=>{
  const duplicate=structuredClone(catalog);
  duplicate.backgrounds[1].id=duplicate.backgrounds[0].id;
  assert.ok(validateCatalog(duplicate).errors.some(error=>error.startsWith('duplicate id:')));
  const unsorted=structuredClone(catalog);
  [unsorted.backgrounds[0],unsorted.backgrounds[1]]=[unsorted.backgrounds[1],unsorted.backgrounds[0]];
  assert.ok(validateCatalog(unsorted).errors.includes('backgrounds are not deterministically sorted'));
});
