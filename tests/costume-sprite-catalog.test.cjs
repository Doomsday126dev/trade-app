'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {validateCatalog,runtimeSource}=require('../scripts/sprites/costume-sprite-catalog-lib.cjs');

const root=path.resolve(__dirname,'..');
const catalog=validateCatalog(JSON.parse(fs.readFileSync(path.join(root,'data/costume-sprite-catalog.json'),'utf8')),root);
const runtime=fs.readFileSync(path.join(root,'js/domain/costumeSpriteCatalog.js'),'utf8');
const frontend=JSON.parse(fs.readFileSync(path.join(root,'scripts/pages/frontend-files.json'),'utf8'));
const window={};
vm.runInNewContext(runtime,{window,Object,Map});
const resolver=window.PogoDomain.costumeSpriteCatalog;

test('reviewed catalog has complete local integrity evidence',()=>{
  assert.equal(catalog.entries.length,392);
  assert.equal(require('../data/pending-costume-artwork.json').maintenanceCandidate.canonicalRecords,catalog.entries.length);
  assert.equal(catalog.entries.filter(entry=>entry.status==='exact').length,385);
  assert.equal(catalog.entries.filter(entry=>entry.status==='unavailable').length,7);
  const assets=[...new Set(catalog.entries.flatMap(entry=>Object.values(entry.assets||{})))];
  assert.equal(assets.length,821);
  for(const asset of assets)assert.ok(frontend.assetFiles.includes(asset),asset);
  assert.equal(runtime,runtimeSource(catalog));
  assert.doesNotMatch(runtime,/https?:\/\/(?:[^/]*\.)?(?:img\.pokemondb\.net|pokeminers|serebii\.net|cdn08)/i);
});

test('exact costumes resolve to distinct self-hosted art and gender variants',()=>{
  const worlds=resolver.resolution({name:'Pikachu (Worlds 2025)',gender:'f'});
  const dapper=resolver.resolution({name:'Pikachu (Dapper) Goggles - Blue',gender:'f'});
  const formal=resolver.resolution({name:'Pikachu (Dapper) Monocle - Blue',gender:'f'});
  assert.equal(worlds.status,'exact');
  assert.match(worlds.urls[0],/assets\/sprites\/go\/pikachu-world-champs-2025-f\.png$/);
  assert.match(dapper.urls[0],/pikachu-dapper-blue-f\.png$/);
  assert.match(formal.urls[0],/pikachu-formal-blue-f\.png$/);
  assert.notEqual(dapper.urls[0],formal.urls[0]);
  assert.doesNotMatch(worlds.urls.join(' '),/sprites\/home|sprites\/pokemon\/25\.png/);
});

test('known costumes without reviewed art fail honestly instead of becoming base species',()=>{
  for(const name of ['Pikachu (Gloria)','Pikachu (Victor)','Pikachu (Jeju)','Pumpkaboo (Spooky)']){
    const result=resolver.resolution({name});
    assert.equal(result.knownVariant,true,name);
    assert.equal(result.status,'unavailable',name);
    assert.deepEqual(Array.from(result.urls),[],name);
  }
  assert.equal(resolver.resolution({name:'Pikachu'}).knownVariant,false);
});

test('every selectable costume is reviewed before runtime fallback can reach base species',()=>{
  const productWindow={};
  const context=vm.createContext({window:productWindow,Object,Map});
  for(const file of ['data.js','js/domain/pokemonKeys.js','js/domain/costumeSpriteCatalog.js']){
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  }
  const application=fs.readFileSync(path.join(root,'js/app/application.js'),'utf8');
  const extraMatch=application.match(/const EXTRA_COSTUME_ENTRIES=(\[.*?\]);\n/s);
  assert.ok(extraMatch,'signed-in costume supplements must remain statically reviewable');
  const extras=JSON.parse(extraMatch[1]);
  const pokemonCatalog=productWindow.PogoDomain.pokemonCatalog;
  const reviewedCatalog=productWindow.PogoDomain.costumeSpriteCatalog;
  const reviewedIdentityRecords=new Map();
  for(const record of catalog.entries){
    const catalogIds=[...new Set(record.names.map(name=>pokemonCatalog.resolveLegacyKey(name)?.catalogId).filter(Boolean))];
    assert.ok(catalogIds.length<=1,`${record.names[0]} mixes canonical costume identities`);
    for(const catalogId of catalogIds){
      assert.equal(reviewedIdentityRecords.has(catalogId),false,`${catalogId} is split across reviewed catalog records`);
      reviewedIdentityRecords.set(catalogId,record);
    }
  }
  const selectable=pokemonCatalog.canonicalizeEntries([
    ...productWindow.POGO_TRADE_DB.costumes,
    ...extras,
    ...pokemonCatalog.verifiedMissingEntries
  ]);
  const statusCounts={exact:0,unavailable:0};
  for(const entry of selectable){
    const decorated=pokemonCatalog.decorateCatalogEntry(entry);
    const names=[decorated.name,...(decorated.spriteLookupKeys||[]),entry.name,entry.displayName].filter(Boolean);
    const result=reviewedCatalog.resolution({names});
    assert.equal(result.knownVariant,true,`${entry.name} could fall through to base-species art`);
    statusCounts[result.status]++;
  }
  assert.deepEqual(statusCounts,{exact:422,unavailable:7});
});

