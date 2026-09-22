const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');

const root=join(__dirname,'..');
const application=readFileSync(join(root,'js/app/application.js'),'utf8');
const start=application.indexOf('const REVIEWED_SPRITE_OVERRIDE_EQUIVALENTS='),end=application.indexOf('\nfunction validateSpriteLoad',start);
assert.ok(start>=0&&end>start);

function harness(){
  const POKE='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
  const exact='https://img.pokemondb.net/sprites/home/normal/avalugg-hisuian.png';
  const context=vm.createContext({
    SPRITE_BASE:POKE,
    spriteSlugsDomain:{
      spriteSemanticIdentity(name,gender){return{exactRequired:/H-Avalugg|Scatterbug \(/.test(name)||gender==='f'};},
      publicSpriteDisplayName:name=>name,publicSpriteBaseName:name=>String(name).replace(/^H-/,'').replace(/\s*\([^)]*\)$/,'')
    },
    normalizeSpriteKey:value=>String(value).toLowerCase(),
    publicSpriteUrls:(name)=>name==='H-Avalugg'?[exact]:[],
    isApprovedRuntimeSpriteUrl:url=>typeof url==='string'&&(url.startsWith(POKE)||url.startsWith('https://img.pokemondb.net/')),
    spriteCatalogContext:()=>({catalogId:'fixture',override:null,reviewed:{status:'available'}}),
    spriteFallbackChain:(_no,name)=>name==='H-Avalugg'?[exact]:[],
    i18nCore:{t:(_key,{name})=>`${name} art unavailable`},escAttr:value=>String(value||''),
    effectiveSpriteScale:()=>1,effectiveSpriteOrigin:()=>({cx:.5,cy:.5}),_spriteTransform:()=>({transform:'none',transformOrigin:'center'})
  });
  vm.runInContext(application.slice(start,end),context);
  return{context,POKE,exact};
}

test('exact Hisuian Avalugg rejects an allowed-host base override and failure cannot downgrade',()=>{
  const {context,POKE,exact}=harness();
  const markup=context.spriteImg(713,40,'','H-Avalugg','','Hisuian Avalugg',{urlOverride:`${POKE}713.png`});
  assert.match(markup,new RegExp(`src="${exact.replaceAll('.','\\.')}"`));
  assert.doesNotMatch(markup,/pokemon\/713\.png/);
  assert.match(markup,/data-fallbacks=""/,'forced exact-art failure has no base-species fallback');
});

test('Scatterbug patterns retain their explicitly reviewed shared base art',()=>{
  const {context,POKE}=harness();
  const shared=`${POKE}664.png`;
  const markup=context.spriteImg(664,40,'','Scatterbug (Garden)','','Scatterbug (Garden)',{urlOverride:shared});
  assert.match(markup,new RegExp(`src="${shared.replaceAll('.','\\.')}"`));
});
