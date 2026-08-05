const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
const tool=require('../scripts/reset-existing-auth-pin.cjs');

const USERNAME='SyntheticTrainer';
const UID='synthetic-uid-1';
const EMAIL='synthetictrainer@invalid.example';
const PIN='654321';
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value))}
function fixture(){return{
  users:{[USERNAME]:{authUid:UID,authEmail:EMAIL,authVersion:1,pin:'old-hash',pinHashed:true,joined:10,lastSeen:20,bio:'kept'}},
  authIndex:{[UID]:{username:USERNAME,lastSeen:20,extra:'kept'}},loginDirectory:{[USERNAME]:{authReady:true,authVersion:1,approvedAt:10}},
  wishlist:{[USERNAME]:{one:{p:'H'},two:{p:'L'}}},publicShares:{[USERNAME]:{profile:{bio:'kept'},lists:{wishlist:{one:{p:'H'}}}}},
  userCommunities:{[UID]:{nyc:{role:'member',username:USERNAME,joinedAt:10}}},
  communities:{nyc:{memberUsernames:{[USERNAME]:true},members:{[UID]:true},admins:{}}},
  authUsers:{[UID]:{uid:UID,email:EMAIL,disabled:false,password:'old-password'}}
}}
function report(){
  const dir=path.join(process.cwd(),'.local/uid-handle-audits/tests');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,`pin-reset-${crypto.randomUUID()}.json`);
  fs.writeFileSync(file,JSON.stringify({records:[{trainerName:USERNAME,uid:UID,classification:'ready_for_mapping',reasonCodes:[]}]}),{mode:0o600});
  return file;
}
function options(extra={}){return{username:USERNAME,projectId:'demo-project',databaseId:'demo-project-default-rtdb',databaseUrl:'https://demo-project-default-rtdb.firebaseio.com/',confirmProject:'demo-project',confirmDatabase:'demo-project-default-rtdb',pinEnv:'TEST_RESET_PIN',identityReport:report(),...extra}}
function adapter(data=fixture(),fail={}){
  const writes=[];
  const getPath=target=>target.split('/').reduce((value,key)=>value?.[key],data);
  return{data,writes,
    read:async target=>clone(getPath(target)),getAuthUser:async uid=>clone(data.authUsers[uid]),
    findAuthUsersByEmails:async emails=>clone(Object.values(data.authUsers).filter(user=>emails.includes(user.email))),
    updateAuthPassword:async(uid,password)=>{if(fail.auth)throw new Error('auth failed');writes.push({type:'auth-password',uid});data.authUsers[uid].password=password;},
    updateAppPin:async(username,pin)=>{if(fail.app)throw new Error('app failed');writes.push({type:'app-pin',username,fields:['pin','pinHashed']});data.users[username].pin=pin;data.users[username].pinHashed=true;}
  };
}
const env={TEST_RESET_PIN:PIN};

