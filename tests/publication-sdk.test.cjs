const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {initializeApp,deleteApp}=require('@firebase/app');
const {getDatabase,connectDatabaseEmulator,ref,set,get,goOffline}=require('@firebase/database');
function payload(baseline=false){
  const window={};
  const code=fs.readFileSync('js/domain/publicSharePublication.js','utf8');
  vm.runInNewContext(code,{window});const api=window.PogoDomain.publicSharePublication,gate=api.createPublicSharePublicationGate(),token=gate.activate({uid:'sdk-publication-uid',username:'SdkPublication'}).token;
  for(const s of api.REQUIRED_SOURCE_SURFACES)gate.markLoaded(token,s);
  const snapshot=api.buildPublicShareSnapshot({gate,token,trigger:'owned_list_edit',canonical:true,username:'SdkPublication',source:{users:{SdkPublication:{}},wishlist:{},dynamax:{},gmax:{},costumes:{}},declarations:[{intent:'lf',category:'wishlist',name:'Pikachu',p:'H'}]}).snapshot;
  if(baseline)for(const type of api.REQUIRED_LIST_SURFACES)snapshot.lists[type]=Object.assign(Object.create(null),snapshot.lists[type]);
  return snapshot;
}
test('captured .127 payload shape reproduces the real Firebase SDK validation failure',async()=>{
 const app=initializeApp({projectId:'demo-trade-investigation',databaseURL:'https://demo-trade-investigation-default-rtdb.firebaseio.com'},'baseline-sdk');
 const db=getDatabase(app);connectDatabaseEmulator(db,'127.0.0.1',9500,{mockUserToken:{sub:'sdk-publication-uid'}});goOffline(db);
 try{assert.throws(()=>set(ref(db,'publicShares/SdkPublication'),payload(true)),/hasOwnProperty/);}finally{await deleteApp(app);}
});
test('ordinary public payload crosses real SDK validation and persists under captured rules',{skip:!process.env.POGO_DATABASE_EMULATOR},async()=>{
 const endpoint=process.env.POGO_DATABASE_EMULATOR;assert.match(endpoint,/^http:\/\/(127\.0\.0\.1|localhost):9500$/);
 const ns='demo-trade-investigation-default-rtdb';
 const seeded=await fetch(`${endpoint}/users/SdkPublication.json?ns=${ns}`,{method:'PUT',headers:{authorization:'Bearer owner','content-type':'application/json'},body:JSON.stringify({authUid:'sdk-publication-uid'})});assert.ok(seeded.ok);
 const app=initializeApp({projectId:'demo-trade-investigation',databaseURL:`https://${ns}.firebaseio.com`},'fixed-sdk');const db=getDatabase(app);
 connectDatabaseEmulator(db,'127.0.0.1',9500,{mockUserToken:{sub:'sdk-publication-uid'}});
 try{const value=payload();await set(ref(db,'publicShares/SdkPublication'),value);const saved=await get(ref(db,'publicShares/SdkPublication'));assert.equal(saved.val().version,2);assert.equal(saved.val().username,'SdkPublication');
 const independent=await fetch(`${endpoint}/publicShares/SdkPublication.json?ns=${ns}`);assert.ok(independent.ok);assert.equal((await independent.json()).declarationCount,1);
 }finally{goOffline(db);await deleteApp(app);}
});
