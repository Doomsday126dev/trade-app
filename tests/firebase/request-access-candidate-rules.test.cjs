const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');

const PROJECT_ID='demo-pogo-request-access-candidate';
const DATABASE_HOST=process.env.FIREBASE_DATABASE_EMULATOR_HOST||'127.0.0.1:9600';
const AUTH_HOST=process.env.FIREBASE_AUTH_EMULATOR_HOST||'127.0.0.1:9699';
const NAMESPACE=`${PROJECT_ID}-default-rtdb`;
const TOKENS={};
const IDS={};
const now=1700000000000;
const valid=(overrides={})=>({username:'Trainer Name',note:'local group',requestedAt:now,status:'pending',...overrides});

async function request(url,method='GET',value,headers={}){
  const response=await fetch(url,{method,headers:{...(value===undefined?{}:{'content-type':'application/json'}),...headers},body:value===undefined?undefined:JSON.stringify(value)});
  return{status:response.status,body:await response.text()};
}
async function createUser(name){
  const response=await request(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,'POST',{email:`${name}@example.test`,password:`${name}-password-123`,returnSecureToken:true});
  assert.equal(response.status,200,response.body);
  const body=JSON.parse(response.body);TOKENS[name]=body.idToken;IDS[name]=body.localId;
}
function url(target='',token){
  const clean=String(target).replace(/^\/+|\/+$/g,'');
  const result=new URL(`http://${DATABASE_HOST}/${clean?`${clean}.json`:'.json'}`);
  result.searchParams.set('ns',NAMESPACE);if(token)result.searchParams.set('auth',token);return result;
}
function db(method,target,value,actor){
  const owner=actor==='emulator-owner';
  return request(url(target,owner?undefined:actor),method,value,owner?{authorization:'Bearer owner'}:{});
}
async function succeeds(promise,label){const result=await promise;assert.ok(result.status>=200&&result.status<300,`${label}: ${result.status} ${result.body}`);return result;}
async function denied(promise,label){const result=await promise;assert.ok([400,401,403].includes(result.status),`${label}: expected denial, got ${result.status} ${result.body}`);return result;}

