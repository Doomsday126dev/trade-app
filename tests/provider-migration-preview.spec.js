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
