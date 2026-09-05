const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');

const root=path.join(__dirname,'..');
function load(){
  const window={crypto:webcrypto,btoa:value=>Buffer.from(value,'binary').toString('base64')};
  const context=vm.createContext({window,Uint8Array,unescape,encodeURIComponent,console});
  for(const file of ['js/domain/accountSyncModel.js','js/domain/accountSyncProduct.js'])vm.runInContext(readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  return window;
}
function active(row,values=row.values){
  const fields=Object.keys(values),tokens=Object.fromEntries(fields.map(field=>[field,`f_${field}`]));
  return{schemaVersion:1,ownerUid:'uid-owner',entityType:'tradeEntry',entityId:row.entityId,identity:row.identity,generation:1,revision:1,deleted:false,createdAt:1,updatedAt:1,values,
    fieldRevisions:Object.fromEntries(fields.map(field=>[tokens[field],1])),fieldMutations:Object.fromEntries(fields.map(field=>[tokens[field],'op_0000000000000001'])),fieldMutationHashes:Object.fromEntries(fields.map(field=>[tokens[field],'a'.repeat(64)])),lifecycleMutation:'op_0000000000000001',lifecycleMutationHash:'a'.repeat(64)};
}

test('Board edit planning changes only intended fields and does not target new remote entries',async()=>{
  const w=load(),api=w.PogoDomain.accountSyncProduct,model=w.PogoDomain.accountSyncModel;
  const base={lf:[],ft:[{name:'Pikachu',p:'H',shiny:false}]},desired={lf:[],ft:[{name:'Pikachu',p:'M',shiny:false}]};
  const current=api.specialBoardRows({board:{lf:[],ft:[{name:'Pikachu',p:'H',shiny:true},{name:'Eevee'}]},catalogIdForBoardEntry:({entry})=>entry.name}).rows.map(row=>active(row));
  const calls=[],source=readFileSync(path.join(root,'js/app/application.js'),'utf8');
  const context={accountSyncProduct:api,accountSyncModel:model,accountSyncCanonicalEntities:current,managedAccountSyncRuntime:{controller:{}},
    accountSyncCatalogIdentity:(_type,name)=>({catalogId:name}),accountSyncAuthorityCurrent:()=>true,
    applyAccountSyncTradeMutations:async mutations=>{calls.push(...mutations);return{ok:true};}};
  vm.runInNewContext(source.slice(source.indexOf('async function writeAccountSyncSpecialBoard('),source.indexOf('function resetOwnedHydrationState(')),context);
  assert.equal((await context.writeAccountSyncSpecialBoard(desired,{baseBoard:base})).ok,true);
  assert.equal(calls.length,1);assert.equal(calls[0].kind,'patch');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].patch)),{priority:'M'});
  assert.equal(current[0].values.shiny||current[1].values.shiny,true);
});

test('duplicate consolidation cannot remove the public representation and is otherwise exact, session-gated and idempotent',async()=>{
  const source=readFileSync(path.join(root,'js/app/application.js'),'utf8');
  for(const mode of ['public-loss','cancel','legacy','changed-session','changed-data','different-values','accepted']){
    const w=load(),api=w.PogoDomain.accountSyncProduct,model=w.PogoDomain.accountSyncModel,calls=[];
    const survivor={name:'Pikachu',ref:mode==='public-loss'?{surface:'special-board',side:'lf',name:'Pikachu'}:{surface:'my-list',type:'wishlist',name:'Pikachu'}};
    const duplicate={name:'Pikachu',ref:mode==='public-loss'?{surface:'my-list',type:'wishlist',name:'Pikachu'}:{surface:'special-board',side:'lf',name:'Pikachu'}};
    let projection={entries:[survivor],duplicates:[{survivor,duplicate}]};
    const retainedIdentity={surface:'my-list',lane:'wishlist',catalogId:'Pikachu'},losingIdentity={surface:'special-board',lane:'looking-for',catalogId:'Pikachu'};
    const retained=active({entityId:model.tradeEntryId(retainedIdentity),identity:retainedIdentity,values:api.tradeValues({priority:'H'})});
    const losing=active({entityId:model.tradeEntryId(losingIdentity),identity:losingIdentity,values:api.tradeValues({priority:mode==='different-values'?'M':'H',sortOrder:5})});
    const context={productDeclarations:()=>projection,confirm:()=>mode!=='cancel',
      accountSyncMutationAuthority:async()=>{if(mode==='changed-data')projection={...projection,entries:[]};return{mode:mode==='legacy'?'legacy':'canonical',controller:{}};},
      accountSyncAuthorityCurrent:()=>mode!=='changed-session',accountSyncCatalogIdentity:()=>({catalogId:'Pikachu'}),
      accountSyncCanonicalEntities:[retained,losing],accountSyncModel:model,toast:()=>{},i18nCore:{t:key=>key},renderMyList:()=>{},
      applyAccountSyncTradeMutations:async mutations=>{calls.push(...mutations);projection={entries:[survivor],duplicates:[]};return{ok:true};}};
    vm.runInNewContext(source.slice(source.indexOf('async function consolidateIntentDuplicates('),source.indexOf('const MY_LIST_TYPES=')),context);
    await context.consolidateIntentDuplicates();
    assert.equal(calls.length,mode==='accepted'?1:0,mode);
    if(mode==='accepted'){
      assert.equal(calls[0].kind,'delete');assert.equal(calls[0].entityId,losing.entityId);assert.notEqual(calls[0].entityId,retained.entityId);
      await context.consolidateIntentDuplicates();assert.equal(calls.length,1);
    }
  }
});

