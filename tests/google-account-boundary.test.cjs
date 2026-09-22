const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const vm=require('node:vm');
const acorn=require('acorn');

function domains(){
  const window={};window.window=window;
  const context=vm.createContext({window,console});
  for(const file of ['js/domain/accountSyncModel.js','js/domain/accountLinkingModel.js'])vm.runInContext(readFileSync(file,'utf8'),context,{filename:file});
  return window.PogoDomain;
}
function digest(value){return createHash('sha256').update(String(value)).digest('hex');}
function productFixture({intents=true}={}){
  return{
    lists:{wishlist:{Pikachu:'H',Eevee:'M'},dynamax:{},gmax:{},costumes:{}},
    favorites:[
      {targetUid:'uid-b',displayName:'Bravo',tagIds:['tag-b','tag-a']},
      {targetUid:'uid-a',displayName:'Alpha',tagIds:['tag-a']}
    ],
    tags:{'tag-b':{id:'tag-b',label:'Raid'},'tag-a':{id:'tag-a',label:'Friends'}},
    board:{lf:[{entityId:'board-a',name:'Mewtwo'}],ft:[{entityId:'board-b',name:'Pikachu',qty:2}]},
    intentDeclarations:intents?[
      {entityId:'intent-b',catalogId:'b',side:'lf',sortOrder:20,note:''},
      {entityId:'intent-a',catalogId:'a',side:'lf',sortOrder:10,note:''}
    ]:[],
    canonicalEntities:[
      {entityType:'tradeEntry',entityId:'intent-b',values:{sortOrder:20,note:''}},
      {entityType:'tag',entityId:'tag-a',values:{label:'Friends'}},
      {entityType:'tradeEntry',entityId:'intent-a',values:{sortOrder:10,note:''}}
    ]
  };
}
async function evidence(value){
  const model=domains();
  return{model,result:await model.accountLinkingModel.productEvidence(value,{fingerprint:item=>digest(model.accountSyncModel.canonicalJson(item))})};
}
function completeBoundary(result){
  return{
    accountDataFingerprint:result.fingerprint,accountDataComponents:result.components,
    journalOwner:'uid-a',journalGeneration:4,migrationGeneration:'migration-stable',
    recoveryEvidenceFingerprint:'recovery-stable',reviewedEvidenceCount:66,activeEvidenceCount:0,
    listenerAuthority:'listener-stable',publicIdentityFingerprint:'public-stable',trainerIdentityFingerprint:'trainer-stable'
  };
}

test('PIN and same-UID Google snapshots remain component-identical across unordered delivery',async()=>{
  const pin=productFixture(),google=JSON.parse(JSON.stringify(pin));
  google.favorites.reverse();
  google.tags={'tag-a':google.tags['tag-a'],'tag-b':google.tags['tag-b']};
  google.intentDeclarations.reverse();
  google.canonicalEntities.reverse();
  const before=await evidence(pin),after=await evidence(google);
  assert.deepEqual(JSON.parse(JSON.stringify(after.result.components)),JSON.parse(JSON.stringify(before.result.components)));
  for(const key of before.model.accountLinkingModel.PRODUCT_COMPONENT_KEYS)assert.equal(after.result.components[key],before.result.components[key],key);
  assert.equal(before.model.accountLinkingModel.assertBoundaryUnchanged(completeBoundary(before.result),completeBoundary(after.result)),true);
  assert.equal(before.result.summaries.intentDeclarations.length,2);
  assert.equal(before.result.summaries.canonicalEntities.length,3);
  assert.deepEqual([...before.result.summaries.favorites.semanticIdentities],['uid-a','uid-b']);
});

test('empty intent declarations remain a covered independent component',async()=>{
  const {model,result}=await evidence(productFixture({intents:false}));
  assert.equal(result.summaries.intentDeclarations.length,0);
  assert.equal(typeof result.components.intentDeclarations,'string');
  assert.ok(model.accountLinkingModel.PRODUCT_COMPONENT_KEYS.includes('intentDeclarations'));
});

