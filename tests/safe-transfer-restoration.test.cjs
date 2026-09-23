const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
function load(){
  const window={};window.window=window;
  const context=vm.createContext({window,URL,Set,Map,Object,Array,String,Number,JSON,Promise});
  for(const file of ['js/domain/pokemonGoSearchSyntax.js','js/domain/safeTransferRestoration.js','js/domain/publicSharePublication.js'])vm.runInContext(readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  return window.PogoDomain;
}
const domain=load(),safe=domain.safeTransferRestoration,syntax=domain.pokemonGoSearchSyntax;
const catalog=safe.createCatalog([
  {no:1,name:'Bulbasaur',catalogId:'pokemon:1:standard'},
  {no:4,name:'Charmander',catalogId:'pokemon:4:standard'},
  {no:7,name:'Squirtle',catalogId:'pokemon:7:standard'},
  {no:7,name:'Squirtle (Sunglasses)',catalogId:'pokemon:7:costume:sunglasses',legacyAliases:['Squirtle Sunglasses']},
  {no:10,name:'Caterpie',catalogId:'pokemon:10:standard'},
  {no:25,name:'Pikachu',catalogId:'pokemon:25:standard'},
  {no:122,name:'Mr_ Mime',displayName:'Mr. Mime',catalogId:'pokemon:122:standard',legacyAliases:['Mr_ Mime']},
  {no:131,name:'Lapras',catalogId:'pokemon:131:gmax'},
  {no:133,name:'Eevee',catalogId:'pokemon:133:standard'},
  {no:150,name:'Mewtwo',catalogId:'pokemon:150:standard'},
  {no:19,name:'Rattata',catalogId:'pokemon:19:standard'},
  {no:19,name:'A-Rattata',catalogId:'pokemon:19:alola'}
]);
const selection=Object.freeze([{id:'trainer-a',label:'Trainer A'}]);

function source(trainerId='trainer-a',declarations=[],overrides={}){
  return{
    trainerId,state:'complete',complete:true,freshness:'current',snapshotVersion:'public-share-v2',sourceVersion:`source-${trainerId}-1`,
    pagination:{complete:true,nextCursor:null},declarations,...overrides
  };
}
function snapshot(sources=[source()],overrides={}){
  return{
    contractVersion:1,
    account:{id:'account-a',version:'session-1'},
    scope:{id:'scope-a',version:'scope-1',displayedSelectionVersion:'scope-1',kind:'trainers',selected:selection},
    universe:{version:'catalog-119',policy:'reviewed-transfer-candidates',species:[1,4,7,10,25,122,131,133,150],excludedSpecies:[10]},
    sources,...overrides
  };
}
function evaluate(value){return safe.evaluate(value,{catalog});}
function plan(value,locale='en',characterBudget=1500){return safe.commandPlan(evaluate(value),{syntax,locale,characterBudget});}
function plain(value){return JSON.parse(JSON.stringify(value));}

test('five-want audit fixture protects every ordinary, canonical, Max, and costume species',()=>{
  const declarations=[
    {intent:'lf',category:'wishlist',name:'Pikachu',p:'H'},
    {intent:'lf',category:'wishlist',name:'Eevee',catalogId:'pokemon:133:standard',p:'M'},
    {intent:'lf',category:'dynamax',name:'Bulbasaur'},
    {intent:'lf',category:'gmax',name:'Lapras'},
    {intent:'lf',category:'costumes',name:'Squirtle (Sunglasses)'}
  ];
  const result=evaluate(snapshot([source('trainer-a',declarations)]));
  assert.equal(result.ok,true);
  assert.deepEqual(plain(result.protectedSpecies),[1,7,25,131,133]);
  assert.deepEqual(plain(result.candidateSpecies),[4,122,150]);
  assert.equal(result.resolvedDeclarations.length,5);
});

test('modern-only trainer, Mr. Mime display alias, forms, duplicates and independent special wants protect species conservatively',()=>{
  const selected=[{id:'modern',label:'Modern only'},{id:'alias',label:'Alias trainer'}];
  const value=snapshot([
    source('modern',[
      {intent:'lf',category:'special',name:'Rattata',lucky:true},
      {intent:'lf',category:'wishlist',name:'A-Rattata',shiny:true},
      {intent:'lf',category:'wishlist',name:'Pikachu',xxl:true},
      {intent:'lf',category:'wishlist',name:'Pikachu',xxs:true},
      {intent:'lf',category:'wishlist',name:'Pikachu',p:'H'}
    ]),
    source('alias',[{intent:'lf',category:'wishlist',name:'Mr. Mime'}])
  ],{scope:{id:'group-favorites',version:'membership-7',displayedSelectionVersion:'membership-7',kind:'group',selected}});
  const result=evaluate(value);
  assert.equal(result.ok,true);
  assert.deepEqual(plain(result.protectedSpecies),[19,25,122]);
  assert.deepEqual(plain(result.scope.selected),selected);
});

test('securely established species protects an unresolved form while an unresolved species fails closed',()=>{
  const established=evaluate(snapshot([source('trainer-a',[{intent:'lf',category:'costumes',name:'Uncatalogued Costume',speciesId:25,speciesEvidence:'canonical-catalog'}]) ]));
  assert.equal(established.ok,true);assert.deepEqual(plain(established.protectedSpecies),[25]);
  const unresolved=evaluate(snapshot([source('trainer-a',[{intent:'lf',category:'wishlist',name:'Unknownmon'}])]));
  assert.equal(unresolved.ok,false);assert.equal(unresolved.error.code,'unresolved_identity');assert.equal(unresolved.executable,false);
});

test('a complete available empty shared snapshot is qualified and is not treated as missing',()=>{
  const result=evaluate(snapshot([source('trainer-a',[])]));
  assert.equal(result.ok,true);assert.deepEqual(plain(result.protectedSpecies),[]);
  assert.deepEqual(plain(result.candidateSpecies),[1,4,7,25,122,131,133,150]);
  assert.equal(result.completeness[0].state,'complete');
});

test('current complete public-share v2 projections and reviewed catalog exclusions adapt without private reads',()=>{
  const projection={
    version:2,username:'Trainer A',profile:{friendCode:'',bio:'',discord:'',avatarPokemon:'',lastUpdated:0},
    publishedListTypes:['wishlist','dynamax','gmax','costumes'],lists:{wishlist:{},dynamax:{},gmax:{},costumes:{}},updatedAt:119,
    declarations:[
      {intent:'lf',category:'wishlist',name:'Pikachu',p:'H',mod:'',gender:'',backgroundId:'',note:'',lucky:false,shiny:false,xxl:false,xxs:false},
      {intent:'lf',category:'dynamax',name:'Bulbasaur',p:'',mod:'',gender:'',backgroundId:'',note:'',lucky:true,shiny:false,xxl:false,xxs:false}
    ],declarationCount:2
  };
  const adapted=safe.sourceFromRepositoryResult({trainerId:'trainer-a',label:'Trainer A',result:{ok:true,value:projection},read:{kind:'exact-public-share',scope:'whole-projection',completed:true,operationId:'read-1'}},{
    validateProjection:domain.publicSharePublication.publicShareProjectionStatus,
    intentEntries:domain.publicSharePublication.intentEntries
  });
  assert.equal(adapted.state,'complete');assert.equal(adapted.declarations.length,2);assert.match(adapted.sourceVersion,/^public-share:/);
  const universe=safe.createReviewedUniverse({version:'release-119',reviewedEntries:[{no:1},{no:4},{no:25},{no:151}],candidateEntries:[{no:1},{no:4},{no:25}]});
  assert.deepEqual(plain(universe),{version:'release-119',species:[1,4,25,151],excludedSpecies:[151],policy:'existing-tradeable-wishlist-catalog-exclusions'});
});

test('repository evidence, not caller defaults, establishes current complete source state',()=>{
  const dependencies={validateProjection:domain.publicSharePublication.publicShareProjectionStatus,intentEntries:domain.publicSharePublication.intentEntries};
  const projection={version:2,username:'Trainer A',profile:{},publishedListTypes:['wishlist','dynamax','gmax','costumes'],lists:{wishlist:{},dynamax:{},gmax:{},costumes:{}},updatedAt:1,declarations:[],declarationCount:0};
  const unproven=safe.sourceFromRepositoryResult({trainerId:'trainer-a',label:'Trainer A',result:{ok:true,value:projection}},dependencies);
  assert.equal(unproven.state,'stale');assert.equal(unproven.complete,false);assert.equal(unproven.freshness,'unverified');
  const evidence={kind:'exact-public-share',scope:'whole-projection',completed:true,operationId:'read-2'};
  const cases=[
    [{ok:true,value:null},'missing'],
    [{ok:false,error:{code:'permission-denied'}},'inaccessible'],
    [{ok:false,error:{code:'deadline-exceeded'}},'timeout'],
    [{ok:false,error:{code:'cache-obsolete'}},'stale'],
    [{ok:true,value:{version:2,username:'Trainer A',profile:{},publishedListTypes:['wishlist','dynamax','gmax','costumes'],lists:{wishlist:{},dynamax:{},gmax:{},costumes:{}},declarations:[],declarationCount:1}},'partial'],
    [{ok:true,value:{version:99,username:'Trainer A'}},'malformed']
  ];
  for(const [result,state] of cases)assert.equal(safe.sourceFromRepositoryResult({trainerId:'trainer-a',label:'Trainer A',result,read:evidence},dependencies).state,state);
});

test('missing, inaccessible, stale, partial, error and timeout inputs are non-executable',()=>{
  for(const state of ['missing','inaccessible','stale','partial','error','timeout']){
    const result=evaluate(snapshot([source('trainer-a',[],{state,complete:false})]));
    assert.equal(result.ok,false,state);assert.equal(result.error.code,`${state}_source`,state);assert.equal(result.commands.length,0,state);
  }
});

test('incomplete pagination, selection/source mismatch and displayed selection drift fail closed',()=>{
  let result=evaluate(snapshot([source('trainer-a',[],{pagination:{complete:false,nextCursor:'page-2'}})]));
  assert.equal(result.error.code,'incomplete_pagination');
  result=evaluate(snapshot([source('someone-else',[])]));assert.equal(result.error.code,'source_scope_mismatch');
  result=evaluate(snapshot([source()],{scope:{id:'scope-a',version:'scope-2',displayedSelectionVersion:'scope-1',kind:'trainers',selected:selection}}));
  assert.equal(result.error.code,'displayed_scope_mismatch');
});

test('complete EN/JA/ES/DE commands are literal, independent serializer outputs',()=>{
  const value=snapshot([source('trainer-a',[
    {intent:'lf',category:'dynamax',name:'Bulbasaur'},
    {intent:'lf',category:'costumes',name:'Squirtle (Sunglasses)'},
    {intent:'lf',category:'wishlist',name:'Pikachu'},
    {intent:'lf',category:'gmax',name:'Lapras'},
    {intent:'lf',category:'wishlist',name:'Eevee'}
  ])]);
  const expected={
    en:'!favorite&!4*&!shiny&!shadow&!purified&!background&!traded&!legendary&!mythical&CP-2500&4,122,150',
    ja:'!お気に入り&!4*&!色違い&!しゃどう&!らいと&!はいけい&!こうかん&!伝説のポケモン&!まぼろし&cp-2500&4,122,150',
    es:'!favorito&!4*&!variocolor&!oscuro&!purificado&!fondo&!intercambiados&!legendario&!singular&PC-2500&4,122,150',
    de:'!Favorit&!4*&!Schillernd&!Crypto&!Erlöst&!hintergrund&!getauscht&!Legendär&!Mysteriös&WP-2500&4,122,150'
  };
  for(const [locale,command] of Object.entries(expected)){
    const result=plan(value,locale);assert.equal(result.commands.length,1,locale);assert.equal(result.commands[0].value,command,locale);
  }
});

test('empty candidates produce no protection-only command',()=>{
  const declarations=[1,4,7,25,122,131,133,150].map(no=>({intent:'lf',category:'wishlist',speciesId:no,speciesEvidence:'source-species-id'}));
  const result=plan(snapshot([source('trainer-a',declarations)]));
  assert.equal(result.status,'empty_candidates');assert.equal(result.executable,false);assert.deepEqual(plain(result.commands),[]);
});

test('split commands retain the complete protection prefix and represent exactly the candidates',()=>{
  const universe=Array.from({length:35},(_,index)=>index+1);
  const value=snapshot([source('trainer-a',[])],{universe:{version:'split-v1',policy:'fixture',species:universe,excludedSpecies:[]}});
  const result=plan(value,'en',120);
  assert.equal(result.ok,true);assert.ok(result.commands.length>1);
  const prefix='!favorite&!4*&!shiny&!shadow&!purified&!background&!traded&!legendary&!mythical&CP-2500&';
  assert.ok(result.commands.every(part=>part.value.startsWith(prefix)&&part.value.length<=120));
  assert.deepEqual(plain(result.commands.flatMap(part=>part.species)),universe);
});

test('set invariants hold for added wants, aliases, delivery order and duplicates',()=>{
  const base=[{intent:'lf',category:'wishlist',name:'Pikachu'}];
  const baseCandidates=new Set(plain(evaluate(snapshot([source('trainer-a',base)])).candidateSpecies));
  const added=evaluate(snapshot([source('trainer-a',[...base,{intent:'lf',category:'wishlist',name:'Eevee'}])])).candidateSpecies;
  assert.ok(plain(added).every(id=>baseCandidates.has(id)),'adding a want cannot expand candidates');
  const aliasA=evaluate(snapshot([source('trainer-a',[{intent:'lf',category:'wishlist',name:'Mr. Mime'}])])).candidateSpecies;
  const aliasB=evaluate(snapshot([source('trainer-a',[{intent:'lf',category:'wishlist',name:'Mr_ Mime'}])])).candidateSpecies;
  assert.deepEqual(plain(aliasA),plain(aliasB));
  const ordered=evaluate(snapshot([source('trainer-a',[...base,{intent:'lf',category:'wishlist',name:'Eevee'}])])).candidateSpecies;
  const reversed=evaluate(snapshot([source('trainer-a',[{intent:'lf',category:'wishlist',name:'Eevee'},...base,...base])])).candidateSpecies;
  assert.deepEqual(plain(ordered),plain(reversed));
  const multiScope={id:'scope-order',version:'scope-order-1',displayedSelectionVersion:'scope-order-1',kind:'trainers',selected:[{id:'trainer-a',label:'A'},{id:'trainer-b',label:'B'}]};
  const sourceA=source('trainer-a',[{intent:'lf',category:'wishlist',name:'Pikachu'}]),sourceB=source('trainer-b',[{intent:'lf',category:'wishlist',name:'Eevee'}]);
  const forward=evaluate(snapshot([sourceA,sourceB],{scope:multiScope})),backward=evaluate(snapshot([sourceB,sourceA],{scope:multiScope}));
  assert.deepEqual(plain(forward.candidateSpecies),plain(backward.candidateSpecies));
  assert.equal(forward.bindingFingerprint,backward.bindingFingerprint);
});

function controllerFixture({loader,copy=async()=>{}}={}){
  const qualified=plan(snapshot([source('trainer-a',[{intent:'lf',category:'wishlist',name:'Pikachu'}])]));
  let live=plain(qualified.binding);
  const controller=safe.createController({
    loadSnapshot:loader||(async()=>snapshot([source('trainer-a',[{intent:'lf',category:'wishlist',name:'Pikachu'}])])),
    plan:value=>plan(value),currentBinding:()=>live,copy
  });
  return{controller,qualified,get live(){return live;},set live(value){live=value;}};
}

test('direct copy handler is inert before readiness and source changes invalidate before copy',async()=>{
  let copies=0;const fixture=controllerFixture({copy:async()=>{copies++;}});
  assert.deepEqual(plain(await fixture.controller.copyPart(0)),{ok:false,status:'not_ready'});assert.equal(copies,0);
  await fixture.controller.start({binding:plain(fixture.qualified.binding),selection});
  fixture.live={...plain(fixture.live),sourceVersions:{'trainer-a':'source-trainer-a-2'}};
  const copied=await fixture.controller.copyPart(0);
  assert.equal(copied.status,'stale');assert.equal(copies,0);assert.equal(fixture.controller.snapshot().phase,'invalidated');
});

test('account switch, group membership change and late responses cannot repopulate obsolete results',async()=>{
  let resolveFirst;const first=new Promise(resolve=>{resolveFirst=resolve;});let calls=0;
  const fixture=controllerFixture({loader:async()=>++calls===1?first:snapshot([source('trainer-a',[])])});
  const request={binding:plain(fixture.qualified.binding),selection};
  const old=fixture.controller.start(request);
  fixture.live={...plain(fixture.live),account:{id:'account-b',version:'session-2'}};
  resolveFirst(snapshot([source('trainer-a',[{intent:'lf',category:'wishlist',name:'Pikachu'}])]));
  await old;assert.equal(fixture.controller.snapshot().phase,'invalidated');
  fixture.live=plain(fixture.qualified.binding);
  const loading=fixture.controller.start(request);
  fixture.live={...plain(fixture.live),scope:{...plain(fixture.live.scope),version:'membership-8'}};
  await loading;assert.equal(fixture.controller.snapshot().phase,'invalidated');
});

test('clipboard failure preserves only the qualified current command for manual recovery and never reports copied',async()=>{
  const fixture=controllerFixture({copy:async()=>{throw Object.assign(new Error('both methods failed'),{code:'clipboard-unavailable'});}});
  await fixture.controller.start({binding:plain(fixture.qualified.binding),selection});
  const expected=fixture.controller.snapshot().plan.commands[0].value;
  const result=await fixture.controller.copyPart(0),state=fixture.controller.snapshot();
  assert.equal(result.status,'copy_failed');assert.equal(state.phase,'copy_failed');assert.equal(state.manualCommand,expected);assert.equal(state.error.code,'clipboard-unavailable');
});

test('displayed, computed and copied scope share one exact versioned binding',async()=>{
  let copied='';const fixture=controllerFixture({copy:async value=>{copied=value;}});
  await fixture.controller.start({binding:plain(fixture.qualified.binding),selection});
  const result=await fixture.controller.copyPart(0),state=fixture.controller.snapshot();
  assert.equal(state.plan.scope.version,state.plan.binding.scope.version);
  assert.deepEqual(plain(state.plan.scope.selected.map(item=>item.id)),plain(state.plan.binding.scope.selectedIds));
  assert.deepEqual(plain(result.binding),plain(state.plan.binding));assert.equal(copied,result.value);
});

test('game language participates in readiness and copy binding',async()=>{
  const fixture=controllerFixture();
  await fixture.controller.start({binding:plain(fixture.qualified.binding),selection});
  fixture.live={...plain(fixture.live),gameLocale:'ja'};
  const result=await fixture.controller.copyPart(0);
  assert.equal(result.status,'stale');assert.equal(fixture.controller.snapshot().phase,'invalidated');
});

test('deferred copy completion cannot restore an obsolete plan or manual command',async()=>{
  const scenarios=['account','selection','source','close','identical_generation'];
  for(const outcome of ['resolve','reject'])for(const scenario of scenarios){
    let settle;const deferred=new Promise((resolve,reject)=>{settle=outcome==='resolve'?resolve:reject;});
    const fixture=controllerFixture({copy:()=>deferred});
    const request={binding:plain(fixture.qualified.binding),selection};
    await fixture.controller.start(request);
    const pending=fixture.controller.copyPart(0);
    if(scenario==='account')fixture.live={...plain(fixture.live),account:{id:'account-b',version:'session-2'}};
    if(scenario==='selection'){fixture.live={...plain(fixture.live),scope:{...plain(fixture.live.scope),version:'scope-2'}};fixture.controller.invalidate('selection_changed');}
    if(scenario==='source'){fixture.live={...plain(fixture.live),sourceVersions:{'trainer-a':'source-trainer-a-2'}};fixture.controller.invalidate('source_refreshed');}
    if(scenario==='close')fixture.controller.invalidate('closed');
    if(scenario==='identical_generation')await fixture.controller.start(request);
    settle(outcome==='resolve'?undefined:Object.assign(new Error('clipboard failed'),{code:'clipboard-unavailable'}));
    const result=await pending,state=fixture.controller.snapshot();
    assert.equal(result.status,'stale',`${scenario}/${outcome}`);
    assert.notEqual(state.phase,'copied',`${scenario}/${outcome}`);
    assert.notEqual(state.phase,'copy_failed',`${scenario}/${outcome}`);
    assert.equal(state.manualCommand,'',`${scenario}/${outcome}`);
  }
});

test('production integration retains hard containment and candidate browser proof reuses shared copyText',()=>{
  const application=readFileSync(path.join(root,'js/app/application.js'),'utf8');
  assert.match(application,/const SAFE_TRANSFER_GENERATION_ENABLED=false/);
  assert.match(application,/async function copyText\(str\)[\s\S]*navigator\.clipboard\.writeText\(str\)[\s\S]*document\.execCommand\('copy'\)/);
  assert.doesNotMatch(application,/SAFE_TRANSFER_GENERATION_ENABLED\s*=\s*(?:true|window|localStorage|location)/);
});
