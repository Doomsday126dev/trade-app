const {test,expect}=require('@playwright/test');
test.beforeEach(async({page})=>{
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:8886/')?route.continue():route.abort());
  await page.goto('/tests/fixtures/provider-migration-preview.html');
});
test('notice is nonmodal, keyboard accessible, and dismisses across reload',async({page})=>{
  const notice=page.getByRole('region',{name:'Keep access to this trainer account'});
  await expect(notice).toBeVisible();
  await page.screenshot({path:`.local/provider-migration/${test.info().project.name}-reminder.png`,fullPage:true});await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Review Google sign-in'})).toBeVisible();
  await page.getByRole('button',{name:'Remind me in 30 days'}).focus();await page.keyboard.press('Enter');
  await expect(notice).toHaveCount(0);await page.reload();await expect(notice).toHaveCount(0);
  expect(await page.evaluate(()=>preview.confirms)).toBe(0);
});
test('Discord review can cancel a wrong identity before any linking',async({page})=>{
  await page.getByRole('button',{name:'Review Discord sign-in'}).click();
  await expect(page.getByRole('heading',{name:'Confirm your Discord account'})).toBeFocused();
  await expect(page.getByText('SyntheticDiscordUser',{exact:true})).toBeVisible();
  await page.screenshot({path:`.local/provider-migration/${test.info().project.name}-discord-review.png`,fullPage:true});
  expect(await page.evaluate(()=>preview.confirms)).toBe(0);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByText('Canceled. No provider linked; PIN still works.')).toBeVisible();
  expect(await page.evaluate(()=>preview.confirms)).toBe(0);
  await expect(page.getByRole('heading',{name:'My List',exact:true})).toBeFocused();
});
test('confirmation is explicit, does not overflow, and keeps synthetic list intact',async({page})=>{
  await page.getByRole('button',{name:'Review Discord sign-in'}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Connect this Discord account'}).click();
  await expect(page.getByText('Simulation complete. Same trainer account; all data preserved.')).toBeVisible();
  await expect(page.getByText('Pikachu · shiny · high priority')).toBeVisible();
  expect(await page.evaluate(()=>preview.confirms)).toBe(1);
});
test('account switch removes reminder and provider text is never interpreted as HTML',async({page})=>{
  await page.evaluate(()=>preview.switchAccount());await expect(page.getByRole('button',{name:'Review Discord sign-in'})).toHaveCount(0);
  await page.evaluate(()=>preview.renderMaliciousLabel());await expect(page.getByText('<img src=x onerror=alert(1)>',{exact:true})).toBeVisible();
  await expect(page.locator('#security img')).toHaveCount(0);
});
test('recovery snapshot captures acknowledged and reviewed IndexedDB records in one owner partition',async({page})=>{
  const path=require('node:path');
  for(const file of['js/domain/accountSyncModel.js','js/data/accountSyncJournal.js','js/dev/accountRecoveryJournalSnapshot.js'])await page.addScriptTag({path:path.join(__dirname,'..',file)});
  const result=await page.evaluate(async()=>{
    const api=window.PogoData.accountSyncJournal,model=window.PogoDomain.accountSyncModel,ownerUid='synthetic-owner',databaseName=`recovery-${crypto.randomUUID()}`;
    const a=api.createAccountSyncJournal({ownerUid,databaseName}),b=api.createAccountSyncJournal({ownerUid:'other-owner',databaseName});
    const identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:25:base'},entityId=model.tradeEntryId(identity);
    const op=(await model.createOperation({ownerUid,entityType:'tradeEntry',entityId,identity,kind:'add',patch:{priority:'H'},baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},clientAt:10})).value;
    await a.enqueueOperation(op);await a.acknowledge(op.operationId,{revision:2});
    await a.putRecoveryCandidate({ownerUid,candidateId:'reviewed-candidate',createdAt:10,resolved:true});
    await a.setMeta('retained-evidence',{accepted:true});await b.setMeta('private-other',{mustNotLeak:true});
    const reader=window.PogoDev.accountRecoveryJournalSnapshot.createAccountRecoveryJournalSnapshot({ownerUid,databaseName});
    const snapshot=await reader.captureOwnerSnapshot();await a.close();
    const reopened=api.createAccountSyncJournal({ownerUid,databaseName}),again=await reader.captureOwnerSnapshot();
    await reopened.close();await b.close();
    return{snapshot,equal:JSON.stringify(snapshot)===JSON.stringify(again)};
  });
  expect(result.equal).toBe(true);expect(result.snapshot.stores.operations[0].status).toBe('acknowledged');
  expect(result.snapshot.stores.recoveryCandidates[0].resolved).toBe(true);
  expect(JSON.stringify(result.snapshot)).not.toContain('mustNotLeak');expect(Object.keys(result.snapshot.stores)).toHaveLength(5);
});
test('real Web Locks serialize competing auth commits across browser tabs',async({page,context})=>{
  const path=require('node:path'),other=await context.newPage();await other.goto('/tests/fixtures/provider-migration-preview.html');
  for(const target of[page,other]){
    await target.addScriptTag({path:path.join(__dirname,'../js/dev/providerAuthCommitGate.js')});
    await target.evaluate(()=>{
      let hook=null;
      // Deliberately stale isolated observers: the shared IDB checkpoint must arbitrate.
      const auth={currentUser:null};
      window.commitGate=window.PogoDev.providerAuthCommitGate.createProviderAuthCommitGate({auth,getLifecycle:()=>auth.currentUser?.uid||'signed-out',
        beforeAuthStateChanged:(a,callback)=>{hook=callback;return()=>{hook=null;};},
        signInWithCustomToken:async(a,uid)=>{await new Promise(resolve=>setTimeout(resolve,100));await hook({uid});auth.currentUser={uid};return{user:{uid}};}});
    });
    await target.evaluate(()=>commitGate.ready());
  }
  const results=await Promise.all([
    page.evaluate(()=>commitGate.commitCustomToken({customToken:'synthetic-owner-a',expectedUid:'synthetic-owner-a',expectedLifecycle:'signed-out'}).then(()=>({ok:true}),error=>({ok:false,code:error.code}))),
    other.evaluate(()=>commitGate.commitCustomToken({customToken:'synthetic-owner-b',expectedUid:'synthetic-owner-b',expectedLifecycle:'signed-out'}).then(()=>({ok:true}),error=>({ok:false,code:error.code})))
  ]);
  expect(results.filter(row=>row.ok)).toHaveLength(1);expect(results.find(row=>!row.ok).code).toBe('provider-auth/session-changed');await other.close();
});
test('standalone callback scrubs the URL, keeps code only in memory and fails safely after reload',async({page})=>{
  const requests=[];page.on('request',request=>requests.push(request));
  await page.goto(`/auth/discord.html?code=synthetic-callback-code&state=${'s'.repeat(43)}&iss=https%3A%2F%2Fdiscord.com`);
  await expect(page.getByRole('heading',{name:'Return to PoGo Trades'})).toBeVisible();
  expect(page.url()).not.toMatch(/code=|state=|iss=/);await expect(page.locator('body')).not.toContainText('synthetic-callback-code');
  expect(await page.evaluate(()=>window.PogoDev.discordCallbackPage.take().code)).toBe('synthetic-callback-code');
  expect(await page.evaluate(()=>window.PogoDev.discordCallbackPage.take())).toBeNull();
  const script=requests.find(request=>request.url().includes('discordCallbackPage.js'));expect(script.headers().referer).toBeUndefined();
  expect(requests.every(request=>request.url().startsWith('http://127.0.0.1:8886/'))).toBe(true);
  await page.reload();await expect(page.locator('#discord-callback-status')).toContainText('could not be resumed');
});
test('readonly recovery capture cannot create a missing journal or report it as complete',async({page})=>{
  const path=require('node:path');for(const file of['js/domain/accountSyncModel.js','js/dev/accountRecoveryJournalSnapshot.js'])await page.addScriptTag({path:path.join(__dirname,'..',file)});
  const result=await page.evaluate(async()=>{
    const databaseName=`missing-recovery-${crypto.randomUUID()}`,reader=window.PogoDev.accountRecoveryJournalSnapshot.createAccountRecoveryJournalSnapshot({ownerUid:'synthetic-owner',databaseName});
    const code=await reader.captureOwnerSnapshot().then(()=>null,error=>error.code);
    return{code,created:(await indexedDB.databases()).some(value=>value.name===databaseName)};
  });
  expect(result).toEqual({code:'recovery/journal-missing',created:false});
});