test('app PIN hash exactly matches the deployed SHA-256 salt contract',()=>assert.equal(tool.hashPin(PIN),crypto.createHash('sha256').update(`${PIN}pogo_salt_nyc`).digest('hex')));
test('dry-run performs exact reads and no writes without accepting a PIN',async()=>{const fake=adapter();const result=await tool.executeReset({adapter:fake,options:options(),env:{}});assert.equal(result.status,'dry-run-ready');assert.equal(fake.writes.length,0)});
test('apply updates the established UID password and only app PIN fields',async()=>{const fake=adapter();const before=clone(fake.data);const result=await tool.executeReset({adapter:fake,options:options({apply:true}),env});assert.equal(result.status,'applied-and-verified');assert.deepEqual(fake.writes.map(write=>write.type),['auth-password','app-pin']);assert.equal(fake.data.users[USERNAME].authUid,UID);assert.equal(fake.data.users[USERNAME].authEmail,EMAIL);assert.equal(fake.data.users[USERNAME].authVersion,1);assert.equal(fake.data.users[USERNAME].pinHashed,true);for(const key of ['authIndex','communities','userCommunities','wishlist','publicShares'])assert.deepEqual(fake.data[key],before[key])});
test('a second exact synthetic Auth identity aborts before writes',async()=>{const fake=adapter();fake.data.authUsers.other={uid:'synthetic-uid-2',email:tool.syntheticAuthEmail(USERNAME,2),disabled:false};await assert.rejects(tool.executeReset({adapter:fake,options:options(),env}),{code:'reset/duplicate-identity'});assert.equal(fake.writes.length,0)});
test('user UID mismatch aborts before writes',async()=>{const fake=adapter();fake.data.users[USERNAME].authUid='wrong';await assert.rejects(tool.executeReset({adapter:fake,options:options(),env}),{code:'reset/auth-index-mismatch'});assert.equal(fake.writes.length,0)});
test('authIndex username mismatch aborts before writes',async()=>{const fake=adapter();fake.data.authIndex[UID].username='Other';await assert.rejects(tool.executeReset({adapter:fake,options:options(),env}),{code:'reset/auth-index-mismatch'});assert.equal(fake.writes.length,0)});
test('Firebase Auth UID and email mismatches abort before writes',async()=>{for(const mutate of [data=>data.authUsers[UID].uid='wrong',data=>data.authUsers[UID].email='wrong@example.invalid']){const fake=adapter();mutate(fake.data);await assert.rejects(tool.executeReset({adapter:fake,options:options(),env}));assert.equal(fake.writes.length,0)}});
test('disabled Auth account aborts before writes',async()=>{const fake=adapter();fake.data.authUsers[UID].disabled=true;await assert.rejects(tool.executeReset({adapter:fake,options:options(),env}),{code:'reset/auth-disabled'});assert.equal(fake.writes.length,0)});
test('missing required list, share, or membership baselines abort before writes',async()=>{for(const mutate of [data=>delete data.wishlist[USERNAME],data=>delete data.publicShares[USERNAME],data=>delete data.userCommunities[UID]]){const fake=adapter();mutate(fake.data);await assert.rejects(tool.executeReset({adapter:fake,options:options(),env}));assert.equal(fake.writes.length,0)}});
test('duplicate identity evidence aborts before writes',async()=>{const fake=adapter();const file=options().identityReport;fs.writeFileSync(file,JSON.stringify({records:[{trainerName:USERNAME,uid:UID,classification:'duplicate_or_conflicting',reasonCodes:['duplicate_auth_identity']}]}));await assert.rejects(tool.executeReset({adapter:fake,options:options({identityReport:file}),env}),{code:'reset/duplicate-identity'});assert.equal(fake.writes.length,0)});
test('partial failure is explicit and never triggers identity reconciliation',async()=>{const fake=adapter(fixture(),{app:true});await assert.rejects(tool.executeReset({adapter:fake,options:options({apply:true}),env}),{code:'reset/partial-auth-updated-app-pin-failed'});assert.deepEqual(fake.writes.map(write=>write.type),['auth-password'])});
test('target, secret, and private hashes are redacted from structured output',async()=>{const fake=adapter();const emitted=[];await tool.executeReset({adapter:fake,options:options(),env,emit:value=>emitted.push(JSON.stringify(value))});assert.equal(emitted.length,1);assert.doesNotMatch(emitted[0],new RegExp(USERNAME));assert.doesNotMatch(emitted[0],new RegExp(UID));assert.doesNotMatch(emitted[0],new RegExp(PIN));assert.doesNotMatch(emitted[0],/[a-f0-9]{64}/);assert.doesNotMatch(emitted[0],/reportHash/);assert.match(emitted[0],/\[redacted\]/)});
test('CLI accepts exactly one username and requires an explicit apply flag and PIN',()=>{assert.throws(()=>tool.parseArgs(['--username',USERNAME,'--username','Other']),{code:'reset/unsupported-option'});assert.throws(()=>tool.validateOptions(options({username:`${USERNAME},Other`}),env),{code:'reset/invalid-username'});assert.equal(tool.parseArgs(['--username',USERNAME]).apply,false);assert.doesNotThrow(()=>tool.validateOptions(options(),{}));assert.throws(()=>tool.validateOptions(options({apply:true}),{}),{code:'reset/invalid-pin'})});
test('Firebase-forbidden usernames and nonexact database targets fail closed',()=>{for(const username of ['Bad.Name','Bad#Name','Bad$Name','Bad[Name]','Bad/Name'])assert.throws(()=>tool.validateOptions(options({username}),env),{code:'reset/invalid-username'});assert.throws(()=>tool.validateOptions(options({databaseUrl:'https://demo-project-default-rtdb.evil.firebaseio.com/'}),env),{code:'reset/database-target-mismatch'})});
test('identity reports must be private regular files inside the ignored root',()=>{const fake=adapter();const file=options().identityReport;fs.chmodSync(file,0o644);assert.throws(()=>tool.readIdentityGate(file,USERNAME,UID),{code:'reset/insecure-identity-report'});assert.equal(fake.writes.length,0)});
test('production adapter exposes no create, list, delete-user, or bulk mutation method',()=>{const source=fs.readFileSync(path.join(__dirname,'../scripts/reset-existing-auth-pin.cjs'),'utf8');assert.doesNotMatch(source,/\.createUser\(|\.listUsers\(|\.deleteUser\(|auth:\s*import|update\(\s*\{[^}]*users\//s);assert.match(source,/auth\.updateUser\(uid,\{password\}\)/);assert.match(source,/database\.ref\(`users\/\$\{username\}`\)\.update\(\{pin,pinHashed:true\}\)/)});
