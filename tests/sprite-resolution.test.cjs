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

test('sprite provenance registry is unique, explicit, and free of stale hosts',()=>{
  const ids=sprites.SPRITE_SOURCE_REGISTRY.map(source=>source.id);
  assert.equal(new Set(ids).size,ids.length);
  for(const source of sprites.SPRITE_SOURCE_REGISTRY){assert.match(source.homepage,/^https:\/\//);assert.ok(source.role);assert.ok(source.hosts.length);}
  assert.match(sw,/'cdn08\.net'/);assert.doesNotMatch(sw,/cdn08\.pokemongohub\.net|static\.pokemongohub\.net/);
});

test('catalog-first verified Pikachu mappings remain distinct and exact',()=>{
  const expected={
    PIKACHU_COSTUME_2020:'025-flying.png',PIKACHU_FLYING_5TH_ANNIV:'025-flying5th.png',PIKACHU_FLYING_OKINAWA:'025-okinawaballoons.png',
    PIKACHU_FLYING_01:'025-flyinggreen.png',PIKACHU_FLYING_02:'025-flyingpurple.png',PIKACHU_FLYING_03:'img15561_5.png',PIKACHU_FLYING_04:'025-indballoon.png',
    PIKACHU_WCS_2025:'025-worlds25.png',PIKACHU_ANNIVERSARY_2026:'025-willow.png'
  };
  const urls=[];
  for(const [id,suffix] of Object.entries(expected)){
    const mapping=sprites.canonicalSpriteOverride(`pokemon:25:costume:${id}`);
    assert.ok(mapping);assert.ok(mapping.url.endsWith(suffix));urls.push(mapping.url);
  }
  assert.equal(new Set(urls.slice(0,7)).size,7);
  assert.notEqual(sprites.canonicalSpriteOverride('pokemon:25:costume:PIKACHU_WCS_2025').url,sprites.canonicalSpriteOverride('pokemon:25:costume:PIKACHU_ANNIVERSARY_2026').url);
});

test('Detective identities have independent canonical records without false art claims',()=>{
  const first=sprites.canonicalSpriteOverride('pokemon:25:standard:legacy:Pikachu%20(Detective)');
  const second=sprites.canonicalSpriteOverride('pokemon:25:standard:legacy:Pikachu%20(Detective%202023)');
  assert.ok(first);assert.ok(second);assert.notEqual(first,second);assert.equal(first.url,second.url);
});

test('unresolved costumes are marked and excluded from guessed costume aliases',()=>{
  for(const name of sprites.UNRESOLVED_SPRITE_KEYS)assert.equal(sprites.isUnresolvedSpriteKey(name),true);
  const map=html.slice(html.indexOf('const GO_COSTUME_SPRITE_SLUGS='),html.indexOf('const EXTRA_COSTUME_ENTRIES='));
  for(const name of sprites.UNRESOLVED_SPRITE_KEYS)assert.doesNotMatch(map,new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
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
