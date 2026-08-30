const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const inventory=require(path.join(root,'data/pending-costume-artwork.json'));
const spriteCatalog=require(path.join(root,'data/costume-sprite-catalog.json'));
const window={};
vm.runInNewContext(fs.readFileSync(path.join(root,'js/domain/pokemonKeys.js'),'utf8'),{window});
const pokemonCatalog=window.PogoDomain.pokemonCatalog;

test('Wave 1 artwork inventory exactly describes the accepted .80 placeholder baseline',()=>{
  assert.equal(inventory.baselineRelease,'2026-08-29.80');
  assert.equal(inventory.maintenanceConcept,'pending-reviewed-artwork');
  assert.equal(inventory.entries.length,28);
  assert.deepEqual(inventory.baseline,{
    canonicalRecords:376,
    exactArtworkRecords:348,
    pendingArtworkRecords:28,
    selectableRows:423,
    exactSelectableRows:395,
    placeholderRows:28,
    unknownOrBaseSpeciesFallthrough:0
  });
  const ids=new Set(),categories={
    'newly-announced':0,
    'accepted-source-missing':0,
    'mapping-ambiguous':0,
    'restricted-source-only':0,
    'review-pending':0
  };
  const unavailable=spriteCatalog.entries.filter(entry=>entry.status==='unavailable');
  assert.equal(unavailable.length,28);
  for(const entry of inventory.entries){
    assert.equal(ids.has(entry.canonicalCostumeId),false,entry.canonicalCostumeId);ids.add(entry.canonicalCostumeId);
    assert.ok(Object.hasOwn(categories,entry.reasonCategory),entry.reasonCategory);categories[entry.reasonCategory]++;
    assert.equal(entry.currentStatus,'pending-reviewed-artwork');
    assert.ok(entry.acceptedSourcesChecked.length>0,entry.displayIdentity);
    assert.equal(typeof entry.candidate.exactImageFound,'boolean',entry.displayIdentity);
    assert.ok(entry.candidate.decision&&entry.candidate.reason&&entry.nextReviewAction&&entry.lastReviewedDate,entry.displayIdentity);
    const source=unavailable.find(item=>item.no===entry.species.dex&&item.names.includes(entry.displayIdentity));
    assert.ok(source,`${entry.displayIdentity} is not an unavailable .80 record`);
    const canonical=pokemonCatalog.decorateCatalogEntry({no:source.no,name:entry.displayIdentity}).catalogId;
    assert.equal(entry.canonicalCostumeId,canonical,entry.displayIdentity);
  }
  assert.deepEqual(categories,{
    'newly-announced':9,
    'accepted-source-missing':0,
    'mapping-ambiguous':5,
    'restricted-source-only':7,
    'review-pending':7
  });
});

test('Wave 1 kit covers all independent journeys, severity levels, cleanup, and honest results',()=>{
  const dir=path.join(root,'docs/trusted-user-wave-1');
  const required=['README.md','CHECKLIST.md','FEEDBACK-TEMPLATE.md','SEVERITY-RUBRIC.md','RESULTS-LOG.md'];
  for(const file of required)assert.ok(fs.existsSync(path.join(dir,file)),file);
  const checklist=fs.readFileSync(path.join(dir,'CHECKLIST.md'),'utf8');
  for(let i=1;i<=15;i++)assert.match(checklist,new RegExp(`\\| ${i} \\|`),`task ${i}`);
  for(const label of ['Both Want','Only I Want','Only Other Wants','Mapped costume','Ordinary Pokémon','Pending artwork'])assert.match(checklist,new RegExp(label));
  const rubric=fs.readFileSync(path.join(dir,'SEVERITY-RUBRIC.md'),'utf8');
  for(const level of ['P0','P1','P2','P3'])assert.match(rubric,new RegExp(`\\| ${level} \\|`));
  const results=fs.readFileSync(path.join(dir,'RESULTS-LOG.md'),'utf8');
  assert.match(results,/Do not prefill outcomes/);
  assert.match(results,/Not exercised/);
  const readme=fs.readFileSync(path.join(dir,'README.md'),'utf8');
  for(const item of ['28 pending reviewed costume artworks','42 background eligibility mappings','background artwork/source strategy','optional Special Trade Board background filter','account-isolation sync scenario not exercised'])assert.match(readme,new RegExp(item));
  assert.match(readme,/3–5 trusted Pokémon GO traders/);
  assert.match(readme,/Provider linking, Google login, Discord login, and public beta remain outside this wave/);
});

test('pending artwork placeholders use localized not-yet-available labels and matching tooltips',()=>{
  const application=fs.readFileSync(path.join(root,'js/app/application.js'),'utf8');
  const publicShare=fs.readFileSync(path.join(root,'js/app/publicShareApp.js'),'utf8');
  assert.match(application,/aria-label="\$\{escAttr\(label\)\}" title="\$\{escAttr\(label\)\}"/);
  assert.match(publicShare,/aria-label="\$\{attr\(label\)\}" title="\$\{attr\(label\)\}"/);
  const expected={
    en:'Artwork not yet available for {name}',
    es:'La imagen de {name} aún no está disponible',
    de:'Das Bild für {name} ist noch nicht verfügbar',
    ja:'{name} の画像はまだ利用できません'
  };
  for(const[locale,label]of Object.entries(expected)){
    const source=fs.readFileSync(path.join(root,`js/i18n/locales/${locale}.js`),'utf8');
    assert.ok(source.includes(`'sprite.artUnavailable':'${label}'`),locale);
  }
});
