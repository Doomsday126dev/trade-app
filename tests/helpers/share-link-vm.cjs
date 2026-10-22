const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'js/app/application.js'),'utf8');

// Load the actual application adapter plus its context helpers, not a second
// implementation. I/O is supplied by the owning test.
function shareLinkHarness({entries,publish,copy}){
  const window={};window.window=window;
  const c=vm.createContext({window,console});
  vm.runInContext(fs.readFileSync(path.join(root,'js/domain/publicSharePublication.js'),'utf8'),c);
  const domain=window.PogoDomain.publicSharePublication,gate=domain.createPublicSharePublicationGate();
  const token=gate.activate({uid:'owner',username:'Owner'}).token;
  for(const surface of ['profile','wishlist','dynamax','gmax','costumes'])gate.markLoaded(token,surface);
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,textContent:'',dataset:{},classList:{contains:()=>c.open},setAttribute(name,value){this[name]=value;},focus(){},select(){}});return nodes.get(id);};
  Object.assign(c,{cur:'Owner',auth:{currentUser:{uid:'owner'}},open:true,myListType:'wishlist',allData:{users:{Owner:{}}},_sessionTransientGeneration:0,
    productShareUi:{generation:0,mode:'link',category:'wishlist',busy:false,receipt:null,context:{}},productShareScope:'full',productShareSnapshot:[],publicLinkAttempt:0,fbOn:true,db:{},
    location:{origin:'https://example.test',pathname:'/trade/'},document:{getElementById:node},URL:{revokeObjectURL(){}},
    activePublicShareHydrationToken:token,managedPublicSharePublication:gate,managedAccountSyncRuntime:null,accountSyncRuntimeGeneration:0,publicSharePublicationDomain:domain,
    ownerPublicShareReview:{generation:token.generation,status:'valid_complete_projection'},i18nCore:{t:key=>key},statuses:[],
    productDeclarations:()=>({entries:entries()}),publishPublicShareNow:publish,copyText:copy,publicShareSessionMatches:()=>c.auth?.currentUser?.uid==='owner'&&c.cur==='Owner',
    publicSharePublicationCurrent:result=>result?.ok===true&&['published','reconciled'].includes(result.status),
    linkPublicationStatus:(key,options={})=>c.statuses.push(options.state||key),refreshProductShare:()=>{c.invalidateProductShare();c.productShareUi.context=c.productShareContext();},closeModal:()=>{c.open=false;c.invalidateProductShare();}
  });
  vm.runInContext(source.slice(source.indexOf('function productShareIsOpen('),source.indexOf('function productSelectionKey(')),c);
  vm.runInContext(source.slice(source.indexOf('function updateProductShareAction('),source.indexOf('async function buildProductShareImage(')),c);
  vm.runInContext(source.slice(source.indexOf('async function copyShareLink('),source.indexOf('// ── SPECIAL TRADE BOARD')),c);
  return{context:c,node,domain};
}
module.exports={shareLinkHarness};