test('reviewed event aliases resolve to their exact visual identity',()=>{
  const expected=new Map([
    ['Pikachu (Fragment)','pikachu-thunderbolt-cap-f.png'],
    ['Raichu Fragment Cap','raichu-thunderbolt-cap-f.png'],
    ['Pikachu (Halloween 2022)','pikachu-halloween-mischief-f.png'],
    ['Pikachu (Halloween 2024)','pikachu-witch-f.png'],
    ['Pikachu (Holiday 2022)','pikachu-holiday-f.png'],
    ['Pikachu (Holiday 2024)','pikachu-holiday-f.png'],
    ['Gengar (Halloween 2024)','gengar-spooky-festival.png']
  ]);
  for(const[name,file]of expected){
    const result=resolver.resolution({name,gender:'f'});
    assert.equal(result.status,'exact',name);
    assert.match(result.urls[0],new RegExp(`${file.replaceAll('.','\\.')}$`),name);
  }
});

test('reviewed event aliases retain distinct canonical identity through serialization',()=>{
  const productWindow={};
  const context=vm.createContext({window:productWindow,Object,Map});
  for(const file of ['data.js','js/domain/pokemonKeys.js']){
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  }
  const pokemonCatalog=productWindow.PogoDomain.pokemonCatalog;
  const expected=[
    ['Pikachu (Fragment)',25,'pokemon:25:standard:legacy:Pikachu%20(Fragment)'],
    ['Raichu Fragment Cap',26,'pokemon:26:standard:legacy:Raichu%20Fragment%20Cap'],
    ['Pikachu (Halloween 2022)',25,'pokemon:25:standard:legacy:Pikachu%20(Halloween%202022)'],
    ['Pikachu (Halloween 2024)',25,'pokemon:25:standard:legacy:Pikachu%20(Halloween%202024)'],
    ['Pikachu (Holiday 2022)',25,'pokemon:25:standard:legacy:Pikachu%20(Holiday%202022)'],
    ['Pikachu (Holiday 2024)',25,'pokemon:25:standard:legacy:Pikachu%20(Holiday%202024)'],
    ['Gengar (Halloween 2024)',94,'pokemon:94:standard:legacy:Gengar%20(Halloween%202024)']
  ];
  const stored=expected.map(([name,no])=>({name,no,p:'H',mod:name}));
  const firstPass=pokemonCatalog.canonicalizeEntries(stored);
  const restored=JSON.parse(JSON.stringify(firstPass));
  const secondPass=pokemonCatalog.canonicalizeEntries(restored);

  assert.equal(firstPass.length,7);
  assert.equal(secondPass.length,7);
  assert.equal(new Set(secondPass.map(entry=>entry.catalogId)).size,7);
  assert.deepEqual(
    JSON.parse(JSON.stringify(secondPass.map(entry=>[entry.name,entry.no,entry.catalogId,entry.mod]))),
    expected.map(([name,no,catalogId])=>[name,no,catalogId,name])
  );

  const holiday2022=secondPass.find(entry=>entry.name==='Pikachu (Holiday 2022)');
  const holiday2024=secondPass.find(entry=>entry.name==='Pikachu (Holiday 2024)');
  assert.notEqual(holiday2022.catalogId,holiday2024.catalogId);
  assert.deepEqual(
    Array.from(resolver.resolution({name:holiday2022.name}).urls),
    Array.from(resolver.resolution({name:holiday2024.name}).urls)
  );

  const halloweenPikachu=resolver.resolution({name:'Pikachu (Halloween 2024)'}).urls[0];
  const halloweenGengar=resolver.resolution({name:'Gengar (Halloween 2024)'}).urls[0];
  assert.notEqual(halloweenPikachu,halloweenGengar);
  assert.doesNotMatch(`${halloweenPikachu} ${halloweenGengar}`,/sprites\/pokemon\/(?:25|94)\.png/);
});

