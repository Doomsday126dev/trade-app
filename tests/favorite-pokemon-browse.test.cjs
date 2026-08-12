const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function load(){
  const window={};
  const context=vm.createContext({window,Intl});
  for(const file of ['js/domain/priorityValues.js','js/domain/favoritePokemonBrowse.js']){
    vm.runInContext(readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  }
  return window.PogoDomain.favoritePokemonBrowse;
}
const browse=load();
const plain=value=>JSON.parse(JSON.stringify(value));

test('all wanted-list categories are indexed with canonical variants kept distinct',()=>{
  const entries=browse.projectSnapshot({lists:{
    wishlist:{Palkia:'L','Palkia (Origin)':'H'},
    dynamax:{Palkia:'M'},gmax:{Palkia:'H'},costumes:{'Pikachu (Libre)':'M'}
  }});
  const palkia=entries.find(item=>item.pokemonName==='Palkia');
  assert.equal(palkia.priority,'H');
  assert.deepEqual(plain(palkia.categories),['wishlist','dynamax','gmax']);
  assert.ok(entries.some(item=>item.pokemonName==='Palkia (Origin)'));
  assert.ok(entries.some(item=>item.pokemonName==='Pikachu (Libre)'));
});

test('one trainer is returned once with the highest applicable priority and category context',()=>{
  const records=new Map([
    ['alpha',{trainerKey:'alpha',displayName:'TrainerAlpha',status:'published',entries:browse.projectSnapshot({lists:{wishlist:{Palkia:'L'},dynamax:{Palkia:'H'},gmax:{},costumes:{}}})}],
    ['beta',{trainerKey:'beta',displayName:'TrainerBeta',status:'published',entries:browse.projectSnapshot({lists:{wishlist:{Palkia:'M'},dynamax:{},gmax:{},costumes:{}}})}]
  ]);
  const index=browse.buildIndex(records);
  const results=browse.resultsForPokemon(index,'Palkia',{
    favorites:[{key:'alpha',displayName:'TrainerAlpha',tagIds:['raid']},{key:'beta',displayName:'TrainerBeta',tagIds:[]}],
    tags:{raid:{label:'Raid group'}},recent:[],locale:'en'
  });
  assert.equal(results.length,2);
  assert.deepEqual(plain(results.map(item=>[item.displayName,item.priority,item.categories,item.tags])),[
    ['TrainerAlpha','H',['wishlist','dynamax'],['Raid group']],['TrainerBeta','M',['wishlist'],[]]
  ]);
});

test('only current Favorites can enter results and tag changes require no index rebuild',()=>{
  const index=browse.buildIndex(new Map([['alpha',{trainerKey:'alpha',displayName:'Alpha',status:'published',entries:[{pokemonKey:'pikachu',priority:'H',categories:['wishlist']}]}],['hidden',{trainerKey:'hidden',displayName:'Hidden',status:'published',entries:[{pokemonKey:'pikachu',priority:'H',categories:['wishlist']}]}]]));
  const first=browse.resultsForPokemon(index,'Pikachu',{favorites:[{key:'alpha',displayName:'Alpha',tagIds:['a']}],tags:{a:{label:'NYC'}},recent:[]});
  const second=browse.resultsForPokemon(index,'Pikachu',{favorites:[{key:'alpha',displayName:'Alpha',tagIds:['b']}],tags:{b:{label:'Trade soon'}},recent:[]});
  assert.deepEqual(plain(first.map(item=>item.displayName)),['Alpha']);
  assert.deepEqual(plain(first[0].tags),['NYC']);
  assert.deepEqual(plain(second[0].tags),['Trade soon']);
});

test('results sort by priority, recent view, then locale-aware trainer name',()=>{
  const entries=name=>({trainerKey:name.toLowerCase(),displayName:name,status:'published',entries:[{pokemonKey:'eevee',priority:name==='Low'?'L':'H',categories:['wishlist']}]});
  const index=browse.buildIndex(new Map(['Alpha','Beta','Low'].map(name=>[name,entries(name)])));
  const favorites=['Alpha','Beta','Low'].map(displayName=>({displayName,key:displayName.toLowerCase(),tagIds:[]}));
  const results=browse.resultsForPokemon(index,'Eevee',{favorites,recent:[{displayName:'Beta',openedAt:20},{displayName:'Alpha',openedAt:10}],locale:'en'});
  assert.deepEqual(plain(results.map(item=>item.displayName)),['Beta','Alpha','Low']);
});

test('unpublished and malformed records never enter the Pokémon index',()=>{
  const index=browse.buildIndex(new Map([
    ['missing',{trainerKey:'missing',displayName:'Missing',status:'not_published',entries:[{pokemonKey:'mew',priority:'H',categories:['wishlist']}]}],
    ['bad',{trainerKey:'bad',displayName:'Bad',status:'projection_unsupported',entries:[{pokemonKey:'mew',priority:'H',categories:['wishlist']}]}]
  ]));
  assert.equal(index.size,0);
});
