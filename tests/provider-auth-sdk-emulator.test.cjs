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

  // A completed SDK operation with a failed final ledger write can be reviewed
  // after recreating the gate, but only with fresh server-verified ID-token proof.
  await sdk.signOut(auth);window.crypto=require('node:crypto').webcrypto;
  let recoveryCheckpoint={revision:0,uid:null,status:'settled'},failSettle=true;
  const outcomes=new Map(),recoveryCoordination={read:async()=>({...recoveryCheckpoint}),write:async value=>{if(failSettle&&value.status==='settled')throw Error('synthetic settled-write failure');recoveryCheckpoint={...value};},readOutcome:async id=>outcomes.get(id),writeOutcome:async value=>outcomes.set(value.operationId,value)};
  const createRecoveryGate=()=>window.PogoDev.providerAuthCommitGate.createProviderAuthCommitGate({auth,locks,coordination:recoveryCoordination,beforeAuthStateChanged:sdk.beforeAuthStateChanged,getLifecycle:()=>auth.currentUser?.uid||'signed-out',signInWithCustomToken:sdk.signInWithCustomToken,
    verifyCurrentAuth:async({user,expectedUid})=>{const decoded=await adminAuthApi.getAuth(adminApp).verifyIdToken(await user.getIdToken(true),true);return{uid:decoded.uid,verified:decoded.uid===expectedUid};}});
  const interruptedGate=createRecoveryGate(),recoveryToken=await adminAuthApi.getAuth(adminApp).createCustomToken(a.user.uid);
  const interrupted=await interruptedGate.commitCustomToken({customToken:recoveryToken,expectedUid:a.user.uid,expectedLifecycle:'signed-out'});
  assert.equal(interrupted.authCoordinationBlocked,true);assert.equal(auth.currentUser.uid,a.user.uid);interruptedGate.dispose();failSettle=false;
  const reloadedGate=createRecoveryGate(),review=await reloadedGate.prepareReconciliation();
  await assert.rejects(reloadedGate.confirmReconciliation(review),{code:'provider-auth/explicit-review-required'});
  assert.equal((await reloadedGate.confirmReconciliation(review,{accepted:true})).status,'reconciled');
  assert.equal(auth.currentUser.uid,a.user.uid);await reloadedGate.assertSession();reloadedGate.dispose();

});

test('actual host candidate wires fresh Firebase verification and explicitly reconciles completed sign-in and sign-out',{skip:!enabled},async t=>{
 const local=path.join(__dirname,'../.local/firebase-auth-sdk/node_modules'),modules=fs.existsSync(local)?local:null,appSdk=require(modules?path.join(modules,'@firebase/app'):'@firebase/app'),sdk=require(modules?path.join(modules,'@firebase/auth'):'@firebase/auth');
 const app=appSdk.initializeApp({projectId:'demo-pogo-discord',apiKey:'synthetic-demo-api-key',authDomain:'localhost'},`checkpoint-host-${Date.now()}`),auth=sdk.initializeAuth(app,{persistence:sdk.inMemoryPersistence});sdk.connectAuthEmulator(auth,`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,{disableWarnings:true});t.after(()=>appSdk.deleteApp(app));await auth.authStateReady();
 const email=`host-checkpoint-${Date.now()}@example.test`,password='synthetic-emulator-password',created=await sdk.createUserWithEmailAndPassword(auth,email,password);await sdk.signOut(auth);
 const w={crypto:require('node:crypto').webcrypto,AbortController,setTimeout,clearTimeout,fetch,__POGO_PROVIDER_AUTH_GATE_CANARY__:true,__POGO_PROVIDER_AUTH_GATE_CANARY_UID__:created.user.uid,dispatchEvent:()=>{}};const context=vm.createContext({window:w,Object,Error,TypeError,String,Number,Date,JSON,Promise,CustomEvent:function(){},toast:()=>{}});
 for(const file of ['providerAuthCommitGate','providerHostAuthGate','providerCheckpointRecovery'])vm.runInContext(fs.readFileSync(path.join(__dirname,`../js/dev/${file}.js`),'utf8'),context);
 let checkpoint={revision:0,uid:null,status:'settled'},broken=true,tail=Promise.resolve();const outcomes=new Map(),coordination={read:async()=>structuredClone(checkpoint),write:async value=>{if(broken&&value.status==='settled')throw Error('synthetic final write failure');checkpoint=structuredClone(value);},readOutcome:async id=>outcomes.get(id),writeOutcome:async value=>outcomes.set(value.operationId,structuredClone(value))};
 // Only persistence/locking are fixture dependencies. The actual application
 // installer supplies the real verifier; its getIdTokenResult + lookup are live
 // requests to the local Auth emulator, with no injected acceptance predicate.
 const original=w.PogoDev.providerHostAuthGate.install;w.PogoDev.providerHostAuthGate={install:options=>original({...options,coordination,locks:{request:(_name,_options,work)=>{const task=tail.then(work);tail=task.catch(()=>{});return task;}}})};
 const source=fs.readFileSync(path.join(__dirname,'../js/app/application.js'),'utf8'),ast=require('acorn').parse(source,{ecmaVersion:'latest'}),node=ast.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='installProviderHostAuthGateCandidate');assert.ok(node);vm.runInContext(source.slice(node.start,node.end),context);
 const wrapped=context.installProviderHostAuthGateCandidate({auth,app,authMod:sdk}),host=w.__pogoProviderHostAuthGate,result=await wrapped.signInWithEmailAndPassword(auth,email,password);assert.equal(result.authCoordinationBlocked,true);assert.equal(checkpoint.status,'pending');broken=false;
 const ticket=await host.prepareCheckpointRecovery();assert.equal(ticket.uid,created.user.uid);await assert.rejects(host.confirmCheckpointRecovery(ticket),{code:'provider-auth/explicit-review-required'});await host.confirmCheckpointRecovery(ticket,{accepted:true});assert.equal(checkpoint.status,'settled');assert.equal(auth.currentUser.uid,created.user.uid);
 broken=true;assert.equal((await wrapped.signOut(auth)).authCoordinationBlocked,true);assert.equal(auth.currentUser,null);broken=false;const signedOut=await host.prepareCheckpointRecovery();assert.equal(signedOut.uid,'');await host.confirmCheckpointRecovery(signedOut,{accepted:true});assert.equal(checkpoint.status,'settled');assert.equal(checkpoint.uid,'');
});