test('reviewed checkpoint reconciliation survives reload and arbitrates two tabs without resetting unknown outcomes',async({page,context})=>{
 const path=require('node:path'),other=await context.newPage();await other.goto('/tests/fixtures/provider-migration-preview.html');
 const install=async target=>{await target.addScriptTag({path:path.join(__dirname,'../js/dev/providerAuthCommitGate.js')});await target.evaluate(()=>{
  const module=PogoDev.providerAuthCommitGate;window.ledger=module.createLedger(indexedDB);window.auth={currentUser:{uid:'synthetic-recovery-owner'},authStateReady:async()=>{}};
  window.recoveryGate=module.createProviderAuthCommitGate({auth,coordination:ledger,getLifecycle:()=>auth.currentUser?.uid||'signed-out',beforeAuthStateChanged:()=>()=>{},signInWithCustomToken:async()=>{},verifyCurrentAuth:async({user,expectedUid})=>({verified:user?.uid===expectedUid,uid:user?.uid})});
 });};
 await install(page);
 await page.evaluate(async()=>{await ledger.write({revision:1,status:'pending',uid:'',targetUid:auth.currentUser.uid,kind:'sign-in',operationId:'synthetic-completed-operation'});await ledger.writeOutcome({operationId:'synthetic-completed-operation',pendingRevision:1,kind:'sign-in',beforeUid:'',uid:auth.currentUser.uid,status:'completed'});});
 await page.reload();await install(page);await install(other);
 for(const target of[page,other])await target.evaluate(async()=>{window.ticket=await recoveryGate.prepareReconciliation();});
 expect(await page.evaluate(async()=>{try{await recoveryGate.confirmReconciliation(ticket);return'wrong';}catch(error){return error.code;}})).toBe('provider-auth/explicit-review-required');
 const results=await Promise.all([page,other].map(target=>target.evaluate(async()=>{try{return(await recoveryGate.confirmReconciliation(ticket,{accepted:true})).status;}catch{return'blocked';}})));
 expect(results.filter(value=>value==='reconciled')).toHaveLength(1);expect(await page.evaluate(async()=>(await ledger.read()).uid)).toBe('synthetic-recovery-owner');await other.close();
});

