const {install:installEditor,settled}=require('./want-editor-application.cjs');

// Synthetic I/O only. Navigation, modals, import parsing/mutation, Share,
// repository validation and transfer calculation remain the actual application.
async function seedDiscovery(){
  document.getElementById('top-un').textContent=cur;
  document.getElementById('my-av').textContent='L';
  const store=ensureTrainerHistoryStore();
  for(const name of ['Ada','Bert'])store.saveFavoriteOrganization(name);
  window.__discovery={reads:[],waiters:[],defer:false,results:{},adminReads:[],adminStops:[]};
  const declaration=name=>({intent:'lf',category:'wishlist',name,p:'H',mod:'',gender:'',backgroundId:'',note:'',lucky:false,shiny:false,xxl:false,xxs:false});
  for(const [name,pokemon]of [['Ada','Pikachu'],['Bert','Eevee']])__discovery.results[name]={ok:true,value:{version:2,username:name,profile:{friendCode:'',bio:'',discord:'',avatarPokemon:'',lastUpdated:0},publishedListTypes:['wishlist','dynamax','gmax','costumes'],lists:{wishlist:{},dynamax:{},gmax:{},costumes:{}},updatedAt:119,declarations:[declaration(pokemon)],declarationCount:1}};
  managedPublicShareRepository=publicShareRepositoryData.createPublicShareRepository({
    readServer(path,options={}){
      __discovery.reads.push(path);
      const result=structuredClone(__discovery.results[decodeURIComponent(path.split('/').pop())]);
      const value=result?.ok?{...result,evidence:{kind:'server-confirmed-public-share',transport:'rtdb-rest',scope:'whole-projection',completed:true,operationId:options.operationId}}:result;
      return __discovery.defer?new Promise(resolve=>__discovery.waiters.push(()=>resolve(value))):Promise.resolve(value);
    },
    read(){throw Error('Cache-capable transfer read');},listen(){throw Error('Unexpected public subscription');}
  });
  // Transport boundary only; the real protected gate/lifecycle still owns
  // subscription dispatch, deduplication and cleanup.
  managedFirebaseClient={listen(path){
    __discovery.adminReads.push(path);
    return{ok:true,unsubscribe:()=>__discovery.adminStops.push(path)};
  }};
  updateFcDisplay();switchTab('more');
}
async function install(page,{empty=false}={}){
  await installEditor(page,empty?{authIndex:{'want-editor-local-uid':{username:'LocalTrainer'}},users:{LocalTrainer:{authUid:'want-editor-local-uid',specialTradeBoard:{lf:[],ft:[]}}},wishlist:{LocalTrainer:{}},dynamax:{LocalTrainer:{}},gmax:{LocalTrainer:{}},costumes:{LocalTrainer:{}}}:null);
  await page.evaluate(seedDiscovery);
}
module.exports={install,seedDiscovery,settled};