test('Board projection round-trips every supported qualifier without losing priority or gender',()=>{
  const api=load().PogoDomain.accountSyncProduct;
  const board={lf:[{name:'Pikachu',p:'M',mod:'Antique',gender:'f',lucky:true,xxl:true,xxs:false,shiny:true,backgroundId:'chicago',note:'retain',mirror:true}],ft:[{name:'Eevee',p:'L',gender:'m',qty:3,note:'older quantity retained'}]};
  const rows=api.specialBoardRows({board,catalogIdForBoardEntry:({entry})=>entry.name}).rows;
  const projected=api.projectTradeEntities({entities:rows.map(row=>active(row)),catalogEntryForId:id=>({name:id}),encodePriority:()=>''});
  const roundTrip=api.specialBoardRows({board:projected.board,catalogIdForBoardEntry:({entry})=>entry.name}).rows;
  assert.deepEqual(JSON.parse(JSON.stringify(roundTrip)),JSON.parse(JSON.stringify(rows)));
});

test('My List rows use canonical catalog identity and preserve structured qualifiers and order',()=>{
  const api=load().PogoDomain.accountSyncProduct;
  const result=api.listRows({
    lists:{wishlist:{LocalizedPikachu:'H[shiny][bg:new-york-city](F)'}},
    orders:{wishlist:{priorities:{H:['LocalizedPikachu']}}},
    parsePriority:()=>({p:'H',mod:'F',gender:'f',shiny:true,backgroundId:'new-york-city'}),
    catalogIdForListEntry:()=> 'pokemon:25:base'
  });
  assert.equal(result.unresolved.length,0);assert.equal(result.rows.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.rows[0].identity)),{surface:'my-list',lane:'wishlist',catalogId:'pokemon:25:base'});
  assert.equal(result.rows[0].values.shiny,true);assert.equal(result.rows[0].values.gender,'f');assert.equal(result.rows[0].values.backgroundId,'new-york-city');
  assert.doesNotMatch(result.rows[0].entityId,/LocalizedPikachu/);
});

test('My List row planning derives canonical sortOrder from the supplied drag-order model',()=>{
  const api=load().PogoDomain.accountSyncProduct,result=api.listRows({
    lists:{wishlist:{Pikachu:'H',Rayquaza:'H'}},orders:{wishlist:{priorities:{H:['Rayquaza','Pikachu']}}},
    parsePriority:()=>({p:'H'}),catalogIdForListEntry:({name})=>`pokemon:${name.toLowerCase()}`
  });
  const byName=Object.fromEntries(result.rows.map(row=>[row.legacyName,row.values.sortOrder]));assert.deepEqual(JSON.parse(JSON.stringify(byName)),{Pikachu:1,Rayquaza:0});
});

test('rapid list edits rebase only their intended qualifier fields onto the latest local state',()=>{
  const api=load().PogoDomain.accountSyncProduct,decode=value=>JSON.parse(value),encode=value=>JSON.stringify(value);
  const base={Pikachu:encode({priority:'H',variant:'',lucky:false,xxl:false,xxs:false,shiny:false,backgroundId:''})};
  const first=api.rebaseListEdit({base,current:base,desired:{Pikachu:encode({...decode(base.Pikachu),shiny:true})},decode,encode});
  const second=api.rebaseListEdit({base,current:first,desired:{Pikachu:encode({...decode(base.Pikachu),lucky:true})},decode,encode});
  assert.deepEqual(JSON.parse(second.Pikachu),{priority:'H',variant:'',lucky:true,xxl:false,xxs:false,shiny:true,backgroundId:''});
  const laterPriority=api.rebaseListEdit({base,current:second,desired:{Pikachu:encode({...decode(base.Pikachu),priority:'M'})},decode,encode});
  assert.equal(JSON.parse(laterPriority.Pikachu).priority,'M');assert.equal(JSON.parse(laterPriority.Pikachu).shiny,true);assert.equal(JSON.parse(laterPriority.Pikachu).lucky,true);
});

