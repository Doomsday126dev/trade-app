const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);
const sw=readFileSync(path.join(root,'sw.js'),'utf8');
const window={URL};
vm.runInNewContext(readFileSync(path.join(root,'js/domain/spriteSlugs.js'),'utf8'),{window,URL});
const sprites=window.PogoDomain.spriteSlugs;

function applicationFunction(name,nextName){
  const start=html.indexOf(`function ${name}`),end=html.indexOf(`function ${nextName}`,start);
  assert.notEqual(start,-1,`Missing ${name}`);assert.notEqual(end,-1,`Missing ${nextName}`);
  return html.slice(start,end);
}

test('runtime sprite registry contains only approved served sources',()=>{
  const ids=Array.from(sprites.SPRITE_SOURCE_REGISTRY,source=>source.id);
  assert.deepEqual(ids,['pokeapi','pokemondb-home','pokemondb-go','weserv']);
  assert.equal(new Set(ids).size,ids.length);
  for(const source of sprites.SPRITE_SOURCE_REGISTRY){assert.match(source.homepage,/^https:\/\//);assert.ok(source.role);assert.ok(source.hosts.length);}
  for(const host of ['raw.githubusercontent.com','images.weserv.nl','img.pokemondb.net'])assert.match(sw,new RegExp(`'${host.replaceAll('.','\\.')}'`));
  assert.doesNotMatch(sw,/cdn08|pokemongohub|serebii|PokeMiners/i);
});

test('anonymous public shares resolve approved form-aware sprites without private catalog data',()=>{
  assert.deepEqual(Array.from(sprites.publicSpriteUrls('Blipbug')),['https://img.pokemondb.net/sprites/home/normal/blipbug.png']);
  assert.deepEqual(Array.from(sprites.publicSpriteUrls('Garden')),['https://img.pokemondb.net/sprites/home/normal/vivillon-garden.png','https://img.pokemondb.net/sprites/home/normal/vivillon.png']);
  assert.deepEqual(Array.from(sprites.publicSpriteUrls('H-Avalugg')),['https://img.pokemondb.net/sprites/home/normal/avalugg-hisuian.png','https://img.pokemondb.net/sprites/home/normal/avalugg.png']);
  assert.deepEqual(Array.from(sprites.publicSpriteUrls('Salandit','f')),['https://img.pokemondb.net/sprites/home/normal/salandit-female.png','https://img.pokemondb.net/sprites/home/normal/salandit.png']);
  assert.equal(sprites.publicSpriteUrls('Garden').every(url=>sprites.spriteSourceForUrl(url)?.id==='pokemondb-home'),true);
});

test('runtime URL validation is path constrained and rejects removed research hosts',()=>{
  const source=applicationFunction('isApprovedRuntimeSpriteUrl','canvasSafeSpriteUrl');
  const approved=vm.runInNewContext(`(()=>{${source};return isApprovedRuntimeSpriteUrl;})()`,{
    URL,document:{baseURI:'https://doomsday126dev.github.io/trade-app/'},location:{origin:'https://doomsday126dev.github.io'}
  });
  for(const value of [
    'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png',
    'https://img.pokemondb.net/sprites/home/normal/pikachu.png',
    'https://images.weserv.nl/?url=img.pokemondb.net%2Fsprites%2Fhome%2Fnormal%2Fpikachu.png',
    'assets/max-cloud.svg',
    'https://doomsday126dev.github.io/trade-app/assets/max-cloud.svg'
  ])assert.equal(approved(value),true,value);
  for(const value of [
    'https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Images/pikachu.png',
    'https://raw.githubusercontent.com/another/repository/main/pikachu.png',
    'https://www.serebii.net/pokemongo/pokemon/025.png',
    'https://cdn08.net/pikachu.png',
    'https://images.weserv.nl/?url=example.com%2Fsprites%2Fpikachu.png',
    'https://doomsday126dev.github.io/trade-app/assets/other.svg',
    ''
  ])assert.equal(approved(value),false,value);
});

test('stored or guessed research URLs cannot enter the render or export chain',()=>{
  assert.equal(Object.keys(sprites.CANONICAL_SPRITE_OVERRIDES).length,0);
  assert.equal(sprites.canonicalSpriteOverride('pokemon:25:costume:PIKACHU_WCS_2025'),null);
  const entry=applicationFunction('entrySpriteUrl','spriteUrl');
  assert.match(entry,/if\(isApprovedRuntimeSpriteUrl\(storedUrl\)\)return storedUrl/);
  assert.match(html,/const approvedOverride=isApprovedRuntimeSpriteUrl\(e\.spriteUrl\)\?e\.spriteUrl:''/);
  assert.doesNotMatch(html,/const GO_COSTUME_SPRITE_SLUGS|POKEMINERS_SPRITE_BASE|SEREBII_SPRITE_BASE|cdn08\.net/);
});

test('unresolved costumes are marked and excluded from guessed costume aliases',()=>{
  for(const name of sprites.UNRESOLVED_SPRITE_KEYS)assert.equal(sprites.isUnresolvedSpriteKey(name),true);
  const resolver=html.slice(html.indexOf('function spriteUrl'),html.indexOf('function spriteFallbackChain'));
  assert.match(resolver,/if\(context\.unresolved\)/);
  assert.match(resolver,/const plainName=String\(lookupName/);
  assert.doesNotMatch(resolver,/pokemondbGoCostumeUrl\(key,[\s\S]*allowPattern:true/);
});

test('successful 1x1 placeholders enter the same bounded fallback path as errors',()=>{
  assert.match(html,/function validateSpriteLoad\(img\)[\s\S]*naturalWidth\|\|0\)<=1[\s\S]*trySpriteFallback\(img\)/);
  assert.match(html,/data-fallbacks="\$\{fallbacks\}" onload="validateSpriteLoad\(this\)" onerror="trySpriteFallback\(this\)"/);
  assert.match(html,/const fbs=\(img\.dataset\.fallbacks\|\|''\)\.split\('\|'\)\.filter\(Boolean\)/);
  assert.match(html,/if\(!fbs\.length\)\{img\.style\.display='none';return;\}/);
  assert.doesNotMatch(sw,/1×1 transparent|iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB/);
});

test('shared slots and centralized optical metadata preserve source quality',()=>{
  for(const value of ['--sprite-slot-compact:24px','--sprite-slot-autocomplete:28px','--sprite-slot-list:34px','--sprite-slot-card:40px','--sprite-slot-avatar:48px'])assert.match(html,new RegExp(value));
  for(const mapping of Object.values(sprites.CANONICAL_SPRITE_OVERRIDES)){assert.equal(typeof mapping.opticalScale,'number');assert.equal(typeof mapping.opticalOffsetX,'number');assert.equal(typeof mapping.opticalOffsetY,'number');}
  const resolver=html.slice(html.indexOf('function spriteUrl'),html.indexOf('// ── SESSION PERSISTENCE'));
  assert.doesNotMatch(resolver,/quality=|width=\d+&height=\d+/i);
});