before(async()=>{await createUser('ordinary');await createUser('admin');});
beforeEach(async()=>{
  await succeeds(db('PUT','',null,'emulator-owner'),'clear');
  await succeeds(db('PUT','admins',{[IDS.admin]:true},'emulator-owner'),'seed admin');
  await succeeds(db('PUT','requests/req_1699999999999_seed',valid({username:'Existing',note:''}),'emulator-owner'),'seed request');
});
after(async()=>{await request(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`,'DELETE');});

test('valid anonymous create accepts the exact canonical four-field payload',async()=>{
  await succeeds(db('PUT',`requests/req_${now}_abc12`,valid()),'anonymous create');
});
test('anonymous create rejects missing empty whitespace short and wrong-type usernames',async()=>{
  const cases=[
    ['missing',(({username,...rest})=>rest)(valid())],
    ['empty',valid({username:''})],['whitespace',valid({username:'   '})],['short',valid({username:'A'})],['type',valid({username:42})]
  ];
  for(const [name,payload] of cases)await denied(db('PUT',`requests/req_${now}_${name.slice(0,5)}`,payload),name);
});

test('username permits Unicode and internal spaces but rejects boundary whitespace and controls',async()=>{
  await succeeds(db('PUT',`requests/req_${now}_u1`,valid({username:'ポケモン'})),'unicode');
  await succeeds(db('PUT',`requests/req_${now}_u2`,valid({username:'A B'})),'internal space');
  for(const [suffix,username] of [['w1',' AB'],['w2','AB '],['c1','AB\nCD'],['c2','AB\u0000CD']])await denied(db('PUT',`requests/req_${now}_${suffix}`,valid({username})),suffix);
});

test('note is a required string that may be empty or Unicode but not whitespace-only multiline controls or objects',async()=>{
  await succeeds(db('PUT',`requests/req_${now}_n1`,valid({note:''})),'empty note');
  await succeeds(db('PUT',`requests/req_${now}_n2`,valid({note:'日本語'})),'unicode note');
  const {note,...missing}=valid();
  for(const [suffix,payload] of [['n3',missing],['n4',valid({note:'   '})],['n5',valid({note:'one\ntwo'})],['n6',valid({note:{nested:true}})]])await denied(db('PUT',`requests/req_${now}_${suffix}`,payload),suffix);
});

test('requestedAt requires a non-negative integer but deliberately leaves skew unresolved',async()=>{
  for(const [suffix,value] of [['t1','123'],['t2',1.5],['t3',-1]])await denied(db('PUT',`requests/req_${now}_${suffix}`,valid({requestedAt:value})),suffix);
  await succeeds(db('PUT',`requests/req_${now}_t4`,valid({requestedAt:1})),'far past retained pending evidence');
  await succeeds(db('PUT',`requests/req_${now}_t5`,valid({requestedAt:now+315360000000})),'far future retained pending evidence');
});

test('anonymous creation requires pending status and the exact child set',async()=>{
  const {status,...missingStatus}=valid();
  for(const [suffix,payload] of [
    ['s1',missingStatus],['s2',valid({status:'approved'})],['s3',valid({status:'denied'})],
    ['s4',{...valid(),admin:true}],['s5',{...valid(),nested:{admin:true}}]
  ])await denied(db('PUT',`requests/req_${now}_${suffix}`,payload),suffix);
});

test('request keys accept only the generated prefix timestamp and one-to-five lowercase base36 suffix',async()=>{
  for(const key of [`req_${now}_a`,`req_${now}_abc12`])await succeeds(db('PUT',`requests/${key}`,valid()),key);
  for(const key of [`wrong_${now}_a`,`req_${now}_`,`req_${now}_abcdef`,`req_${now}_ABC`,`req_${now}_a-`,'random'])await denied(db('PUT',`requests/${key}`,valid()),key);
  await denied(db('PUT',`requests/${encodeURIComponent(`req_${now}_a.b`)}`,valid()),'invalid RTDB key character');
});

test('anonymous and authenticated non-admin actors cannot overwrite update delete or transition existing requests',async()=>{
  const path='requests/req_1699999999999_seed';
  for(const actor of [undefined,TOKENS.ordinary]){
    await denied(db('PUT',path,valid({username:'Changed'}),actor),'overwrite');
    await denied(db('PATCH',path,{note:'changed'},actor),'note update');
    await denied(db('PATCH',path,{status:'approved'},actor),'status update');
    await denied(db('DELETE',path,undefined,actor),'delete');
  }
  await denied(db('PUT',`requests/req_${now}_auth1`,valid(),TOKENS.ordinary),'authenticated create');
});

test('Admin and owner-equivalent index members may approve deny or delete but not rewrite immutable fields',async()=>{
  const approve='requests/req_1699999999999_seed';
  await succeeds(db('PATCH',approve,{status:'approved'},TOKENS.admin),'approve');
  await succeeds(db('PUT','requests/req_1699999999998_deny1',valid({username:'Deny Me',note:''}),'emulator-owner'),'seed denial');
  await succeeds(db('PATCH','requests/req_1699999999998_deny1',{status:'denied'},TOKENS.admin),'deny');
  await succeeds(db('PUT','requests/req_1699999999997_del1',valid({username:'Delete Me',note:''}),'emulator-owner'),'seed delete');
  await succeeds(db('DELETE','requests/req_1699999999997_del1',undefined,TOKENS.admin),'delete');
  await succeeds(db('PUT','requests/req_1699999999996_edit1',valid({username:'Immutable',note:''}),'emulator-owner'),'seed immutable');
  await denied(db('PATCH','requests/req_1699999999996_edit1',{username:'Changed',status:'approved'},TOKENS.admin),'username immutable');
  await denied(db('PATCH','requests/req_1699999999996_edit1',{note:'Changed',status:'approved'},TOKENS.admin),'note immutable');
  await denied(db('PATCH','requests/req_1699999999996_edit1',{requestedAt:now+1,status:'approved'},TOKENS.admin),'timestamp immutable');
});

test('anonymous and ordinary actors cannot read requests while Admin can read the reviewed collection',async()=>{
  await denied(db('GET','requests',undefined),'anonymous read');
  await denied(db('GET','requests',undefined,TOKENS.ordinary),'ordinary read');
  await succeeds(db('GET','requests',undefined,TOKENS.admin),'admin read');
});

test('large payload stress remains accepted because final production bounds require historical evidence',async()=>{
  await succeeds(db('PUT',`requests/req_${now}_big1`,valid({username:'U'.repeat(5000),note:'N'.repeat(20000)})),'large pending compatibility payload');
});