test('unresolved catalog names are quarantined instead of becoming display-string identities',()=>{
  const api=load().PogoDomain.accountSyncProduct,result=api.listRows({lists:{wishlist:{UnknownLabel:'H'}},parsePriority:()=>({p:'H'}),catalogIdForListEntry:()=>''});
  assert.equal(result.rows.length,0);assert.deepEqual(JSON.parse(JSON.stringify(result.unresolved)),[{surface:'my-list',lane:'wishlist',name:'UnknownLabel',reason:'catalog-identity-unresolved'}]);
});

test('trade mutation planning patches fields independently and treats lane or identity changes as delete plus add',()=>{
  const api=load().PogoDomain.accountSyncProduct,model=load().PogoDomain.accountSyncModel;
  const identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:25:base'},row={entityType:'tradeEntry',entityId:model.tradeEntryId(identity),identity,values:api.tradeValues({priority:'H'})};
  const current=active(row),changed={...row,values:api.tradeValues({...row.values,backgroundId:'nyc'})};
  const patch=api.planTradeMutations({currentEntities:[current],desiredRows:[changed],scope:{surface:'my-list',lanes:['wishlist']}});
  assert.deepEqual(JSON.parse(JSON.stringify(patch)),[{kind:'patch',entityType:'tradeEntry',entityId:row.entityId,patch:{backgroundId:'nyc'}}]);
  const movedIdentity={...identity,lane:'dynamax'},moved={...row,entityId:model.tradeEntryId(movedIdentity),identity:movedIdentity};
  const lifecycle=api.planTradeMutations({currentEntities:[current],desiredRows:[moved],scope:{surface:'my-list',lanes:['wishlist','dynamax']}});
  assert.deepEqual(Array.from(lifecycle,item=>item.kind).sort(),['add','delete']);
});

test('lane-scoped trade planning cannot add or delete entries outside its scope',()=>{
  const window=load(),api=window.PogoDomain.accountSyncProduct,model=window.PogoDomain.accountSyncModel;
  const wishlistIdentity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:25:base'};
  const boardIdentity={surface:'special-board',lane:'for-trade',catalogId:'pokemon:800:base'};
  const wishlist={entityType:'tradeEntry',entityId:model.tradeEntryId(wishlistIdentity),identity:wishlistIdentity,values:api.tradeValues({priority:'H'})};
  const board={entityType:'tradeEntry',entityId:model.tradeEntryId(boardIdentity),identity:boardIdentity,values:api.tradeValues({quantity:2})};
  const mutations=api.planTradeMutations({
    currentEntities:[active(wishlist),active(board)],
    desiredRows:[wishlist,board],
    scope:{surface:'my-list',lanes:['wishlist']}
  });
  assert.deepEqual(JSON.parse(JSON.stringify(mutations)),[]);
});

test('canonical entities project back to My List and Special Board without changing device-local state',()=>{
  const window=load(),api=window.PogoDomain.accountSyncProduct,model=window.PogoDomain.accountSyncModel;
  const listIdentity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:25:base'},boardIdentity={surface:'special-board',lane:'for-trade',catalogId:'pokemon:800:base'};
  const listRow={entityType:'tradeEntry',entityId:model.tradeEntryId(listIdentity),identity:listIdentity,values:api.tradeValues({priority:'M',shiny:true,sortOrder:2})};
  const boardRow={entityType:'tradeEntry',entityId:model.tradeEntryId(boardIdentity),identity:boardIdentity,values:api.tradeValues({quantity:4,note:'registered',mirror:true,sortOrder:0})};
  const catalog={
    'pokemon:25:base':{name:'Pikachu',displayName:'Pikachu',no:25},
    'pokemon:800:base':{name:'Necrozma',displayName:'Necrozma',no:800}
  };
  const projected=api.projectTradeEntities({entities:[active(listRow),active(boardRow)],catalogEntryForId:id=>catalog[id],encodePriority:value=>`${value.priority}${value.shiny?'[shiny]':''}`});
  assert.equal(projected.lists.wishlist.Pikachu,'M[shiny]');assert.equal(projected.board.ft[0].name,'Necrozma');assert.equal(projected.board.ft[0].qty,4);assert.equal(projected.board.ft[0].mirror,true);
  assert.ok(api.DEVICE_LOCAL_STATE.includes('recent-trainers'));assert.equal('recent' in projected,false);
});

