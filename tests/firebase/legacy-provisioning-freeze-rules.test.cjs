const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');

const PROJECT_ID=process.env.POGO_RULES_PROJECT_ID||'demo-pogo-legacy-provisioning-freeze';
const DATABASE_HOST=process.env.FIREBASE_DATABASE_EMULATOR_HOST||'127.0.0.1:9700';
const AUTH_HOST=process.env.FIREBASE_AUTH_EMULATOR_HOST||'127.0.0.1:9799';
const NAMESPACE=`${PROJECT_ID}-default-rtdb`,TOKENS={},IDS={},now=1700000000000;
const freeze=(overrides={})=>({schemaVersion:1,state:'active',provisioningModel:'bounded-legacy-provisioning-freeze',freezeId:'legacy-freeze-review-0001',provisioningContractDigest:'a'.repeat(64),activatedAt:now,releasedAt:null,...overrides});
const user=(uid,overrides={})=>({authUid:uid,authEmail:'trainer@example.test',authVersion:1,friendCode:'',isAdmin:false,isOwner:false,...overrides});
const directory=(overrides={})=>({authReady:true,authVersion:1,approvedAt:now,...overrides});
const requestRecord=(status='pending')=>({username:'NewTrainer',note:'',requestedAt:now,status});

async function request(url,method='GET',value,headers={}){
  const response=await fetch(url,{method,headers:{...(value===undefined?{}:{'content-type':'application/json'}),...headers},body:value===undefined?undefined:JSON.stringify(value)});
  return{status:response.status,body:await response.text()};
}
async function createUser(name){
  const response=await request(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,'POST',{email:`${name}@example.test`,password:`${name}-password-123`,returnSecureToken:true});
  assert.equal(response.status,200,response.body);const body=JSON.parse(response.body);TOKENS[name]=body.idToken;IDS[name]=body.localId;
}
function url(target='',token){const clean=String(target).replace(/^\/+|\/+$/g,'');const result=new URL(`http://${DATABASE_HOST}/${clean?`${clean}.json`:'.json'}`);result.searchParams.set('ns',NAMESPACE);if(token)result.searchParams.set('auth',token);return result;}
function db(method,target,value,actor){const owner=actor==='emulator-owner';return request(url(target,owner?undefined:actor),method,value,owner?{authorization:'Bearer owner'}:{});}
async function succeeds(promise,label){const result=await promise;assert.ok(result.status>=200&&result.status<300,`${label}: ${result.status} ${result.body}`);return result;}
async function denied(promise,label){const result=await promise;assert.ok([400,401,403].includes(result.status),`${label}: expected denial, got ${result.status} ${result.body}`);return result;}
async function activateFreeze(){await succeeds(db('PUT','legacyProvisioningFreeze',freeze(),'emulator-owner'),'activate freeze');}

before(async()=>{await createUser('ordinary');await createUser('admin');});
beforeEach(async()=>{
  await succeeds(db('PUT','',null,'emulator-owner'),'clear');
  await succeeds(db('PATCH','',{admins:{[IDS.admin]:true},users:{Existing:user(IDS.ordinary)},loginDirectory:{Existing:directory()},authIndex:{[IDS.ordinary]:{username:'Existing'}},requests:{req_1700000000000_seed:requestRecord()}},'emulator-owner'),'seed');
});
after(async()=>{await request(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`,'DELETE');});

test('normal legacy account and handle creation works before freeze activation',async()=>{
  await succeeds(db('PATCH','',{'users/BeforeFreeze':user('uid-before'),'loginDirectory/BeforeFreeze':directory()},TOKENS.admin),'pre-freeze create');
});

test('active freeze denies new legacy handle activation and request approval',async()=>{
  await activateFreeze();
  await denied(db('PATCH','',{'users/FrozenCreate':user('uid-frozen'),'loginDirectory/FrozenCreate':directory()},TOKENS.admin),'frozen create');
  await denied(db('PATCH','requests/req_1700000000000_seed',{status:'approved'},TOKENS.admin),'frozen approval');
  await succeeds(db('PATCH','requests/req_1700000000000_seed',{status:'denied'},TOKENS.admin),'frozen denial');
});

test('Admin direct writes cannot bypass the freeze on either namespace path',async()=>{
  await activateFreeze();
  await denied(db('PUT','users/DirectUser',user('uid-direct'),TOKENS.admin),'direct user');
  await denied(db('PUT','loginDirectory/DirectUser',directory(),TOKENS.admin),'direct directory');
});

test('existing login reads and exact existing-handle profile updates remain available',async()=>{
  await activateFreeze();
  await succeeds(db('GET','loginDirectory/Existing',undefined),'public directory read');
  await succeeds(db('GET','users/Existing',undefined,TOKENS.ordinary),'owner user read');
  await succeeds(db('PATCH','users/Existing',{friendCode:'0000 1111 2222'},TOKENS.ordinary),'owner profile update');
});

test('identity-preserving repair is allowed while handle-changing repair and deletion are denied',async()=>{
  await activateFreeze();
  await succeeds(db('PATCH','users/Existing',{authVersion:2,authEmail:'trainer-v2@example.test'},TOKENS.admin),'same handle repair');
  await succeeds(db('PATCH','loginDirectory/Existing',{authVersion:2},TOKENS.admin),'same directory repair');
  await denied(db('PATCH','users/Existing',{authUid:'uid-replacement'},TOKENS.admin),'UID-changing repair');
  await denied(db('PATCH','',{'users/Existing':null,'users/Renamed':user(IDS.ordinary),'loginDirectory/Existing':null,'loginDirectory/Renamed':directory()},TOKENS.admin),'rename repair');
  await denied(db('DELETE','loginDirectory/Existing',undefined,TOKENS.admin),'handle deletion');
});

test('malformed freeze evidence fails closed and an exact released record reopens legacy creation',async()=>{
  await succeeds(db('PUT','legacyProvisioningFreeze',{state:'active'},'emulator-owner'),'malformed freeze');
  await denied(db('PATCH','',{'users/MalformedBlocked':user('uid-malformed'),'loginDirectory/MalformedBlocked':directory()},TOKENS.admin),'malformed blocked');
  await succeeds(db('PUT','legacyProvisioningFreeze',freeze({state:'released',releasedAt:now+1}),'emulator-owner'),'release freeze');
  await succeeds(db('PATCH','',{'users/AfterRelease':user('uid-released'),'loginDirectory/AfterRelease':directory()},TOKENS.admin),'released create');
});

test('same-handle legacy race loses atomically while provider certification may remain eligible',async()=>{
  await activateFreeze();
  const attempts=await Promise.all([
    db('PATCH','',{'users/RaceTrainer':user('uid-race-a'),'loginDirectory/RaceTrainer':directory()},TOKENS.admin),
    db('PATCH','',{'users/RaceTrainer':user('uid-race-b'),'loginDirectory/RaceTrainer':directory()},TOKENS.admin)
  ]);
  assert.equal(attempts.every(result=>[400,401,403].includes(result.status)),true);
  const result=await db('GET','loginDirectory/RaceTrainer');assert.equal(result.body,'null');
});
