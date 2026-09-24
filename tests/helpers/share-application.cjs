const {expect}=require('@playwright/test');

// Actual application, fresh context, no remote services. Only public artwork may
// load remotely; Firebase imports/requests and service workers are blocked.
async function installShareApplication(page){
  const origin=new URL(process.env.PLAYWRIGHT_BASE_URL||'http://localhost:4174').origin;
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin||route.request().resourceType()==='image'?route.continue():route.abort());
  await page.route('**/sw.js*',route=>route.abort());
  await page.goto('./?local-share-application-test');
  await page.waitForFunction(()=>typeof __pogoEnsureFullApp==='function');
  await page.evaluate(()=>__pogoEnsureFullApp('local-share-application-test'));
  await page.waitForFunction(()=>typeof renderMyList==='function'&&window.__pogoStartup?.firebaseStartupSettledAt>0);
  await page.evaluate(()=>{
    managedListenerLifecycle?.deactivateSession?.('share_application_test');
    managedListenerLifecycle?.clearSelectedTrainer?.('share_application_test');
    managedSubscriptions?.unsubscribeByKey?.('public:loginDirectory');managedOwnedDataCoordinator?.reset?.();
    db=null;fbOn=false;managedFirebaseClient=null;managedAccountSyncRuntime=null;accountSyncUiState=null;
    cur='LocalTrainer';auth={currentUser:{uid:'synthetic-share-owner',providerData:[]}};_authStateKnown=true;
    allData=normalizeData({users:{LocalTrainer:{authUid:'synthetic-share-owner',friendCode:'1234 5678 9012',discord:'local-trainer',bio:'Weekend trades. Regional forms and special requests welcome.',privateMarker:'PRIVATE_DO_NOT_EXPORT',pinHash:'PRIVATE_PIN',intentDeclarations:[
      {entityId:'exact-form',side:'lf',name:'Spinda (Form 7)',p:'H',mod:'Exact form',shiny:true,lucky:true,note:'Saturday after 3 pm\nPlease keep the exact form. Public note with details for our trade.'},
      {entityId:'missing-art',side:'lf',name:'Synthetic Missing Artwork',p:'L',note:'Public note without artwork',no:null},
      {entityId:'independent',side:'lf',name:'Pikachu',p:'',shiny:true,lucky:true,xxl:true,xxs:true,gender:'f',note:'Independent requirements'},
      {entityId:'ordinary',side:'lf',name:'Arrokuda',p:'H'},{entityId:'medium',side:'lf',name:'Flittle',p:'M'}
    ]}},wishlist:{LocalTrainer:{Relicanth:'H',Snom:'L'}},dynamax:{LocalTrainer:{Bulbasaur:'M'}},gmax:{LocalTrainer:{'Gigantamax Charizard':'H'}},costumes:{LocalTrainer:{}}});
    _pathLoadState={wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded'};
    activePublicShareHydrationToken=managedPublicSharePublication.activate({uid:auth.currentUser.uid,username:cur}).token;
    for(const surface of ['profile','wishlist','dynamax','gmax','costumes'])managedPublicSharePublication.markLoaded(activePublicShareHydrationToken,surface);
    ownerPublicShareReview={generation:activePublicShareHydrationToken.generation,status:'valid_complete_projection',republishRequired:false,busy:false};
    window.__shareTest={writes:[],reads:[],copies:[],fallbacks:0,stored:null,clipboardFails:false,writeFails:false,readbackMismatch:false};
    // Exercise publishPublicShareNow AND its real readback verifier; replace only
    // the RTDB and clipboard I/O boundaries with a synthetic in-memory store.
    db={synthetic:true};fbOn=true;
    ref=(_db,path)=>{if(path!=='publicShares/LocalTrainer')throw Error('Unexpected service path: '+path);return path;};
    set=async(path,value)=>{__shareTest.writes.push({path,value:structuredClone(value)});if(__shareTest.holdWrite)await new Promise(resolve=>__shareTest.resolveWrite=resolve);if(__shareTest.writeFails)throw Error('Synthetic write failure');__shareTest.stored=structuredClone(value);};
    get=async path=>{__shareTest.reads.push(path);return{exists:()=>true,val:()=>__shareTest.readbackMismatch?{broken:true}:structuredClone(__shareTest.stored)};};
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{
      __shareTest.copies.push(value);if(__shareTest.holdClipboard)await new Promise((resolve,reject)=>{__shareTest.resolveClipboard=resolve;__shareTest.rejectClipboard=reject;});
      if(__shareTest.clipboardFails)throw Error('Synthetic clipboard denial');
    }}});
    document.execCommand=()=>{__shareTest.fallbacks++;return false;};
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    document.getElementById('my-un').textContent='LocalTrainer';document.getElementById('my-av').textContent='L';document.getElementById('top-un').textContent='LocalTrainer';
    applyTheme('dark');switchTab('mylist',{render:false});renderMyList();updateFcDisplay();
    window.__shareTest.before=JSON.stringify(allData);
  });
  await expect(page.locator('#combined-list .wants-row')).toHaveCount(9);
}
module.exports={installShareApplication};
