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
  assert.equal(catalog.entries.length,376);
  assert.equal(catalog.entries.filter(entry=>entry.status==='exact').length,355);
  assert.equal(catalog.entries.filter(entry=>entry.status==='unavailable').length,21);
  const assets=[...new Set(catalog.entries.flatMap(entry=>Object.values(entry.assets||{})))];
  assert.equal(assets.length,462);
  for(const asset of assets)assert.ok(frontend.assetFiles.includes(asset),asset);
  assert.equal(runtime,runtimeSource(catalog));
  assert.doesNotMatch(runtime,/img\.pokemondb\.net|pokeminers|serebii|cdn08/i);
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
  for(const name of ['Pikachu (Cosmog Spacesuit)','Pikachu (Worlds 2026)','Pikachu (Fossil)','Noibat Headband']){
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
  assert.deepEqual(statusCounts,{exact:402,unavailable:21});
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

test('the local reviewed asset graph remains lazy rather than joining shell precache',()=>{
  const worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const releaseAssets=worker.match(/const RELEASE_ASSETS=\[([\s\S]*?)\n\];/)?.[1]||'';
  assert.doesNotMatch(releaseAssets,/assets\/sprites\/go/);
  assert.match(worker,/url\.origin===self\.location\.origin&&\/\\\/assets\\\/sprites\\\/go/);
});
