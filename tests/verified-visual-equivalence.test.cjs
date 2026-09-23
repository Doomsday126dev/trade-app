const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const window={URL};
const context=vm.createContext({window,URL});
for(const file of ['js/domain/publicPokemonDex.js','js/domain/spriteSlugs.js'])
  vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
const sourceWindow={};
vm.runInNewContext(fs.readFileSync(path.join(root,'data.js'),'utf8'),{window:sourceWindow});
const sprites=window.PogoDomain.spriteSlugs;

test('only the eighteen reviewed Scatterbug identities share species 664 art',()=>{
  for(const pattern of sprites.SCATTERBUG_VISUAL_EQUIVALENTS)
    assert.equal(sprites.verifiedEquivalentSpriteUrl(`Scatterbug (${pattern})`,664),'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/664.png');
  assert.equal(sprites.verifiedEquivalentSpriteUrl('Scatterbug (Invented)',664),'');
  assert.equal(sprites.verifiedEquivalentSpriteUrl('Vivillon (Garden)',666),'');
  assert.equal(sprites.verifiedEquivalentSpriteUrl('Scatterbug (Garden)',666),'');
});

test('finite Dynamax equivalence preserves every underlying visible form',()=>{
  assert.equal(window.POGO_TRADE_DB,undefined,'anonymous public shell must not need data.js');
  const max=sourceWindow.POGO_TRADE_DB.dynamax;
  assert.equal(max.length,125);
  assert.equal(window.PogoDomain.publicPokemonDex.dynamaxSize,125);
  for(const entry of max){
    const name=`${entry.name} (Dynamax)`;
    assert.equal(sprites.reviewedDynamaxBase(name,entry.no),entry.name,name);
    assert.ok(sprites.verifiedEquivalentSpriteUrl(name,entry.no),name);
    assert.equal(sprites.verifiedEquivalentSpriteUrl(name,entry.no+1),'',name);
  }
  for(const [name,form] of [
    ['Toxtricity (Amped) (Dynamax)','toxtricity-amped'],
    ['Toxtricity (Low Key) (Dynamax)','toxtricity-low-key'],
    ['Urshifu (Single Strike) (Dynamax)','urshifu-single-strike'],
    ['Urshifu (Rapid Strike) (Dynamax)','urshifu-rapid-strike']
  ])assert.equal(sprites.verifiedEquivalentSpriteUrl(name,name.startsWith('Toxtricity')?849:892),`https://img.pokemondb.net/sprites/home/normal/${form}.png`);
  assert.equal(sprites.verifiedEquivalentSpriteUrl('Charmander (Gigantamax)',4),'');
  assert.equal(sprites.verifiedEquivalentSpriteUrl('Invented (Dynamax)',4),'');
});

test('Rockruff Dusk shares appearance, but ambiguous Gigantamax Urshifu never substitutes art',()=>{
  assert.equal(sprites.verifiedEquivalentSpriteUrl('Rockruff (Dusk)',744),'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/744.png');
  assert.equal(sprites.verifiedEquivalentSpriteUrl('Rockruff (Dusk)',745),'');
  assert.equal(sprites.isAmbiguousVisibleForm('Urshifu (Gigantamax)',892),true);
  assert.deepEqual(Array.from(sprites.publicSpriteUrls('Urshifu (Gigantamax)','',892)),[]);
  assert.equal(sprites.isAmbiguousVisibleForm('Urshifu (Rapid Strike)',892),false);
});