test('the local reviewed asset graph remains lazy rather than joining shell precache',()=>{
  const worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const releaseAssets=worker.match(/const RELEASE_ASSETS=\[([\s\S]*?)\n\];/)?.[1]||'';
  assert.doesNotMatch(releaseAssets,/assets\/sprites\/go/);
  assert.match(worker,/url\.origin===self\.location\.origin&&\/\\\/assets\\\/sprites\\\/go/);
});

test('search eligibility marks only audited released Pikachu identities without promoting their art',()=>{
  const pending=JSON.parse(fs.readFileSync(path.join(root,'data/pending-costume-artwork.json'),'utf8'));
  const expected=pending.entries.filter(e=>e.species.dex===25&&e.identityStatus==='released').map(e=>e.displayIdentity).sort();
  const eligible=catalog.entries.filter(e=>e.no===25&&e.identityStatus==='released');
  assert.deepEqual(eligible.filter(e=>e.status==='unavailable').map(e=>e.names[0]).sort(),expected);
  assert.equal(eligible.length,12);
  for(const entry of eligible.filter(e=>e.status==='unavailable')){assert.equal(entry.status,'unavailable');assert.deepEqual(Array.from(resolver.resolution({name:entry.names[0]}).urls),[]);}
  assert.equal(catalog.entries.find(e=>e.names.includes('Pikachu (Gloria)')).identityStatus,undefined);
  assert.equal(catalog.entries.find(e=>e.names.includes('Pikachu (GO Fest 2023)')).identityStatus,undefined);
});

test('explicit reviewed female art has no default-gender fallback',()=>{
  assert.deepEqual(Array.from(resolver.resolution({name:'Pikachu (Detective)',gender:'f'}).urls),['assets/sprites/go/pikachu-detective-f.png']);
});

test('Pokemod source is pinned and every exact Shiny/gender variant is mandatory',()=>{
 const rows=catalog.entries.filter(r=>r.sourceProvider==='pokemod-reviewed');assert.equal(rows.length,5);
 for(const row of rows){for(const gender of ['m','f'])for(const shiny of [false,true]){const key=shiny?(gender==='f'?'femaleShiny':'shiny'):(gender==='f'?'female':'default');assert.deepEqual(Array.from(resolver.resolution({name:row.names[0],gender,shiny}).urls),[row.assets[key]]);}
 for(const mutate of [r=>r.sourceCommit='0'.repeat(40),r=>r.sourceFiles.default='pm25.fWRONG.icon.png',r=>delete r.assets.femaleShiny,r=>r.sourceUrl='https://example.com/base.png']){const changed=structuredClone(catalog);mutate(changed.entries.find(e=>e.names[0]===row.names[0]));assert.throws(()=>validateCatalog(changed,root),/Pokemod/);}}
 assert.match(resolver.resolution({name:'Pikachu (Astronaut)',shiny:true}).urls[0],/astronaut-shiny/);
 assert.deepEqual(Array.from(resolver.resolution({name:'Pikachu (Detective)',shiny:true}).urls),[]);
});

test('five remaining Dittobase identities retain exact pixels and gender boundaries',()=>{
 const rows=catalog.entries.filter(r=>r.sourceProvider==='dittobase-reviewed');assert.equal(rows.length,5);const urls=[];for(const row of rows){assert.match(row.reviewIdentityId,/^(announcement:|pokemon:)/);for(const gender of ['m','f'])for(const shiny of [false,true]){const r=resolver.resolution({name:row.names[0],gender,shiny}),key=shiny?(gender==='f'?'femaleShiny':'shiny'):(gender==='f'?'female':'default');assert.deepEqual(Array.from(r.urls),row.assets[key]?[row.assets[key]]:[]);urls.push(...r.urls);}}
 assert.equal(new Set(urls).size,16);assert.equal(rows.filter(r=>r.femaleArtworkUnavailable).length,0);
 for(const mutate of [r=>r.sourceUrl='https://example.com/wrong.png',r=>r.sourceFiles.default='25-pikachu.png',r=>r.assets.default=rows[1].assets.default,r=>r.femaleArtworkUnavailable=!r.femaleArtworkUnavailable]){const changed=structuredClone(catalog);mutate(changed.entries.find(r=>r.sourceProvider==='dittobase-reviewed'));assert.throws(()=>validateCatalog(changed,root),/Dittobase|digest/);}
});
