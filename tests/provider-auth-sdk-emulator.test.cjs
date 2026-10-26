'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const enabled=process.env.DISCORD_FIRESTORE_EMULATOR==='1';
test('Firebase 12.14.0 blocking hook rejects wrong-UID sign-in and permits only exact mapped UID',{skip:!enabled},async t=>{
  assert.equal(process.env.GCLOUD_PROJECT,'demo-pogo-discord');assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST||'',/^127\.0\.0\.1:\d+$/);
  const local=path.join(__dirname,'../.local/firebase-auth-sdk/node_modules'),moduleRoot=fs.existsSync(local)?local:null;
  const appSdk=require(moduleRoot?path.join(moduleRoot,'@firebase/app'):'@firebase/app'),sdk=require(moduleRoot?path.join(moduleRoot,'@firebase/auth'):'@firebase/auth');
  const app=appSdk.initializeApp({projectId:'demo-pogo-discord',apiKey:'synthetic-demo-api-key',authDomain:'localhost'},`discord-sdk-${Date.now()}`);
  const auth=sdk.initializeAuth(app,{persistence:sdk.inMemoryPersistence});sdk.connectAuthEmulator(auth,`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,{disableWarnings:true});
  t.after(()=>appSdk.deleteApp(app));await auth.authStateReady();
  const suffix=Date.now(),password='synthetic-emulator-only-password';
  const a=await sdk.createUserWithEmailAndPassword(auth,`guard-a-${suffix}@example.test`,password);await sdk.signOut(auth);
  const b=await sdk.createUserWithEmailAndPassword(auth,`guard-b-${suffix}@example.test`,password);await sdk.signOut(auth);
  let lifecycle='signed-out';const unsubscribe=sdk.onAuthStateChanged(auth,user=>{lifecycle=user?`signed-in-${user.uid}`:'signed-out';});t.after(unsubscribe);
  const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/dev/providerAuthCommitGate.js'),'utf8'),{window,Object,Error,String,TypeError});
  let tail=Promise.resolve();const locks={request(name,options,work){const next=tail.then(work);tail=next.catch(()=>{});return next;}};
  const gate=window.PogoDev.providerAuthCommitGate.createProviderAuthCommitGate({auth,locks,beforeAuthStateChanged:sdk.beforeAuthStateChanged,getLifecycle:()=>lifecycle,
    signInWithCustomToken:()=>sdk.signInWithEmailAndPassword(auth,a.user.email,password)});
  let entered,release;const ready=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});
  const pending=gate.run({kind:'sign-in',expectedUid:a.user.uid,expectedLifecycle:lifecycle},async()=>{entered();await held;return sdk.signInWithEmailAndPassword(auth,a.user.email,password);});
  await ready;await assert.rejects(sdk.signInWithEmailAndPassword(auth,b.user.email,password));assert.equal(auth.currentUser,null);
  release();const result=await pending;assert.equal(result.user.uid,a.user.uid);assert.equal(auth.currentUser.uid,a.user.uid);
  gate.dispose();
});
