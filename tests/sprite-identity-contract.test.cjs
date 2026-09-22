const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const application=fs.readFileSync(path.join(root,'js/app/application.js'),'utf8');
const oracle=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/sprite-identity-oracle.json'),'utf8'));
const window={URL};
vm.runInNewContext(fs.readFileSync(path.join(root,'js/domain/spriteSlugs.js'),'utf8'),{window,URL,Object,Map,Set});
const sprites=window.PogoDomain.spriteSlugs;

function mappingObject(){
  const match=application.match(/const COSTUME_FORM_SPRITE_IDS=(\{[\s\S]*?\n\});\nconst EXTRA_COSTUME_ENTRIES=/);
  assert.ok(match,'numeric mapping table remains independently inspectable');
  return vm.runInNewContext(`(${match[1]})`);
}

test('pinned semantic oracle validates correct unique IDs and declared equivalent aliases',()=>{
  const actual=mappingObject();
  for(const[name,id]of Object.entries(oracle.numericMappings))assert.equal(actual[name],id,name);
  const relevant=Object.entries(oracle.numericMappings);
  const byId=new Map();
  for(const[name,id]of relevant){if(!byId.has(id))byId.set(id,[]);byId.get(id).push(name);}
  assert.deepEqual([...byId.values()].filter(names=>names.length>1),[],'unrelated identities must not collide');
  assert.equal(actual['P-Tauros (Blaze)'],actual['P-Tauros (Fire)'],'declared Blaze/Fire aliases remain equivalent');
});

test('public Pumpkaboo hyphen forms use pinned exact HOME identities',()=>{
  for(const[name,id]of Object.entries(oracle.publicForms)){
    assert.equal(sprites.PUBLIC_EXACT_FORM_IDS[sprites.normalizeSpriteKey(name)],id,name);
    assert.equal(sprites.publicSpriteUrls(name,'',710)[0],`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${id}.png`,name);
    assert.equal(sprites.publicSpriteUrls(name,'',710).some(url=>url.endsWith('/710.png')),false,name);
  }
});

test('semantic fallback never downgrades explicit forms or relevant gender',()=>{
  const explicit=sprites.publicSpriteUrls('Urshifu (Gigantamax)','',892);
  assert.ok(explicit.length>0);assert.equal(explicit.some(url=>/\/(?:892|urshifu)\.png$/.test(url)),false);
  const female=sprites.publicSpriteUrls('Venusaur','f',3);
  assert.ok(female.length>0);assert.equal(female.some(url=>url.endsWith('/other/home/3.png')||url.endsWith('/venusaur.png')),false);
  const ordinary=sprites.publicSpriteUrls('Venusaur','',3);
  assert.ok(ordinary.some(url=>url.endsWith('/3.png')));
});

test('pinned gender semantics retain distinct art and permit reviewed same-art fallback',()=>{
  for(const entry of oracle.genderSemantics.visiblyDifferent){
    const identity=sprites.spriteSemanticIdentity(entry.name,'f',entry.no);
    assert.equal(identity.genderDistinct,true,entry.name);
    assert.equal(identity.genderEquivalent,false,entry.name);
    const urls=Array.from(sprites.publicSpriteUrls(entry.name,'f',entry.no));
    assert.ok(urls.length>0,entry.name);
    assert.equal(urls.some(url=>url.endsWith(`/other/home/${entry.no}.png`)||url.endsWith(`/${entry.name.toLowerCase()}.png`)),false,entry.name);
  }
  for(const entry of oracle.genderSemantics.sameArt){
    const identity=sprites.spriteSemanticIdentity(entry.name,'f',entry.no);
    assert.equal(identity.genderDistinct,false,entry.name);
    assert.equal(identity.genderEquivalent,true,entry.name);
    const urls=Array.from(sprites.publicSpriteUrls(entry.name,'f',entry.no));
    assert.ok(urls.some(url=>url.endsWith(`/other/home/${entry.no}.png`)),entry.name);
  }
});

test('Unown punctuation identities survive normalization and Slowbro label matches dex 80',()=>{
  const keys=oracle.distinctStoredNames.map(sprites.normalizeSpriteKey);
  assert.equal(new Set(keys).size,3);
  assert.match(application,/\{"no":80,"name":"Slowbro 2021","displayName":"Slowbro 2021"/);
  assert.doesNotMatch(application,/\{"no":80,"name":"Slowpoke 2021"/);
});

test('legacy Slowpoke label resolves to the corrected Slowbro identity and reviewed art',()=>{
  const productWindow={};
  const context=vm.createContext({window:productWindow,Object,Map,Set,URL});
  for(const file of ['js/domain/pokemonKeys.js','js/domain/costumeSpriteCatalog.js']){
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  }
  const catalog=productWindow.PogoDomain.pokemonCatalog;
  const oldKey=catalog.resolveLegacyKey('Slowpoke 2021');
  const corrected=catalog.resolveLegacyKey('Slowbro 2021');
  assert.equal(oldKey.catalogId,'pokemon:80:standard:legacy:Slowpoke%202021');
  assert.equal(corrected.catalogId,oldKey.catalogId);
  assert.equal(corrected.canonicalKey,'Slowbro 2021');
  assert.deepEqual(
    Array.from(productWindow.PogoDomain.costumeSpriteCatalog.resolution({name:'Slowpoke 2021'}).urls),
    Array.from(productWindow.PogoDomain.costumeSpriteCatalog.resolution({name:'Slowbro 2021'}).urls)
  );
});

test('every renderer retains identity when art is unavailable or exhausted',()=>{
  assert.match(application,/placeholder\.className=`pc-sprite-placeholder load-failed/);
  assert.match(application,/const drawableBoard=\{lf:\[\.\.\.sourceBoard\.lf\],ft:\[\.\.\.sourceBoard\.ft\]\}/);
  assert.match(application,/if\(img\)drawImageContain\(ctx,img,sx,sy,gridSprSize,gridSprSize\);[\s\S]*else drawSpriteFallback\(ctx,e,sx,sy,gridSprSize\)/);
});
