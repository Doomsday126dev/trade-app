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
  await sdk.signOut(auth);
  // Exercise the actual custom-token bridge, not an email sign-in substitute.
  const functionRequire=require('node:module').createRequire(path.join(__dirname,'../functions/package.json'));
  const adminAppApi=functionRequire('firebase-admin/app'),adminAuthApi=functionRequire('firebase-admin/auth');
  const adminApp=adminAppApi.initializeApp({projectId:'demo-pogo-discord'},`discord-custom-${suffix}`);t.after(()=>adminAppApi.deleteApp(adminApp));
  const customToken=await adminAuthApi.getAuth(adminApp).createCustomToken(a.user.uid);
  const direct=window.PogoDev.providerAuthCommitGate.createProviderAuthCommitGate({auth,locks,beforeAuthStateChanged:sdk.beforeAuthStateChanged,getLifecycle:()=>lifecycle,signInWithCustomToken:sdk.signInWithCustomToken});
  const customResult=await direct.commitCustomToken({customToken,expectedUid:a.user.uid,expectedLifecycle:lifecycle});
  assert.equal(customResult.user.uid,a.user.uid);assert.equal(auth.currentUser.uid,a.user.uid);
  assert.equal((await customResult.user.getIdTokenResult()).signInProvider,'custom');
  assert.ok(customResult.user.providerData.some(provider=>provider.providerId==='password'));
  direct.dispose();
  await sdk.signOut(auth);
  let active=true,cancelEntered,cancelRelease;const cancelReady=new Promise(resolve=>{cancelEntered=resolve;}),cancelHeld=new Promise(resolve=>{cancelRelease=resolve;});
  const canceledGate=window.PogoDev.providerAuthCommitGate.createProviderAuthCommitGate({auth,locks,beforeAuthStateChanged:sdk.beforeAuthStateChanged,getLifecycle:()=>lifecycle,
    signInWithCustomToken:async(a,token)=>{cancelEntered();await cancelHeld;return sdk.signInWithCustomToken(a,token);}});
  const secondToken=await adminAuthApi.getAuth(adminApp).createCustomToken(a.user.uid);
  const canceled=canceledGate.commitCustomToken({customToken:secondToken,expectedUid:a.user.uid,expectedLifecycle:lifecycle,isCurrent:()=>active});
  await cancelReady;active=false;cancelRelease();await assert.rejects(canceled,{code:'provider-auth/canceled'});assert.equal(auth.currentUser,null);canceledGate.dispose();
  let lateEntered,lateRelease,removeLater;
  const lateReady=new Promise(resolve=>{lateEntered=resolve;}),lateHeld=new Promise(resolve=>{lateRelease=resolve;});
  const binding=`v1_${'b'.repeat(64)}`;
  const lateGate=window.PogoDev.providerAuthCommitGate.createProviderAuthCommitGate({auth,locks,beforeAuthStateChanged:sdk.beforeAuthStateChanged,getLifecycle:()=>binding,
    signInWithCustomToken:async(a,token)=>{
      removeLater=sdk.beforeAuthStateChanged(a,async()=>{lateEntered();await lateHeld;});
      return sdk.signInWithCustomToken(a,token);
    }});
  const lateToken=await adminAuthApi.getAuth(adminApp).createCustomToken(a.user.uid);
  const origin='https://doomsday126dev.github.io',callback=`${origin}/trade-app/auth/discord.html`,state='s'.repeat(43),statuses=[];
  const capturedAt=Date.now(),continuation={operation:'sign-in',requestId:`discord-${'r'.repeat(43)}`,ownerBinding:'',lifecycleBinding:binding,state,issuedAt:capturedAt,expiresAt:capturedAt+300000,browserBinding:'b'.repeat(43)};
  const storage=new Map([['pogo.discord.prototype.request',JSON.stringify(continuation)]]);
  window.btoa=btoa;window.AbortController=AbortController;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/dev/discordOAuthPrototypeClient.js'),'utf8'),{window,Object,Error,String,TypeError,URL,Uint8Array,Date,JSON,Number,Set});
  const client=window.PogoDev.discordOAuthPrototypeClient.createDiscordOAuthPrototypeClient({candidateMode:true,callbackUri:callback,
    cryptoApi:require('node:crypto').webcrypto,fetchImpl:async()=>{throw Error('direct network forbidden');},
    location:{href:callback},history:{replaceState(){}},storage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    getSessionBinding:()=>({ownerBinding:auth.currentUser?`v1_${'a'.repeat(64)}`:'',lifecycleBinding:binding}),onStatus:value=>statuses.push(value.status),
    requestTransport:async()=>({ok:true,operation:'sign-in',status:'existing-account',uid:a.user.uid,customToken:lateToken}),
    signInWithCustomToken:(customToken,context)=>lateGate.commitCustomToken({customToken,...context})});
  const late=client.completeFromLocation(`${callback}?code=synthetic-late-code&state=${state}&iss=https%3A%2F%2Fdiscord.com`);
  await lateReady;
  assert.equal(client.getState().status,'committing');assert.equal(client.cancel().canCancel,false);
  lateRelease();assert.equal((await late).status,'existing-account');assert.equal(auth.currentUser?.uid,a.user.uid);
  assert.ok(statuses.includes('committing'));assert.equal(client.getState().status,'idle');
  removeLater();lateGate.dispose();
  await sdk.signOut(auth);
  const secondApp=appSdk.initializeApp({projectId:'demo-pogo-discord',apiKey:'synthetic-demo-api-key',authDomain:'localhost'},`discord-second-${suffix}`);
  t.after(()=>appSdk.deleteApp(secondApp));
  const secondAuth=sdk.initializeAuth(secondApp,{persistence:sdk.inMemoryPersistence});sdk.connectAuthEmulator(secondAuth,`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,{disableWarnings:true});await secondAuth.authStateReady();
  let checkpoint={revision:0,uid:null,status:'settled'};
  const coordination={read:async()=>({...checkpoint}),write:async value=>{checkpoint={...value};}};
  const gates=[auth,secondAuth].map(instance=>window.PogoDev.providerAuthCommitGate.createProviderAuthCommitGate({auth:instance,locks,coordination,beforeAuthStateChanged:sdk.beforeAuthStateChanged,getLifecycle:()=>instance.currentUser?.uid||'signed-out',signInWithCustomToken:sdk.signInWithCustomToken}));
  await Promise.all(gates.map(gate=>gate.ready()));
  const tokens=await Promise.all([a.user.uid,b.user.uid].map(uid=>adminAuthApi.getAuth(adminApp).createCustomToken(uid)));
  const competing=await Promise.allSettled(gates.map((gate,index)=>gate.commitCustomToken({customToken:tokens[index],expectedUid:[a.user.uid,b.user.uid][index],expectedLifecycle:'signed-out'})));
  assert.equal(competing.filter(value=>value.status==='fulfilled').length,1);
  assert.equal(competing.find(value=>value.status==='rejected').reason.code,'provider-auth/session-changed');
  assert.equal([auth,secondAuth].filter(instance=>instance.currentUser).length,1);gates.forEach(gate=>gate.dispose());

});
