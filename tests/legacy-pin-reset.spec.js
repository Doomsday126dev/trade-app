const {test,expect}=require('@playwright/test');
const {createResetService}=require('../functions/legacy-pin-reset/reset');
const {createJournal}=require('../functions/legacy-pin-reset/journal');

test('owner Admin reset, masked PINs, lost-response reconciliation and mobile layout',async({page})=>{
  const evidence={admins:{'reset-owner':true},users:{Doomsday126:{authUid:'reset-owner',isAdmin:true},Trainer:{authUid:'reset-target',authEmail:'trainer@pogotrades.nyc',authVersion:1}},
    authIndex:{'reset-owner':{username:'Doomsday126'},'reset-target':{username:'Trainer'}},loginDirectory:{Trainer:{authReady:true,authVersion:1}}};
  let value={schemaVersion:1,records:[]},generation=1,mutations=0,loseResponse=false;
  const service=createResetService({ownerUid:'reset-owner',hmacKey:'browser-test-only'.repeat(4),
    journal:createJournal({read:async()=>({value:structuredClone(value),generation}),compareAndSwap:async(expected,next)=>{expect(expected).toBe(generation);value=structuredClone(next);generation++;}}),
    adapter:{readIdentityFence:async()=>null,readEvidence:async()=>structuredClone(evidence),getAuthUser:async uid=>uid==='reset-owner'?{uid,disabled:false}:{uid,email:'trainer@pogotrades.nyc',disabled:false,metadata:{creationTime:'2026-01-01T00:00:00Z'},providerData:[{providerId:'password',uid:'trainer@pogotrades.nyc'}]},
      legacyOnly:async()=>true,listAuthIdentities:async()=>[{uid:'reset-target',email:'trainer@pogotrades.nyc'}],updatePassword:async()=>{mutations++;}}});
  await page.exposeFunction('resetFixtureTransport',async data=>{
    const result=await service.run({uid:'reset-owner',authTime:Math.floor(Date.now()/1000),appVerified:true},data);
    if(data.action==='reset'&&loseResponse){loseResponse=false;throw new Error('Response lost');}return result;
  });
  await page.route(/(?:firebaseio\.com|firebasedatabase\.app|identitytoolkit\.googleapis\.com|firestore\.googleapis\.com|cloudfunctions\.net)/,route=>route.abort());
  await page.goto('./?pin-reset-qualification');
  await page.waitForFunction(()=>typeof window.__pogoEnsureFullApp==='function');
  await page.evaluate(()=>window.__pogoEnsureFullApp('pin-reset-qualification'));
  await page.waitForFunction(()=>typeof openExistingPinReset==='function'&&window.__pogoStartup?.firebaseStartupSettledAt!=null);
  expect(await page.evaluate(()=>legacyPinResetAvailable())).toBe(false);
  await page.evaluate(()=>{
    managedSubscriptions.unsubscribeAll?.();
    auth={currentUser:{uid:'reset-owner'}};cur='Doomsday126';currentAuthUid='reset-owner';_authStateKnown=true;db=null;fbOn=false;
    activateOwnedSession('reset-owner','Doomsday126');
    allData.users={Doomsday126:{authUid:'reset-owner',isAdmin:true},Trainer:{authUid:'reset-target',authEmail:'trainer@pogotrades.nyc',authVersion:1}};
    allData.loginDirectory={Trainer:{authReady:true,authVersion:1}};
    callLegacyPinReset=data=>window.resetFixtureTransport(data);
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    switchTab('admin',{render:false});renderAdmin();setAdminSection('maintenance');
  });
  expect(await page.evaluate(()=>protectedOwnerSession())).toBe(true);
  expect(await page.evaluate(()=>legacyPinResetAvailable())).toBe(true);
  const dialog=page.getByRole('dialog',{name:'Reset PIN'});
  await page.locator('[data-admin-user-action="reset-existing"][data-username="Trainer"]').click();
  await expect(dialog.getByLabel('New PIN',{exact:true})).toBeEnabled();
  await expect(dialog).toContainText('Trainer');await expect(dialog).toContainText('Account created');
  expect(await dialog.innerText()).not.toContain('reset-target');
  await expect(dialog.getByLabel('New PIN',{exact:true})).toHaveAttribute('type','password');
  await expect(dialog.getByLabel('New PIN',{exact:true})).toHaveAttribute('autocomplete','off');
  await dialog.getByLabel('New PIN',{exact:true}).fill('654321');await dialog.getByLabel('Confirm new PIN').fill('111111');
  await dialog.getByRole('button',{name:'Confirm reset'}).click();await expect(dialog).toContainText('same six-digit PIN twice');expect(mutations).toBe(0);
  await page.screenshot({path:'test-results/legacy-pin-reset-desktop.png'});
  await dialog.getByLabel('Confirm new PIN').fill('654321');await dialog.getByRole('button',{name:'Confirm reset'}).click();
  await expect(dialog).toContainText('PIN reset completed');expect(mutations).toBe(1);
  await expect(dialog.getByLabel('New PIN',{exact:true})).toHaveValue('');
  expect(await page.evaluate(()=>JSON.stringify(sessionStorage))).not.toContain('654321');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  loseResponse=true;await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>openExistingPinReset('Trainer'));
  await expect(dialog.getByLabel('New PIN',{exact:true})).toBeEnabled();
  await dialog.getByLabel('New PIN',{exact:true}).fill('765432');await dialog.getByLabel('Confirm new PIN').fill('765432');
  await dialog.getByRole('button',{name:'Confirm reset'}).click();await expect(dialog).toContainText('result is unknown');
  expect(mutations).toBe(2);await expect(dialog.getByRole('button',{name:'Confirm reset'})).toBeDisabled();
  expect(await page.evaluate(()=>JSON.stringify(sessionStorage))).not.toContain('765432');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.evaluate(()=>openExistingPinReset('Trainer'));
  await expect(dialog).toContainText('previous reset needs verification');
  await dialog.getByRole('button',{name:'Check result'}).click();await expect(dialog).toContainText('PIN reset completed');expect(mutations).toBe(2);
  const box=await dialog.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await page.screenshot({path:'test-results/legacy-pin-reset-mobile.png'});
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(()=>openExistingPinReset('Trainer'));
  await dialog.getByLabel('New PIN',{exact:true}).fill('555555');
  await page.evaluate(()=>resetSessionTransientUi('auth_loss'));
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.stringify(sessionStorage))).not.toContain('555555');
  for(const event of ['popstate','hashchange','pagehide']){
    await page.evaluate(()=>openExistingPinReset('Trainer'));
    await dialog.getByLabel('New PIN',{exact:true}).fill('001234');
    await page.evaluate(name=>{window.resetDetachedInput=existingPinResetDialog.querySelector('input');window.dispatchEvent(new Event(name));},event);
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(()=>window.resetDetachedInput.value)).toBe('');
  }
  await page.evaluate(()=>openExistingPinReset('Trainer'));
  await dialog.getByLabel('New PIN',{exact:true}).fill('001234');
  await page.evaluate(()=>switchTab('mylist',{render:false}));
  await expect(dialog).toHaveCount(0);
  await page.evaluate(()=>{cur='Trainer';renderAdmin();openExistingPinReset('Trainer');});
  expect(await page.evaluate(()=>legacyPinResetAvailable())).toBe(false);
  await expect(dialog).toHaveCount(0);await expect(page.locator('[data-admin-user-action="reset-existing"]')).toHaveCount(0);
});