async function registrationPreview(page,{holdCommit=false}={}){
 const path=require('node:path');
 await page.route('https://doomsday126dev.github.io/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:24px;font:16px system-ui;background:#f5f1e9;color:#252b28"><main style="max-width:560px;margin:auto" id="registration"></main></body></html>'}));
 await page.goto('https://doomsday126dev.github.io/trade-app/');
 await page.addStyleTag({path:path.join(__dirname,'../css/app.css')});
 for(const file of['discordOAuthPrototypeClient.js','discordCandidateRuntime.js','discordRegistrationView.js'])await page.addScriptTag({path:path.join(__dirname,'../js/dev',file)});
 await page.evaluate(async hold=>{
   const lifecycle=`v1_${'a'.repeat(64)}`,state='s'.repeat(43),binding='b'.repeat(43);let owner='',commits=0;
   const calls=[];let runtime;
   runtime=PogoDev.discordCandidateRuntime.createDiscordCandidateRuntime({enabled:true,location:{href:location.href,assign(){}},getSessionBinding:()=>({ownerBinding:owner,lifecycleBinding:lifecycle}),getAuthorizationHeader:async()=>owner?'Bearer synthetic-id-token':'',
     invokeGateway:async(action,input)=>{calls.push(action);if(action==='complete')return{ok:true,operation:'sign-in',status:'onboarding-required',registrationToken:'r'.repeat(43),expiresInMs:300000};
       if(action==='register')return{ok:true,operation:'registration',status:'account-created',uid:'synthetic-browser-uid',customToken:'synthetic-token',canonicalTrainerName:input.requestedHandle,replay:false};
       if(action==='cancelRegistration')return{ok:true,operation:'registration',status:'canceled'};
       if(action==='readAccount'&&window.failAccountRead){window.failAccountRead=false;throw Error('synthetic account read unavailable');}
       if(action==='readAccount')return{ok:true,operation:'read-account',foundation:{schemaVersion:1,canonicalTrainerName:'TrainerNew',normalizedTrainerName:'trainernew',handleKey:'v1_747261696e65726e6577',identityKind:'provider_only',legacyAccessConfigured:false,legacyUsername:null,revision:1,status:'active'}};
       throw Error('unexpected route');},
     authGate:{commitCustomToken:async input=>{if(input.expectedUid!=='synthetic-browser-uid'||!input.isCurrent())throw Error('wrong uid');input.onCommitBoundary();if(hold)await new Promise(resolve=>window.releaseRegistration=resolve);owner=`v1_${'c'.repeat(64)}`;commits++;return{};}}});
   sessionStorage.setItem('pogo.discord.prototype.request',JSON.stringify({operation:'sign-in',requestId:`discord-${'q'.repeat(43)}`,ownerBinding:'',lifecycleBinding:lifecycle,state,issuedAt:Date.now(),expiresAt:Date.now()+300000,browserBinding:binding}));
   await runtime.completeCallback({type:'pogo:discord-callback',code:'synthetic-code',state,iss:'https://discord.com'});
   PogoDev.discordRegistrationView.mount({container:document.getElementById('registration'),runtime,onComplete:async()=>{window.accountRead=await runtime.readAccount();}});
   window.registration={runtime,calls,get commits(){return commits;},switchOwner(){owner=`v1_${'d'.repeat(64)}`;}};
 },holdCommit);
}
test('new Discord review requires consent and reads only the committed account',async({page})=>{
 await registrationPreview(page);await page.getByLabel('Trainer name',{exact:true}).fill('TrainerNew');
 await page.screenshot({path:`.local/provider-migration/${test.info().project.name}-registration-review.png`,fullPage:true});
 await page.getByRole('button',{name:'Create account',exact:true}).click();await expect(page.getByRole('status')).toContainText('Review the sharing');
 expect(await page.evaluate(()=>registration.commits)).toBe(0);
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Create account',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Finish trainer setup'})).toHaveCount(0);
 expect(await page.evaluate(()=>registration.commits)).toBe(1);expect(await page.evaluate(()=>accountRead.foundation.canonicalTrainerName)).toBe('TrainerNew');
 expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>sessionStorage.getItem(k).includes('synthetic-token')))).toHaveLength(0);
});
test('registration review cancels on the server and never signs in',async({page})=>{
 await registrationPreview(page);await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('heading',{name:'Finish trainer setup'})).toHaveCount(0);
 expect(await page.evaluate(()=>registration.commits)).toBe(0);expect(await page.evaluate(()=>registration.calls)).toEqual(['complete','cancelRegistration']);
});
test('registration refuses cancellation after the SDK commit boundary',async({page})=>{
 await registrationPreview(page,{holdCommit:true});await page.getByLabel('Trainer name',{exact:true}).fill('TrainerNew');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Create account',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>registration.runtime.getState().status)).toBe('committing');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('status')).toContainText('Finishing sign-in');
 expect(await page.evaluate(()=>registration.runtime.cancel().canCancel)).toBe(false);await page.evaluate(()=>releaseRegistration());
 await expect.poll(()=>page.evaluate(()=>registration.commits)).toBe(1);
});
test('provider switch before confirmation cannot create or read another UID',async({page})=>{
 await registrationPreview(page);await page.getByLabel('Trainer name',{exact:true}).fill('TrainerNew');await page.getByRole('checkbox').check();await page.evaluate(()=>registration.switchOwner());
 await page.getByRole('button',{name:'Create account',exact:true}).click();await expect(page.getByRole('status')).toContainText('needs checking');
 expect(await page.evaluate(()=>registration.commits)).toBe(0);expect(await page.evaluate(()=>registration.calls)).toEqual(['complete']);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('completed registration retries account loading without another auth commit',async({page})=>{
 await registrationPreview(page);await page.evaluate(()=>window.failAccountRead=true);await page.getByLabel('Trainer name',{exact:true}).fill('TrainerNew');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Create account',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('You are signed in');expect(await page.evaluate(()=>registration.commits)).toBe(1);
 await page.getByRole('button',{name:'Retry loading account',exact:true}).click();await expect(page.getByRole('heading',{name:'Finish trainer setup'})).toHaveCount(0);
 expect(await page.evaluate(()=>registration.commits)).toBe(1);expect(await page.evaluate(()=>registration.calls.filter(x=>x==='register').length)).toBe(1);
});

test('recovery review requires explicit selections, displays coverage safely, downloads a private bundle and isolates account switches',async({page})=>{
 const path=require('node:path');for(const file of ['js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/dev/accountRecoveryBundle.js','js/dev/accountRecoveryDryRun.js','js/dev/accountRecoveryBatchPlan.js','js/dev/accountRecoveryOwnerConsumer.js','js/dev/accountRecoveryReview.js'])await page.addScriptTag({path:path.join(__dirname,'..',file)});
 const source=await page.evaluate(async()=>{
   const uid='synthetic-recovery-view',model=PogoDomain.accountSyncModel,merge=PogoDomain.accountSyncMerge,bundleModel=PogoDev.accountRecoveryBundle.createAccountRecoveryBundle(),identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:25:base'},op=(await model.createOperation({ownerUid:uid,entityType:'tradeEntry',entityId:model.tradeEntryId(identity),identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},patch:{priority:'H'},clientAt:10})).value;
   const sections=Object.fromEntries(PogoDev.accountRecoveryBundle.SECTIONS.map(name=>[name,{complete:true,records:[]} ]));sections.canonicalEntities.records=[{id:`tradeEntry:${op.entityId}`,value:merge.mergeOperation(null,op,{acceptedAt:11}).value}];sections.preferences.records=[{id:'device',value:{theme:'dark',unsupportedSetting:'kept for review'}}];sections.groups.records=[{id:'<img src=x onerror=alert(1)>',value:{role:'member'}}];
   const source=await bundleModel.create({source:{ownerUid:uid,trainerHandle:'RecoveryTrainer',capturedAt:10,revision:'source'},sections}),empty=JSON.parse(JSON.stringify(sections));empty.canonicalEntities.records=[];const target=await bundleModel.create({source:{ownerUid:uid,trainerHandle:'RecoveryTrainer',capturedAt:10,revision:'target'},sections:empty});let session={uid,lifecycleId:'recovery-browser-life',accountReady:true},row=null,writes=0;
   const consumer=PogoDev.accountRecoveryOwnerConsumer.create({enabled:true,bundleModel,batchPlanner:PogoDev.accountRecoveryBatchPlan.create(),getSession:()=>session,journal:{getMeta:async()=>null,setMeta:async()=>{}},repository:{ownerUid:uid,readAccount:async()=>({meta:{ownerUid:uid,initialized:true},tradeEntries:row?{[op.entityId]:row}:{}}),applyOperation:async operation=>{writes++;row=merge.mergeOperation(null,operation,{acceptedAt:11}).value;return{ok:true};}},verifyTradeIdentity:identity=>identity});
   const controller=PogoDev.accountRecoveryReview.create({enabled:true,bundleModel,collector:{collect:async()=>target},dryRun:PogoDev.accountRecoveryDryRun.createAccountRecoveryDryRun({bundleModel}),ownerConsumer:consumer,getSession:()=>session}),container=document.createElement('div');document.querySelector('main').append(container);PogoDev.accountRecoveryReview.mount({container,controller});window.recoveryViewTest={controller,get writes(){return writes;},switch(){session={uid:'other-owner',lifecycleId:'other',accountReady:true};}};return JSON.stringify(source);
 });
 const region=page.getByRole('region',{name:'Account backup and recovery review'});await expect(region.getByRole('heading',{name:'Back up and review recovery'})).toBeFocused();
 const download=page.waitForEvent('download');await region.getByRole('button',{name:'Download account backup'}).click();expect((await download).suggestedFilename()).toBe('pogo-account-backup.json');
 await region.getByLabel('Review a backup file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(source)});await expect(region.getByRole('heading',{name:'RecoveryTrainer: 1 proposed additions'})).toBeVisible();await expect(region.getByText('Manual review: device preference: unsupportedSetting',{exact:true})).toBeVisible();await expect(region.locator('img')).toHaveCount(0);expect(await page.evaluate(()=>recoveryViewTest.writes)).toBe(0);
 await region.getByRole('button',{name:'Apply selected recovery'}).click();await expect(region.getByText('Review the additions and limits, then check the confirmation box.')).toBeVisible();
 await region.getByLabel('Add reviewed entries, Favorites and tags').check();await region.getByLabel('I reviewed the proposed additions and recovery limits.').check();await region.getByRole('button',{name:'Apply selected recovery'}).click();await expect(region.getByRole('status')).toContainText('entries: verified');expect(await page.evaluate(()=>recoveryViewTest.writes)).toBe(1);
 await region.getByRole('button',{name:'Stop recovery'}).click();await page.evaluate(()=>recoveryViewTest.switch());await region.getByLabel('Review a backup file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(source)});await expect(region.getByRole('status')).toContainText('recovery/identity-recovery-required');expect(await page.evaluate(()=>recoveryViewTest.writes)).toBe(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('completed Google signup permits another owner after real storage reload while ambiguous requests remain isolated',async({page})=>{
 const path=require('node:path');const load=()=>page.addScriptTag({path:path.join(__dirname,'../js/services/providerAccountFoundation.js')});
 const install=async(uid,life,mode='success')=>page.evaluate(({uid,life,mode})=>{
   const service=PogoServices.providerAccountFoundation,auth={currentUser:{uid,getIdToken:async()=> 'synthetic-id-token'}},foundation=name=>({schemaVersion:1,canonicalTrainerName:name,normalizedTrainerName:name.toLowerCase(),handleKey:service.normalizeHandle(name).handleKey,legacyUsername:null,identityKind:'provider_only',legacyAccessConfigured:false,status:'active',revision:1});
   const sdk={getFunctions:()=>({}),httpsCallable:(_instance,name)=>async input=>{const calls=JSON.parse(localStorage.getItem('googleFixtureCalls')||'[]');calls.push({uid,name});localStorage.setItem('googleFixtureCalls',JSON.stringify(calls));const accounts=JSON.parse(localStorage.getItem('googleFixtureAccounts')||'{}');if(name===service.CREATE_CALLABLE){if(mode==='ambiguous')throw Error('synthetic lost request');accounts[uid]=foundation(input.requestedHandle);localStorage.setItem('googleFixtureAccounts',JSON.stringify(accounts));return{data:{code:'SUCCESS',foundation:accounts[uid]}};}return{data:accounts[uid]?{code:'SUCCESS',foundation:accounts[uid]}:{code:'FOUNDATION_NOT_INITIALIZED'}};}};
   window.googleFixture={auth,service,client:service.createProviderAccountClient({firebaseApp:{},auth,firebaseAppCheckReady:async()=>({ok:true,instance:{}}),getLifecycleSnapshot:()=>({uid:auth.currentUser?.uid,lifecycleId:life}),importFunctionsSdk:async()=>sdk,storage:localStorage,cryptoImpl:crypto})};
 },{uid,life,mode});
 await load();await install('google-owner-a','auth-1');expect(await page.evaluate(async()=>{await googleFixture.client.create({requestedHandle:'TrainerFirst'});googleFixture.client.close();googleFixture.auth.currentUser=null;return JSON.parse(localStorage.getItem(googleFixture.service.STORAGE_KEY)).phase;})).toBe('complete');
 await page.reload();await load();await install('google-owner-b','auth-2');expect(await page.evaluate(()=>googleFixture.client.pendingForCurrentOwner())).toBeNull();expect(await page.evaluate(async()=>(await googleFixture.client.create({requestedHandle:'TrainerSecond'})).foundation.canonicalTrainerName)).toBe('TrainerSecond');
 await page.reload();await load();await install('google-owner-c','auth-3','ambiguous');expect(await page.evaluate(async()=>{try{await googleFixture.client.create({requestedHandle:'TrainerThird'});}catch(error){return error.code;}})).toBe('provider-account/ambiguous-result');const pending=await page.evaluate(()=>localStorage.getItem(googleFixture.service.STORAGE_KEY));
 await page.reload();await load();await install('google-owner-d','auth-4');expect(await page.evaluate(async()=>{try{await googleFixture.client.pendingForCurrentOwner();}catch(error){return error.code;}})).toBe('provider-account/pending-owner-mismatch');expect(await page.evaluate(()=>localStorage.getItem(googleFixture.service.STORAGE_KEY))).toBe(pending);
 expect(await page.evaluate(async()=>{try{await googleFixture.client.create({requestedHandle:'TrainerFourth'});}catch(error){return error.code;}})).toBe('provider-account/pending-reconciliation');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('googleFixtureCalls')).filter(row=>row.uid==='google-owner-d').length)).toBe(0);
 await page.reload();await load();await install('google-owner-c','auth-5','ambiguous');expect(await page.evaluate(async()=>(await googleFixture.client.pendingForCurrentOwner()).handle)).toBe('TrainerThird');expect(await page.evaluate(async()=>{try{await googleFixture.client.reconcilePending();}catch(error){return error.code;}})).toBe('provider-account/ambiguous-result');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('googleFixtureCalls')).filter(row=>row.uid==='google-owner-c'&&row.name==='createE1ProviderAccountFoundation').length)).toBe(1);
});

