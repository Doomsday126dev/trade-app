const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {sanitizeProviderPublicProjection}=require('../functions/e1-authority-service/providerPublicProjection');

function loadDomains(){
  const window={};window.window=window;
  const context=vm.createContext({window,console});
  for(const file of ['js/domain/publicSharePublication.js','js/domain/providerPublicProjection.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
  return window.PogoDomain;
}
function row(extra={}){
  return{intent:'lf',category:'wishlist',name:'Pikachu',p:'H',mod:'',gender:'',backgroundId:'',note:'',lucky:false,shiny:false,xxl:false,xxs:false,...extra};
}
function snapshot(declarations){
  return{version:2,username:'Owner',profile:{friendCode:'',bio:'',discord:'',avatarPokemon:'',lastUpdated:100},lists:{wishlist:{},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],declarations,declarationCount:declarations.length,updatedAt:100};
}

test('multiline notes use a gateway-compatible line separator and preserve display line breaks',()=>{
  const domain=loadDomains(),source=row({note:'Saturday\r\nAfter 3 pm'});
  const declarations=domain.publicSharePublication.publicDeclarations([source]);
  assert.equal(source.note,'Saturday\r\nAfter 3 pm');
  assert.equal(declarations[0].note,'Saturday\u2028After 3 pm');
  assert.equal(domain.publicSharePublication.publicNoteForDisplay(declarations[0].note),'Saturday\nAfter 3 pm');
  assert.deepEqual(JSON.parse(JSON.stringify(domain.publicSharePublication.publicDeclarations(declarations,{strict:true}))),JSON.parse(JSON.stringify(declarations)));

  const stored=domain.providerPublicProjection.nextProjection(snapshot(declarations),null,{trainerName:'Owner',now:200});
  const accepted=sanitizeProviderPublicProjection(stored,{trainerName:'Owner'});
  assert.equal(accepted.declarations[0].note,'Saturday\u2028After 3 pm');
});

test('public link action publishes multiline notes and catches other invalid text before publication',async()=>{
  const domain=loadDomains(),source=fs.readFileSync('js/app/application.js','utf8');
  const copy=source.slice(source.indexOf('async function copyShareLink('),source.indexOf('// ── SPECIAL TRADE BOARD'));
  let entries=[row({note:'Saturday\nAfter 3 pm'})],published=0,copied='',status='';
  const input={value:'',focus(){},select(){}};
  const context={
    console,cur:'Owner',auth:{currentUser:{uid:'owner-uid'}},publicLinkAttempt:0,myListType:'wishlist',location:{origin:'https://example.test',pathname:'/trade/'},
    document:{getElementById:id=>id==='product-share-modal'?{classList:{contains:()=>false}}:id==='share-public-url'?input:null},
    productDeclarations:()=>({entries}),publicSharePublicationDomain:domain.publicSharePublication,
    linkPublicationStatus:key=>{status=key;},publishPublicShareNow:async()=>{published++;return{status:'published'};},
    publicSharePublicationCurrent:()=>true,copyText:async value=>{copied=value;}
  };
  vm.createContext(context);vm.runInContext(copy,context);
  await context.copyShareLink();
  assert.equal(published,1);assert.equal(status,'product.publishedCopied');assert.equal(copied,'https://example.test/trade/?view=Owner&list=wishlist');

  entries=[row({note:'invalid\tcontrol'})];published=0;copied='';status='';
  await context.copyShareLink();
  assert.equal(published,0);assert.equal(copied,'');assert.equal(status,'product.publishFailed');
});

test('shared semantic labels distinguish ordinary, Dynamax and Gigantamax without duplicate Max wording',()=>{
  const domain=loadDomains(),source=fs.readFileSync('js/app/application.js','utf8');
  const block=source.slice(source.indexOf('function productShareCategoryLabel('),source.indexOf('function refreshProductShare('));
  const labels={'list.dynamax':'Dynamax','list.gigantamax':'Gigantamax','share.flagShiny':'Shiny only','myList.lucky':'Lucky'};
  const context={i18nCore:{t:key=>labels[key]||key},publicSharePublicationDomain:domain.publicSharePublication,priLabel:value=>({H:'High',M:'Medium',L:'Low'})[value]||value};
  vm.createContext(context);vm.runInContext(block,context);
  assert.equal(context.productShareDescription({name:'Bulbasaur',category:'wishlist',p:'H'}),'Bulbasaur · High');
  assert.equal(context.productShareDescription({name:'Bulbasaur',category:'dynamax',p:'H'}),'Bulbasaur · Dynamax · High');
  assert.equal(context.productShareDescription({name:'Dynamax Bulbasaur',category:'dynamax',p:'H'}),'Dynamax Bulbasaur · High');
  assert.equal(context.productShareDescription({name:'Charizard',category:'gmax',p:'M'}),'Charizard · Gigantamax · Medium');
  assert.equal(context.productShareDescription({name:'Gigantamax Charizard',category:'gmax',p:'M'}),'Gigantamax Charizard · Medium');
  assert.equal(context.productShareDescription({name:'Pikachu',category:'wishlist',note:'Saturday\u2028After 3 pm'}),'Pikachu · Saturday\nAfter 3 pm');
});