test('owner inspect errors explain bounded eligibility failures without suggesting an identity repair by sign-in',async({page})=>{
  await page.route(/(?:firebaseio\.com|firebasedatabase\.app|identitytoolkit\.googleapis\.com|firestore\.googleapis\.com|cloudfunctions\.net)/,route=>route.abort());
  await page.goto('./?pin-reset-error-qualification');
  await page.waitForFunction(()=>typeof window.__pogoEnsureFullApp==='function');
  await page.evaluate(()=>window.__pogoEnsureFullApp('pin-reset-error-qualification'));
  await page.waitForFunction(()=>typeof openExistingPinReset==='function'&&window.__pogoStartup?.firebaseStartupSettledAt!=null);
  await page.evaluate(()=>{
    managedSubscriptions.unsubscribeAll?.();
    auth={currentUser:{uid:'reset-owner'}};cur='Doomsday126';currentAuthUid='reset-owner';_authStateKnown=true;db=null;fbOn=false;
    activateOwnedSession('reset-owner','Doomsday126');
    allData.users={Doomsday126:{authUid:'reset-owner',isAdmin:true},Trainer:{authUid:'reset-target',authEmail:'trainer_v3@pogotrades.nyc',authVersion:3}};
    allData.loginDirectory={Trainer:{authReady:true,authVersion:3}};
    window.__resetErrorActions=[];
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    switchTab('admin',{render:false});renderAdmin();setAdminSection('maintenance');
  });
  const dialog=page.getByRole('dialog',{name:'Reset PIN'});
  for(const [code,text] of [
    ['reset/identity-conflict','Account identity is inconsistent.'],
    ['reset/identity-not-legacy','Account is not eligible for legacy PIN reset.'],
    ['reset/owner-required','Owner authorization could not be verified.'],
    ['reset/not-enabled','Reset service unavailable.']
  ]){
    await page.evaluate(code=>{callLegacyPinReset=async data=>{window.__resetErrorActions.push(data.action);throw Object.assign(new Error(code),{code:'functions/failed-precondition'});};openExistingPinReset('Trainer');},code);
    await expect(dialog.getByRole('status')).toContainText(text);
    await expect(dialog.getByRole('status')).toContainText('No reset was sent.');
    await expect(dialog.getByRole('status')).not.toContainText('Sign in again');
    await expect(dialog.getByLabel('New PIN',{exact:true})).toBeDisabled();
    await expect(dialog.getByRole('button',{name:'Confirm reset'})).toBeDisabled();
    await dialog.locator('[data-reset-diagnostics] summary').click();
    await expect(dialog.locator('[data-reset-diagnostics] code')).toHaveText(code);
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:844});
      const box=await dialog.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
      expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    }
    if(code==='reset/identity-conflict')await page.screenshot({path:'test-results/legacy-pin-reset-identity-error-mobile.png'});
    await dialog.getByRole('button',{name:'Close',exact:true}).click();
  }
  expect(await page.evaluate(()=>window.__resetErrorActions)).toEqual(['inspect','inspect','inspect','inspect']);
  await page.evaluate(()=>{callLegacyPinReset=async()=>{throw new Error('SDK detail 001234 private-token uid-private');};openExistingPinReset('Trainer');});
  await expect(dialog.getByRole('status')).toContainText('Reset service unavailable.');
  await expect(dialog).not.toContainText('001234');await expect(dialog).not.toContainText('private-token');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(()=>{cur='Trainer';renderAdmin();openExistingPinReset('Trainer');});
  await expect(dialog).toHaveCount(0);await expect(page.locator('[data-admin-user-action="reset-existing"]')).toHaveCount(0);
});
