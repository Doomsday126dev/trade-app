const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=readFileSync(path.join(__dirname,'..','js/services/googleAuthAdapter.js'),'utf8');

function codedError(code){const error=new Error(code);error.code=code;return error;}
function user(uid='uid-a',providers=['password']){return{uid,providerData:providers.map(providerId=>({providerId,email:'private@example.test'}))};}
function loadAdapter({standalone=false}={}){
  const window={navigator:{standalone},matchMedia:()=>({matches:standalone})};window.window=window;
  vm.runInContext(source,vm.createContext({window,console}),{filename:'googleAuthAdapter.js'});
  return window.PogoServices.googleAuthAdapter;
}
function harness(options={}){
  const domain=loadAdapter(options),calls=[];
  const auth={currentUser:options.signedOut?null:user('uid-a',options.providers||['password'])};
  class GoogleAuthProvider{constructor(){calls.push(['provider']);}}
  const dependencies={
    getAuth:()=>auth,GoogleAuthProvider,
    linkWithPopup:async(target,provider)=>{calls.push(['link',target,provider]);if(options.linkError)throw codedError(options.linkError);const resultUser=options.resultUser||user('uid-a',['password','google.com']);auth.currentUser=Object.hasOwn(options,'currentUserAfter')?options.currentUserAfter:resultUser;return{user:resultUser,credential:{accessToken:'must-not-escape'}};},
    signInWithPopup:async(target,provider)=>{calls.push(['sign-in',target,provider]);if(options.signInError)throw codedError(options.signInError);const resultUser=options.resultUser||user(options.signInUid||'uid-a',['google.com']);auth.currentUser=Object.hasOwn(options,'currentUserAfter')?options.currentUserAfter:resultUser;return{user:resultUser,credential:{accessToken:'must-not-escape'}};},
    reauthenticateWithPopup:async(target,provider)=>{calls.push(['reauth',target,provider]);if(options.reauthError)throw codedError(options.reauthError);return{user:options.resultUser||target,credential:{accessToken:'must-not-escape'}};},
    unlink:async(target,providerId)=>{calls.push(['unlink',target,providerId]);if(options.unlinkError)throw codedError(options.unlinkError);const resultUser=user(target.uid,target.providerData.map(value=>value.providerId).filter(value=>value!==providerId));auth.currentUser=Object.hasOwn(options,'currentUserAfter')?options.currentUserAfter:resultUser;return resultUser;},
    getAdditionalUserInfo:()=>({isNewUser:options.isNewUser===true}),
    onReauthenticated:value=>calls.push(['reauthenticated',value])
  };
  return{domain,auth,calls,adapter:domain.createGoogleAuthAdapter(dependencies)};
}

test('existing-user Connect calls only linkWithPopup on auth.currentUser and preserves UID',async()=>{
  const h=harness(),before=h.auth.currentUser;
  const result=await h.adapter.linkCurrentUser({providerKey:'google'});
  assert.equal(result.uid,'uid-a');assert.equal(result.status,'linked');
  assert.equal(h.calls.filter(([name])=>name==='link').length,1);assert.equal(h.calls.find(([name])=>name==='link')[1],before);
  assert.equal(h.calls.some(([name])=>name==='sign-in'),false);
});

test('already-linked Google account is idempotent and opens no popup',async()=>{
  const h=harness({providers:['password','google.com']}),result=await h.adapter.linkCurrentUser({providerKey:'google'});
  assert.equal(result.status,'already-linked');assert.equal(h.calls.some(([name])=>name==='link'),false);
});

test('signed-out Google login is a distinct signInWithPopup operation with sanitized output',async()=>{
  const h=harness({signedOut:true,isNewUser:true}),result=await h.adapter.signInProvider({providerKey:'google',flow:'popup'});
  assert.deepEqual({...result},{uid:'uid-a',status:'authenticated',providerIds:['google.com'],isNewFirebaseUser:true});
  assert.equal(h.calls.filter(([name])=>name==='sign-in').length,1);assert.equal(h.calls.some(([name])=>name==='link'),false);
  assert.equal(JSON.stringify(result).includes('accessToken'),false);assert.equal(JSON.stringify(result).includes('private@example.test'),false);
});

test('adapter rejects redirect and unsupported providers without invoking Firebase',async()=>{
  const h=harness({signedOut:true});
  await assert.rejects(h.adapter.signInProvider({providerKey:'google',flow:'redirect'}),error=>error.code==='provider-link/redirect-disabled');
  await assert.rejects(h.adapter.signInProvider({providerKey:'discord',flow:'popup'}),error=>error.code==='provider-link/provider-unavailable');
  assert.equal(h.calls.some(([name])=>name==='sign-in'),false);
});

for(const [firebaseCode,safeCode] of[
  ['auth/credential-already-in-use','auth/credential-already-in-use'],
  ['auth/popup-closed-by-user','auth/popup-closed-by-user'],
  ['auth/popup-blocked','auth/popup-blocked'],
  ['auth/network-request-failed','provider-link/network-failed']
])test(`Google error ${firebaseCode} is safely classified without switching accounts`,async()=>{
  const h=harness({linkError:firebaseCode}),before=h.auth.currentUser;
  await assert.rejects(h.adapter.linkCurrentUser({providerKey:'google'}),error=>error.code===safeCode&&!String(error.message).includes('private@example.test'));
  assert.equal(h.auth.currentUser,before);assert.equal(h.calls.some(([name])=>name==='sign-in'),false);
});

test('sign-out or UID replacement during link fails closed',async()=>{
  const signedOut=harness({currentUserAfter:null});
  await assert.rejects(signedOut.adapter.linkCurrentUser({providerKey:'google'}),error=>error.code==='provider-link/uid-changed');
  const switched=harness({currentUserAfter:user('uid-b',['google.com'])});
  await assert.rejects(switched.adapter.linkCurrentUser({providerKey:'google'}),error=>error.code==='provider-link/uid-changed');
});

test('reauthentication and unlink remain bound to Google and the current UID',async()=>{
  const h=harness({providers:['password','google.com']});
  assert.equal((await h.adapter.reauthenticateCurrentUser({methodKey:'google'})).status,'reauthenticated');
  const result=await h.adapter.unlinkCurrentUser({providerKey:'google'});
  assert.equal(result.uid,'uid-a');assert.equal(result.status,'unlinked');assert.deepEqual([...result.providerIds],['password']);
  assert.deepEqual(h.calls.find(([name])=>name==='unlink').slice(2),['google.com']);
});

test('installed-web-app context explicitly remains popup-only',()=>{
  const h=harness({standalone:true});assert.deepEqual({...h.adapter.browserContext()},{standalone:true,popup:true,redirect:false});
});

test('Google implementation requests no extra scopes and contains no secret or token persistence',()=>{
  assert.doesNotMatch(source,/addScope|contacts|drive|calendar|gmail|photos/i);
  assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|clientSecret|refreshToken/);
  assert.doesNotMatch(source,/linkWithRedirect|signInWithRedirect/);
});