test('component evidence reports duplicate identities without exposing values',async()=>{
  const fixture=productFixture();fixture.favorites.push({...fixture.favorites[0]});
  const {result}=await evidence(fixture);
  assert.deepEqual(JSON.parse(JSON.stringify(result.summaries.favorites.duplicateIdentities)),[{id:'uid-b',count:2}]);
  assert.equal(Object.hasOwn(result.summaries.favorites,'values'),false);
});

test('an actual single-field product mutation fails on its exact component',async()=>{
  const before=await evidence(productFixture()),changed=productFixture();
  changed.tags['tag-a'].label='Different label';
  const after=await evidence(changed);
  assert.notEqual(after.result.components.favoriteTags,before.result.components.favoriteTags);
  for(const key of before.model.accountLinkingModel.PRODUCT_COMPONENT_KEYS.filter(key=>key!=='favoriteTags'))assert.equal(after.result.components[key],before.result.components[key],key);
  assert.throws(()=>before.model.accountLinkingModel.assertBoundaryUnchanged(completeBoundary(before.result),completeBoundary(after.result)),error=>error.code==='provider-link/account-boundary-changed-account-data-favorite-tags');
});

test('Special Trade Board order remains protected product state',async()=>{
  const beforeFixture=productFixture(),afterFixture=productFixture();
  beforeFixture.board.lf.push({entityId:'board-c',name:'Eevee'});
  afterFixture.board.lf.push({entityId:'board-c',name:'Eevee'});
  afterFixture.board.lf.reverse();
  const before=await evidence(beforeFixture),after=await evidence(afterFixture);
  assert.notEqual(after.result.components.specialTradeBoard,before.result.components.specialTradeBoard);
  assert.throws(()=>before.model.accountLinkingModel.assertBoundaryUnchanged(completeBoundary(before.result),completeBoundary(after.result)),error=>error.code==='provider-link/account-boundary-changed-account-data-special-trade-board');
});

const application=readFileSync('js/app/application.js','utf8');
const ast=acorn.parse(application,{ecmaVersion:'latest'});
function extract(name){const node=ast.body.find(item=>item.type==='FunctionDeclaration'&&item.id.name===name);assert.ok(node,name);return application.slice(node.start,node.end);}
function readinessFixture({projectionReady,profileReady=true,state={}}={}){
  const user={uid:'uid-a'},runtime={ownerUid:'uid-a',projectionReady,profileReady,snapshot:async()=>({state:'saved',active:true,listenerHealthy:true,controllerHealthy:true,lastError:'',pendingCount:0,blockedCount:0,conflictCount:0,...state})};
  const context=vm.createContext({auth:{currentUser:user},cur:'Trainer',_sessionTransientGeneration:7,managedAccountSyncRuntime:runtime,
    accountSyncUiState:{},ensureAccountSyncRuntime:async()=>({ok:true,status:'active'}),accountSyncClearStaleRecoveryPresentation(){},refreshSyncUi(){},
    accountSyncProjectionReady:()=>runtime.projectionReady===true&&runtime.profileReady===true,
    accountLinkingModelDomain:{failure:code=>Object.assign(new Error(code),{code})}});
  vm.runInContext(extract('providerAccountBoundaryReadiness'),context);
  return{context,runtime};
}

test('partially hydrated PIN snapshots are rejected before fingerprinting',async()=>{
  for(const fixture of [readinessFixture({projectionReady:false}),readinessFixture({projectionReady:true,state:{pendingCount:1}})]){
    await assert.rejects(fixture.context.providerAccountBoundaryReadiness('uid-a'),error=>error.code==='provider-link/account-boundary-not-ready');
  }
});

test('fully hydrated stable PIN and Google sessions reach the same readiness boundary',async()=>{
  for(const fixture of [readinessFixture({projectionReady:true}),readinessFixture({projectionReady:true})]){
    const ready=await fixture.context.providerAccountBoundaryReadiness('uid-a');
    assert.equal(ready.runtime,fixture.runtime);assert.equal(ready.state.listenerHealthy,true);assert.equal(ready.state.pendingCount,0);
  }
});