test('accepted public rows project without sync metadata and reject substituted row shapes',()=>{
  const window=load(),api=window.PogoDomain.accountSyncProduct,model=window.PogoDomain.accountSyncModel;
  const identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:25:base'},row={entityType:'tradeEntry',entityId:model.tradeEntryId(identity),identity,values:api.tradeValues({priority:'H',backgroundId:'new-york-city'})};
  const accepted=model.publicTradeProjection([active(row)]),catalog={'pokemon:25:base':{name:'Pikachu',displayName:'Pikachu',no:25}};
  const projected=api.projectAcceptedPublicRows({rows:accepted,catalogEntryForId:id=>catalog[id],encodePriority:value=>`${value.priority}:${value.backgroundId}`});
  assert.deepEqual(JSON.parse(JSON.stringify(projected.lists.wishlist)),{Pikachu:'H:new-york-city'});
  assert.equal('operationId'in accepted[0],false);assert.equal('fieldRevisions'in accepted[0],false);assert.equal('ownerUid'in accepted[0],false);
  assert.throws(()=>api.projectAcceptedPublicRows({rows:[{...accepted[0],operationId:'op_private'}],catalogEntryForId:id=>catalog[id],encodePriority:value=>value.priority}),/row shape is invalid/);
});

test('Special Trade Board canonical rows retain LF/FT quantity note mirror shiny background and ordering',()=>{
  const window=load(),api=window.PogoDomain.accountSyncProduct;
  const parsed=api.specialBoardRows({board:{lf:[{name:'Rayquaza',shiny:true,mirror:true,backgroundId:'new-york-city',note:'registered'}],ft:[{name:'Necrozma',qty:7,backgroundId:'go-fest-2024'}]},catalogIdForBoardEntry:({entry})=>`pokemon:${entry.name.toLowerCase()}`});
  assert.equal(parsed.unresolved.length,0);const lf=parsed.rows.find(row=>row.identity.lane==='looking-for'),ft=parsed.rows.find(row=>row.identity.lane==='for-trade');
  assert.deepEqual(JSON.parse(JSON.stringify({shiny:lf.values.shiny,mirror:lf.values.mirror,backgroundId:lf.values.backgroundId,note:lf.values.note,sortOrder:lf.values.sortOrder})),{shiny:true,mirror:true,backgroundId:'new-york-city',note:'registered',sortOrder:0});
  assert.equal(ft.values.quantity,7);assert.equal(ft.values.backgroundId,'go-fest-2024');
});

test('favorite UID resolution requires an exact forward and reverse identity binding',()=>{
  const api=load().PogoDomain.accountSyncProduct,state={users:{Friend:{authUid:'uid-friend'}},authIndex:{'uid-friend':{username:'Friend'}}};
  assert.equal(api.exactFavoriteTargetUid('Friend',state),'uid-friend');
  assert.equal(api.exactFavoriteTargetUid('Friend',{...state,authIndex:{'uid-friend':{username:'Other'}}}),'');
  assert.equal(api.exactFavoriteTargetUid('friend',state),'');
});

test('favorite tag patches use explicit false tombstones and organizer projection filters them',()=>{
  const window=load(),api=window.PogoDomain.accountSyncProduct;
  assert.deepEqual(JSON.parse(JSON.stringify(api.favoriteTagPatch(['tag_a','tag_b'],['tag_b','tag_c']))),{'tagIds/tag_a':false,'tagIds/tag_c':true});
  const tags=[{entityType:'tag',entityId:'tag_b',deleted:false,values:{label:'Raid'},createdAt:1,updatedAt:1},{entityType:'tag',entityId:'tag_c',deleted:false,values:{label:'Trade'},createdAt:1,updatedAt:1}];
  const favorite={entityType:'favorite',entityId:'uid-friend',deleted:false,values:{displayName:'Friend',tagIds:{tag_a:false,tag_b:true,tag_c:true}},createdAt:1,updatedAt:2};
  assert.deepEqual(JSON.parse(JSON.stringify(api.organizerProjection([...tags,favorite]).favorites[0].tagIds)),['tag_b','tag_c']);
});

test('legacy tag IDs are deterministic fixed-length hashes and new IDs use secure randomness',async()=>{
  const model=load().PogoDomain.accountSyncModel;
  const a=await model.tagIdFromLegacy({ownerUid:'uid-owner',label:'Raid',legacyId:'tag_old'}),b=await model.tagIdFromLegacy({ownerUid:'uid-owner',label:'Raid',legacyId:'tag_old'});
  assert.equal(a,b);assert.match(a,/^tag_[a-f0-9]{64}$/);assert.ok(model.newTagId(webcrypto).length<80);
});
