'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const enabled=process.env.DISCORD_FIRESTORE_EMULATOR==='1';
test('pinned Firebase browser persistence converges to one mapped UID after competing tab commits',{skip:!enabled,timeout:60000},async t=>{
 assert.equal(process.env.GCLOUD_PROJECT,'demo-pogo-discord');assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST||'',/^127\.0\.0\.1:\d+$/);
 const root=path.join(__dirname,'..'),local=path.join(root,'.local/firebase-auth-sdk/node_modules'),modules=fs.existsSync(local)?local:path.join(root,'node_modules');
 const imports={};for(const name of['app','auth','util','component','logger']){const pkg=JSON.parse(fs.readFileSync(path.join(modules,'@firebase',name,'package.json')));imports[`@firebase/${name}`]=`/sdk/@firebase/${name}/${pkg.module}`;}
 imports.idb='/sdk/idb/build/index.js';
 assert.equal(JSON.parse(fs.readFileSync(path.join(modules,'@firebase/auth/package.json'))).version,'1.13.2');
 const html=`<!doctype html><script type="importmap">${JSON.stringify({imports})}</script><script src="/gate.js"></script><script type="module">
 import {initializeApp} from '@firebase/app';import * as sdk from '@firebase/auth';
 const app=initializeApp({projectId:'demo-pogo-discord',apiKey:'synthetic-demo-api-key',authDomain:'localhost'},'browser-shared');
 const auth=sdk.initializeAuth(app,{persistence:sdk.indexedDBLocalPersistence});sdk.connectAuthEmulator(auth,'http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}',{disableWarnings:true});await auth.authStateReady();
 const gate=window.PogoDev.providerAuthCommitGate.createProviderAuthCommitGate({auth,beforeAuthStateChanged:sdk.beforeAuthStateChanged,signInWithCustomToken:sdk.signInWithCustomToken,getLifecycle:()=>auth.currentUser?.uid||'signed-out'});await gate.ready();window.fixture={auth,gate};
 </script>`;
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/'){res.setHeader('content-type','text/html');return res.end(html);}
  if(pathname==='/gate.js'){res.setHeader('content-type','text/javascript');return res.end(fs.readFileSync(path.join(root,'js/dev/providerAuthCommitGate.js')));}
  if(!/^\/sdk\/(?:@firebase\/(?:app|auth|util|component|logger)\/dist|idb\/build)\/[a-zA-Z0-9_./-]+\.m?js$/.test(pathname)||pathname.includes('..')){res.statusCode=404;return res.end();}
  try{res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(path.join(modules,pathname.slice(5))));}catch{res.statusCode=404;res.end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const {chromium}=require('@playwright/test'),browser=await chromium.launch({headless:true});t.after(()=>browser.close());const context=await browser.newContext();
 const origin=`http://127.0.0.1:${server.address().port}`;
 await context.route('**/*',route=>{const url=new URL(route.request().url());return url.hostname==='127.0.0.1'?route.continue():route.abort();});
 const pages=[await context.newPage(),await context.newPage()];
 for(const page of pages){await page.goto(origin);await page.waitForFunction(()=>Boolean(window.fixture));}
 const functionRequire=require('node:module').createRequire(path.join(root,'functions/package.json')),apps=functionRequire('firebase-admin/app'),authApi=functionRequire('firebase-admin/auth');
 const admin=apps.initializeApp({projectId:'demo-pogo-discord'},`browser-guard-${Date.now()}`);t.after(()=>apps.deleteApp(admin));
 const uids=['synthetic-browser-a','synthetic-browser-b'],tokens=await Promise.all(uids.map(uid=>authApi.getAuth(admin).createCustomToken(uid)));
 const results=await Promise.all(pages.map((page,index)=>page.evaluate(async({token,uid})=>{
  try{const result=await fixture.gate.commitCustomToken({customToken:token,expectedUid:uid,expectedLifecycle:'signed-out'});return{ok:true,uid:result.user.uid};}catch(error){return{ok:false,code:error.code};}
 },{token:tokens[index],uid:uids[index]})));
 assert.equal(results.filter(row=>row.ok).length,1);assert.equal(results.find(row=>!row.ok).code,'provider-auth/session-changed');const winner=results.find(row=>row.ok).uid;
 for(const page of pages){await page.waitForFunction(uid=>fixture.auth.currentUser?.uid===uid,winner);assert.equal(await page.evaluate(()=>fixture.auth.currentUser.uid),winner);}
 const loser=pages[results.findIndex(row=>!row.ok)];await loser.reload();await loser.waitForFunction(()=>Boolean(window.fixture));assert.equal(await loser.evaluate(()=>fixture.auth.currentUser.uid),winner);
});
