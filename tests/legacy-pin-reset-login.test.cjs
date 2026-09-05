const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),acorn=require('acorn');
const source=fs.readFileSync(path.join(__dirname,'../js/app/application.js'),'utf8');
const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'script'});
function extract(name){const node=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(node);return source.slice(node.start,node.end);}
test('unchanged cached legacy PIN hash cannot bypass Firebase credential validation for a bound account',async()=>{
  let calls=0,created=0;
  const context=vm.createContext({auth:{currentUser:{uid:'existing-uid'}},authVersionForUser:()=>1,authEmail:()=> 'trainer@pogotrades.nyc',withTimeout:p=>p,
    signInWithEmailAndPassword:async()=>{calls++;throw Object.assign(new Error('Wrong PIN'),{code:'auth/invalid-credential'});},
    createUserWithEmailAndPassword:async()=>{created++;}});
  vm.runInContext(extract('ensureFirebaseIdentity'),context);
  await assert.rejects(context.ensureFirebaseIdentity('Trainer','123456',{authUid:'existing-uid',pin:'cached-old-hash',pinHashed:true}));
  assert.equal(calls,1);assert.equal(created,0);
});
test('normal ready-directory login uses Firebase success instead of the stale legacy hash and never unlocks on a hash alone',()=>{
  const login=extract('doLogin');
  assert.match(login,/const ok=ident\?true:await verifyPin\(p,ud\.pin\)/);
  assert.ok(login.indexOf('if(!ident?.uid)')<login.indexOf('activateOwnedSession(ident.uid,u)'));
  assert.ok(login.indexOf("err.textContent='❌ Wrong PIN'")<login.indexOf('await verifyPin'));
  assert.match(source,/async function ensureFirebaseIdentity/);
});