test('checkpoint recovery UI requires checked evidence and confirmation, preserving blocked state on close',async({page})=>{
 const path=require('node:path');await page.addScriptTag({path:path.join(__dirname,'../js/dev/providerCheckpointRecovery.js')});await page.evaluate(()=>{
   const container=document.createElement('div');document.querySelector('main').append(container);let confirmations=0;window.checkpointUi={get confirmations(){return confirmations;}};
   PogoDev.providerCheckpointRecovery.mount({container,host:{available:true,prepareCheckpointRecovery:async()=>({kind:'sign-in',uid:'synthetic-canary',operationId:'synthetic-completed-operation'}),confirmCheckpointRecovery:async(_ticket,options)=>{if(options.accepted!==true)throw Error('must review');confirmations++;return{status:'reconciled'};}}});
 });
 const region=page.getByRole('region',{name:'Review interrupted sign-in checkpoint'});await expect(region.getByRole('heading',{name:'Review interrupted sign-in'})).toBeFocused();await expect(region.getByRole('button',{name:'Reconcile local checkpoint'})).toBeDisabled();await region.getByRole('button',{name:'Check current session'}).click();await expect(region.getByRole('status')).toContainText('Verified recorded sign-in');await region.getByRole('button',{name:'Reconcile local checkpoint'}).click();expect(await page.evaluate(()=>checkpointUi.confirmations)).toBe(0);await region.getByLabel('I reviewed this completed operation and current session.').check();await region.getByRole('button',{name:'Reconcile local checkpoint'}).click();await expect(region.getByRole('status')).toContainText('Local checkpoint reconciled');expect(await page.evaluate(()=>checkpointUi.confirmations)).toBe(1);await region.getByRole('button',{name:'Close review'}).click();await expect(region).toHaveCount(0);
});

test('late bootstrap activation failure preserves signed-in result and directs support without a retry loop',async({page})=>{
 const path=require('node:path');await page.addScriptTag({path:path.join(__dirname,'../js/dev/discordRegistrationView.js')});await page.evaluate(()=>{
   let confirmations=0;window.lateActivation={get confirmations(){return confirmations;}};const container=document.createElement('div');document.querySelector('main').append(container);
   PogoDev.discordRegistrationView.mount({container,runtime:{available:true,getState:()=>({status:'idle'}),confirmRegistration:async()=>{confirmations++;return{status:'account-created',uid:'synthetic-late-uid'};}},onComplete:async()=>{throw Object.assign(Error('synthetic activation refusal'),{code:'discord/bootstrap_proof_required'});}});
 });
 const section=page.getByRole('region',{name:'Finish trainer setup'});await section.getByLabel('Trainer name',{exact:true}).fill('LateTrainer');await section.getByRole('checkbox').check();await section.getByRole('button',{name:'Create account'}).click();await expect(section.getByRole('status')).toContainText('Firebase sign-in succeeded');await expect(section.getByRole('status')).toContainText('support review');await expect(section.getByRole('button',{name:'Support review needed'})).toBeDisabled();expect(await page.evaluate(()=>lateActivation.confirmations)).toBe(1);await section.getByRole('button',{name:'Close',exact:true}).click();await expect(section).toHaveCount(0);
});
